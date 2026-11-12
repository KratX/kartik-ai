/**
 * @kartik/frontend/features/billing — Server-Priced Plan Selection & Integer Paise Formatter (Micro-step 7.3.a).
 *
 * Enforces Blueprint §11 & Invariant #5:
 * 1. "Billing calculates prices and credits server-side. The browser sends a plan ID or an operation — never an authoritative amount."
 * 2. "Use integer paise for INR; never floating-point rupees for accounting."
 */

import type { KartikGatewayClient } from '../../lib/api-client.js';
import type {
  BillingPlanId,
  PaymentOrderSummary,
  PaymentVerificationResult,
} from '../../types/index.js';

export interface PlanDisplayItem {
  readonly planId: BillingPlanId;
  readonly displayName: string;
  readonly expectedCredits: number;
  readonly expectedAmountPaise: number;
  readonly formattedInrLabel: string;
}

const VALID_PLAN_IDS = new Set<BillingPlanId>([
  'starter_100',
  'pro_500',
  'scale_2000',
]);

/**
 * Formats integer paise (`number`) into an exact INR display string (`₹499.00`)
 * using integer division and modulo — never floating-point division (§11).
 */
export function formatPaiseToInrLabel(amountPaise: number): string {
  if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    throw new Error(
      `amountPaise must be a non-negative safe integer; received ${String(amountPaise)}`,
    );
  }
  const rupees = Math.trunc(amountPaise / 100);
  const paiseRemainder = amountPaise % 100;
  const paddedPaise = String(paiseRemainder).padStart(2, '0');
  return `₹${rupees.toLocaleString('en-IN')}.${paddedPaise}`;
}

export const FRONTEND_PLAN_CATALOGUE_DISPLAY: readonly PlanDisplayItem[] =
  Object.freeze([
    Object.freeze({
      planId: 'starter_100',
      displayName: 'Starter 100 Credits',
      expectedCredits: 100,
      expectedAmountPaise: 9900,
      formattedInrLabel: formatPaiseToInrLabel(9900),
    }),
    Object.freeze({
      planId: 'pro_500',
      displayName: 'Pro 500 Credits',
      expectedCredits: 500,
      expectedAmountPaise: 39900,
      formattedInrLabel: formatPaiseToInrLabel(39900),
    }),
    Object.freeze({
      planId: 'scale_2000',
      displayName: 'Scale 2000 Credits',
      expectedCredits: 2000,
      expectedAmountPaise: 129900,
      formattedInrLabel: formatPaiseToInrLabel(129900),
    }),
  ]);

export function assertValidBillingPlanId(raw: unknown): BillingPlanId {
  if (typeof raw !== 'string' || !VALID_PLAN_IDS.has(raw as BillingPlanId)) {
    throw new Error(`Unsupported billing planId: "${String(raw)}"`);
  }
  return raw as BillingPlanId;
}

/**
 * Orchestrates the browser-side Razorpay top-up flow via `/api/v1/billing/orders`
 * and `/api/v1/billing/verify` without ever sending client-calculated amounts (§11).
 */
export class BillingCheckoutController {
  private readonly client: KartikGatewayClient;

  constructor(client: KartikGatewayClient) {
    this.client = client;
  }

  public async initiatePlanTopUp(
    planId: unknown,
    idempotencyKey?: string,
  ): Promise<{
    readonly order: PaymentOrderSummary;
    readonly formattedAmount: string;
  }> {
    const validatedPlanId = assertValidBillingPlanId(planId);
    const order = await this.client.createPaymentOrder(
      validatedPlanId,
      idempotencyKey,
    );
    return Object.freeze({
      order,
      formattedAmount: formatPaiseToInrLabel(order.amountPaise),
    });
  }

  public async completeCheckoutVerification(
    input: {
      readonly razorpayOrderId: string;
      readonly razorpayPaymentId: string;
      readonly razorpaySignature: string;
    },
    idempotencyKey?: string,
  ): Promise<PaymentVerificationResult> {
    if (
      !input.razorpayOrderId?.trim() ||
      !input.razorpayPaymentId?.trim() ||
      !input.razorpaySignature?.trim()
    ) {
      throw new Error(
        'razorpayOrderId, razorpayPaymentId, and razorpaySignature are required for checkout verification',
      );
    }
    return this.client.verifyPaymentCheckout(
      {
        razorpayOrderId: input.razorpayOrderId.trim(),
        razorpayPaymentId: input.razorpayPaymentId.trim(),
        razorpaySignature: input.razorpaySignature.trim(),
      },
      idempotencyKey,
    );
  }
}
