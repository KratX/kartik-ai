import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AppError } from '@kartik/shared/errors';
import {
  CHAT_INITIAL_MIGRATION,
  InMemoryChatRepository,
  PostgresChatRepository,
  loadChatConfig,
} from '../src/index.js';

const { publicKey } = crypto.generateKeyPairSync('ed25519');
const TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('@kartik/chat config, 0001_chat_core migration & ChatRepository cursor pagination (6.1.a)', () => {
  it('validates Chat config and Ed25519 USER_CONTEXT_PUBLIC_KEY at boot (§6.2 & §6.4)', () => {
    const config = loadChatConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/kartik',
      REDIS_URL: 'redis://localhost:6379',
      USER_CONTEXT_PUBLIC_KEY: TEST_PUBLIC_PEM,
      CHAT_TO_AGENT_TOKEN: 'chat-to-agent-internal-secret-token',
      CHAT_TO_BILLING_TOKEN: 'chat-to-billing-internal-secret-token',
    });

    assert.equal(config.port, 4002);
    assert.equal(config.demoReadOnly, false);
    assert.equal(config.maxMessageChars, 16_000);
    assert.equal(config.agentServiceUrl, 'http://localhost:4003');
    assert.equal(config.billingServiceUrl, 'http://localhost:4004');
  });

  it('defines chat.conversations, chat.messages, and chat.agent_runs with run-state constraints in 0001_chat_core.sql (Invariant #3)', () => {
    assert.equal(CHAT_INITIAL_MIGRATION.version, '0001_chat_core');
    assert.ok(CHAT_INITIAL_MIGRATION.sql.includes('CREATE TABLE IF NOT EXISTS chat.conversations'));
    assert.ok(CHAT_INITIAL_MIGRATION.sql.includes('CREATE TABLE IF NOT EXISTS chat.messages'));
    assert.ok(CHAT_INITIAL_MIGRATION.sql.includes('CREATE TABLE IF NOT EXISTS chat.agent_runs'));
    assert.ok(CHAT_INITIAL_MIGRATION.sql.includes('execution_unknown'));
  });

  it('enforces 404 ownership anti-enumeration and HMAC keyset cursor pagination on conversations and messages (§5.4, Invariant #20)', async () => {
    const repo = new InMemoryChatRepository();

    await repo.createConversation({
      conversationId: 'conv_1',
      userId: 'usr_alice',
      title: 'First Conversation',
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: '2026-11-11T10:00:00.000Z',
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    });

    await repo.createConversation({
      conversationId: 'conv_2',
      userId: 'usr_alice',
      title: 'Second Conversation',
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: '2026-11-11T10:05:00.000Z',
      createdAt: '2026-11-11T10:05:00.000Z',
      updatedAt: '2026-11-11T10:05:00.000Z',
    });

    // Foreign user (usr_bob) looking up usr_alice's conversation gets 404 NOT_FOUND (never 403)
    await assert.rejects(
      () => repo.getConversationForUser('usr_bob', 'conv_1'),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.httpStatus, 404);
        return true;
      },
    );

    // Keyset pagination across Alice's conversations (limit=1)
    const page1 = await repo.listConversationsForUser({
      userId: 'usr_alice',
      limit: 1,
    });
    assert.equal(page1.items.length, 1);
    assert.equal(page1.items[0]?.conversationId, 'conv_2');
    assert.ok(page1.nextCursor);

    const page2 = await repo.listConversationsForUser({
      userId: 'usr_alice',
      limit: 1,
      cursor: page1.nextCursor,
    });
    assert.equal(page2.items.length, 1);
    assert.equal(page2.items[0]?.conversationId, 'conv_1');
    assert.equal(page2.nextCursor, null);

    // Replaying Alice's pagination cursor as usr_bob must be rejected with 400 VALIDATION_FAILED
    await assert.rejects(
      () =>
        repo.listConversationsForUser({
          userId: 'usr_bob',
          limit: 1,
          cursor: page1.nextCursor,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'VALIDATION_FAILED');
        return true;
      },
    );
  });

  it('tracks AgentRunRecord state transitions by client requestId and executes parameterized SQL in PostgresChatRepository (Invariants #3 & #15)', async () => {
    const repo = new InMemoryChatRepository();

    await repo.saveAgentRun({
      runId: 'run_001',
      requestId: 'req_client_idem_0001',
      traceId: 'trace_001',
      userId: 'usr_alice',
      conversationId: 'conv_1',
      userMessageId: 'msg_u1',
      assistantMessageId: null,
      agent: 'coding',
      operation: 'code_generation',
      reservationId: 'res_001',
      reservedCredits: 10,
      settledCredits: null,
      state: 'reserved',
      payloadFingerprint: 'f'.repeat(64),
      errorCode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const updated = await repo.updateAgentRun('req_client_idem_0001', {
      state: 'completed',
      settledCredits: 10,
      assistantMessageId: 'msg_a1',
    });
    assert.equal(updated.state, 'completed');
    assert.equal(updated.settledCredits, 10);
    assert.equal(updated.assistantMessageId, 'msg_a1');

    const queries: string[] = [];
    const pgRepo = new PostgresChatRepository({
      async query<T>(sql: string) {
        queries.push(sql);
        return { rows: [] as T[], rowCount: 1 };
      },
    });
    await pgRepo.createConversation({
      conversationId: 'conv_pg_1',
      userId: 'usr_pg',
      title: 'PG Test',
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    assert.equal(queries.length, 1);
    assert.ok(queries[0]?.includes('INSERT INTO chat.conversations'));
  });
});
