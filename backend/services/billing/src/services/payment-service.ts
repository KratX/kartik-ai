/**
 * @kartik/billing — PaymentProvider Adapter & Transactional PaymentOrderService (Micro-step 4.3.a).
 *
 * Enforces Blueprint §9 (Invariants #5, #15, #17, #19) and §11 (Credits & payments):
 * - Browser sends only `planId` (never a price or credit amount); Billing resolves `pricePaise`
 *   and `creditsGranted` from `DEFAULT_BILLING_PLANS` server-side.
 * - `MockPaymentProvider` is the default (`BILLING_MODE=mock`) so local development and automated
 *   tests never create live Razorpay orders.
 * - Both browser checkout verification (`verifyCheckoutPayment`) and asynchronous webhooks
 *   (`handleRazorpayWebhook`) lock the user's account with `SELECT ... FOR UPDATE` and settle
 *   the order idempotently: if checkout verification arrives first and the webhook arrives later
 *   (or vice-versa), credits are granted **exactly once**.
 */

import { createHash } from 'node:crypto';
import {
  AppError,
  computePayloadFingerprint,
  validateIdempotencyKey,
} from '@kartik/shared';
import {
  resolveBillingPlan,
  type CreditAccountRecord,
  type PaymentOrderRecord,
  type PlanId,
} from '../models/index.js';
import type { BillingRepository } from '../repositories/index.js';
import {
  parseAndVerifyRazorpayWebhook,
  verifyRazorpayCheckoutSignature,
} from '../webhooks/index.js';

export interface CreateProviderOrderInput {
  readonly userId: string;
  readonly planId: PlanId;
  readonly requestId: string;
  readonly amountPaise: number;
  readonly currency: 'INR';
}

export interface ProviderOrderResult {
  readonly providerOrderId: string;
  readonly amountPaise: number;
  readonly currency: 'INR';
  readonly mock: boolean;
}

/**
 * Provider adapter interface isolating Billing from vendor SDK details (Invariant #13 & §10).
 */
export interface PaymentProvider {
  createOrder(input: CreateProviderOrderInput): Promise<ProviderOrderResult>;
}

/**
 * Deterministic mock payment provider (`BILLING_MODE=mock`, default per Invariant #19).
 * Generates a reproducible `order_mock_<hash>` ID per `(userId, requestId)` without network I/O.
 */
export class MockPaymentProvider implements PaymentProvider {
  async createOrder(input: CreateProviderOrderInput): Promise<ProviderOrderResult> {
    const digest = createHash('sha256')
      .update(`${input.userId}:${input.requestId}:${input.planId}:${input.amountPaise}`, 'utf8')
      .digest('hex')
      .slice(0, 16);

    return {
      providerOrderId: `order_mock_${digest}`,
      amountPaise: input.amountPaise,
      currency: 'INR',
      mock: true,
    };
  }
}

export interface CreateBillingOrderRequest {
  readonly userId: string;
  readonly requestId: string;
  readonly planId: string;
}

export interface CreateBillingOrderResponse {
  readonly orderId: string;
  readonly providerOrderId: string;
  readonly planId: PlanId;
  readonly amountPaise: number;
  readonly currency: 'INR';
  readonly creditsGranted: number;
  readonly status: PaymentOrderRecord['status'];
  readonly keyId: string;
}

export interface VerifyCheckoutPaymentRequest {
  readonly userId: string;
  readonly requestId: string;
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
  /** Optional provider-reported amount in integer paise for amount-mismatch defense (§11). */
  readonly amountPaise?: number;
}

export interface PaymentSettlementResult {
  readonly order: PaymentOrderRecord;
  readonly account: CreditAccountRecord;
  readonly newlyCredited: boolean;
}

export interface PaymentOrderServiceOptions {
  readonly repository: BillingRepository;
  readonly paymentProvider?: PaymentProvider;
  readonly initialFreeCredits?: number;
  readonly razorpayKeyId?: string;
  readonly razorpayKeySecret?: string;
  readonly razorpayWebhookSecret?: string;
}

