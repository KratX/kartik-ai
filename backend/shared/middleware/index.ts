/**
 * @kartik/shared/middleware — Request Context, Run-Identity Enforcement, Rate Limiting,
 * DEMO_READ_ONLY Kill-Switch, Internal Service Auth & Error Boundary
 * (Blueprint §5.2, §5.4, §5.5, §6.3, §6.4, §12 & Architecture Invariants #14, #15).
 */
import { randomUUID } from 'node:crypto';
import {
  INTERNAL_AUTH_HEADERS,
  verifyServiceCaller,
  verifyUserContextAssertion,
  type ServiceCallerName,
  type UserContextAssertionClaims,
  type UserContextAudience,
} from '../auth/index.js';
import { IDEMPOTENCY_KEY_HEADER } from '../contracts/index.js';
import { AppError, mapErrorToHttpResponse } from '../errors/index.js';
import type { Logger } from '../logger/index.js';
import { RedisKeys, type RateLimitScope, type RedisKeySpec } from '../redis/index.js';
import { validateIdempotencyKey } from '../validation/index.js';

export interface RequestContext {
  traceId: string;
  requestId?: string;
  userContext?: UserContextAssertionClaims;
  serviceCaller?: ServiceCallerName;
  log?: Logger;
}

export interface MiddlewareRequest {
  readonly method: string;
  readonly path?: string;
  readonly url?: string;
  readonly ip?: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  requestContext?: RequestContext;
}

export interface MiddlewareResponse {
  setHeader(name: string, value: string): void;
  status(code: number): MiddlewareResponse;
  json(body: unknown): void;
}

export type NextFunction = (err?: unknown) => void;
export type MiddlewareHandler = (
  req: MiddlewareRequest,
  res: MiddlewareResponse,
  next: NextFunction,
) => void | Promise<void>;

export function getSingleHeader(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  headerName: string,
): string | undefined {
  const lower = headerName.toLowerCase();
  const direct = headers[lower] ?? headers[headerName];
  if (typeof direct === 'string') {
    return direct;
  }
  if (Array.isArray(direct)) {
    return direct[0];
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
    }
  }
  return undefined;
}

const MUTATING_HTTP_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function isMutatingMethod(method: string): boolean {
  return MUTATING_HTTP_METHODS.has(method.toUpperCase());
}

export interface RequestContextMiddlewareOptions {
  /**
   * 'gateway' generates a fresh `traceId` on every incoming browser request and validates
   * `Idempotency-Key` -> `requestId` on mutating endpoints.
   * 'service' reads `x-trace-id` and `x-request-id` forwarded by the Gateway.
   */
  readonly role: 'gateway' | 'service';
  readonly logger?: Logger;
  readonly requireIdempotencyOnMutating?: boolean;
  readonly idempotencyExemptPaths?: readonly string[];
}

/**
 * Attaches `req.requestContext` (`traceId`, optional `requestId`, and child logger)
 * and enforces the Run-Identity invariant (§5.4 & Invariant #15):
 * - Gateway generates ONLY `traceId` (`trc_<uuid>`).
 * - `requestId` comes strictly from the client's `Idempotency-Key` (never generated or rewritten).
 */
