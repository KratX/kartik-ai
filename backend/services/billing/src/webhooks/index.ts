/**
 * @kartik/billing/webhooks — Razorpay Checkout & Raw-Body Webhook Signature Verification (Micro-step 4.3.a).
 *
 * Enforces Blueprint §11 (Credits & payments):
 * - Checkout signature: HMAC-SHA256 over `${razorpayOrderId}|${razorpayPaymentId}` using `RAZORPAY_KEY_SECRET`.
 * - Webhook signature: HMAC-SHA256 over the exact unparsed `rawBody` bytes/string using `RAZORPAY_WEBHOOK_SECRET`.
 * - Different secrets, different payloads — never mix them.
 * - Constant-time comparison (`timingSafeEqual`) to prevent byte-by-byte timing attacks.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '@kartik/shared';

function constantTimeHexEquals(expectedHex: string, candidateHex: string): boolean {
  const cleanExpected = expectedHex.trim().toLowerCase();
  const cleanCandidate = candidateHex.trim().toLowerCase();
  if (
    cleanExpected.length === 0 ||
    cleanExpected.length !== cleanCandidate.length ||
    !/^[0-9a-f]+$/.test(cleanCandidate)
  ) {
    return false;
  }
  const bufA = Buffer.from(cleanExpected, 'hex');
  const bufB = Buffer.from(cleanCandidate, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Computes the expected Razorpay checkout HMAC-SHA256 signature over `${orderId}|${paymentId}`
 * using `keySecret` (§11).
 */
export function computeRazorpayCheckoutSignature(
  razorpayOrderId: string,
  razorpayPaymentId: string,
  keySecret: string,
): string {
  const payload = `${razorpayOrderId}|${razorpayPaymentId}`;
  return createHmac('sha256', keySecret).update(payload, 'utf8').digest('hex');
}

/**
 * Verifies the Razorpay checkout signature (`order_id|payment_id`) in constant time (§11).
 * Throws `400 PAYMENT_VERIFICATION_FAILED` if invalid.
 */
export function verifyRazorpayCheckoutSignature(params: {
  readonly razorpayOrderId: string;
  readonly razorpayPaymentId: string;
  readonly razorpaySignature: string;
  readonly keySecret: string;
}): void {
  if (
    !params.razorpayOrderId?.trim() ||
    !params.razorpayPaymentId?.trim() ||
    !params.razorpaySignature?.trim() ||
    !params.keySecret
  ) {
    throw new AppError(
      'PAYMENT_VERIFICATION_FAILED',
      'Missing Razorpay checkout verification parameters',
    );
  }

  const expected = computeRazorpayCheckoutSignature(
    params.razorpayOrderId.trim(),
    params.razorpayPaymentId.trim(),
    params.keySecret,
  );

  if (!constantTimeHexEquals(expected, params.razorpaySignature)) {
    throw new AppError(
      'PAYMENT_VERIFICATION_FAILED',
      'Invalid Razorpay checkout signature over order_id|payment_id',
    );
  }
}

/**
 * Computes the expected Razorpay webhook HMAC-SHA256 signature over the exact raw request body
 * using `webhookSecret` (§11).
 */
export function computeRazorpayWebhookSignature(
  rawBody: string | Buffer,
  webhookSecret: string,
): string {
  return createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
}

/**
 * Verifies the Razorpay webhook `X-Razorpay-Signature` header over the exact `rawBody`
 * using `webhookSecret` in constant time (§11).
 * Throws `400 PAYMENT_VERIFICATION_FAILED` if invalid.
 */
export function verifyRazorpayWebhookSignature(params: {
  readonly rawBody: string | Buffer;
  readonly signatureHeader: string;
  readonly webhookSecret: string;
}): void {
  const rawLength =
    typeof params.rawBody === 'string'
      ? params.rawBody.length
      : params.rawBody?.byteLength ?? 0;

  if (rawLength === 0 || !params.signatureHeader?.trim() || !params.webhookSecret) {
    throw new AppError(
      'PAYMENT_VERIFICATION_FAILED',
      'Missing Razorpay webhook raw body or X-Razorpay-Signature header',
    );
  }

  const expected = computeRazorpayWebhookSignature(params.rawBody, params.webhookSecret);
  if (!constantTimeHexEquals(expected, params.signatureHeader)) {
    throw new AppError(
      'PAYMENT_VERIFICATION_FAILED',
      'Invalid Razorpay webhook signature over raw body',
    );
  }
}

export interface VerifiedRazorpayWebhookEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly providerOrderId: string;
  readonly providerPaymentId: string;
  readonly amountPaise: number;
  readonly currency: string;
  readonly userId: string;
}

/**
 * Verifies the raw-body HMAC signature and parses a Razorpay `payment.captured` or `order.paid`
 * webhook payload without trusting unvalidated fields (§10 & §11).
 */
export function parseAndVerifyRazorpayWebhook(params: {
  readonly rawBody: string | Buffer;
  readonly signatureHeader: string;
  readonly eventIdHeader?: string;
  readonly webhookSecret: string;
}): VerifiedRazorpayWebhookEvent {
  verifyRazorpayWebhookSignature({
    rawBody: params.rawBody,
    signatureHeader: params.signatureHeader,
    webhookSecret: params.webhookSecret,
  });

  const bodyText =
    typeof params.rawBody === 'string'
      ? params.rawBody
      : params.rawBody.toString('utf8');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(bodyText) as Record<string, unknown>;
  } catch {
    throw new AppError(
      'PAYMENT_VERIFICATION_FAILED',
      'Malformed JSON in Razorpay webhook body',
    );
  }

  const eventType = typeof parsed.event === 'string' ? parsed.event.trim() : '';
  if (eventType !== 'payment.captured' && eventType !== 'order.paid') {
    throw new AppError(
      'VALIDATION_FAILED',
      `Unsupported Razorpay webhook event type: ${eventType || 'unknown'}`,
    );
  }

  const payloadObj = parsed.payload as Record<string, unknown> | undefined;
  const paymentWrapper = payloadObj?.payment as Record<string, unknown> | undefined;
  const entity = paymentWrapper?.entity as Record<string, unknown> | undefined;

  const providerPaymentId =
    typeof entity?.id === 'string' ? entity.id.trim() : '';
  const providerOrderId =
    typeof entity?.order_id === 'string' ? entity.order_id.trim() : '';
  const amountPaise =
    typeof entity?.amount === 'number' && Number.isInteger(entity.amount)
      ? entity.amount
      : -1;
  const currency =
    typeof entity?.currency === 'string' ? entity.currency.trim() : '';
  const notes = entity?.notes as Record<string, unknown> | undefined;
  const userId = typeof notes?.userId === 'string' ? notes.userId.trim() : '';

  const eventId =
    (params.eventIdHeader && params.eventIdHeader.trim()) ||
    (typeof parsed. event_id === 'string' ? parsed.event_id.trim() : '') ||
    `evt_${providerOrderId}_${providerPaymentId}`;

  if (
    !providerOrderId ||
    !providerPaymentId ||
    amountPaise <= 0 ||
    currency !== 'INR' ||
    !userId
  ) {
    throw new AppError(
      'PAYMENT_VERIFICATION_FAILED',
      'Razorpay webhook payload is missing required order_id, payment_id, integer paise amount, INR currency, or notes.userId',
    );
  }

  return {
    eventId,
    eventType,
    providerOrderId,
    providerPaymentId,
    amountPaise,
    currency,
    userId,
  };
}
