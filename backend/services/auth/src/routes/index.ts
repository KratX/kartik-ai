/**
 * @file backend/services/auth/src/routes/index.ts
 * @description Route table & request pipeline dispatcher for @kartik/auth
 * (Blueprint §2.1, §5.4, §5.5, §6.3, §7.2 Phase 2 Exit Gate, ADR 0002).
 *
 * Public routes (reached exclusively through the API Gateway — Invariant #1):
 * - `POST /auth/google` — rate-limited by IP (`rl:ip:{ip}:{window}`), verifies Firebase ID token,
 *   upserts user in `auth.users`, creates opaque Redis session, sets `HttpOnly` cookie.
 * - `GET /auth/me` — introspects session cookie, refreshes sliding 7-day TTL, returns user.
 * - `POST /auth/logout` — revokes Redis session immediately and clears cookie.
 * - `GET /healthz` & `GET /readyz` — liveness & readiness probes.
 *
 * Private internal route (never exposed on the Gateway's public route table — Invariant #14):
 * - `POST /internal/sessions/introspect` — guarded by `createGatewayOnlyInternalMiddleware`
 *   requiring `x-service-caller: gateway` and constant-time `x-service-token`.
 */

import {
  AppError,
  createErrorBoundaryMiddleware,
  InMemoryRateLimitStore,
  type Logger,
  type MiddlewareHandler,
  type MiddlewareResponse,
  type RateLimitCounterStore,
} from '@kartik/shared';
import type { AuthServiceConfig } from '../config/index.js';
import { AuthController, type AuthHttpRequest } from '../controllers/index.js';
import {
  createAuthIpRateLimitMiddleware,
  createAuthRequestContextMiddleware,
  createGatewayOnlyInternalMiddleware,
} from '../middleware/index.js';
import type { UserRepository } from '../repositories/index.js';
import type { FirebaseTokenVerifier, SessionService } from '../services/index.js';

export interface AuthRouterDependencies {
  readonly config: AuthServiceConfig;
  readonly firebaseVerifier: FirebaseTokenVerifier;
  readonly userRepository: UserRepository;
  readonly sessionService: SessionService;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly maxAuthRequestsPerMinute?: number;
  readonly logger?: Logger;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly nowSeconds?: () => number;
}

export interface DispatchedHttpResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: T;
}

export interface AuthRouter {
  readonly controller: AuthController;
  /**
   * Express-compatible `(req, res)` handler that runs the request context,
   * route-specific security middleware, controller action, and error boundary.
   */
  handle(req: AuthHttpRequest, res: MiddlewareResponse): Promise<void>;
  /**
   * Convenience programmatic dispatcher for integration testing without binding a TCP port.
   */
  execute<T = unknown>(request: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly body?: unknown;
    readonly ip?: string;
  }): Promise<DispatchedHttpResponse<T>>;
}

async function runMiddlewareChain(
  middlewares: readonly MiddlewareHandler[],
  req: AuthHttpRequest,
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

export function createAuthRouter(deps: AuthRouterDependencies): AuthRouter {
  const controller = new AuthController({
    config: deps.config,
    firebaseVerifier: deps.firebaseVerifier,
    userRepository: deps.userRepository,
    sessionService: deps.sessionService,
    ...(deps.checkReadiness ? { checkReadiness: deps.checkReadiness } : {}),
  });

  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();
  const contextMw = createAuthRequestContextMiddleware(deps.logger);
  const ipRateLimitMw = createAuthIpRateLimitMiddleware({
    rateLimitStore,
    ...(deps.maxAuthRequestsPerMinute !== undefined
      ? { maxAuthRequestsPerMinute: deps.maxAuthRequestsPerMinute }
      : {}),
    ...(deps.nowSeconds ? { nowSeconds: deps.nowSeconds } : {}),
  });
  const gatewayInternalMw = createGatewayOnlyInternalMiddleware(deps.config);
  const errorBoundary = createErrorBoundaryMiddleware(deps.logger);

  async function handle(req: AuthHttpRequest, res: MiddlewareResponse): Promise<void> {
    try {
      await runMiddlewareChain([contextMw], req, res);

      const method = req.method.toUpperCase();
      const routePath = ((req.path ?? req.url ?? '').split('?')[0] ?? '').replace(/\/+$/, '') || '/';

      if (method === 'POST' && routePath === '/auth/google') {
        await runMiddlewareChain([ipRateLimitMw], req, res);
        await controller.handleGoogleSignIn(req, res);
        return;
      }

      if (method === 'GET' && routePath === '/auth/me') {
        await controller.handleGetMe(req, res);
        return;
      }

      if (method === 'POST' && routePath === '/auth/logout') {
        await controller.handleLogout(req, res);
        return;
      }

      if (method === 'POST' && routePath === '/internal/sessions/introspect') {
        await runMiddlewareChain([gatewayInternalMw], req, res);
        await controller.handleInternalSessionIntrospect(req, res);
        return;
      }

      if (method === 'GET' && routePath === '/healthz') {
        controller.handleHealthz(req, res);
        return;
      }

      if (method === 'GET' && routePath === '/readyz') {
        await controller.handleReadyz(req, res);
        return;
      }

      throw new AppError('NOT_FOUND', `Route ${method} ${routePath} not found on auth service.`);
    } catch (err) {
      errorBoundary(err, req, res);
    }
  }

  async function execute<T = unknown>(request: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly body?: unknown;
    readonly ip?: string;
  }): Promise<DispatchedHttpResponse<T>> {
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: unknown = undefined;

    const reqObj: AuthHttpRequest = {
      method: request.method,
      path: request.path,
      url: request.path,
      ip: request.ip ?? '127.0.0.1',
      headers: request.headers ?? {},
      body: request.body,
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
    controller,
    handle,
    execute,
  };
}
