/**
 * @file backend/gateway/src/routes/index.ts
 * @description Public route table, request pipeline, and reverse-proxy dispatcher for @kartik/gateway
 * (Blueprint §2.1, §5.4, §5.5, §6.3, §6.4, §7.2 Phase 3 Exit Gate, §11, §12, ADR 0002 & Invariants #1, #14, #15, #20).
 *
 * Key architectural invariants enforced at the Gateway boundary:
 * 1. Single Front Door (Invariant #1): Maps `/api/v1/*` browser requests to internal services
 *    (`auth`, `chat`, `agent`, `billing`).
 * 2. Internal Route Blocking (Invariant #14 & #20): Any browser request targeting `/internal/*`
 *    or `/api/v1/internal/*` returns `404 NOT_FOUND` immediately — never forwarded upstream.
 * 3. Run Identity vs. Trace Identity (Invariant #15 & §5.4): Gateway generates a fresh `traceId`
 *    (`trc_<uuid>`) on every incoming request and forwards the client's `Idempotency-Key`
 *    UNCHANGED as `x-request-id` (returning `400 IDEMPOTENCY_KEY_REQUIRED` when missing on
 *    mutating authenticated endpoints).
 * 4. Cookie-to-Assertion Exchange (ADR 0002 & §6.4): Introspects `kartik_session` via Auth once,
 *    strips the `Cookie` header, and mints an audience-scoped Ed25519 `x-user-context` assertion
 *    (`aud: 'chat' | 'agent' | 'billing'`).
 * 5. Raw Body Webhook Forwarding (§11): Preserves `rawBody` and `x-razorpay-signature` on
 *    `POST /api/v1/webhooks/razorpay` without requiring cookies or Origin CSRF headers.
 */

import {
  AppError,
  createDemoReadOnlyMiddleware,
  createErrorBoundaryMiddleware,
  createRateLimitMiddleware,
  createRequestContextMiddleware,
  createSuccessEnvelope,
  InMemoryRateLimitStore,
  type Logger,
  type MiddlewareHandler,
  type MiddlewareResponse,
  type RateLimitCounterStore,
} from '@kartik/shared';
import type {
  GatewayServiceConfig,
  UpstreamServiceTarget,
} from '../config/index.js';
import {
  createGatewayCorsAndCsrfMiddleware,
  createGatewaySessionMiddleware,
  GatewaySessionIntrospector,
  type GatewayHttpRequest,
} from '../middleware/index.js';
import {
  buildDownstreamProxyHeaders,
  FetchUpstreamHttpClient,
  type UpstreamHttpClient,
} from '../proxy/index.js';

export interface ResolvedGatewayRoute {
  readonly target: UpstreamServiceTarget;
  readonly upstreamPath: string;
  readonly requiresSession: boolean;
  readonly preserveCookieForAuth: boolean;
  readonly preserveRawBody: boolean;
}

/**
 * Strips optional `/api/v1` prefix and resolves a public browser path to its owning
 * internal service (`auth`, `chat`, `agent`, `billing`) and upstream path.
 * Rejects any `/internal/*` path with `404 NOT_FOUND` (Invariant #14 & #20).
 */
export function resolvePublicGatewayRoute(
  method: string,
  rawPathAndQuery: string,
): ResolvedGatewayRoute {
  const [rawPathPart = '/', queryPart] = rawPathAndQuery.split('?');
  const normalizedPath = rawPathPart.replace(/\/+$/, '') || '/';
  const querySuffix = queryPart && queryPart.length > 0 ? `?${queryPart}` : '';

  // Block any attempt to reach private /internal/* endpoints from the public Gateway (Invariant #14)
  if (
    normalizedPath === '/internal' ||
    normalizedPath.startsWith('/internal/') ||
    normalizedPath === '/api/v1/internal' ||
    normalizedPath.startsWith('/api/v1/internal/') ||
    normalizedPath.includes('/internal/')
  ) {
    throw new AppError('NOT_FOUND', `Route ${method.toUpperCase()} ${normalizedPath} not found`);
  }

  const strippedPath = normalizedPath.startsWith('/api/v1/')
    ? normalizedPath.slice('/api/v1'.length)
    : normalizedPath === '/api/v1'
      ? '/'
      : normalizedPath;

  // 1. Public Auth routes (/auth/google, /auth/me, /auth/logout)
  if (
    (method.toUpperCase() === 'POST' && strippedPath === '/auth/google') ||
    (method.toUpperCase() === 'GET' && strippedPath === '/auth/me') ||
    (method.toUpperCase() === 'POST' && strippedPath === '/auth/logout')
  ) {
    return {
      target: 'auth',
      upstreamPath: `${strippedPath}${querySuffix}`,
      requiresSession: false,
      preserveCookieForAuth: true,
      preserveRawBody: false,
    };
  }

  // 2. Razorpay Webhook route (server-to-server HMAC signature over raw body, §11)
  if (method.toUpperCase() === 'POST' && strippedPath === '/webhooks/razorpay') {
    return {
      target: 'billing',
      upstreamPath: `/webhooks/razorpay${querySuffix}`,
      requiresSession: false,
      preserveCookieForAuth: false,
      preserveRawBody: true,
    };
  }

  // 3. Chat service routes (/conversations and /conversations/*)
  if (strippedPath === '/conversations' || strippedPath.startsWith('/conversations/')) {
    return {
      target: 'chat',
      upstreamPath: `${strippedPath}${querySuffix}`,
      requiresSession: true,
      preserveCookieForAuth: false,
      preserveRawBody: false,
    };
  }

  // 4. Agent service routes (/agents/*, /files/*, /artifacts/*)
  if (
    strippedPath === '/agents' ||
    strippedPath.startsWith('/agents/') ||
    strippedPath === '/files' ||
    strippedPath.startsWith('/files/') ||
    strippedPath === '/artifacts' ||
    strippedPath.startsWith('/artifacts/')
  ) {
    return {
      target: 'agent',
      upstreamPath: `${strippedPath}${querySuffix}`,
      requiresSession: true,
      preserveCookieForAuth: false,
      preserveRawBody: false,
    };
  }

  // 5. Billing service routes (/billing and /billing/*)
  if (strippedPath === '/billing' || strippedPath.startsWith('/billing/')) {
    return {
      target: 'billing',
      upstreamPath: `${strippedPath}${querySuffix}`,
      requiresSession: true,
      preserveCookieForAuth: false,
      preserveRawBody: false,
    };
  }

  throw new AppError('NOT_FOUND', `Route ${method.toUpperCase()} ${normalizedPath} not found`);
}

