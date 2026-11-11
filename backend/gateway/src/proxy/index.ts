/**
 * @file backend/gateway/src/proxy/index.ts
 * @description Upstream HTTP proxy client & internal header builder for @kartik/gateway
 * (Blueprint §2.1, §5.4, §6.3, §6.4, §11, ADR 0002 & Architecture Invariants #1, #14, #15).
 *
 * Security & architectural invariants enforced here:
 * 1. Browser `cookie`, `authorization`, `host`, and any spoofed client `x-service-*` or
 *    `x-user-context` headers are stripped before forwarding to `chat`, `agent`, or `billing`
 *    (ADR 0002). Only public Auth routes (`/auth/me`, `/auth/logout`) receive the browser's
 *    `cookie` header when `preserveCookieForAuth: true`.
 * 2. Gateway injects `x-service-caller: gateway` and `x-service-token` on every internal hop (§6.3).
 * 3. For authenticated downstream calls (`chat`, `agent`, `billing`), Gateway signs a short-lived
 *    Ed25519 `x-user-context` assertion bound strictly to the target service (`aud: target`),
 *    `sub: userId`, `sessionId`, and `traceId` — NEVER embedding `requestId` inside the assertion (§6.4).
 * 4. `x-trace-id` is always forwarded; `x-request-id` (`Idempotency-Key`) is forwarded unchanged
 *    when present (Invariant #15).
 */

import {
  AppError,
  INTERNAL_AUTH_HEADERS,
  signUserContextAssertion,
  type UserContextAudience,
} from '@kartik/shared';
import {
  resolveUpstreamServiceUrl,
  type GatewayServiceConfig,
  type UpstreamServiceTarget,
} from '../config/index.js';

export interface IntrospectedSessionIdentity {
  readonly sessionId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly expiresAt: string;
}

export interface UpstreamProxyRequest {
  readonly target: UpstreamServiceTarget;
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  /**
   * Preserves exact raw request bytes for webhook signature verification
   * (e.g. `/webhooks/razorpay` HMAC-SHA256 verification in Billing per §11).
   */
  readonly rawBody?: string | Buffer;
}

export interface UpstreamProxyResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: T;
}

export interface UpstreamHttpClient {
  forward<T = unknown>(req: UpstreamProxyRequest): Promise<UpstreamProxyResponse<T>>;
}

const HOP_BY_HOP_OR_SPOOFABLE_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'cookie',
  'authorization',
  INTERNAL_AUTH_HEADERS.SERVICE_CALLER,
  INTERNAL_AUTH_HEADERS.SERVICE_TOKEN,
  INTERNAL_AUTH_HEADERS.USER_CONTEXT,
  INTERNAL_AUTH_HEADERS.TRACE_ID,
  INTERNAL_AUTH_HEADERS.REQUEST_ID,
]);

export interface BuildDownstreamHeadersOptions {
  readonly config: Pick<
    GatewayServiceConfig,
    'SERVICE_TO_SERVICE_TOKEN' | 'USER_CONTEXT_SIGNING_KEY'
  >;
  readonly target: UpstreamServiceTarget;
  readonly traceId: string;
  readonly requestId?: string;
  readonly incomingHeaders?: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly introspectedSession?: IntrospectedSessionIdentity;
  readonly preserveCookieForAuth?: boolean;
  readonly nowSeconds?: number;
}

/**
 * Builds sanitized, authenticated headers for an upstream service hop.
 * Strips client cookies and spoofable internal headers, attaches `x-service-caller: gateway`
 * + `x-service-token`, forwards `x-trace-id` and `x-request-id` unchanged, and mints an
 * audience-scoped Ed25519 `x-user-context` assertion when `introspectedSession` is provided.
 */
export function buildDownstreamProxyHeaders(
  options: BuildDownstreamHeadersOptions,
): Record<string, string> {
  const out: Record<string, string> = {};

  if (options.incomingHeaders) {
    for (const [rawKey, rawVal] of Object.entries(options.incomingHeaders)) {
      if (rawVal === undefined) {
        continue;
      }
      const lower = rawKey.toLowerCase();
      if (lower === 'cookie' && options.preserveCookieForAuth && options.target === 'auth') {
        out.cookie = typeof rawVal === 'string' ? rawVal : (rawVal[0] ?? '');
        continue;
      }
      if (HOP_BY_HOP_OR_SPOOFABLE_HEADERS.has(lower)) {
        continue;
      }
      const val = typeof rawVal === 'string' ? rawVal : (rawVal[0] ?? '');
      if (val.length > 0) {
        out[lower] = val;
      }
    }
  }

  out[INTERNAL_AUTH_HEADERS.SERVICE_CALLER] = 'gateway';
  out[INTERNAL_AUTH_HEADERS.SERVICE_TOKEN] = options.config.SERVICE_TO_SERVICE_TOKEN;
  out[INTERNAL_AUTH_HEADERS.TRACE_ID] = options.traceId;

  if (options.requestId !== undefined && options.requestId.length > 0) {
    out[INTERNAL_AUTH_HEADERS.REQUEST_ID] = options.requestId;
  }

  if (options.introspectedSession && options.target !== 'auth') {
    const audience: UserContextAudience = options.target;
    const assertion = signUserContextAssertion(
      {
        sub: options.introspectedSession.userId,
        aud: audience,
        traceId: options.traceId,
        sessionId: options.introspectedSession.sessionId,
        ...(options.nowSeconds !== undefined ? { nowSeconds: options.nowSeconds } : {}),
      },
      options.config.USER_CONTEXT_SIGNING_KEY,
    );
    out[INTERNAL_AUTH_HEADERS.USER_CONTEXT] = assertion;
  }

  return out;
}

