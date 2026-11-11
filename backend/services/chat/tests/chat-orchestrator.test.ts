import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, ERROR_CATALOGUE } from '@kartik/shared/errors';
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
  InMemoryChatIdempotencyStore,
  InMemoryChatLockStore,
  InMemoryChatRepository,
  type AgentPurgeCascadeResult,
  type AgentServiceClient,
  type BillingReleaseResult,
  type BillingServiceClient,
  type BillingSettleResult,
} from '../src/index.js';

class FakeBillingAndAgentRig
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
  public nextAgentError: Error | null = null;
  public nextAgentUnits = 7;
  public nextPurgeConfirmed = true;

  public async reserve(
    request: CreditReserveRequest,
  ): Promise<CreditReserveResponse> {
    this.reserveCalls.push(request);
    const reservedCredits = DEFAULT_OPERATION_UNITS[request.operation];
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
    const reserved = 10;
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
    if (this.nextAgentError) {
      const err = this.nextAgentError;
      this.nextAgentError = null;
      throw err;
    }
    return {
      executionId: `exec_${request.requestId}`,
      requestId: request.requestId,
      agent: 'chat',
      replyContent: `Mock specialist answer for: ${request.prompt}`,
      actualUnits: this.nextAgentUnits,
      artifactIds: ['art_01'],
      citations: [
        {
          sourceId: 'src_01',
          title: 'Kartik.ai Spec',
          urlOrPage: 'page 1',
        },
      ],
      usage: {
        promptTokens: 12,
        completionTokens: 24,
        totalTokens: 36,
        provider: 'mock-gemini',
        model: 'gemini-2.5-flash-mock',
        durationMs: 5,
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
      deletedVectorsCount: input.fileIds.length * 2,
      deletedObjectsCount: input.fileIds.length + input.artifactIds.length,
      deletedFilesCount: input.fileIds.length,
      deletedArtifactsCount: input.artifactIds.length,
      confirmed: this.nextPurgeConfirmed,
    };
  }
}