export interface GatewayRouterDependencies {
  readonly config: GatewayServiceConfig;
  readonly upstreamClient?: UpstreamHttpClient;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly maxIpRequestsPerMinute?: number;
  readonly logger?: Logger;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly nowSeconds?: () => number;
}

export interface GatewayDispatchedResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: T;
}

export interface GatewayRouter {
  readonly upstreamClient: UpstreamHttpClient;
  handle(req: GatewayHttpRequest, res: MiddlewareResponse): Promise<void>;
  execute<T = unknown>(request: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly body?: unknown;
    readonly rawBody?: string | Buffer;
    readonly ip?: string;
  }): Promise<GatewayDispatchedResponse<T>>;
}

async function runMiddlewareChain(
  middlewares: readonly MiddlewareHandler[],
  req: GatewayHttpRequest,
  res: MiddlewareResponse,
): Promise<void> {
  for (const mw of middlewares) {
    let nextCalled = false;
    let forwardedError: unknown;

    await mw(req, res, (err?: unknown) => {
      nextCalled = true;
      forwardedError = err;
    });

    if (forwardedError !== undefined) {
      throw forwardedError;
    }
    if (!nextCalled) {
      return;
    }
  }
}

const IDEMPOTENCY_EXEMPT_GATEWAY_PATHS = [
  '/auth/google',
  '/api/v1/auth/google',
  '/auth/logout',
  '/api/v1/auth/logout',
  '/webhooks/razorpay',
  '/api/v1/webhooks/razorpay',
] as const;

const DEMO_READ_ONLY_EXEMPT_PATHS = [
  '/auth/logout',
  '/api/v1/auth/logout',
] as const;