/**
 * Production HTTP client forwarding Gateway requests to internal microservices using Node `fetch`.
 */
export class FetchUpstreamHttpClient implements UpstreamHttpClient {
  private readonly config: Pick<
    GatewayServiceConfig,
    | 'AUTH_SERVICE_URL'
    | 'CHAT_SERVICE_URL'
    | 'AGENT_SERVICE_URL'
    | 'BILLING_SERVICE_URL'
    | 'UPSTREAM_TIMEOUT_MS'
  >;

  constructor(
    config: Pick<
      GatewayServiceConfig,
      | 'AUTH_SERVICE_URL'
      | 'CHAT_SERVICE_URL'
      | 'AGENT_SERVICE_URL'
      | 'BILLING_SERVICE_URL'
      | 'UPSTREAM_TIMEOUT_MS'
    >,
  ) {
    this.config = config;
  }

  async forward<T = unknown>(req: UpstreamProxyRequest): Promise<UpstreamProxyResponse<T>> {
    const baseUrl = resolveUpstreamServiceUrl(this.config, req.target);
    const normalizedPath = req.path.startsWith('/') ? req.path : `/${req.path}`;
    const url = `${baseUrl}${normalizedPath}`;

    const headers: Record<string, string> = { ...req.headers };
    let bodyPayload: string | undefined;

    if (req.rawBody !== undefined) {
      bodyPayload =
        typeof req.rawBody === 'string' ? req.rawBody : req.rawBody.toString('utf8');
    } else if (req.body !== undefined && req.method.toUpperCase() !== 'GET' && req.method.toUpperCase() !== 'HEAD') {
      headers['content-type'] = headers['content-type'] ?? 'application/json';
      bodyPayload = JSON.stringify(req.body);
    }

    try {
      const response = await fetch(url, {
        method: req.method.toUpperCase(),
        headers,
        ...(bodyPayload !== undefined ? { body: bodyPayload } : {}),
        signal: AbortSignal.timeout(this.config.UPSTREAM_TIMEOUT_MS),
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      const text = await response.text();
      let parsedBody: unknown = null;
      if (text.length > 0) {
        try {
          parsedBody = JSON.parse(text);
        } catch {
          parsedBody = text;
        }
      }

      return {
        statusCode: response.status,
        headers: responseHeaders,
        body: parsedBody as T,
      };
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        throw new AppError(
          'PROVIDER_TIMEOUT',
          `Upstream service "${req.target}" timed out after ${this.config.UPSTREAM_TIMEOUT_MS}ms`,
        );
      }
      if (req.target === 'billing') {
        throw new AppError(
          'BILLING_UNAVAILABLE',
          'Billing service is temporarily unreachable; retry with the same Idempotency-Key',
        );
      }
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Upstream service "${req.target}" is temporarily unreachable`,
      );
    }
  }
}

export type InMemoryUpstreamHandler = (
  req: UpstreamProxyRequest,
) => Promise<UpstreamProxyResponse> | UpstreamProxyResponse;

/**
 * Deterministic in-memory upstream transport for unit & contract testing without TCP sockets.
 * Records every forwarded request so tests can inspect injected headers and stripped cookies.
 */
export class InMemoryUpstreamHttpClient implements UpstreamHttpClient {
  public readonly recordedRequests: UpstreamProxyRequest[] = [];
  private readonly handlers = new Map<string, InMemoryUpstreamHandler>();
  private fallbackHandler?: InMemoryUpstreamHandler;

  registerHandler(
    target: UpstreamServiceTarget,
    method: string,
    path: string,
    handler: InMemoryUpstreamHandler,
  ): void {
    const key = `${target}:${method.toUpperCase()}:${path}`;
    this.handlers.set(key, handler);
  }

  setFallbackHandler(handler: InMemoryUpstreamHandler): void {
    this.fallbackHandler = handler;
  }

  async forward<T = unknown>(req: UpstreamProxyRequest): Promise<UpstreamProxyResponse<T>> {
    const cleanPath = req.path.split('?')[0] ?? req.path;
    const snapshot: UpstreamProxyRequest = {
      ...req,
      method: req.method.toUpperCase(),
      headers: { ...req.headers },
    };
    this.recordedRequests.push(snapshot);

    const key = `${req.target}:${req.method.toUpperCase()}:${cleanPath}`;
    const handler = this.handlers.get(key) ?? this.fallbackHandler;
    if (!handler) {
      throw new AppError(
        req.target === 'billing' ? 'BILLING_UNAVAILABLE' : 'PROVIDER_UNAVAILABLE',
        `No in-memory upstream handler registered for ${key}`,
      );
    }

    const res = await handler(snapshot);
    return res as UpstreamProxyResponse<T>;
  }
}
