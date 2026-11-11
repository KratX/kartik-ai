/**
 * @kartik/billing/routes — Public & Internal Route Dispatcher (Micro-step 4.4.a — Phase 4 Exit Gate).
 *
 * Public routes (forwarded by API Gateway with `x-service-caller: gateway`):
 * - `GET /billing/balance` (or `/api/v1/billing/balance`)
 * - `GET /billing/ledger` (or `/api/v1/billing/ledger`)
 * - `POST /billing/orders` (or `/api/v1/billing/orders`)
 * - `POST /billing/verify` (or `/api/v1/billing/verify`)
 * - `POST /webhooks/razorpay` (or `/api/v1/webhooks/razorpay`)
 * - `GET /healthz` & `GET /readyz`
 *
 * Internal routes (called strictly by `@kartik/chat` with `x-service-caller: chat` — Invariant #6 & #14):
 * - `POST /internal/credits/reserve`
 * - `POST /internal/credits/settle`
 * - `POST /internal/credits/release`
 */

import {
  AppError,
  InMemoryRateLimitStore,
  createErrorBoundaryMiddleware,
  type Logger,
  type MiddlewareHandler,
  type MiddlewareResponse,
  type RateLimitCounterStore,
} from '@kartik/shared';
import type { BillingServiceConfig } from '../config/index.js';
import { BillingController, type BillingHttpRequest } from '../controllers/index.js';
import {
  createBillingDemoReadOnlyMiddleware,
  createBillingRequestContextMiddleware,
  createBillingUserRateLimitMiddleware,
  createChatToBillingInternalMiddleware,
  createGatewayUserBillingMiddleware,
  createGatewayWebhookBillingMiddleware,
} from '../middleware/index.js';
import type { BillingRepository } from '../repositories/index.js';
import type {
  CreditReservationService,
  PaymentOrderService,
} from '../services/index.js';

export interface BillingRouterDependencies {
  readonly config: BillingServiceConfig;
  readonly repository: BillingRepository;
  readonly creditService: CreditReservationService;
  readonly paymentService: PaymentOrderService;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly maxBillingRequestsPerMinute?: number;
  readonly logger?: Logger;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly nowSeconds?: () => number;
}

export interface DispatchedBillingHttpResponse<T = unknown> {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: T;
}

export interface BillingRouter {
  readonly controller: BillingController;
  handle(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void>;
  execute<T = unknown>(request: {
    readonly method: string;
    readonly path: string;
    readonly headers?: Readonly<Record<string, string | readonly string[] | undefined>>;
    readonly body?: unknown;
    readonly rawBody?: string | Buffer;
    readonly ip?: string;
  }): Promise<DispatchedBillingHttpResponse<T>>;
}

async function runMiddlewareChain(
  middlewares: readonly MiddlewareHandler[],
  req: BillingHttpRequest,
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

function normalizeBillingRoutePath(rawPath: string): string {
  const withoutQuery = (rawPath.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
  if (withoutQuery.startsWith('/api/v1/')) {
    return withoutQuery.slice('/api/v1'.length);
  }
  return withoutQuery;
}

export function createBillingRouter(deps: BillingRouterDependencies): BillingRouter {
  const controller = new BillingController({
    repository: deps.repository,
    creditService: deps.creditService,
    paymentService: deps.paymentService,
    ...(deps.checkReadiness ? { checkReadiness: deps.checkReadiness } : {}),
  });

  const rateLimitStore = deps.rateLimitStore ?? new InMemoryRateLimitStore();
  const contextMw = createBillingRequestContextMiddleware(deps.logger);
  const demoReadOnlyMw = createBillingDemoReadOnlyMiddleware(deps.config);
  const gatewayUserMw = createGatewayUserBillingMiddleware(deps.config, deps.nowSeconds);
  const gatewayWebhookMw = createGatewayWebhookBillingMiddleware(deps.config);
  const chatInternalMw = createChatToBillingInternalMiddleware(deps.config, deps.nowSeconds);
  const userRateLimitMw = createBillingUserRateLimitMiddleware({
    rateLimitStore,
    ...(deps.maxBillingRequestsPerMinute !== undefined
      ? { maxRequestsPerMinute: deps.maxBillingRequestsPerMinute }
      : {}),
    ...(deps.nowSeconds ? { nowSeconds: deps.nowSeconds } : {}),
  });
  const errorBoundary = createErrorBoundaryMiddleware(deps.logger);

  async function handle(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    try {
      await runMiddlewareChain([contextMw], req, res);

      const method = req.method.toUpperCase();
      const routePath = normalizeBillingRoutePath(req.path ?? req.url ?? '/');

      if (method === 'GET' && routePath === '/healthz') {
        controller.handleHealthz(req, res);
        return;
      }

      if (method === 'GET' && routePath === '/readyz') {
        await controller.handleReadyz(req, res);
        return;
      }

      // Public Gateway-forwarded user routes
      if (method === 'GET' && routePath === '/billing/balance') {
        await runMiddlewareChain([gatewayUserMw, userRateLimitMw], req, res);
        await controller.handleGetBalance(req, res);
        return;
      }

      if (method === 'GET' && routePath === '/billing/ledger') {
        await runMiddlewareChain([gatewayUserMw, userRateLimitMw], req, res);
        await controller.handleGetLedger(req, res);
        return;
      }

      if (method === 'POST' && routePath === '/billing/orders') {
        await runMiddlewareChain(
          [demoReadOnlyMw, gatewayUserMw, userRateLimitMw],
          req,
          res,
        );
        await controller.handleCreateOrder(req, res);
        return;
      }

      if (method === 'POST' && routePath === '/billing/verify') {
        await runMiddlewareChain(
          [demoReadOnlyMw, gatewayUserMw, userRateLimitMw],
          req,
          res,
        );
        await controller.handleVerifyCheckout(req, res);
        return;
      }

      if (method === 'POST' && routePath === '/webhooks/razorpay') {
        await runMiddlewareChain([gatewayWebhookMw], req, res);
        await controller.handleRazorpayWebhook(req, res);
        return;
      }

      // Internal Chat-to-Billing routes (Invariant #6 & #14)
      if (method === 'POST' && routePath === '/internal/credits/reserve') {
        await runMiddlewareChain([chatInternalMw], req, res);
        await controller.handleInternalReserve(req, res);
        return;
      }

      if (method === 'POST' && routePath === '/internal/credits/settle') {
        await runMiddlewareChain([chatInternalMw], req, res);
        await controller.handleInternalSettle(req, res);
        return;
      }

      if (method === 'POST' && routePath === '/internal/credits/release') {
        await runMiddlewareChain([chatInternalMw], req, res);
        await controller.handleInternalRelease(req, res);
        return;
      }

      throw new AppError(
        'NOT_FOUND',
        `Route ${method} ${routePath} not found on billing service.`,
      );
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
  }): Promise<DispatchedBillingHttpResponse<T>> {
    let statusCode = 200;
    const responseHeaders: Record<string, string> = {};
    let responseBody: unknown = undefined;

    const reqObj: BillingHttpRequest = {
      method: request.method,
      path: request.path,
      url: request.path,
      ip: request.ip ?? '127.0.0.1',
      headers: request.headers ?? {},
      body: request.body,
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
    controller,
    handle,
    execute,
  };
}
