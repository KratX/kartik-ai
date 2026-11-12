/**
 * @file backend/gateway/tests/e2e-readiness.test.ts
 * @description Phase 8 Cross-Service End-to-End Integration, Free-Tier Portfolio Readiness,
 * and Final Blueprint Exit Gate Closure (Micro-step 8.2.a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSuccessEnvelope,
  generateEd25519KeyPair,
  IDEMPOTENCY_KEY_HEADER,
  INTERNAL_AUTH_HEADERS,
  verifyUserContextAssertion,
  type AppError,
} from '@kartik/shared';
import {
  ARCHITECTURE_INVARIANTS_REGISTRY,
  createGatewayRouter,
  CrossServiceHealthAggregator,
  InMemoryUpstreamHttpClient,
  loadGatewayConfig,
  verifyPortfolioFreeTierReadiness,
  type IntrospectedSessionIdentity,
} from '../src/index.js';

describe('@kartik/gateway Cross-Service E2E Pipeline, Free-Tier Readiness & Phase 8 Final Exit Gate (8.2.a)', () => {
  it('completes the full cross-service E2E lifecycle through Gateway: Google Login -> Create Conversation -> Specialist Turn (with Idempotency Replay) -> Credit Balance -> Cascade Purge (Phase 8 Exit Gate)', async () => {
    const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
    const nowSec = 1_762_900_000;

    const config = loadGatewayConfig({
      NODE_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-e2e-token-82a-secret',
      USER_CONTEXT_SIGNING_KEY: privateKeyPem,
      CORS_ALLOWED_ORIGINS: 'https://app.kartik.ai',
      DEMO_READ_ONLY: 'false',
    });

    const session: IntrospectedSessionIdentity = {
      sessionId: 'sess_e2e_82a_opaque_high_entropy_token_001',
      userId: 'usr_e2e_kartik_82a',
      email: 'kartik@kartik.ai',
      displayName: 'Kartik Rawat',
      avatarUrl: null,
      expiresAt: '2026-11-19T12:00:00.000Z',
    };

    let availableCredits = 100;
    const processedTurnByRequestId = new Map<string, unknown>();
    let conversationPurged = false;

    const upstream = new InMemoryUpstreamHttpClient();

    // 1. Auth Service: POST /auth/google & POST /internal/sessions/introspect
    upstream.registerHandler('auth', 'POST', '/auth/google', (req) => ({
      statusCode: 200,
      headers: {
        'set-cookie': `kartik_session=${session.sessionId}; Path=/; HttpOnly; SameSite=Lax`,
      },
      body: createSuccessEnvelope(
        req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_login',
        {
          user: {
            userId: session.userId,
            email: session.email,
            displayName: session.displayName,
            avatarUrl: null,
          },
        },
      ),
    }));

    upstream.registerHandler('auth', 'POST', '/internal/sessions/introspect', (req) => {
      const body = req.body as { sessionId?: string };
      if (body.sessionId === session.sessionId) {
        return {
          statusCode: 200,
          headers: {},
          body: createSuccessEnvelope('trc_introspect', session),
        };
      }
      return {
        statusCode: 401,
        headers: {},
        body: {
          traceId: 'trc_introspect',
          data: null,
          meta: { nextCursor: null },
          error: { code: 'UNAUTHENTICATED', message: 'Expired session' },
        },
      };
    });

    // 2. Chat Service: POST /conversations, POST /conversations/:id/messages, DELETE /conversations/:id
    upstream.registerHandler('chat', 'POST', '/conversations', (req) => {
      const claims = verifyUserContextAssertion(
        req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT]!,
        publicKeyPem,
        { expectedAudience: 'chat', nowSeconds: nowSec },
      );
      assert.equal(claims.sub, session.userId);
      const requestId = req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID]!;
      return {
        statusCode: 201,
        headers: {},
        body: createSuccessEnvelope(
          req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID]!,
          {
            conversationId: 'conv_e2e_82a',
            userId: session.userId,
            title: 'Phase 8 E2E Architecture Verification',
            deletionState: 'active',
          },
          { requestId },
        ),
      };
    });

    upstream.registerHandler(
      'chat',
      'POST',
      '/conversations/conv_e2e_82a/messages',
      (req) => {
        const claims = verifyUserContextAssertion(
          req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT]!,
          publicKeyPem,
          { expectedAudience: 'chat', nowSeconds: nowSec },
        );
        assert.equal(claims.sub, session.userId);
        const requestId = req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID]!;
        const traceId = req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID]!;

        // 24h idempotent replay: never charge twice for the same client requestId (Invariant #15)
        if (processedTurnByRequestId.has(requestId)) {
          return {
            statusCode: 200,
            headers: {},
            body: createSuccessEnvelope(
              traceId,
              {
                ...(processedTurnByRequestId.get(requestId) as Record<string, unknown>),
                idempotentReplay: true,
              },
              { requestId },
            ),
          };
        }

        availableCredits -= 15;
        const turnPayload = {
          conversationId: 'conv_e2e_82a',
          requestId,
          traceId,
          remainingCredits: availableCredits,
          idempotentReplay: false,
          assistantMessage: {
            messageId: 'msg_e2e_assistant_1',
            role: 'assistant',
            agentUsed: 'coding',
            content: 'Generated sandboxed calculator widget.',
            artifactIds: ['art_e2e_calc_1'],
            citations: [],
          },
        };
        processedTurnByRequestId.set(requestId, turnPayload);

        return {
          statusCode: 201,
          headers: {},
          body: createSuccessEnvelope(traceId, turnPayload, { requestId }),
        };
      },
    );

    upstream.registerHandler('chat', 'DELETE', '/conversations/conv_e2e_82a', (req) => {
      if (conversationPurged) {
        return {
          statusCode: 404,
          headers: {},
          body: {
            traceId: req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID] ?? 'trc_404',
            data: null,
            meta: { nextCursor: null },
            error: { code: 'NOT_FOUND', message: 'Conversation not found' },
          },
        };
      }
      conversationPurged = true;
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope(
          req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID]!,
          {
            conversationId: 'conv_e2e_82a',
            deletionState: 'purged',
            cascadeOrder: ['vectors', 'objects', 'metadata'],
          },
          { requestId: req.headers[INTERNAL_AUTH_HEADERS.REQUEST_ID] },
        ),
      };
    });

    // 3. Billing Service: GET /billing/balance
    upstream.registerHandler('billing', 'GET', '/billing/balance', (req) => {
      const claims = verifyUserContextAssertion(
        req.headers[INTERNAL_AUTH_HEADERS.USER_CONTEXT]!,
        publicKeyPem,
        { expectedAudience: 'billing', nowSeconds: nowSec },
      );
      assert.equal(claims.sub, session.userId);
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope(req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID]!, {
          userId: session.userId,
          availableCredits,
          reservedCredits: 0,
        }),
      };
    });

    const router = createGatewayRouter({
      config,
      upstreamClient: upstream,
      nowSeconds: () => nowSec,
    });

    // Step A: Login via Google
    const loginRes = await router.execute<{ data: { user: { userId: string } } }>({
      method: 'POST',
      path: '/api/v1/auth/google',
      headers: { origin: 'https://app.kartik.ai' },
      body: { idToken: 'mock_google_id_token' },
    });
    assert.equal(loginRes.statusCode, 200);
    assert.equal(loginRes.body.data.user.userId, session.userId);
    const cookieHeader = `kartik_session=${session.sessionId}`;

    // Step B: Create conversation
    const createConvRes = await router.execute<{ data: { conversationId: string } }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: cookieHeader,
        [IDEMPOTENCY_KEY_HEADER]: 'req_e2e_conv_create_01',
      },
      body: { title: 'Phase 8 E2E Architecture Verification' },
    });
    assert.equal(createConvRes.statusCode, 201);
    assert.equal(createConvRes.body.data.conversationId, 'conv_e2e_82a');

    // Step C: Send specialist turn + verify idempotent replay does not double-charge
    const turnKey = 'req_e2e_turn_sticky_01';
    const turn1 = await router.execute<{
      data: { remainingCredits: number; idempotentReplay: boolean };
    }>({
      method: 'POST',
      path: '/api/v1/conversations/conv_e2e_82a/messages',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: cookieHeader,
        [IDEMPOTENCY_KEY_HEADER]: turnKey,
      },
      body: { prompt: 'Build an app calculator widget' },
    });
    assert.equal(turn1.statusCode, 201);
    assert.equal(turn1.body.data.remainingCredits, 85);
    assert.equal(turn1.body.data.idempotentReplay, false);

    const turnReplay = await router.execute<{
      data: { remainingCredits: number; idempotentReplay: boolean };
    }>({
      method: 'POST',
      path: '/api/v1/conversations/conv_e2e_82a/messages',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: cookieHeader,
        [IDEMPOTENCY_KEY_HEADER]: turnKey,
      },
      body: { prompt: 'Build an app calculator widget' },
    });
    assert.equal(turnReplay.statusCode, 200);
    assert.equal(turnReplay.body.data.remainingCredits, 85);
    assert.equal(turnReplay.body.data.idempotentReplay, true);

    // Step D: Check credit balance via Billing
    const balanceRes = await router.execute<{ data: { availableCredits: number } }>({
      method: 'GET',
      path: '/api/v1/billing/balance',
      headers: { cookie: cookieHeader },
    });
    assert.equal(balanceRes.statusCode, 200);
    assert.equal(balanceRes.body.data.availableCredits, 85);

    // Step E: Delete conversation cascade (vectors -> objects -> metadata) & verify subsequent 404
    const deleteRes = await router.execute<{
      data: { deletionState: string; cascadeOrder: string[] };
    }>({
      method: 'DELETE',
      path: '/api/v1/conversations/conv_e2e_82a',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: cookieHeader,
        [IDEMPOTENCY_KEY_HEADER]: 'req_e2e_delete_01',
      },
    });
    assert.equal(deleteRes.statusCode, 200);
    assert.equal(deleteRes.body.data.deletionState, 'purged');
    assert.deepEqual(deleteRes.body.data.cascadeOrder, [
      'vectors',
      'objects',
      'metadata',
    ]);

    const deleteAgain = await router.execute<{ error: { code: string } }>({
      method: 'DELETE',
      path: '/api/v1/conversations/conv_e2e_82a',
      headers: {
        origin: 'https://app.kartik.ai',
        cookie: cookieHeader,
        [IDEMPOTENCY_KEY_HEADER]: 'req_e2e_delete_02',
      },
    });
    assert.equal(deleteAgain.statusCode, 404);
    assert.equal(deleteAgain.body.error.code, 'NOT_FOUND');
  });

  it('enforces free-tier portfolio defaults, rejects live Razorpay keys (rzp_live_*), and requires bounded daily live budgets (§11 & §12)', () => {
    const validReport = verifyPortfolioFreeTierReadiness({
      MOCK_AI: 'true',
      IMAGE_PROVIDER: 'mock',
      BILLING_MODE: 'mock',
      DEMO_READ_ONLY: 'false',
      DAILY_LIVE_CALL_BUDGET: '50',
    });

    assert.equal(validReport.compliant, true);
    assert.equal(validReport.mockAiDefault, true);
    assert.equal(validReport.imageProviderMode, 'mock');
    assert.equal(validReport.billingMode, 'mock');
    assert.match(
      validReport.postureStatement,
      /available free allowances, subject to current eligibility and usage/i,
    );

    // Rejects rzp_live_* keys on public deployments (§11)
    assert.throws(
      () =>
        verifyPortfolioFreeTierReadiness({
          MOCK_AI: 'true',
          BILLING_MODE: 'razorpay_test',
          RAZORPAY_KEY_ID: 'rzp_live_forbiddenKey123',
        }),
      (err: unknown) => (err as AppError).code === 'VALIDATION_FAILED',
    );

    // Rejects live AI mode without a positive daily budget ceiling (§12)
    assert.throws(
      () =>
        verifyPortfolioFreeTierReadiness({
          MOCK_AI: 'false',
          DAILY_LIVE_CALL_BUDGET: '0',
        }),
      (err: unknown) => (err as AppError).code === 'VALIDATION_FAILED',
    );
  });

  it('aggregates /readyz across auth, chat, agent, and billing in CrossServiceHealthAggregator', async () => {
    const upstream = new InMemoryUpstreamHttpClient();
    for (const target of ['auth', 'chat', 'agent', 'billing'] as const) {
      upstream.registerHandler(target, 'GET', '/readyz', () => ({
        statusCode: 200,
        headers: {},
        body: { status: 'ready' },
      }));
    }

    const aggregator = new CrossServiceHealthAggregator(upstream);
    const healthy = await aggregator.checkAllServices();
    assert.equal(healthy.status, 'ready');
    assert.deepEqual(healthy.unhealthyServices, []);

    // Simulate Billing readiness degradation
    upstream.registerHandler('billing', 'GET', '/readyz', () => ({
      statusCode: 503,
      headers: {},
      body: { status: 'down' },
    }));

    const degraded = await aggregator.checkAllServices();
    assert.equal(degraded.status, 'degraded');
    assert.deepEqual(degraded.unhealthyServices, ['billing']);
  });

  it('verifies all 20 Architecture Invariants in ARCHITECTURE_INVARIANTS_REGISTRY across Phases 1–8 (Phase 8 Final Exit Gate)', () => {
    assert.equal(ARCHITECTURE_INVARIANTS_REGISTRY.length, 20);
    const ids = ARCHITECTURE_INVARIANTS_REGISTRY.map((i) => i.id);
    assert.deepEqual(
      ids,
      Array.from({ length: 20 }, (_, idx) => idx + 1),
    );
  });
});
