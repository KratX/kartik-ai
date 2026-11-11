import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_AUTH_HEADERS,
  generateEd25519KeyPair,
  signUserContextAssertion,
} from '@kartik/shared/auth';
import type {
  AgentExecuteRequest,
  AgentExecuteResponse,
  CreditReleaseRequest,
  CreditReserveRequest,
  CreditReserveResponse,
  CreditSettleRequest,
} from '@kartik/shared/contracts';
import {
  ChatOrchestratorService,
  DEFAULT_OPERATION_UNITS,
  InMemoryChatRepository,
  createChatRouter,
  loadChatConfig,
  type AgentPurgeCascadeResult,
  type AgentServiceClient,
  type BillingReleaseResult,
  type BillingServiceClient,
  type BillingSettleResult,
  type ChatTurnResult,
  type ConversationRecord,
  type DeleteConversationResult,
  type MessageRecord,
} from '../src/index.js';

const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();

class RouteTestBillingAndAgentRig
  implements BillingServiceClient, AgentServiceClient
{
  public reserveCalls: CreditReserveRequest[] = [];
  public settleCalls: Array<
    CreditSettleRequest & { readonly actualUnits?: number }
  > = [];
  public releaseCalls: CreditReleaseRequest[] = [];
  public executeCalls: AgentExecuteRequest[] = [];
  public purgeCalls: Array<{
    readonly userId: string;
    readonly conversationId: string;
    readonly fileIds: readonly string[];
    readonly artifactIds: readonly string[];
  }> = [];

  public balance = 100;
  private lastReserved = 10;

  public async reserve(
    request: CreditReserveRequest,
  ): Promise<CreditReserveResponse> {
    this.reserveCalls.push(request);
    const reservedCredits = DEFAULT_OPERATION_UNITS[request.operation];
    this.lastReserved = reservedCredits;
    this.balance -= reservedCredits;
    return {
      reservationId: `resv_${request.requestId}`,
      requestId: request.requestId,
      reservedCredits,
      status: 'reserved',
      expiresAt: new Date(Date.now() + 900_000).toISOString(),
    };
  }

  public async settle(
    request: CreditSettleRequest & { readonly actualUnits?: number },
  ): Promise<BillingSettleResult> {
    this.settleCalls.push(request);
    const reserved = this.lastReserved;
    const settled = request.actualUnits ?? reserved;
    const refunded = Math.max(0, reserved - settled);
    this.balance += refunded;
    return {
      reservationId: request.reservationId,
      requestId: request.requestId,
      status: 'settled',
      reservedCredits: reserved,
      settledCredits: settled,
      refundedCredits: refunded,
      remainingBalance: this.balance,
    };
  }

  public async release(
    request: CreditReleaseRequest,
  ): Promise<BillingReleaseResult> {
    this.releaseCalls.push(request);
    const released = 10;
    this.balance += released;
    return {
      reservationId: request.reservationId,
      requestId: request.requestId,
      status: 'released',
      releasedCredits: released,
      remainingBalance: this.balance,
    };
  }

  public async execute(
    request: AgentExecuteRequest,
  ): Promise<AgentExecuteResponse & { readonly actualUnits?: number }> {
    this.executeCalls.push(request);
    return {
      executionId: `exec_${request.requestId}`,
      requestId: request.requestId,
      agent: 'chat',
      replyContent: `Mock reply for: ${request.prompt}`,
      actualUnits: 6,
      artifactIds: ['art_route_01'],
      citations: [
        {
          sourceId: 'src_route_01',
          title: 'Phase 6 Spec',
          urlOrPage: 'p. 6',
        },
      ],
      usage: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        provider: 'mock-gemini',
        model: 'gemini-2.5-flash-mock',
        durationMs: 4,
        mock: true,
      },
    };
  }

  public async purgeResources(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly fileIds: readonly string[];
    readonly artifactIds: readonly string[];
  }): Promise<AgentPurgeCascadeResult> {
    this.purgeCalls.push(input);
    return {
      conversationId: input.conversationId,
      userId: input.userId,
      purgeOrder: ['vectors', 'objects', 'metadata'],
      deletedVectorsCount: input.fileIds.length,
      deletedObjectsCount: input.fileIds.length + input.artifactIds.length,
      deletedFilesCount: input.fileIds.length,
      deletedArtifactsCount: input.artifactIds.length,
      confirmed: true,
    };
  }
}

function createTestChatRouter(options?: {
  readonly demoReadOnly?: boolean;
  readonly maxRequestsPerMinute?: number;
  readonly checkReadiness?: () => Promise<boolean>;
}) {
  const config = loadChatConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/kartik',
    REDIS_URL: 'redis://localhost:6379',
    USER_CONTEXT_PUBLIC_KEY: publicKeyPem,
    CHAT_TO_AGENT_TOKEN: 'secret-chat-to-agent-token-63a',
    CHAT_TO_BILLING_TOKEN: 'secret-chat-to-billing-token-63a',
    DEMO_READ_ONLY: options?.demoReadOnly ? 'true' : 'false',
  });

  const repository = new InMemoryChatRepository();
  const rig = new RouteTestBillingAndAgentRig();
  const orchestrator = new ChatOrchestratorService({
    repo: repository,
    billingClient: rig,
    agentClient: rig,
  });

  const router = createChatRouter({
    config,
    repository,
    orchestrator,
    maxRequestsPerMinute: options?.maxRequestsPerMinute ?? 60,
    checkReadiness: options?.checkReadiness,
  });

  return { router, repository, rig };
}

