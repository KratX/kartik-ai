import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_RECOVERY_POLICY,
  GatewayApiError,
  KartikGatewayClient,
  WorkspaceStore,
  generateClientIdempotencyKey,
  resolveClientRecoveryAction,
  type HttpTransportRequest,
} from '../src/index.js';

describe('@kartik/frontend Gateway API Client, Idempotency-Key & WorkspaceStore (7.1.a)', () => {
  it('routes all requests through /api/v1 with credentials="include", unwraps envelopes, and forbids /internal/* (Invariants #1 & #14)', async () => {
    const captured: HttpTransportRequest[] = [];

    const client = new KartikGatewayClient({
      baseUrl: '/api/v1',
      transport: async (req) => {
        captured.push(req);
        return {
          status: 200,
          json: async () => ({
            traceId: 'trace_71a_list',
            data: {
              items: [
                {
                  conversationId: 'conv_71a_1',
                  userId: 'usr_alice',
                  title: 'Phase 7 Frontend Architecture',
                  deletionState: 'active',
                  messageCount: 2,
                  lastMessageAt: '2026-11-12T10:00:00.000Z',
                  createdAt: '2026-11-12T10:00:00.000Z',
                  updatedAt: '2026-11-12T10:00:00.000Z',
                },
              ],
            },
            meta: { nextCursor: 'cursor_next_page_2' },
            error: null,
          }),
        };
      },
    });

    const page = await client.listConversations({ limit: 10 });
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.conversationId, 'conv_71a_1');
    assert.equal(page.nextCursor, 'cursor_next_page_2');
    assert.equal(page.traceId, 'trace_71a_list');
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.url, '/api/v1/conversations?limit=10');
    assert.equal(captured[0]?.credentials, 'include');
    assert.equal(captured[0]?.headers['Idempotency-Key'], undefined);

    // Forbids calling /internal/* from browser client (Invariant #14)
    await assert.rejects(
      async () =>
        client.request({
          method: 'POST',
          path: '/internal/sessions/introspect',
        }),
      /Invariant #14 violation/,
    );
  });

  it('generates client-owned Idempotency-Key headers on mutating requests (POST/DELETE) without rewriting caller-supplied keys (Invariant #15)', async () => {
    const captured: HttpTransportRequest[] = [];

    const client = new KartikGatewayClient({
      transport: async (req) => {
        captured.push(req);
        return {
          status: 201,
          json: async () => ({
            requestId: req.headers['Idempotency-Key'],
            traceId: 'trace_71a_mut',
            data: {
              conversationId: 'conv_71a_new',
              userId: 'usr_alice',
              title: 'Client Key Test',
              deletionState: 'active',
              messageCount: 0,
              lastMessageAt: '2026-11-12T10:00:00.000Z',
              createdAt: '2026-11-12T10:00:00.000Z',
              updatedAt: '2026-11-12T10:00:00.000Z',
            },
            meta: { nextCursor: null },
            error: null,
          }),
        };
      },
    });

    // Auto-generates Idempotency-Key when omitted
    await client.createConversation('Auto Key Conversation');
    const autoKey = captured[0]?.headers['Idempotency-Key'];
    assert.ok(autoKey && autoKey.startsWith('req_conv_'));

    // Preserves explicit caller-supplied Idempotency-Key unchanged
    await client.createConversation(
      'Explicit Key Conversation',
      'req_custom_client_key_001',
    );
    assert.equal(
      captured[1]?.headers['Idempotency-Key'],
      'req_custom_client_key_001',
    );

    const sampleKey = generateClientIdempotencyKey('req_turn');
    assert.ok(sampleKey.startsWith('req_turn_'));
    assert.ok(sampleKey.length >= 20);
  });

  it('maps all 19 normative error codes to exact client recovery actions (§5.5)', () => {
    assert.equal(Object.keys(ERROR_RECOVERY_POLICY).length, 19);
    assert.equal(
      resolveClientRecoveryAction('BILLING_UNAVAILABLE'),
      'retry_same_key',
    );
    assert.equal(
      resolveClientRecoveryAction('EXECUTION_UNKNOWN'),
      'do_not_retry',
    );
    assert.equal(
      resolveClientRecoveryAction('ARTIFACT_INVALID'),
      'retry_new_key',
    );
    assert.equal(
      resolveClientRecoveryAction('PROVIDER_TIMEOUT'),
      'retry_new_key',
    );
    assert.equal(
      resolveClientRecoveryAction('DEMO_READ_ONLY'),
      'read_only_mode',
    );
    assert.equal(
      resolveClientRecoveryAction('QUOTA_EXHAUSTED'),
      'top_up_quota',
    );
  });

  it('preserves the exact same Idempotency-Key across 503 BILLING_UNAVAILABLE retries and activates demoReadOnlyBanner on 403 DEMO_READ_ONLY in WorkspaceStore (§5.5, §12, Invariant #15)', async () => {
    const sentIdempotencyKeys: string[] = [];
    let attempt = 0;

    const client = new KartikGatewayClient({
      transport: async (req) => {
        attempt += 1;
        const key = req.headers['Idempotency-Key'] ?? '';
        sentIdempotencyKeys.push(key);

        if (attempt === 1) {
          return {
            status: 503,
            json: async () => ({
              requestId: key,
              traceId: 'trace_billing_down',
              data: null,
              meta: { nextCursor: null },
              error: {
                code: 'BILLING_UNAVAILABLE',
                message: 'Billing upstream temporarily unavailable',
              },
            }),
          };
        }

        if (attempt === 2) {
          return {
            status: 201,
            json: async () => ({
              requestId: key,
              traceId: 'trace_billing_recovered',
              data: {
                conversationId: 'conv_71a_store',
                requestId: key,
                traceId: 'trace_billing_recovered',
                remainingCredits: 85,
                idempotentReplay: false,
                userMessage: {
                  messageId: 'msg_u_1',
                  conversationId: 'conv_71a_store',
                  userId: 'usr_alice',
                  requestId: key,
                  role: 'user',
                  content: 'Build a calculator',
                  agentUsed: null,
                  attachmentFileIds: [],
                  artifactIds: [],
                  citations: [],
                  createdAt: '2026-11-12T10:01:00.000Z',
                },
                assistantMessage: {
                  messageId: 'msg_a_1',
                  conversationId: 'conv_71a_store',
                  userId: 'usr_alice',
                  requestId: key,
                  role: 'assistant',
                  content: 'Here is your calculator component.',
                  agentUsed: 'coding',
                  attachmentFileIds: [],
                  artifactIds: ['art_calc_1'],
                  citations: [],
                  createdAt: '2026-11-12T10:01:01.000Z',
                },
              },
              meta: { nextCursor: null },
              error: null,
            }),
          };
        }

        return {
          status: 403,
          json: async () => ({
            requestId: key,
            traceId: 'trace_demo_ro',
            data: null,
            meta: { nextCursor: null },
            error: {
              code: 'DEMO_READ_ONLY',
              message: 'Demo is in read-only mode',
            },
          }),
        };
      },
    });

    const store = new WorkspaceStore(client, 100);
    store.setSelectedSpecialist('coding');

    // Attempt 1 fails with 503 BILLING_UNAVAILABLE -> pendingTurnKey must be preserved for safe retry
    await assert.rejects(
      async () =>
        store.sendTurn({
          conversationId: 'conv_71a_store',
          prompt: 'Build a calculator',
        }),
      (err: unknown) =>
        err instanceof GatewayApiError &&
        err.code === 'BILLING_UNAVAILABLE' &&
        err.recoveryAction === 'retry_same_key',
    );

    const preservedKey = store.getState().pendingTurnKey;
    assert.ok(preservedKey);
    assert.equal(preservedKey, sentIdempotencyKeys[0]);

    // Attempt 2 retries and MUST reuse the exact same Idempotency-Key (never double-charging)
    const stateAfterSuccess = await store.sendTurn({
      conversationId: 'conv_71a_store',
      prompt: 'Build a calculator',
    });

    assert.equal(sentIdempotencyKeys[1], sentIdempotencyKeys[0]);
    assert.equal(stateAfterSuccess.availableCredits, 85);
    assert.equal(stateAfterSuccess.pendingTurnKey, null);
    assert.equal(
      stateAfterSuccess.messagesByConversation['conv_71a_store']?.length,
      2,
    );

    // Attempt 3 encounters 403 DEMO_READ_ONLY -> activates demoReadOnlyBanner and clears pendingTurnKey
    await assert.rejects(
      async () =>
        store.sendTurn({
          conversationId: 'conv_71a_store',
          prompt: 'Another prompt',
        }),
      (err: unknown) =>
        err instanceof GatewayApiError && err.code === 'DEMO_READ_ONLY',
    );
    assert.equal(store.getState().demoReadOnlyBanner, true);
    assert.equal(store.getState().pendingTurnKey, null);
  });
});
