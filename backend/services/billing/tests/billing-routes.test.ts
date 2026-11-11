import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_AUTH_HEADERS,
  generateEd25519KeyPair,
  signUserContextAssertion,
} from '@kartik/shared';
import {
  CreditReservationService,
  InMemoryBillingRepository,
  MockPaymentProvider,
  PaymentOrderService,
  computeRazorpayCheckoutSignature,
  computeRazorpayWebhookSignature,
  createBillingRouter,
  loadBillingConfig,
} from '../src/index.js';

const TEST_KEYS = generateEd25519KeyPair();
const TEST_USER_ID = '550e8400-e29b-41d4-a716-446655440000';
const KEY_SECRET = 'rzp_test_key_secret_phase4_exit_gate';
const WEBHOOK_SECRET = 'rzp_test_webhook_secret_phase4_exit_gate';

function createBillingTestHarness(overrides?: {
  demoReadOnly?: boolean;
  maxBillingRequestsPerMinute?: number;
  checkReadiness?: () => Promise<boolean>;
}) {
  const config = loadBillingConfig({
    NODE_ENV: 'test',
    BILLING_DATABASE_URL: 'postgresql://billing:secret@127.0.0.1:5432/kartik?schema=billing',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    BILLING_MODE: 'mock',
    DEMO_READ_ONLY: overrides?.demoReadOnly ? 'true' : 'false',
    USER_CONTEXT_PUBLIC_KEY: TEST_KEYS.publicKeyPem,
    GATEWAY_TO_BILLING_TOKEN: 's2s_gateway_to_billing_token_0001',
    CHAT_TO_BILLING_TOKEN: 's2s_chat_to_billing_token_000001',
  });

  const repository = new InMemoryBillingRepository();
  const creditService = new CreditReservationService({
    repository,
    initialFreeCredits: config.FREE_TIER_INITIAL_CREDITS,
  });
  const paymentService = new PaymentOrderService({
    repository,
    paymentProvider: new MockPaymentProvider(),
    initialFreeCredits: config.FREE_TIER_INITIAL_CREDITS,
    razorpayKeySecret: KEY_SECRET,
    razorpayWebhookSecret: WEBHOOK_SECRET,
  });

  const router = createBillingRouter({
    config,
    repository,
    creditService,
    paymentService,
    ...(overrides?.maxBillingRequestsPerMinute !== undefined
      ? { maxBillingRequestsPerMinute: overrides.maxBillingRequestsPerMinute }
      : {}),
    ...(overrides?.checkReadiness ? { checkReadiness: overrides.checkReadiness } : {}),
  });

  return { config, repository, creditService, paymentService, router };
}

function mintAssertion(aud: 'billing' | 'chat' | 'agent', userId = TEST_USER_ID): string {
  return signUserContextAssertion(
    {
      sub: userId,
      aud,
      traceId: 'trc_billing_route_test',
      sessionId: 'sess_billing_01',
    },
    TEST_KEYS.privateKeyPem,
  );
}