describe('@kartik/chat HTTP routes & Phase 6 Exit Gate closure (6.3.a)', () => {
  it('completes POST /conversations -> POST /conversations/:id/messages -> 24h idempotent replay -> GET messages cursor -> DELETE cascade purge -> 404 (Phase 6 Exit Gate)', async () => {
    const { router, rig } = createTestChatRouter();

    const aliceAssertion = signUserContextAssertion(
      {
        sub: 'usr_alice',
        aud: 'chat',
        traceId: 'trace_chat_63a_1',
      },
      privateKeyPem,
    );

    // 1. Create conversation
    const createRes = await router.execute<{
      error: null;
      data: ConversationRecord;
      requestId: string;
    }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_create_conv_63a',
      },
      body: { title: 'Phase 6 Exit Gate Conversation' },
    });

    assert.equal(createRes.statusCode, 201);
    assert.equal(createRes.body.error, null);
    const convId = createRes.body.data.conversationId;
    assert.ok(convId.startsWith('conv_'));

    // 2. Send message turn (Reserve -> Execute -> Settle)
    const msgRes = await router.execute<{
      error: null;
      data: ChatTurnResult;
      requestId: string;
    }>({
      method: 'POST',
      path: `/api/v1/conversations/${convId}/messages`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_send_msg_63a_1',
      },
      body: {
        prompt: 'Explain Phase 6 Chat Service orchestration',
        attachmentFileIds: ['file_pdf_01'],
      },
    });

    assert.equal(msgRes.statusCode, 201);
    assert.equal(msgRes.body.data.idempotentReplay, false);
    assert.equal(msgRes.body.data.run.state, 'completed');
    assert.equal(msgRes.body.data.run.settledCredits, 6);
    assert.equal(msgRes.body.data.remainingCredits, 94);
    assert.equal(rig.reserveCalls.length, 1);
    assert.equal(rig.executeCalls.length, 1);
    assert.equal(rig.settleCalls.length, 1);

    // 3. Replay identical requestId -> returns 200 OK idempotent replay without calling Billing or Agent again
    const replayRes = await router.execute<{
      error: null;
      data: ChatTurnResult;
      requestId: string;
    }>({
      method: 'POST',
      path: `/api/v1/conversations/${convId}/messages`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_send_msg_63a_1',
      },
      body: {
        prompt: 'Explain Phase 6 Chat Service orchestration',
        attachmentFileIds: ['file_pdf_01'],
      },
    });

    assert.equal(replayRes.statusCode, 200);
    assert.equal(replayRes.body.data.idempotentReplay, true);
    assert.equal(rig.reserveCalls.length, 1);
    assert.equal(rig.executeCalls.length, 1);
    assert.equal(rig.settleCalls.length, 1);

    // 4. List messages with limit=1 -> returns nextCursor in envelope meta.nextCursor
    const page1 = await router.execute<{
      error: null;
      data: { items: readonly MessageRecord[] };
      meta: { nextCursor: string | null };
    }>({
      method: 'GET',
      path: `/api/v1/conversations/${convId}/messages?limit=1`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
    });

    assert.equal(page1.statusCode, 200);
    assert.equal(page1.body.data.items.length, 1);
    assert.ok(page1.body.meta.nextCursor);

    // 5. Delete conversation -> cascades vectors -> objects -> metadata via Agent
    const delRes = await router.execute<{
      error: null;
      data: DeleteConversationResult;
    }>({
      method: 'DELETE',
      path: `/api/v1/conversations/${convId}`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_delete_conv_63a',
      },
    });

    assert.equal(delRes.statusCode, 200);
    assert.equal(delRes.body.data.conversation.deletionState, 'purged');
    assert.deepEqual(delRes.body.data.purgeResult.purgeOrder, [
      'vectors',
      'objects',
      'metadata',
    ]);
    assert.equal(rig.purgeCalls.length, 1);

    // 6. Subsequent GET on purged conversation returns 404 NOT_FOUND
    const afterDel = await router.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'GET',
      path: `/api/v1/conversations/${convId}`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
    });
    assert.equal(afterDel.statusCode, 404);
    assert.equal(afterDel.body.error.code, 'NOT_FOUND');
  });

  it('rejects wrong-audience Ed25519 assertions (aud !== "chat") with 401 and returns 404 NOT_FOUND on foreign user conversation access (§6.4 & Invariant #20)', async () => {
    const { router } = createTestChatRouter();

    const aliceChatAssertion = signUserContextAssertion(
      {
        sub: 'usr_alice',
        aud: 'chat',
        traceId: 'trace_alice_chat',
      },
      privateKeyPem,
    );

    const bobChatAssertion = signUserContextAssertion(
      {
        sub: 'usr_bob',
        aud: 'chat',
        traceId: 'trace_bob_chat',
      },
      privateKeyPem,
    );

    const wrongAudAssertion = signUserContextAssertion(
      {
        sub: 'usr_alice',
        aud: 'agent',
        traceId: 'trace_wrong_aud',
      },
      privateKeyPem,
    );

    // Wrong audience (aud="agent") is rejected with 401 UNAUTHENTICATED
    const wrongAudRes = await router.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: wrongAudAssertion,
      },
    });
    assert.equal(wrongAudRes.statusCode, 401);
    assert.equal(wrongAudRes.body.error.code, 'UNAUTHENTICATED');

    // Alice creates a conversation
    const created = await router.execute<{
      error: null;
      data: ConversationRecord;
    }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceChatAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_alice_conv_2',
      },
      body: { title: 'Alice Private Workspace' },
    });
    const convId = created.body.data.conversationId;

    // Bob attempting to GET or DELETE Alice's conversation receives 404 NOT_FOUND (never 403 FORBIDDEN, Invariant #20)
    const bobGet = await router.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'GET',
      path: `/api/v1/conversations/${convId}`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: bobChatAssertion,
      },
    });
    assert.equal(bobGet.statusCode, 404);
    assert.equal(bobGet.body.error.code, 'NOT_FOUND');

    const bobDelete = await router.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'DELETE',
      path: `/api/v1/conversations/${convId}`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: bobChatAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_bob_intrude_del',
      },
    });
    assert.equal(bobDelete.statusCode, 404);
    assert.equal(bobDelete.body.error.code, 'NOT_FOUND');
  });

  it('enforces DEMO_READ_ONLY kill switch on mutating chat routes (403) while allowing GET browsing, and requires Idempotency-Key (§12, Invariant #15)', async () => {
    const { router: writableRouter } = createTestChatRouter({
      demoReadOnly: false,
    });
    const { router: readOnlyRouter } = createTestChatRouter({
      demoReadOnly: true,
    });

    const aliceAssertion = signUserContextAssertion(
      {
        sub: 'usr_alice',
        aud: 'chat',
        traceId: 'trace_demo_check',
      },
      privateKeyPem,
    );

    // Missing Idempotency-Key on POST /conversations fails with 400 IDEMPOTENCY_KEY_REQUIRED
    const missingIdem = await writableRouter.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
      body: { title: 'Missing Idempotency Key' },
    });
    assert.equal(missingIdem.statusCode, 400);
    assert.equal(missingIdem.body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

    // In DEMO_READ_ONLY mode, GET /conversations succeeds (200) while POST /conversations returns 403 DEMO_READ_ONLY
    const getReadOnly = await readOnlyRouter.execute<{
      error: null;
      data: { items: readonly ConversationRecord[] };
    }>({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
    });
    assert.equal(getReadOnly.statusCode, 200);

    const postReadOnly = await readOnlyRouter.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_readonly_blocked',
      },
      body: { title: 'Blocked in Demo Mode' },
    });
    assert.equal(postReadOnly.statusCode, 403);
    assert.equal(postReadOnly.body.error.code, 'DEMO_READ_ONLY');
  });

  it('serves /healthz and /readyz (503 PROVIDER_UNAVAILABLE when down) and enforces per-user rate limits (429 RATE_LIMITED with Retry-After)', async () => {
    let isReady = true;
    const { router } = createTestChatRouter({
      maxRequestsPerMinute: 2,
      checkReadiness: async () => isReady,
    });

    const health = await router.execute<{
      error: null;
      data: { status: string; service: string };
    }>({
      method: 'GET',
      path: '/healthz',
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.data.service, 'chat');

    isReady = false;
    const notReady = await router.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'GET',
      path: '/readyz',
    });
    assert.equal(notReady.statusCode, 503);
    assert.equal(notReady.body.error.code, 'PROVIDER_UNAVAILABLE');

    const aliceAssertion = signUserContextAssertion(
      {
        sub: 'usr_rate_test',
        aud: 'chat',
        traceId: 'trace_rate_test',
      },
      privateKeyPem,
    );

    const r1 = await router.execute({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: { [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion },
    });
    assert.equal(r1.statusCode, 200);

    const r2 = await router.execute({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: { [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion },
    });
    assert.equal(r2.statusCode, 200);

    const r3 = await router.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'GET',
      path: '/api/v1/conversations',
      headers: { [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion },
    });
    assert.equal(r3.statusCode, 429);
    assert.equal(r3.body.error.code, 'RATE_LIMITED');
    assert.equal(r3.headers['Retry-After'] ?? r3.headers['retry-after'], '60');
  });
});