export class PaymentOrderService {
  private readonly repository: BillingRepository;
  private readonly paymentProvider: PaymentProvider;
  private readonly initialFreeCredits: number;
  private readonly razorpayKeyId: string;
  private readonly razorpayKeySecret: string;
  private readonly razorpayWebhookSecret: string;

  constructor(options: PaymentOrderServiceOptions) {
    this.repository = options.repository;
    this.paymentProvider = options.paymentProvider ?? new MockPaymentProvider();
    this.initialFreeCredits = options.initialFreeCredits ?? 100;
    this.razorpayKeyId = options.razorpayKeyId ?? 'rzp_test_mock_key_id';
    this.razorpayKeySecret = options.razorpayKeySecret ?? 'rzp_test_mock_key_secret_0001';
    this.razorpayWebhookSecret =
      options.razorpayWebhookSecret ?? 'rzp_test_mock_webhook_secret_0001';
  }

  /**
   * Creates a payment order using server-calculated integer paise pricing (§11).
   * Replays idempotently if `(userId, requestId)` was already created with the same `planId`,
   * or throws `409 IDEMPOTENCY_CONFLICT` if `planId` changed.
   */
  async createOrder(req: CreateBillingOrderRequest): Promise<CreateBillingOrderResponse> {
    const requestId = validateIdempotencyKey(req.requestId);
    const userId = req.userId?.trim();
    if (!userId) {
      throw new AppError('VALIDATION_FAILED', 'userId is required');
    }

    const plan = resolveBillingPlan(req.planId);
    if (!plan || plan.pricePaise <= 0) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Plan "${String(req.planId)}" is not a purchasable paid plan`,
      );
    }

    const payloadFingerprint = computePayloadFingerprint({
      userId,
      planId: plan.id,
      amountPaise: plan.pricePaise,
      creditsGranted: plan.creditsGranted,
    });

    return this.repository.withLockedAccount(
      userId,
      this.initialFreeCredits,
      async (tx) => {
        const existing = await tx.getPaymentOrderByRequestId(requestId);
        if (existing) {
          if (existing.payloadFingerprint !== payloadFingerprint) {
            throw new AppError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency-Key was already used for a different payment plan (§5.4)',
            );
          }
          return {
            orderId: existing.id,
            providerOrderId: existing.providerOrderId,
            planId: existing.planId,
            amountPaise: existing.amountPaise,
            currency: existing.currency,
            creditsGranted: existing.creditsGranted,
            status: existing.status,
            keyId: this.razorpayKeyId,
          };
        }

        const providerOrder = await this.paymentProvider.createOrder({
          userId,
          planId: plan.id,
          requestId,
          amountPaise: plan.pricePaise,
          currency: 'INR',
        });

        const savedOrder = await tx.createPaymentOrder({
          userId,
          planId: plan.id,
          requestId,
          providerOrderId: providerOrder.providerOrderId,
          amountPaise: plan.pricePaise,
          creditsGranted: plan.creditsGranted,
          payloadFingerprint,
        });

        return {
          orderId: savedOrder.id,
          providerOrderId: savedOrder.providerOrderId,
          planId: savedOrder.planId,
          amountPaise: savedOrder.amountPaise,
          currency: savedOrder.currency,
          creditsGranted: savedOrder.creditsGranted,
          status: savedOrder.status,
          keyId: this.razorpayKeyId,
        };
      },
    );
  }

  /**
   * Verifies the Razorpay checkout signature (`order_id|payment_id` with `RAZORPAY_KEY_SECRET`)
   * and credits the user's account inside a `SELECT ... FOR UPDATE` transaction (§11).
   */
  async verifyCheckoutPayment(
    req: VerifyCheckoutPaymentRequest,
  ): Promise<PaymentSettlementResult> {
    validateIdempotencyKey(req.requestId);
    const userId = req.userId?.trim();
    if (!userId) {
      throw new AppError('VALIDATION_FAILED', 'userId is required');
    }

    verifyRazorpayCheckoutSignature({
      razorpayOrderId: req.razorpayOrderId,
      razorpayPaymentId: req.razorpayPaymentId,
      razorpaySignature: req.razorpaySignature,
      keySecret: this.razorpayKeySecret,
    });

    return this.settleVerifiedOrder({
      userId,
      providerOrderId: req.razorpayOrderId.trim(),
      providerPaymentId: req.razorpayPaymentId.trim(),
      expectedAmountPaise: req.amountPaise,
    });
  }

  /**
   * Verifies the Razorpay webhook signature over the exact `rawBody` (`RAZORPAY_WEBHOOK_SECRET`),
   * enforces webhook event idempotency, validates integer paise amount matching, and credits
   * the user's account inside a `SELECT ... FOR UPDATE` transaction (§11).
   */
  async handleRazorpayWebhook(params: {
    readonly rawBody: string | Buffer;
    readonly signatureHeader: string;
    readonly eventIdHeader?: string;
  }): Promise<PaymentSettlementResult> {
    const verifiedEvent = parseAndVerifyRazorpayWebhook({
      rawBody: params.rawBody,
      signatureHeader: params.signatureHeader,
      eventIdHeader: params.eventIdHeader,
      webhookSecret: this.razorpayWebhookSecret,
    });

    return this.settleVerifiedOrder({
      userId: verifiedEvent.userId,
      providerOrderId: verifiedEvent.providerOrderId,
      providerPaymentId: verifiedEvent.providerPaymentId,
      expectedAmountPaise: verifiedEvent.amountPaise,
      webhookEventId: verifiedEvent.eventId,
    });
  }

  private async settleVerifiedOrder(params: {
    readonly userId: string;
    readonly providerOrderId: string;
    readonly providerPaymentId: string;
    readonly expectedAmountPaise?: number;
    readonly webhookEventId?: string;
  }): Promise<PaymentSettlementResult> {
    return this.repository.withLockedAccount(
      params.userId,
      this.initialFreeCredits,
      async (tx) => {
        const order = await tx.getPaymentOrderByProviderOrderId(params.providerOrderId);
        if (!order) {
          throw new AppError('NOT_FOUND', 'Payment order not found');
        }

        if (
          params.expectedAmountPaise !== undefined &&
          params.expectedAmountPaise !== order.amountPaise
        ) {
          throw new AppError(
            'PAYMENT_VERIFICATION_FAILED',
            `Payment amount mismatch: expected ${order.amountPaise} paise, got ${params.expectedAmountPaise} paise`,
          );
        }

        if (params.webhookEventId) {
          await tx.recordWebhookEventOnce(
            params.webhookEventId,
            params.providerOrderId,
            params.providerPaymentId,
          );
        }

        // If already marked PAID (e.g. checkout verified first and webhook arrived later, or replay):
        if (order.status === 'PAID') {
          if (
            order.providerPaymentId &&
            order.providerPaymentId !== params.providerPaymentId
          ) {
            throw new AppError(
              'IDEMPOTENCY_CONFLICT',
              'Order was already settled with a different providerPaymentId',
            );
          }
          return {
            order,
            account: tx.account,
            newlyCredited: false,
          };
        }

        const paidOrder = await tx.markPaymentOrderPaid(
          order.id,
          params.providerPaymentId,
        );

        const newAvailable = tx.account.availableCredits + order.creditsGranted;
        const newLifetimeCredited = tx.account.lifetimeCredited + order.creditsGranted;

        const updatedAccount = await tx.updateAccountBalances({
          availableCredits: newAvailable,
          reservedCredits: tx.account.reservedCredits,
          lifetimeCredited: newLifetimeCredited,
          planId: order.planId,
        });

        await tx.appendLedgerEntry({
          userId: params.userId,
          requestId: order.requestId,
          entryType: 'PURCHASE_CREDIT',
          deltaCredits: order.creditsGranted,
          balanceAfter: updatedAccount.availableCredits,
          paymentOrderId: order.id,
          description: `Purchased ${order.planId} (+${order.creditsGranted} credits for ${order.amountPaise} paise)`,
        });

        return {
          order: paidOrder,
          account: updatedAccount,
          newlyCredited: true,
        };
      },
    );
  }
}
