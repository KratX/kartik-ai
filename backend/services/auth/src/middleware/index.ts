/**
 * @file backend/services/auth/src/middleware/index.ts
 * @description Auth service middleware factory functions (Blueprint §5.2, §6.3, §11, ADR 0002).
 *
 * Provides:
 * - `createAuthRequestContextMiddleware`: attaches `traceId`, `requestId`, and child logger.
 * - `createAuthRateLimitMiddleware`: IP-based pre-auth rate limiting on `/auth/google` (`rl:ip:{ip}:{window}`).
 * - `createGatewayOnlyInternalMiddleware`: enforces constant-time `x-service-caller: gateway` +
 *   `x-service-token` verification on `/internal/sessions/introspect` (Invariant #14).
 */

import {
  createInternalAuthMiddleware,
  createRateLimitMiddleware,
  createRequestContextMiddleware,
  type Logger,
  type MiddlewareHandler,
  type RateLimitCounterStore,
} from '@kartik/shared';
import type { AuthServiceConfig } from '../config/index.js';

export interface AuthMiddlewareDependencies {
  readonly config: AuthServiceConfig;
  readonly rateLimitStore: RateLimitCounterStore;
  readonly logger?: Logger;
  readonly maxAuthRequestsPerMinute?: number;
  readonly nowSeconds?: () => number;
}

/**
 * Attaches `req.requestContext` (`traceId`, optional `requestId`, and child logger) for Auth routes.
 */
export function createAuthRequestContextMiddleware(logger?: Logger): MiddlewareHandler {
  return createRequestContextMiddleware({
    role: 'service',
    ...(logger ? { logger } : {}),
  });
}

/**
 * Protects `/auth/google` against brute-force / credential-stuffing bursts per IP (`rl:ip:{ip}:{window}`).
 * Fails closed (`503 LIMITER_UNAVAILABLE`) if the rate-limit store is unreachable.
 */
export function createAuthIpRateLimitMiddleware(
  deps: Pick<AuthMiddlewareDependencies, 'rateLimitStore' | 'maxAuthRequestsPerMinute' | 'nowSeconds'>,
): MiddlewareHandler {
  return createRateLimitMiddleware({
    store: deps.rateLimitStore,
    mode: 'ip',
    scope: 'auth',
    maxRequests: deps.maxAuthRequestsPerMinute ?? 20,
    windowSeconds: 60,
    failOpen: false,
    ...(deps.nowSeconds ? { nowSeconds: deps.nowSeconds } : {}),
  });
}

/**
 * Restricts `/internal/sessions/introspect` strictly to the API Gateway (`x-service-caller: gateway`)
 * using constant-time token comparison (`x-service-token`) (Blueprint §6.3 & Invariant #14).
 */
export function createGatewayOnlyInternalMiddleware(
  config: Pick<AuthServiceConfig, 'SERVICE_TO_SERVICE_TOKEN'>,
): MiddlewareHandler {
  return createInternalAuthMiddleware({
    expectedTokenOrDirectory: config.SERVICE_TO_SERVICE_TOKEN,
    allowedCallers: ['gateway'],
    requireUserContext: false,
  });
}