describe('@kartik/chat ChatOrchestratorService reserve/execute/settle & cascade purge (6.2.a)', () => {
  it('coordinates reserve -> execute -> settle, persists messages, and replays 24h idempotent retries without re-charging (§5.2, §5.4, Invariants #6 & #15)', async () => {
    const repo = new InMemoryChatRepository();
    const rig = new FakeBillingAndAgentRig();
    const idemStore = new InMemoryChatIdempotencyStore();
    const orchestrator = new ChatOrchestratorService({
      repo,
      billingClient: rig,
      agentClient: rig,
      idempotencyStore: idemStore,
    });

    await repo.createConversation({
      conversationId: 'conv_601',
      userId: 'user_alpha',
      title: 'Orchestration Test',
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: '2026-11-11T10:00:00.000Z',
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    });

    const firstTurn = await orchestrator.sendMessage({
      userId: 'user_alpha',
      conversationId: 'conv_601',
      requestId: 'req_turn_001_valid',
      traceId: 'trace_first',
      prompt: 'Explain the reserve -> execute -> settle flow',
    });

    assert.equal(firstTurn.idempotentReplay, false);
    assert.equal(firstTurn.run.state, 'completed');
    assert.equal(firstTurn.run.reservedCredits, 10);
    assert.equal(firstTurn.run.settledCredits, 7);
    assert.equal(firstTurn.remainingCredits, 93);
    assert.equal(rig.reserveCalls.length, 1);
    assert.equal(rig.executeCalls.length, 1);
    assert.equal(rig.settleCalls.length, 1);

    // Identical retry with same Idempotency-Key must replay cached result without calling Billing or Agent again
    const replayTurn = await orchestrator.sendMessage({
      userId: 'user_alpha',
      conversationId: 'conv_601',
      requestId: 'req_turn_001_valid',
      traceId: 'trace_replay',
      prompt: 'Explain the reserve -> execute -> settle flow',
    });

    assert.equal(replayTurn.idempotentReplay, true);
    assert.equal(replayTurn.traceId, 'trace_replay');
    assert.equal(
      replayTurn.assistantMessage.messageId,
      firstTurn.assistantMessage.messageId,
    );
    assert.equal(rig.reserveCalls.length, 1);
    assert.equal(rig.executeCalls.length, 1);
    assert.equal(rig.settleCalls.length, 1);

    // Mutated payload reusing the same Idempotency-Key must fail with 409 IDEMPOTENCY_CONFLICT
    await assert.rejects(
      async () =>
        orchestrator.sendMessage({
          userId: 'user_alpha',
          conversationId: 'conv_601',
          requestId: 'req_turn_001_valid',
          traceId: 'trace_conflict',
          prompt: 'Mutated prompt reusing the same Idempotency-Key!',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'IDEMPOTENCY_CONFLICT' &&
        err.httpStatus === 409,
    );
  });

  it('releases the credit reservation immediately when Agent fails with a confirmed error (§11 & Invariant #6)', async () => {
    const repo = new InMemoryChatRepository();
    const rig = new FakeBillingAndAgentRig();
    const orchestrator = new ChatOrchestratorService({
      repo,
      billingClient: rig,
      agentClient: rig,
    });

    await repo.createConversation({
      conversationId: 'conv_602',
      userId: 'user_alpha',
      title: 'Release on Failure Test',
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: '2026-11-11T10:00:00.000Z',
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    });

    rig.nextAgentError = new AppError(
      'ARTIFACT_INVALID',
      'Untrusted model output contained path traversal',
    );

    await assert.rejects(
      async () =>
        orchestrator.sendMessage({
          userId: 'user_alpha',
          conversationId: 'conv_602',
          requestId: 'req_turn_002_fail',
          traceId: 'trace_fail',
          prompt: 'Write code for a component',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'ARTIFACT_INVALID' &&
        err.httpStatus === 502,
    );

    assert.equal(rig.reserveCalls.length, 1);
    assert.equal(rig.releaseCalls.length, 1);
    assert.equal(rig.settleCalls.length, 0);

    const releasedRun = await repo.getAgentRunByRequestId(
      'user_alpha',
      'req_turn_002_fail',
    );
    assert.ok(releasedRun);
    assert.equal(releasedRun.state, 'released');
    assert.equal(releasedRun.settledCredits, 0);
    assert.equal(releasedRun.errorCode, 'ARTIFACT_INVALID');
  });

  it('transitions ambiguous EXECUTION_UNKNOWN to execution_unknown without releasing blindly, blocks blind retries, and reconciles under lock:settle:{reservationId} (§10 & §11)', async () => {
    const repo = new InMemoryChatRepository();
    const rig = new FakeBillingAndAgentRig();
    const lockStore = new InMemoryChatLockStore();
    const orchestrator = new ChatOrchestratorService({
      repo,
      billingClient: rig,
      agentClient: rig,
      lockStore,
    });

    await repo.createConversation({
      conversationId: 'conv_603',
      userId: 'user_alpha',
      title: 'Ambiguous Timeout Reconciliation',
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: '2026-11-11T10:00:00.000Z',
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    });

    rig.nextAgentError = new AppError(
      'EXECUTION_UNKNOWN',
      'Agent upstream timed out before response receipt',
    );

    await assert.rejects(
      async () =>
        orchestrator.sendMessage({
          userId: 'user_alpha',
          conversationId: 'conv_603',
          requestId: 'req_turn_003_timeout',
          traceId: 'trace_timeout',
          prompt: 'Analyze complex architecture',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'EXECUTION_UNKNOWN' &&
        err.httpStatus === ERROR_CATALOGUE.EXECUTION_UNKNOWN.httpStatus,
    );

    // Must NOT have released or settled blindly
    assert.equal(rig.reserveCalls.length, 1);
    assert.equal(rig.releaseCalls.length, 0);
    assert.equal(rig.settleCalls.length, 0);

    const unknownRun = await repo.getAgentRunByRequestId(
      'user_alpha',
      'req_turn_003_timeout',
    );
    assert.ok(unknownRun);
    assert.equal(unknownRun.state, 'execution_unknown');

    // Blind retry with same requestId while in execution_unknown is blocked with 409 IDEMPOTENCY_CONFLICT
    await assert.rejects(
      async () =>
        orchestrator.sendMessage({
          userId: 'user_alpha',
          conversationId: 'conv_603',
          requestId: 'req_turn_003_timeout',
          traceId: 'trace_blind_retry',
          prompt: 'Analyze complex architecture',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'IDEMPOTENCY_CONFLICT' &&
        err.httpStatus === 409,
    );

    // Reconcile the unknown run cleanly under lock:settle:{reservationId}
    const reconciled = await orchestrator.reconcileUnknownRun({
      userId: 'user_alpha',
      requestId: 'req_turn_003_timeout',
      traceId: 'trace_reconcile',
      outcome: 'completed',
      actualUnits: 8,
    });

    assert.equal(reconciled.state, 'completed');
    assert.equal(reconciled.settledCredits, 8);
    assert.equal(rig.settleCalls.length, 1);
  });

  it('coordinates conversation deletion under lock:cleanup:{conversationId} and marks purged only after Agent confirms vectors -> objects -> metadata (Invariants #3, #18, #20)', async () => {
    const repo = new InMemoryChatRepository();
    const rig = new FakeBillingAndAgentRig();
    const lockStore = new InMemoryChatLockStore();
    const orchestrator = new ChatOrchestratorService({
      repo,
      billingClient: rig,
      agentClient: rig,
      lockStore,
    });

    await repo.createConversation({
      conversationId: 'conv_604',
      userId: 'user_alpha',
      title: 'Cascade Delete Test',
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: '2026-11-11T10:00:00.000Z',
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T10:00:00.000Z',
    });

    await repo.saveMessage({
      messageId: 'msg_del_1',
      conversationId: 'conv_604',
      userId: 'user_alpha',
      requestId: 'req_del_msg_1',
      role: 'user',
      content: 'Uploaded spec.pdf',
      agentUsed: 'rag',
      attachmentFileIds: ['file_pdf_99'],
      artifactIds: ['art_code_99'],
      citations: [],
      createdAt: '2026-11-11T10:01:00.000Z',
    });

    // Foreign user attempting to delete user_alpha's conversation gets 404 NOT_FOUND (Invariant #20)
    await assert.rejects(
      async () =>
        orchestrator.deleteConversation({
          userId: 'user_intruder',
          conversationId: 'conv_604',
          requestId: 'req_foreign_delete',
          traceId: 'trace_foreign_del',
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'NOT_FOUND' &&
        err.httpStatus === 404,
    );

    const deleteRes = await orchestrator.deleteConversation({
      userId: 'user_alpha',
      conversationId: 'conv_604',
      requestId: 'req_valid_delete',
      traceId: 'trace_del',
    });

    assert.equal(deleteRes.lockKey, 'lock:cleanup:conv_604');
    assert.equal(deleteRes.conversation.deletionState, 'purged');
    assert.deepEqual(deleteRes.purgeResult.purgeOrder, [
      'vectors',
      'objects',
      'metadata',
    ]);
    assert.equal(rig.purgeCalls.length, 1);
    assert.deepEqual(rig.purgeCalls[0]?.fileIds, ['file_pdf_99']);
    assert.deepEqual(rig.purgeCalls[0]?.artifactIds, ['art_code_99']);
    assert.equal(await lockStore.isLocked('lock:cleanup:conv_604'), false);
  });
});
