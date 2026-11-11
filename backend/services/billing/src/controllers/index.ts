/**
 * @kartik/billing/controllers — HTTP Controller Handlers for Public & Internal Billing Routes
 * (Micro-step 4.4.a — Blueprint §5.4, §5.5, §7.2 Phase 4 Exit Gate, §9 Invariants #5, #6, #15, #17 & §11).
 */

import {
  AppError,
  createSuccessEnvelope,
  getSingleHeader,
  type BillingOperation,
  type MiddlewareRequest,
  type MiddlewareResponse,
  type SpecialistAgentName,
} from '@kartik/shared';
import { DEFAULT_BILLING_PLANS } from '../models/index.js';
import type { BillingRepository } from '../repositories/index.js';
import type {
  CreditReservationService,
  PaymentOrderService,
} from '../services/index.js';

export interface BillingHttpRequest extends MiddlewareRequest {
  readonly body?: unknown;
  readonly rawBody?: string | Buffer;
}

export interface BillingControllerDependencies {
  readonly repository: BillingRepository;
  readonly creditService: CreditReservationService;
  readonly paymentService: PaymentOrderService;
  readonly checkReadiness?: () => Promise<boolean>;
}

function asObjectBody(body: unknown): Record<string, unknown> {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return {};
}

export class BillingController {
  private readonly repository: BillingRepository;
  private readonly creditService: CreditReservationService;
  private readonly paymentService: PaymentOrderService;
  private readonly checkReadiness?: () => Promise<boolean>;

  constructor(deps: BillingControllerDependencies) {
    this.repository = deps.repository;
    this.creditService = deps.creditService;
    this.paymentService = deps.paymentService;
    this.checkReadiness = deps.checkReadiness;
  }

  private requireAuthenticatedUserId(req: BillingHttpRequest): string {
    const userId = req.requestContext?.userContext?.sub;
    if (!userId || !userId.trim()) {
      throw new AppError('UNAUTHENTICATED', 'Missing verified user-context assertion');
    }
    return userId.trim();
  }