describe('@kartik/billing HTTP routes & Phase 4 Exit Gate closure (4.4.a)', () => {
  it('completes public balance -> order -> checkout verify -> delayed raw-body webhook -> ledger flow (Phase 4 Exit Gate)', async () => {
    const { config, router } = createBillingTestHarness();
    const userAssertion = mintAssertion('billing');

    // 1. GET /billing/balance returns 100 initial credits and server-side plans
    const balRes = await router.execute<{
      data: {
        account: { availableCredits: number; reservedCredits: number };
        plans: readonly { id: string; pricePaise: number }[];
      };
    }>({
      method: 'GET',
      path: '/billing/balance',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
      },
    });
    assert.equal(balRes.statusCode, 200);
    assert.equal(balRes.body.data.account.availableCredits, 100);
    assert.equal(balRes.body.data.plans.length, 3);

    // 2. POST /billing/orders creates a starter_inr_499 order in integer paise (49,900 paise)
    const orderRes = await router.execute<{
      requestId: string;
      data: {
        order: {
          orderId: string;
          providerOrderId: string;
          amountPaise: number;
          creditsGranted: number;
        };
      };
    }>({
      method: 'POST',
      path: '/billing/orders',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_create_order_44a_01',
      },
      body: { planId: 'starter_inr_499' },
    });
    assert.equal(orderRes.statusCode, 200);
    assert.equal(orderRes.body.requestId, 'idem_create_order_44a_01');
    assert.equal(orderRes.body.data.order.amountPaise, 49_900);
    assert.equal(orderRes.body.data.order.creditsGranted, 500);

    const providerOrderId = orderRes.body.data.order.providerOrderId;
    const paymentId = 'pay_phase4_exit_001';

    // 3. POST /billing/verify verifies checkout HMAC and credits +500 -> 600 available
    const checkoutSig = computeRazorpayCheckoutSignature(
      providerOrderId,
      paymentId,
      KEY_SECRET,
    );
    const verifyRes = await router.execute<{
      data: {
        newlyCredited: boolean;
        account: { availableCredits: number };
      };
    }>({
      method: 'POST',
      path: '/billing/verify',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_verify_order_44a_01',
      },
      body: {
        razorpayOrderId: providerOrderId,
        razorpayPaymentId: paymentId,
        razorpaySignature: checkoutSig,
      },
    });
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyRes.body.data.newlyCredited, true);
    assert.equal(verifyRes.body.data.account.availableCredits, 600);

    // 4. Delayed POST /webhooks/razorpay with rawBody HMAC arrives later -> idempotent (newlyCredited: false)
    const rawWebhookBody = JSON.stringify({
      event: 'payment.captured',
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: providerOrderId,
            amount: 49_900,
            currency: 'INR',
            notes: { userId: TEST_USER_ID },
          },
        },
      },
    });
    const webhookSig = computeRazorpayWebhookSignature(
      rawWebhookBody,
      WEBHOOK_SECRET,
    );

    const webhookRes = await router.execute<{
      data: { received: boolean; newlyCredited: boolean };
    }>({
      method: 'POST',
      path: '/webhooks/razorpay',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        'x-razorpay-signature': webhookSig,
        'x-razorpay-event-id': 'evt_44a_001',
      },
      rawBody: rawWebhookBody,
    });
    assert.equal(webhookRes.statusCode, 200);
    assert.equal(webhookRes.body.data.received, true);
    assert.equal(webhookRes.body.data.newlyCredited, false);

    // 5. GET /billing/ledger returns exactly 2 entries (INITIAL_GRANT + PURCHASE_CREDIT)
    const ledgerRes = await router.execute<{
      data: { entries: readonly { entryType: string; deltaCredits: number }[] };
    }>({
      method: 'GET',
      path: '/billing/ledger',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
      },
    });
    assert.equal(ledgerRes.statusCode, 200);
    assert.equal(ledgerRes.body.data.entries.length, 2);
  });

  it('enforces Chat-only caller auth on /internal/credits/{reserve,settle,release} and rejects Agent or wrong-aud assertions (Invariants #6 & #14)', async () => {
    const { config, router } = createBillingTestHarness();
    const chatAssertion = mintAssertion('billing');

    // 1. Valid Chat caller reserves 15 credits for web_search
    const reserveRes = await router.execute<{
      data: { reservationId: string; reservedCredits: number; status: string };
    }>({
      method: 'POST',
      path: '/internal/credits/reserve',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'chat',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.CHAT_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: chatAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_chat_reserve_44a_01',
      },
      body: {
        conversationId: 'conv_44a_01',
        agent: 'search',
        operation: 'web_search',
      },
    });
    assert.equal(reserveRes.statusCode, 200);
    assert.equal(reserveRes.body.data.reservedCredits, 15);
    assert.equal(reserveRes.body.data.status, 'reserved');

    // 2. Valid Chat caller settles the reservation
    const settleRes = await router.execute<{
      data: { status: string; availableCreditsAfter: number };
    }>({
      method: 'POST',
      path: '/internal/credits/settle',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'chat',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.CHAT_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: chatAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_chat_reserve_44a_01',
      },
      body: {
        reservationId: reserveRes.body.data.reservationId,
      },
    });
    assert.equal(settleRes.statusCode, 200);
    assert.equal(settleRes.body.data.status, 'settled');
    assert.equal(settleRes.body.data.availableCreditsAfter, 85);

    // 3. Gateway or Agent attempting to call /internal/credits/reserve is rejected (403 FORBIDDEN / 401)
    const gatewayAttempt = await router.execute<{ error: { code: string } }>({
      method: 'POST',
      path: '/internal/credits/reserve',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: chatAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_forbidden_gw_0001',
      },
      body: {
        conversationId: 'conv_44a_01',
        agent: 'chat',
        operation: 'chat_turn',
      },
    });
    assert.equal(gatewayAttempt.statusCode, 403);
    assert.equal(gatewayAttempt.body.error.code, 'FORBIDDEN');

    // 4. Assertion minted for 'agent' audience is rejected on public /billing/balance (401 UNAUTHENTICATED)
    const wrongAudRes = await router.execute<{ error: { code: string } }>({
      method: 'GET',
      path: '/billing/balance',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: mintAssertion('agent'),
      },
    });
    assert.equal(wrongAudRes.statusCode, 401);
    assert.equal(wrongAudRes.body.error.code, 'UNAUTHENTICATED');
  });

  it('enforces DEMO_READ_ONLY kill switch on mutating billing routes and requires Idempotency-Key (§12, Invariant #15)', async () => {
    const { config, router } = createBillingTestHarness({ demoReadOnly: true });
    const userAssertion = mintAssertion('billing');

    // GET /billing/balance still works in DEMO_READ_ONLY mode
    const getRes = await router.execute({
      method: 'GET',
      path: '/billing/balance',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
      },
    });
    assert.equal(getRes.statusCode, 200);

    // POST /billing/orders is blocked with 403 DEMO_READ_ONLY
    const postDemoRes = await router.execute<{ error: { code: string } }>({
      method: 'POST',
      path: '/billing/orders',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_demo_blocked_0001',
      },
      body: { planId: 'starter_inr_499' },
    });
    assert.equal(postDemoRes.statusCode, 403);
    assert.equal(postDemoRes.body.error.code, 'DEMO_READ_ONLY');

    // When DEMO_READ_ONLY=false, missing Idempotency-Key returns 400 IDEMPOTENCY_KEY_REQUIRED
    const normalHarness = createBillingTestHarness({ demoReadOnly: false });
    const missingKeyRes = await normalHarness.router.execute<{
      error: { code: string };
    }>({
      method: 'POST',
      path: '/billing/orders',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]:
          normalHarness.config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
      },
      body: { planId: 'starter_inr_499' },
    });
    assert.equal(missingKeyRes.statusCode, 400);
    assert.equal(missingKeyRes.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('serves /healthz and /readyz (503 BILLING_UNAVAILABLE when down) and enforces per-user rate limits (429)', async () => {
    let isReady = true;
    const { config, router } = createBillingTestHarness({
      maxBillingRequestsPerMinute: 2,
      checkReadiness: async () => isReady,
    });
    const userAssertion = mintAssertion('billing');

    const health = await router.execute<{ data: { status: string; service: string } }>({
      method: 'GET',
      path: '/healthz',
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.data.service, 'billing');

    isReady = false;
    const notReady = await router.execute<{ error: { code: string } }>({
      method: 'GET',
      path: '/readyz',
    });
    assert.equal(notReady.statusCode, 503);
    assert.equal(notReady.body.error.code, 'BILLING_UNAVAILABLE');

    // Rate limit check (2 allowed per minute, 3rd returns 429 RATE_LIMITED)
    const r1 = await router.execute({
      method: 'GET',
      path: '/billing/balance',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
      },
    });
    const r2 = await router.execute({
      method: 'GET',
      path: '/billing/balance',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
      },
    });
    const r3 = await router.execute<{ error: { code: string } }>({
      method: 'GET',
      path: '/billing/balance',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.GATEWAY_TO_BILLING_TOKEN,
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: userAssertion,
      },
    });
    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    assert.equal(r3.statusCode, 429);
    assert.equal(r3.body.error.code, 'RATE_LIMITED');
    assert.ok(r3.headers['retry-after']);
  });
});
