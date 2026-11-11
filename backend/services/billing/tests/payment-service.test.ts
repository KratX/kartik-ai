import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '@kartik/shared';
import {
  InMemoryBillingRepository,
  MockPaymentProvider,
  PaymentOrderService,
  computeRazorpayCheckoutSignature,
  computeRazorpayWebhookSignature,
} from '../src/index.js';

const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const KEY_SECRET = 'rzp_test_key_secret_for_checkout_9999';
const WEBHOOK_SECRET = 'rzp_test_webhook_secret_for_raw_body_8888';

describe('@kartik/billing PaymentOrderService & Razorpay checkout/webhook HMAC verification (4.3.a)', () => {
  it('calculates integer paise order amounts server-side, replays idempotently, and rejects planId conflicts with 409 (§11, Invariant #15)', async () => {
    const repository = new InMemoryBillingRepository();
    const service = new PaymentOrderService({
      repository,
      paymentProvider: new MockPaymentProvider(),
      razorpayKeySecret: KEY_SECRET,
      razorpayWebhookSecret: WEBHOOK_SECRET,
    });

    const order1 = await service.createOrder({
      userId: TEST_USER_ID,
      requestId: 'idem_order_starter_0001',
      planId: 'starter_inr_499',
    });

    assert.equal(order1.amountPaise, 49_900);
    assert.equal(order1.creditsGranted, 500);
    assert.equal(order1.status, 'CREATED');

    // Exact retry with same requestId & planId -> returns identical order without creating a second one
    const orderReplay = await service.createOrder({
      userId: TEST_USER_ID,
      requestId: 'idem_order_starter_0001',
      planId: 'starter_inr_499',
    });
    assert.equal(orderReplay.orderId, order1.orderId);
    assert.equal(orderReplay.providerOrderId, order1.providerOrderId);

    // Reusing same requestId for a different planId -> 409 IDEMPOTENCY_CONFLICT
    await assert.rejects(
      () =>
        service.createOrder({
          userId: TEST_USER_ID,
          requestId: 'idem_order_starter_0001',
          planId: 'pro_inr_1499',
        }),
      (err: unknown) => err instanceof AppError && err.code === 'IDEMPOTENCY_CONFLICT',
    );
  });

  it('verifies checkout HMAC over order_id|payment_id with keySecret and rejects wrong or webhook-signed signatures (§11)', async () => {
    const repository = new InMemoryBillingRepository();
    const service = new PaymentOrderService({
      repository,
      razorpayKeySecret: KEY_SECRET,
      razorpayWebhookSecret: WEBHOOK_SECRET,
    });

    const created = await service.createOrder({
      userId: TEST_USER_ID,
      requestId: 'idem_checkout_verify_01',
      planId: 'starter_inr_499',
    });

    const paymentId = 'pay_mock_987654321';

    // Signing with WEBHOOK_SECRET instead of KEY_SECRET must fail (§11: different secrets, different payloads)
    const wrongSecretSig = computeRazorpayCheckoutSignature(
      created.providerOrderId,
      paymentId,
      WEBHOOK_SECRET,
    );

    await assert.rejects(
      () =>
        service.verifyCheckoutPayment({
          userId: TEST_USER_ID,
          requestId: 'idem_verify_req_00001',
          razorpayOrderId: created.providerOrderId,
          razorpayPaymentId: paymentId,
          razorpaySignature: wrongSecretSig,
        }),
      (err: unknown) =>
        err instanceof AppError && err.code === 'PAYMENT_VERIFICATION_FAILED',
    );

    // Valid signature with KEY_SECRET over `${order_id}|${payment_id}` succeeds and grants +500 credits
    const validSig = computeRazorpayCheckoutSignature(
      created.providerOrderId,
      paymentId,
      KEY_SECRET,
    );

    const settled = await service.verifyCheckoutPayment({
      userId: TEST_USER_ID,
      requestId: 'idem_verify_req_00001',
      razorpayOrderId: created.providerOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: validSig,
    });

    assert.equal(settled.newlyCredited, true);
    assert.equal(settled.order.status, 'PAID');
    assert.equal(settled.account.availableCredits, 600); // 100 initial + 500 starter
    assert.equal(settled.account.planId, 'starter_inr_499');
  });

  it('verifies webhook HMAC over exact rawBody with webhookSecret and rejects tampered bytes or amount mismatches (§11)', async () => {
    const repository = new InMemoryBillingRepository();
    const service = new PaymentOrderService({
      repository,
      razorpayKeySecret: KEY_SECRET,
      razorpayWebhookSecret: WEBHOOK_SECRET,
    });

    const created = await service.createOrder({
      userId: TEST_USER_ID,
      requestId: 'idem_webhook_order_001',
      planId: 'pro_inr_1499', // 149,900 paise, 2,000 credits
    });

    // 1. Amount mismatch payload (reports 49900 paise instead of 149900 paise) -> 400 PAYMENT_VERIFICATION_FAILED
    const mismatchedRawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_mismatch_01',
            order_id: created.providerOrderId,
            amount: 49_900,
            currency: 'INR',
            notes: { userId: TEST_USER_ID },
          },
        },
      },
    });
    const mismatchedSig = computeRazorpayWebhookSignature(
      mismatchedRawBody,
      WEBHOOK_SECRET,
    );

    await assert.rejects(
      () =>
        service.handleRazorpayWebhook({
          rawBody: mismatchedRawBody,
          signatureHeader: mismatchedSig,
          eventIdHeader: 'evt_mismatch_01',
        }),
      (err: unknown) =>
        err instanceof AppError && err.code === 'PAYMENT_VERIFICATION_FAILED',
    );

    // 2. Valid rawBody with exact 149,900 paise amount, but tampered whitespace after signing -> 400 PAYMENT_VERIFICATION_FAILED
    const validRawBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: 'pay_webhook_pro_001',
            order_id: created.providerOrderId,
            amount: 149_900,
            currency: 'INR',
            notes: { userId: TEST_USER_ID },
          },
        },
      },
    });
    const validWebhookSig = computeRazorpayWebhookSignature(
      validRawBody,
      WEBHOOK_SECRET,
    );

    await assert.rejects(
      () =>
        service.handleRazorpayWebhook({
          rawBody: `${validRawBody} `, // 1 extra trailing space invalidates raw-body HMAC
          signatureHeader: validWebhookSig,
          eventIdHeader: 'evt_pro_01',
        }),
      (err: unknown) =>
        err instanceof AppError && err.code === 'PAYMENT_VERIFICATION_FAILED',
    );

    // 3. Exact untampered rawBody succeeds and grants +2,000 credits
    const settled = await service.handleRazorpayWebhook({
      rawBody: validRawBody,
      signatureHeader: validWebhookSig,
      eventIdHeader: 'evt_pro_01',
    });

    assert.equal(settled.newlyCredited, true);
    assert.equal(settled.account.availableCredits, 2_100); // 100 initial + 2,000 pro
  });

  it('prevents double-crediting when checkout verification, delayed webhook, and duplicate webhook replay all arrive for the same order (§11)', async () => {
    const repository = new InMemoryBillingRepository();
    const service = new PaymentOrderService({
      repository,
      razorpayKeySecret: KEY_SECRET,
      razorpayWebhookSecret: WEBHOOK_SECRET,
    });

    const created = await service.createOrder({
      userId: TEST_USER_ID,
      requestId: 'idem_race_order_00001',
      planId: 'starter_inr_499',
    });
    const paymentId = 'pay_race_shared_001';

    // Step 1: Browser checkout verification arrives first
    const checkoutSig = computeRazorpayCheckoutSignature(
      created.providerOrderId,
      paymentId,
      KEY_SECRET,
    );
    const first = await service.verifyCheckoutPayment({
      userId: TEST_USER_ID,
      requestId: 'idem_checkout_first_01',
      razorpayOrderId: created.providerOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: checkoutSig,
    });
    assert.equal(first.newlyCredited, true);
    assert.equal(first.account.availableCredits, 600);

    // Step 2: Delayed Razorpay webhook arrives 10 seconds later for the same order & payment
    const webhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: created.providerOrderId,
            amount: 49_900,
            currency: 'INR',
            notes: { userId: TEST_USER_ID },
          },
        },
      },
    });
    const webhookSig = computeRazorpayWebhookSignature(webhookBody, WEBHOOK_SECRET);

    const delayedWebhook = await service.handleRazorpayWebhook({
      rawBody: webhookBody,
      signatureHeader: webhookSig,
      eventIdHeader: 'evt_delayed_001',
    });
    assert.equal(delayedWebhook.newlyCredited, false);
    assert.equal(delayedWebhook.account.availableCredits, 600);

    // Step 3: Duplicate webhook delivery replay
    const replayWebhook = await service.handleRazorpayWebhook({
      rawBody: webhookBody,
      signatureHeader: webhookSig,
      eventIdHeader: 'evt_delayed_001',
    });
    assert.equal(replayWebhook.newlyCredited, false);
    assert.equal(replayWebhook.account.availableCredits, 600);

    // Verify ledger has only 1 INITIAL_GRANT and 1 PURCHASE_CREDIT entry
    const ledger = await repository.listLedgerEntries(TEST_USER_ID);
    const purchaseEntries = ledger.filter((e) => e.entryType === 'PURCHASE_CREDIT');
    assert.equal(purchaseEntries.length, 1);
  });
});
