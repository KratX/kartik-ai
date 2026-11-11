/**
 * @file backend/gateway/src/middleware/index.ts
 * @description API Gateway middleware for session cookie introspection, CORS allowlist
 * enforcement, and Origin-based CSRF protection (Blueprint §2.1, §6.3, §6.4, §11, ADR 0002).
 */

import {
  AppError,
  getSingleHeader,
  INTERNAL_AUTH_HEADERS,
  isMutatingMethod,
  type ApiResponseEnvelope,
  type MiddlewareHandler,
  type MiddlewareRequest,
  type MiddlewareResponse,
} from '@kartik/shared';
import type { GatewayServiceConfig } from '../config/index.js';
import type {
  IntrospectedSessionIdentity,
  UpstreamHttpClient,
} from '../proxy/index.js';

export interface GatewayHttpRequest extends MiddlewareRequest {
  readonly body?: unknown;
  readonly rawBody?: string | Buffer;
  introspectedSession?: IntrospectedSessionIdentity;
}

/**
 * Extracts a named cookie value from the HTTP `Cookie` request header.
 */
export function extractCookieValue(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return null;
  }
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0) {
      continue;
    }
    const name = pair.slice(0, eqIndex).trim();
    if (name === cookieName) {
      const val = pair.slice(eqIndex + 1).trim();
      return val.length > 0 ? val : null;
    }
  }
  return null;
}

export interface GatewaySessionIntrospectorOptions {
  readonly config: Pick<GatewayServiceConfig, 'SERVICE_TO_SERVICE_TOKEN'>;
  readonly upstreamClient: UpstreamHttpClient;
}

/**
 * Calls `@kartik/auth` (`POST /internal/sessions/introspect`) with `x-service-caller: gateway`
 * and `x-service-token` to resolve an opaque browser session ID into verified user claims (ADR 0002).
 */
export class GatewaySessionIntrospector {
  private readonly config: Pick<GatewayServiceConfig, 'SERVICE_TO_SERVICE_TOKEN'>;
  private readonly upstreamClient: UpstreamHttpClient;

  constructor(options: GatewaySessionIntrospectorOptions) {
    this.config = options.config;
    this.upstreamClient = options.upstreamClient;
  }

  async introspect(
    sessionId: string,
    traceId: string,
  ): Promise<IntrospectedSessionIdentity> {
    if (!sessionId || sessionId.trim().length < 16) {
      throw new AppError('UNAUTHENTICATED', 'Missing or malformed session cookie');
    }

    const response = await this.upstreamClient.forward<
      ApiResponseEnvelope<IntrospectedSessionIdentity>
    >({
      target: 'auth',
      method: 'POST',
      path: '/internal/sessions/introspect',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: this.config.SERVICE_TO_SERVICE_TOKEN,
        [INTERNAL_AUTH_HEADERS.TRACE_ID]: traceId,
      },
      body: { sessionId: sessionId.trim() },
    });

    if (response.statusCode === 403) {
      const msg =
        response.body?.error?.message ?? 'User account is disabled or forbidden';
      throw new AppError('FORBIDDEN', msg);
    }

    if (response.statusCode !== 200 || !response.body?.data?.userId) {
      const msg =
        response.body?.error?.message ?? 'Session has expired or been revoked';
      throw new AppError('UNAUTHENTICATED', msg);
    }

    return response.body.data;
  }
}

export interface GatewaySessionMiddlewareOptions {
  readonly config: Pick<GatewayServiceConfig, 'SESSION_COOKIE_NAME'>;
  readonly introspector: GatewaySessionIntrospector;
}

/**
 * Extracts `kartik_session` from the browser's `Cookie` header, introspects it via Auth,
 * and attaches `req.introspectedSession` for downstream Ed25519 assertion signing.
 */
export function createGatewaySessionMiddleware(
  options: GatewaySessionMiddlewareOptions,
): MiddlewareHandler {
  return async (req: GatewayHttpRequest, _res: MiddlewareResponse, next) => {
    try {
      const cookieHeader = getSingleHeader(req.headers, 'cookie');
      const sessionId = extractCookieValue(
        cookieHeader,
        options.config.SESSION_COOKIE_NAME,
      );
      if (!sessionId) {
        throw new AppError('UNAUTHENTICATED', 'Authentication session cookie is required');
      }

      const traceId = req.requestContext?.traceId ?? 'trc_gateway_unknown';
      const identity = await options.introspector.introspect(sessionId, traceId);
      req.introspectedSession = identity;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export interface GatewayCorsAndCsrfOptions {
  readonly allowedOrigins: readonly string[];
  /**
   * Paths exempt from Origin CSRF checks (e.g. server-to-server `/api/v1/webhooks/razorpay`
   * which authenticates via `X-Razorpay-Signature` HMAC rather than cookies).
   */
  readonly csrfExemptPaths?: readonly string[];
}

/**
 * Enforces explicit CORS origin allowlisting (`Access-Control-Allow-Credentials: true`)
 * and Origin-header CSRF protection on mutating cookie-bearing requests (§11).
 */
export function createGatewayCorsAndCsrfMiddleware(
  options: GatewayCorsAndCsrfOptions,
): MiddlewareHandler {
  const allowedSet = new Set(options.allowedOrigins);
  const csrfExempt = new Set(options.csrfExemptPaths ?? ['/api/v1/webhooks/razorpay']);

  return (req, res, next) => {
    try {
      const rawOrigin = getSingleHeader(req.headers, 'origin');
      const routePath = ((req.path ?? req.url ?? '').split('?')[0] ?? '').replace(/\/+$/, '') || '/';

      let normalizedOrigin: string | undefined;
      if (rawOrigin && rawOrigin.trim().length > 0) {
        try {
          normalizedOrigin = new URL(rawOrigin.trim()).origin;
        } catch {
          throw new AppError('FORBIDDEN', 'Malformed Origin header');
        }
      }

      if (normalizedOrigin) {
        if (!allowedSet.has(normalizedOrigin)) {
          throw new AppError(
            'FORBIDDEN',
            `Origin "${normalizedOrigin}" is not permitted by CORS policy`,
          );
        }
        res.setHeader('Access-Control-Allow-Origin', normalizedOrigin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Vary', 'Origin');
        res.setHeader(
          'Access-Control-Allow-Methods',
          'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        );
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Idempotency-Key, X-Trace-Id',
        );
      }

      // CSRF protection on mutating requests carrying a Cookie header (§11)
      const hasCookie = Boolean(getSingleHeader(req.headers, 'cookie'));
      if (isMutatingMethod(req.method) && hasCookie && !csrfExempt.has(routePath)) {
        if (!normalizedOrigin || !allowedSet.has(normalizedOrigin)) {
          throw new AppError(
            'FORBIDDEN',
            'CSRF validation failed: mutating cookie-authenticated requests require an allowed Origin header (§11)',
          );
        }
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