export function createGatewayRouter(deps: GatewayRouterDependencies): GatewayRouter {
  const upstreamClient =
    deps.upstreamClient ?? new FetchUpstreamHttpClient(deps.config);
  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();

  const introspector = new GatewaySessionIntrospector({
    config: deps.config,
    upstreamClient,
  });

  const requestContextMw = createRequestContextMiddleware({
    role: 'gateway',
    requireIdempotencyOnMutating: true,
    idempotencyExemptPaths: IDEMPOTENCY_EXEMPT_GATEWAY_PATHS,
    ...(deps.logger ? { logger: deps.logger } : {}),
  });

  const corsCsrfMw = createGatewayCorsAndCsrfMiddleware({
    allowedOrigins: deps.config.allowedOrigins,
    csrfExemptPaths: ['/webhooks/razorpay', '/api/v1/webhooks/razorpay'],
  });

  const demoReadOnlyMw = createDemoReadOnlyMiddleware({
    enabled: () => deps.config.DEMO_READ_ONLY,
    exemptPaths: DEMO_READ_ONLY_EXEMPT_PATHS,
  });

  const ipRateLimitMw = createRateLimitMiddleware({
    store: rateLimitStore,
    mode: 'ip',
    maxRequests: deps.maxIpRequestsPerMinute ?? 120,
    windowSeconds: 60,
    failOpen: false,
    ...(deps.nowSeconds ? { nowSeconds: deps.nowSeconds } : {}),
  });

  const sessionMw = createGatewaySessionMiddleware({
    config: deps.config,
    introspector,
  });

  const errorBoundary = createErrorBoundaryMiddleware(deps.logger);

  async function handle(req: GatewayHttpRequest, res: MiddlewareResponse): Promise<void> {
    try {
      const method = req.method.toUpperCase();
      const rawUrl = req.url ?? req.path ?? '/';
      const cleanPath = (rawUrl.split('?')[0] ?? '/').replace(/\/+$/, '') || '/';

      // Handle CORS preflight OPTIONS requests after validating Origin
      if (method === 'OPTIONS') {
        await runMiddlewareChain([requestContextMw, corsCsrfMw], req, res);
        res.status(204).json(null);
        return;
      }

      // Gateway liveness & readiness probes
      if (method === 'GET' && cleanPath === '/healthz') {
        await runMiddlewareChain([requestContextMw], req, res);
        const traceId = req.requestContext?.traceId ?? 'trc_unknown';
        res.status(200).json(
          createSuccessEnvelope(traceId, { status: 'ok', service: 'gateway' }),
        );
        return;
      }

      if (method === 'GET' && cleanPath === '/readyz') {
        await runMiddlewareChain([requestContextMw], req, res);
        const traceId = req.requestContext?.traceId ?? 'trc_unknown';
        const ready = deps.checkReadiness ? await deps.checkReadiness() : true;
        if (!ready) {
          throw new AppError('INTERNAL_ERROR', 'Gateway dependencies are not ready');
        }
        res.status(200).json(
          createSuccessEnvelope(traceId, { status: 'ready', service: 'gateway' }),
        );
        return;
      }

      // 1. Resolve route first so /internal/* paths or unknown routes return 404 NOT_FOUND
      // before requiring Idempotency-Key or session introspection.
      const resolvedRoute = resolvePublicGatewayRoute(method, rawUrl);

      // 2. Run Gateway boundary middlewares (traceId/requestId, CORS/CSRF, DEMO_READ_ONLY, IP rate limit)
      await runMiddlewareChain(
        [requestContextMw, corsCsrfMw, demoReadOnlyMw, ipRateLimitMw],
        req,
        res,
      );

      // 3. If route requires an authenticated user session, introspect the cookie via Auth
      if (resolvedRoute.requiresSession) {
        await runMiddlewareChain([sessionMw], req, res);
      }

      const traceId = req.requestContext?.traceId ?? 'trc_unknown';
      const requestId = req.requestContext?.requestId;

      // 4. Build sanitized downstream headers (minting Ed25519 x-user-context assertion for chat/agent/billing)
      const downstreamHeaders = buildDownstreamProxyHeaders({
        config: deps.config,
        target: resolvedRoute.target,
        traceId,
        ...(requestId !== undefined ? { requestId } : {}),
        incomingHeaders: req.headers,
        ...(req.introspectedSession
          ? { introspectedSession: req.introspectedSession }
          : {}),
        preserveCookieForAuth: resolvedRoute.preserveCookieForAuth,
        ...(deps.nowSeconds ? { nowSeconds: deps.nowSeconds() } : {}),
      });

      // 5. Forward request to owning internal microservice
      const upstreamRes = await upstreamClient.forward({
        target: resolvedRoute.target,
        method,
        path: resolvedRoute.upstreamPath,
        headers: downstreamHeaders,
        ...(req.body !== undefined ? { body: req.body } : {}),
        ...(resolvedRoute.preserveRawBody && req.rawBody !== undefined
          ? { rawBody: req.rawBody }
          : {}),
      });

      // Forward safe response headers (Set-Cookie from Auth, Retry-After from rate limiters)
      const setCookie = upstreamRes.headers['set-cookie'];
      if (setCookie && resolvedRoute.target === 'auth') {
        res.setHeader('Set-Cookie', setCookie);
      }
      const retryAfter = upstreamRes.headers['retry-after'];
      if (retryAfter) {
        res.setHeader('Retry-After', retryAfter);
      }

      res.status(upstreamRes.statusCode).json(upstreamRes.body);
    } catch (err) {
      errorBoundary(err, req, res);
    }
  }

  async function execute<T = unknown>(request: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly body?: unknown;
    readonly rawBody?: string | Buffer;
    readonly ip?: string;
  }): Promise<GatewayDispatchedResponse<T>> {
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: unknown = undefined;

    const reqObj: GatewayHttpRequest = {
      method: request.method,
      path: request.path.split('?')[0] ?? request.path,
      url: request.path,
      ip: request.ip ?? '127.0.0.1',
      headers: request.headers ?? {},
      ...(request.body !== undefined ? { body: request.body } : {}),
      ...(request.rawBody !== undefined ? { rawBody: request.rawBody } : {}),
    };

    const resObj: MiddlewareResponse = {
      setHeader(name: string, value: string) {
        responseHeaders[name.toLowerCase()] = value;
      },
      status(code: number) {
        statusCode = code;
        return resObj;
      },
      json(payload: unknown) {
        responseBody = payload;
      },
    };

    await handle(reqObj, resObj);

    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody as T,
    };
  }

  return {
    upstreamClient,
    handle,
    execute,
  };
}
