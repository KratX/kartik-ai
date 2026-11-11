/**
 * @file backend/gateway/tests/gateway-routes.test.ts
 * @description Integration tests for @kartik/gateway public route table & Phase 3 Exit Gate closure (3.3.a).
 *
 * Verifies:
 * 1. Authenticated browser request (`POST /api/v1/conversations`) introspects session cookie via Auth,
 *    strips `Cookie`, mints `x-user-context` (`aud: 'chat'`), generates fresh `traceId`, and preserves
 *    client `Idempotency-Key` unchanged as `x-request-id` (Phase 3 Exit Gate & Invariant #15).
 * 2. Missing `Idempotency-Key` on mutating authenticated route fails with 400 `IDEMPOTENCY_KEY_REQUIRED`.
 * 3. Any browser request targeting `/internal/*` or `/api/v1/internal/*` returns 404 `NOT_FOUND`
 *    without forwarding upstream (Phase 3 Exit Gate & Invariants #14, #20).
 * 4. Raw body preservation on `POST /api/v1/webhooks/razorpay` (§11) & `DEMO_READ_ONLY` kill switch (§12).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSuccessEnvelope,
  generateEd25519KeyPair,
  IDEMPOTENCY_KEY_HEADER,
  INTERNAL_AUTH_HEADERS,
  verifyUserContextAssertion,
} from '@kartik/shared';
import {
  createGatewayRouter,
  InMemoryUpstreamHttpClient,
  loadGatewayConfig,
  type IntrospectedSessionIdentity,
} from '../src/index.js';

function createGatewayTestHarness(overrides?: { demoReadOnly?: boolean }) {
  const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
  const nowSec = 1_762_860_000;

  const config = loadGatewayConfig({
    NODE_ENV: 'test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-token-at-least-16-chars',
    USER_CONTEXT_SIGNING_KEY: privateKeyPem,
    CORS_ALLOWED_ORIGINS: 'https://app.kartik.ai,http://localhost:5173',
    DEMO_READ_ONLY: overrides?.demoReadOnly ? 'true' : 'false',
  });

  const sampleSession: IntrospectedSessionIdentity = {
    sessionId: 'rX8mQp9vL2kW4nZ7cT1yB6gH3jF5dS0aU9eM4pQ2wK8',
    userId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'kartik@kartik.ai',
    displayName: 'Kartik Rawat',
    avatarUrl: null,
    expiresAt: '2026-11-18T12:00:00.000Z',
  };

  const upstream = new InMemoryUpstreamHttpClient();

  upstream.registerHandler('auth', 'POST', '/internal/sessions/introspect', (req) => {
    const body = req.body as { sessionId?: string };
    if (body.sessionId === sampleSession.sessionId) {
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope(
          req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_auth',
          sampleSession,
        ),
      };
    }
    return {
      statusCode: 401,
      headers: {},
      body: {
        traceId: 'trc_auth',
        data: null,
        meta: { nextCursor: null },
        error: { code: 'UNAUTHENTICATED', message: 'Invalid session' },
      },
    };
  });

  const router = createGatewayRouter({
    config,
    upstreamClient: upstream,
    nowSeconds: () => nowSec,
  });

  return {
    config,
    publicKeyPem,
    nowSec,
    sampleSession,
    upstream,
    router,
  };
}

describe('@kartik/gateway public route table & Phase 3 Exit Gate closure (3.3.a)', () => {
  it('exchanges session cookie for aud-scoped Ed25519 assertion, generates fresh traceId, and forwards Idempotency-Key unchanged as x-request-id (Phase 3 Exit Gate)', async () => {
    const { publicKeyPem, nowSec, sampleSession, upstream, router } =
      createGatewayTestHarness();

    upstream.registerHandler('chat', 'POST', '/conversations', (req) => {
      // Cookie must be stripped before reaching Chat
      assert.equal(req.headers.cookie, undefined);

      // Gateway must attach service credentials and forward x-request-id unchanged
      assert.equal(req.headers[INTERNAL_AUTH_HEADERS.SERVICE_CALLER], 'gateway');
      assert.equal(
        req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID],
        'idem_create_conv_phase3_0001',
      );

      // Verify Ed25519 x-user-context assertion signed for 'chat'
      const assertion = req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT];
      assert.ok(assertion);
      const claims = verifyUserContextAssertion(assertion, publicKeyPem, {
        expectedAudience: 'chat',
        nowSeconds: nowSec,
      });
      assert.equal(claims.sub, sampleSession.userId);
      assert.equal(claims.aud, 'chat');

      const traceId = req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID]!;
      return {
        statusCode: 201,
        headers: {},
        body: createSuccessEnvelope(
          traceId,
          { conversationId: 'conv_001', title: 'New Chat' },
          { requestId: req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID] },
        ),
      };
    });

    const res = await router.execute<{
      traceId: string;
      requestId?: string;
      data: { conversationId: string };
    }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: `kartik_session=${sampleSession.sessionId}`,
        [IDEMPOTENCY_KEY_HEADER]: 'idem_create_conv_phase3_0001',
        // Even if client tries to spoof x-trace-id, Gateway generates a fresh trc_<uuid>
        [INTERNAL_AUTH_HEADERS.TRACE_ID]: 'client_spoofed_trace_id',
      },
      body: { title: 'New Chat' },
    });

    assert.equal(res.statusCode, 201);
    assert.notEqual(res.body.traceId, 'client_spoofed_trace_id');
    assert.match(res.body.traceId, /^trc_/);
    assert.equal(res.body.requestId, 'idem_create_conv_phase3_0001');
    assert.equal(res.body.data.conversationId, 'conv_001');

    // Missing Idempotency-Key on mutating authenticated route fails with 400 IDEMPOTENCY_KEY_REQUIRED
    const missingIdem = await router.execute<{ error: { code: string } }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: `kartik_session=${sampleSession.sessionId}`,
      },
      body: { title: 'Missing Key' },
    });
    assert.equal(missingIdem.statusCode, 400);
    assert.equal(missingIdem.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('blocks any browser request to /internal/* or /api/v1/internal/* with 404 NOT_FOUND (Phase 3 Exit Gate & Invariants #14, #20)', async () => {
    const { upstream, router } = createGatewayTestHarness();

    const paths = [
      '/internal/sessions/introspect',
      '/api/v1/internal/sessions/introspect',
      '/internal/credits/reserve',
      '/api/v1/conversations/internal/purge',
    ];

    for (const blockedPath of paths) {
      const res = await router.execute<{ error: { code: string } }>({
        method: 'POST',
        path: blockedPath,
        body: {},
      });
      assert.equal(res.statusCode, 404, `Expected 404 for ${blockedPath}`);
      assert.equal(res.body.error.code, 'NOT_FOUND');
    }

    assert.equal(
      upstream.recordedRequests.length,
      0,
      'Blocked /internal/* requests must never reach any upstream service',
    );
  });

  it('routes /api/v1/auth/* with Set-Cookie passthrough and /api/v1/files/* & /api/v1/billing/* with target-specific aud claims', async () => {
    const { publicKeyPem, nowSec, sampleSession, upstream, router } =
      createGatewayTestHarness();

    upstream.registerHandler('auth', 'POST', '/auth/google', (req) => ({
      statusCode: 200,
      headers: {
        'set-cookie': `kartik_session=${sampleSession.sessionId}; Path=/; HttpOnly`,
      },
      body: createSuccessEnvelope(
        req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_1',
        { user: { id: sampleSession.userId } },
      ),
    }));

    upstream.registerHandler('agent', 'GET', '/files/file_001', (req) => {
      const claims = verifyUserContextAssertion(
        req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT]!,
        publicKeyPem,
        { expectedAudience: 'agent', nowSeconds: nowSec },
      );
      assert.equal(claims.aud, 'agent');
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope(
          req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_2',
          { fileId: 'file_001' },
        ),
      };
    });

    upstream.registerHandler('billing', 'GET', '/billing/balance', (req) => {
      const claims = verifyUserContextAssertion(
        req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT]!,
        publicKeyPem,
        { expectedAudience: 'billing', nowSeconds: nowSec },
      );
      assert.equal(claims.aud, 'billing');
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope(
          req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_3',
          { availableCredits: 500 },
        ),
      };
    });

    const loginRes = await router.execute({
      method: 'POST',
      path: '/api/v1/auth/google',
      body: { idToken: 'mock-google-token:kartik' },
    });
    assert.equal(loginRes.statusCode, 200);
    assert.match(loginRes.headers['set-cookie'] ?? '', /kartik_session=/);

    const fileRes = await router.execute({
      method: 'GET',
      path: '/api/v1/files/file_001',
      headers: { cookie: `kartik_session=${sampleSession.sessionId}` },
    });
    assert.equal(fileRes.statusCode, 200);

    const billingRes = await router.execute({
      method: 'GET',
      path: '/api/v1/billing/balance',
      headers: { cookie: `kartik_session=${sampleSession.sessionId}` },
    });
    assert.equal(billingRes.statusCode, 200);
  });

  it('preserves exact rawBody on POST /api/v1/webhooks/razorpay (§11) and enforces DEMO_READ_ONLY kill switch (§12)', async () => {
    const { sampleSession, upstream, router } = createGatewayTestHarness({
      demoReadOnly: false,
    });

    const rawWebhookPayload = '{"event":"payment.captured","payload":{"payment":{"entity":{"id":"pay_123"}}}}';

    upstream.registerHandler('billing', 'POST', '/webhooks/razorpay', (req) => {
      assert.equal(req.rawBody, rawWebhookPayload);
      assert.equal(req.headers['x-razorpay-signature'], 'hmac_sha256_sig_value');
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope('trc_webhook', { received: true }),
      };
    });

    const webhookRes = await router.execute({
      method: 'POST',
      path: '/api/v1/webhooks/razorpay',
      headers: {
        'x-razorpay-signature': 'hmac_sha256_sig_value',
      },
      rawBody: rawWebhookPayload,
    });
    assert.equal(webhookRes.statusCode, 200);

    // Verify DEMO_READ_ONLY blocks mutating requests with 403 DEMO_READ_ONLY while allowing GET
    const readOnlyHarness = createGatewayTestHarness({ demoReadOnly: true });
    readOnlyHarness.upstream.registerHandler('chat', 'GET', '/conversations', () => ({
      statusCode: 200,
      headers: {},
      body: createSuccessEnvelope('trc_ro', { items: [] }),
    }));

    const blockedMutate = await readOnlyHarness.router.execute<{ error: { code: string } }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: `kartik_session=${sampleSession.sessionId}`,
        [IDEMPOTENCY_KEY_HEADER]: 'idem_readonly_test_0001',
      },
      body: { title: 'Blocked' },
    });
    assert.equal(blockedMutate.statusCode, 403);
    assert.equal(blockedMutate.body.error.code, 'DEMO_READ_ONLY');

    const allowedGet = await readOnlyHarness.router.execute({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: {
        cookie: `kartik_session=${sampleSession.sessionId}`,
      },
    });
    assert.equal(allowedGet.statusCode, 200);
  });
});
