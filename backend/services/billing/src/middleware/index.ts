/**
 * @kartik/billing/middleware — Internal Caller Auth, Audience-Bound Ed25519 User Context & Rate Limits
 * (Micro-step 4.4.a — Blueprint §6.3, §6.4, §9 Invariants #5, #6, #14 & §12).
 *
 * Security boundaries enforced:
 * 1. Public user-facing Billing routes (`/billing/balance`, `/billing/ledger`, `/billing/orders`,
 *    `/billing/verify`) are reached exclusively via the API Gateway (`x-service-caller: gateway` +
 *    `GATEWAY_TO_BILLING_TOKEN`) and require a valid Ed25519 `x-user-context` assertion with
 *    `aud === "billing"` (§6.4).
 * 2. Public webhook route (`/webhooks/razorpay`) is forwarded by the API Gateway
 *    (`x-service-caller: gateway` + `GATEWAY_TO_BILLING_TOKEN`, no user-context assertion)
 *    with raw body bytes preserved for Razorpay HMAC-SHA256 verification (§11).
 * 3. Internal credit routes (`/internal/credits/reserve`, `/internal/credits/settle`,
 *    `/internal/credits/release`) are restricted strictly to `@kartik/chat`
 *    (`x-service-caller: chat` + `CHAT_TO_BILLING_TOKEN`) per Invariant #6 ("Agent never
 *    calculates, reserves, settles or mutates credits. Chat coordinates Billing around Agent execution").
 */

import {
  createDemoReadOnlyMiddleware,
  createInternalAuthMiddleware,
  createRateLimitMiddleware,
  createRequestContextMiddleware,
  type Logger,
  type MiddlewareHandler,
  type RateLimitCounterStore,
} from '@kartik/shared';
import type { BillingServiceConfig } from '../config/index.js';

export function createBillingRequestContextMiddleware(logger?: Logger): MiddlewareHandler {
  return createRequestContextMiddleware({
    role: 'service',
    ...(logger ? { logger } : {}),
  });
}

export function createBillingDemoReadOnlyMiddleware(
  config: Pick<BillingServiceConfig, 'DEMO_READ_ONLY'>,
): MiddlewareHandler {
  return createDemoReadOnlyMiddleware({
    enabled: () => config.DEMO_READ_ONLY,
  });
}

/**
 * Verifies that a user-facing Billing route was forwarded by the API Gateway
 * (`x-service-caller: gateway` + `GATEWAY_TO_BILLING_TOKEN`) and carries a valid
 * Ed25519 `x-user-context` assertion bound to `aud: "billing"` (§6.3 & §6.4).
 */
export function createGatewayUserBillingMiddleware(
  config: Pick<BillingServiceConfig, 'GATEWAY_TO_BILLING_TOKEN' | 'USER_CONTEXT_PUBLIC_KEY'>,
  nowSeconds?: () => number,
): MiddlewareHandler {
  return createInternalAuthMiddleware({
    expectedTokenOrDirectory: {
      gateway: config.GATEWAY_TO_BILLING_TOKEN,
    },
    allowedCallers: ['gateway'],
    requireUserContext: true,
    userContextPublicKey: config.USER_CONTEXT_PUBLIC_KEY,
    expectedAudience: 'billing',
    ...(nowSeconds ? { nowSeconds } : {}),
  });
}

/**
 * Verifies that `/webhooks/razorpay` was forwarded by the API Gateway
 * (`x-service-caller: gateway` + `GATEWAY_TO_BILLING_TOKEN`) without requiring a user session.
 */
export function createGatewayWebhookBillingMiddleware(
  config: Pick<BillingServiceConfig, 'GATEWAY_TO_BILLING_TOKEN'>,
): MiddlewareHandler {
  return createInternalAuthMiddleware({
    expectedTokenOrDirectory: {
      gateway: config.GATEWAY_TO_BILLING_TOKEN,
    },
    allowedCallers: ['gateway'],
    requireUserContext: false,
  });
}

/**
 * Enforces Invariant #6 & #14 on `/internal/credits/{reserve,settle,release}`:
 * ONLY `@kartik/chat` (`x-service-caller: chat` + `CHAT_TO_BILLING_TOKEN`) is permitted to
 * reserve, settle, or release credits, and the request must carry the user's Ed25519
 * `x-user-context` assertion (`aud: "billing"` or `"chat"`).
 */
export function createChatToBillingInternalMiddleware(
  config: Pick<
    BillingServiceConfig,
    'CHAT_TO_BILLING_TOKEN' | 'GATEWAY_TO_BILLING_TOKEN' | 'USER_CONTEXT_PUBLIC_KEY'
  >,
  nowSeconds?: () => number,
): MiddlewareHandler {
  return createInternalAuthMiddleware({
    expectedTokenOrDirectory: {
      chat: config.CHAT_TO_BILLING_TOKEN,
      gateway: config.GATEWAY_TO_BILLING_TOKEN,
    },
    allowedCallers: ['chat'],
    requireUserContext: true,
    userContextPublicKey: config.USER_CONTEXT_PUBLIC_KEY,
    expectedAudience: ['billing', 'chat'],
    ...(nowSeconds ? { nowSeconds } : {}),
  });
}

export function createBillingUserRateLimitMiddleware(params: {
  readonly rateLimitStore: RateLimitCounterStore;
  readonly maxRequestsPerMinute?: number;
  readonly nowSeconds?: () => number;
}): MiddlewareHandler {
  return createRateLimitMiddleware({
    store: params.rateLimitStore,
    mode: 'user',
    scope: 'billing',
    maxRequests: params.maxRequestsPerMinute ?? 30,
    windowSeconds: 60,
    failOpen: false,
    ...(params.nowSeconds ? { nowSeconds: params.nowSeconds } : {}),
  });
}