  private requireRequestId(req: BillingHttpRequest): string {
    const requestId =
      req.requestContext?.requestId ??
      getSingleHeader(req.headers, 'x-request-id') ??
      getSingleHeader(req.headers, 'idempotency-key');
    if (!requestId || !requestId.trim()) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Idempotency-Key (x-request-id) header is required for mutating billing operations',
      );
    }
    return requestId.trim();
  }

  /**
   * `GET /billing/balance`
   * Returns the authenticated user's credit account balance (`availableCredits`, `reservedCredits`)
   * and available server-side integer paise plans.
   */
  async handleGetBalance(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const userId = this.requireAuthenticatedUserId(req);
    const account = await this.creditService.getBalance(userId);
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';

    res.status(200).json(
      createSuccessEnvelope(traceId, {
        account,
        plans: DEFAULT_BILLING_PLANS,
      }),
    );
  }

  /**
   * `GET /billing/ledger`
   * Returns the authenticated user's credit ledger entries in newest-first order.
   */
  async handleGetLedger(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const userId = this.requireAuthenticatedUserId(req);
    await this.creditService.getBalance(userId);
    const entries = await this.repository.listLedgerEntries(userId, 50);
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';

    res.status(200).json(
      createSuccessEnvelope(traceId, {
        entries,
      }),
    );
  }

  /**
   * `POST /billing/orders`
   * Creates a payment order using server-calculated integer paise pricing for `planId` (§11).
   */
  async handleCreateOrder(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const userId = this.requireAuthenticatedUserId(req);
    const requestId = this.requireRequestId(req);
    const body = asObjectBody(req.body);
    const planId = typeof body.planId === 'string' ? body.planId.trim() : '';

    if (!planId) {
      throw new AppError('VALIDATION_FAILED', 'Request body must include planId', {
        details: { planId: ['Must be a non-empty string'] },
      });
    }

    const order = await this.paymentService.createOrder({
      userId,
      requestId,
      planId,
    });

    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    res.status(200).json(createSuccessEnvelope(traceId, { order }, { requestId }));
  }

  /**
   * `POST /billing/verify`
   * Verifies the Razorpay checkout HMAC (`order_id|payment_id` with `RAZORPAY_KEY_SECRET`)
   * and credits the user's account idempotently (§11).
   */
  async handleVerifyCheckout(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const userId = this.requireAuthenticatedUserId(req);
    const requestId = this.requireRequestId(req);
    const body = asObjectBody(req.body);

    const razorpayOrderId =
      typeof body.razorpayOrderId === 'string' ? body.razorpayOrderId.trim() : '';
    const razorpayPaymentId =
      typeof body.razorpayPaymentId === 'string' ? body.razorpayPaymentId.trim() : '';
    const razorpaySignature =
      typeof body.razorpaySignature === 'string' ? body.razorpaySignature.trim() : '';
    const amountPaise =
      typeof body.amountPaise === 'number' ? body.amountPaise : undefined;

    const settled = await this.paymentService.verifyCheckoutPayment({
      userId,
      requestId,
      razorpayOrderId,
      razorpayPaymentId,
      razorpaySignature,
      ...(amountPaise !== undefined ? { amountPaise } : {}),
    });

    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    res.status(200).json(createSuccessEnvelope(traceId, settled, { requestId }));
  }

  /**
   * `POST /webhooks/razorpay`
   * Verifies the Razorpay webhook HMAC over the exact unparsed `rawBody` (`RAZORPAY_WEBHOOK_SECRET`)
   * and settles the payment order idempotently (§11).
   */
  async handleRazorpayWebhook(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const signatureHeader = getSingleHeader(req.headers, 'x-razorpay-signature') ?? '';
    const eventIdHeader = getSingleHeader(req.headers, 'x-razorpay-event-id');

    const rawBody =
      req.rawBody !== undefined
        ? req.rawBody
        : typeof req.body === 'string' || Buffer.isBuffer(req.body)
          ? req.body
          : '';

    const settled = await this.paymentService.handleRazorpayWebhook({
      rawBody,
      signatureHeader,
      ...(eventIdHeader ? { eventIdHeader } : {}),
    });

    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    res.status(200).json(
      createSuccessEnvelope(traceId, {
        received: true,
        newlyCredited: settled.newlyCredited,
        orderId: settled.order.id,
      }),
    );
  }

  /**
   * `POST /internal/credits/reserve`
   * Private endpoint called strictly by `@kartik/chat` before Agent execution (Invariant #6).
   */
  async handleInternalReserve(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const userId = this.requireAuthenticatedUserId(req);
    const requestId = this.requireRequestId(req);
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const body = asObjectBody(req.body);

    const conversationId =
      typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
    const agent = (typeof body.agent === 'string' ? body.agent.trim() : '') as SpecialistAgentName;
    const operation = (
      typeof body.operation === 'string' ? body.operation.trim() : ''
    ) as BillingOperation;

    const reservation = await this.creditService.reserveCredits({
      requestId,
      traceId,
      userId,
      conversationId,
      agent,
      operation,
    });

    res.status(200).json(createSuccessEnvelope(traceId, reservation, { requestId }));
  }

  /**
   * `POST /internal/credits/settle`
   * Private endpoint called strictly by `@kartik/chat` after durable Agent completion (Invariant #6).
   */
  async handleInternalSettle(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const userId = this.requireAuthenticatedUserId(req);
    const requestId = this.requireRequestId(req);
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const body = asObjectBody(req.body);

    const reservationId =
      typeof body.reservationId === 'string' ? body.reservationId.trim() : '';
    const actualUnits =
      typeof body.actualUnits === 'number' ? body.actualUnits : undefined;

    const settled = await this.creditService.settleCredits({
      requestId,
      reservationId,
      traceId,
      userId,
      ...(actualUnits !== undefined ? { actualUnits } : {}),
    });

    res.status(200).json(createSuccessEnvelope(traceId, settled, { requestId }));
  }

  /**
   * `POST /internal/credits/release`
   * Private endpoint called strictly by `@kartik/chat` on confirmed Agent failure (Invariant #6).
   */
  async handleInternalRelease(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const userId = this.requireAuthenticatedUserId(req);
    const requestId = this.requireRequestId(req);
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const body = asObjectBody(req.body);

    const reservationId =
      typeof body.reservationId === 'string' ? body.reservationId.trim() : '';
    const reason =
      typeof body.reason === 'string' ? body.reason.trim() : 'Agent execution failed';

    const released = await this.creditService.releaseCredits({
      requestId,
      reservationId,
      traceId,
      userId,
      reason,
    });

    res.status(200).json(createSuccessEnvelope(traceId, released, { requestId }));
  }

  handleHealthz(req: BillingHttpRequest, res: MiddlewareResponse): void {
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    res.status(200).json(
      createSuccessEnvelope(traceId, {
        status: 'ok',
        service: 'billing',
      }),
    );
  }

  async handleReadyz(req: BillingHttpRequest, res: MiddlewareResponse): Promise<void> {
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const ready = this.checkReadiness ? await this.checkReadiness() : true;
    if (!ready) {
      throw new AppError(
        'BILLING_UNAVAILABLE',
        'Billing dependencies (Postgres/Redis) are not ready.',
      );
    }
    res.status(200).json(
      createSuccessEnvelope(traceId, {
        status: 'ready',
        service: 'billing',
      }),
    );
  }
}