export function createRequestContextMiddleware(
  options: RequestContextMiddlewareOptions,
): MiddlewareHandler {
  const exemptPaths = new Set(options.idempotencyExemptPaths ?? []);

  return (req, res, next) => {
    try {
      const incomingTraceId = getSingleHeader(req.headers, INTERNAL_AUTH_HEADERS.TRACE_ID);
      const traceId =
        options.role === 'service' && incomingTraceId && incomingTraceId.trim().length > 0
          ? incomingTraceId.trim()
          : `trc_${randomUUID()}`;

      res.setHeader(INTERNAL_AUTH_HEADERS.TRACE_ID, traceId);

      const routePath = (req.path ?? req.url ?? '').split('?')[0] ?? '';
      const isMutating = isMutatingMethod(req.method);
      const isExempt = exemptPaths.has(routePath);

      let requestId: string | undefined;

      if (options.role === 'gateway') {
        const rawIdemKey = getSingleHeader(req.headers, IDEMPOTENCY_KEY_HEADER);
        const shouldRequireIdem =
          (options.requireIdempotencyOnMutating ?? true) && isMutating && !isExempt;

        if (shouldRequireIdem || (rawIdemKey !== undefined && rawIdemKey !== '')) {
          requestId = validateIdempotencyKey(rawIdemKey);
          res.setHeader(INTERNAL_AUTH_HEADERS.REQUEST_ID, requestId);
        }
      } else {
        const forwardedRequestId =
          getSingleHeader(req.headers, INTERNAL_AUTH_HEADERS.REQUEST_ID) ??
          getSingleHeader(req.headers, IDEMPOTENCY_KEY_HEADER);
        if (forwardedRequestId !== undefined && forwardedRequestId !== '') {
          requestId = validateIdempotencyKey(forwardedRequestId);
          res.setHeader(INTERNAL_AUTH_HEADERS.REQUEST_ID, requestId);
        }
      }

      const childLogger = options.logger
        ? options.logger.child({
            traceId,
            ...(requestId !== undefined ? { requestId } : {}),
          })
        : undefined;

      req.requestContext = {
        traceId,
        ...(requestId !== undefined ? { requestId } : {}),
        ...(childLogger !== undefined ? { log: childLogger } : {}),
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}

export interface DemoReadOnlyOptions {
  readonly enabled: boolean | (() => boolean);
  readonly exemptPaths?: readonly string[];
}

/**
 * Enforces the `DEMO_READ_ONLY` kill switch (§12):
 * Read-only methods (`GET`, `HEAD`, `OPTIONS`) pass; mutating methods return `403 DEMO_READ_ONLY`.
 */
export function createDemoReadOnlyMiddleware(options: DemoReadOnlyOptions): MiddlewareHandler {
  const exempt = new Set(options.exemptPaths ?? []);

  return (req, _res, next) => {
    const isEnabled = typeof options.enabled === 'function' ? options.enabled() : options.enabled;
    if (!isEnabled) {
      next();
      return;
    }

    const routePath = (req.path ?? req.url ?? '').split('?')[0] ?? '';
    if (isMutatingMethod(req.method) && !exempt.has(routePath)) {
      next(
        new AppError(
          'DEMO_READ_ONLY',
          'Demo is currently in read-only mode; mutating requests are disabled',
        ),
      );
      return;
    }

    next();
  };
}

export interface RateLimitCounterStore {
  incrementAndGet(keySpec: RedisKeySpec): Promise<{ readonly count: number; readonly ttlSeconds: number }>;
}

/**
 * Deterministic in-memory fixed-window rate-limit store for unit tests and local fallback.
 */
export class InMemoryRateLimitStore implements RateLimitCounterStore {
  private readonly counters = new Map<string, { count: number; ttlSeconds: number }>();

  async incrementAndGet(
    keySpec: RedisKeySpec,
  ): Promise<{ readonly count: number; readonly ttlSeconds: number }> {
    const existing = this.counters.get(keySpec.key);
    if (!existing) {
      const initial = { count: 1, ttlSeconds: keySpec.ttlSeconds };
      this.counters.set(keySpec.key, initial);
      return initial;
    }
    existing.count += 1;
    return { count: existing.count, ttlSeconds: existing.ttlSeconds };
  }
}

export interface RateLimitMiddlewareOptions {
  readonly store: RateLimitCounterStore;
  readonly mode: 'user' | 'ip';
  readonly scope?: RateLimitScope;
  readonly maxRequests: number;
  readonly windowSeconds?: number;
  readonly nowSeconds?: () => number;
  /**
   * Default `false`: if the rate-limit store fails, reject with `503 LIMITER_UNAVAILABLE`.
   */
  readonly failOpen?: boolean;
}

/**
 * Fixed-window rate-limit middleware using `RedisKeys.userRateLimit` or `RedisKeys.ipRateLimit` (§5.2 & §5.5).
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions): MiddlewareHandler {
  const windowSeconds = options.windowSeconds ?? 60;
  if (!Number.isInteger(options.maxRequests) || options.maxRequests <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Rate-limit maxRequests must be a positive integer');
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) {
    throw new AppError('VALIDATION_FAILED', 'Rate-limit windowSeconds must be a positive integer');
  }

  return async (req, res, next) => {
    const nowSec = options.nowSeconds ? options.nowSeconds() : Math.floor(Date.now() / 1000);
    const windowBucket = `w${Math.floor(nowSec / windowSeconds)}`;
    const retryAfterSeconds = Math.max(1, windowSeconds - (nowSec % windowSeconds));

    let keySpec: RedisKeySpec;
    try {
      if (options.mode === 'user') {
        const userId = req.requestContext?.userContext?.sub;
        if (!userId) {
          next(new AppError('UNAUTHENTICATED', 'User context is required for user-scoped rate limiting'));
          return;
        }
        const scope = options.scope ?? 'chat';
        keySpec = RedisKeys.userRateLimit(scope, userId, windowBucket, windowSeconds);
      } else {
        const ip = (req.ip ?? getSingleHeader(req.headers, 'x-forwarded-for') ?? '127.0.0.1')
          .split(',')[0]!
          .trim();
        keySpec = RedisKeys.ipRateLimit(ip, windowBucket, windowSeconds);
      }
    } catch (err) {
      next(err);
      return;
    }

    try {
      const { count } = await options.store.incrementAndGet(keySpec);
      res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.maxRequests - count)));

      if (count > options.maxRequests) {
        next(
          new AppError('RATE_LIMITED', 'Rate limit exceeded; please back off and retry later', {
            retryAfterSeconds,
          }),
        );
        return;
      }

      next();
    } catch {
      if (options.failOpen) {
        req.requestContext?.log?.warn('Rate-limit store unavailable; failing open as configured');
        next();
        return;
      }
      next(
        new AppError('LIMITER_UNAVAILABLE', 'Rate limiter store is temporarily unavailable', {
          retryAfterSeconds: 5,
        }),
      );
    }
  };
}

export interface InternalAuthMiddlewareOptions {
  readonly expectedTokenOrDirectory: string | Readonly<Partial<Record<ServiceCallerName, string>>>;
  readonly allowedCallers?: readonly ServiceCallerName[];
  readonly requireUserContext?: boolean;
  readonly userContextPublicKey?: string;
  readonly expectedAudience?: UserContextAudience | readonly UserContextAudience[];
  readonly nowSeconds?: () => number;
}

/**
 * Verifies service-to-service caller credentials (`x-service-caller` + `x-service-token`)
 * and optionally verifies the Gateway's Ed25519 `x-user-context` assertion (§6.3 & §6.4).
 */
export function createInternalAuthMiddleware(
  options: InternalAuthMiddlewareOptions,
): MiddlewareHandler {
  return (req, _res, next) => {
    try {
      const callerHeader = getSingleHeader(req.headers, INTERNAL_AUTH_HEADERS.SERVICE_CALLER);
      const tokenHeader = getSingleHeader(req.headers, INTERNAL_AUTH_HEADERS.SERVICE_TOKEN);

      const { caller } = verifyServiceCaller({
        callerHeader,
        tokenHeader,
        expectedTokenOrDirectory: options.expectedTokenOrDirectory,
        allowedCallers: options.allowedCallers,
      });

      if (!req.requestContext) {
        req.requestContext = { traceId: `trc_${randomUUID()}` };
      }
      req.requestContext.serviceCaller = caller;

      if (options.requireUserContext) {
        if (!options.userContextPublicKey || !options.expectedAudience) {
          throw new AppError(
            'INTERNAL_ERROR',
            'Internal auth middleware configured with requireUserContext=true is missing publicKey or expectedAudience',
          );
        }
        const assertionToken = getSingleHeader(req.headers, INTERNAL_AUTH_HEADERS.USER_CONTEXT);
        if (!assertionToken) {
          throw new AppError('UNAUTHENTICATED', 'Missing x-user-context assertion header');
        }
        const claims = verifyUserContextAssertion(assertionToken, options.userContextPublicKey, {
          expectedAudience: options.expectedAudience,
          ...(options.nowSeconds ? { nowSeconds: options.nowSeconds() } : {}),
        });
        req.requestContext.userContext = claims;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Final error-handling boundary that converts any `AppError` or unknown runtime error
 * into the canonical Kartik.ai response envelope and sets `Retry-After` when present (§5.4 & §5.5).
 */
export function createErrorBoundaryMiddleware(fallbackLogger?: Logger) {
  return (err: unknown, req: MiddlewareRequest, res: MiddlewareResponse, _next?: NextFunction): void => {
    const traceId =
      req.requestContext?.traceId ??
      getSingleHeader(req.headers, INTERNAL_AUTH_HEADERS.TRACE_ID) ??
      `trc_${randomUUID()}`;
    const requestId = req.requestContext?.requestId;

    const log = req.requestContext?.log ?? fallbackLogger;
    if (log) {
      log.error('Request failed at error boundary', {
        errorName: err instanceof Error ? err.name : 'UnknownError',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }

    const mapped = mapErrorToHttpResponse(err, { traceId, requestId });
    for (const [headerName, headerValue] of Object.entries(mapped.headers)) {
      res.setHeader(headerName, headerValue);
    }
    res.status(mapped.httpStatus).json(mapped.body);
  };
}
