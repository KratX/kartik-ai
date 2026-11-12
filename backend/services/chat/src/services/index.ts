import { randomUUID } from 'node:crypto';
import {
  AppError,
  REDIS_TTL_SECONDS,
  RedisKeys,
  computePayloadFingerprint,
  validateIdempotencyKey,
  type AgentExecuteRequest,
  type AgentExecuteResponse,
  type BillingOperation,
  type CreditReleaseRequest,
  type CreditReserveRequest,
  type CreditReserveResponse,
  type CreditSettleRequest,
  type ReservationState,
  type SpecialistAgentName,
} from '@kartik/shared';
import type {
  AgentRunRecord,
  ConversationRecord,
  MessageRecord,
} from '../models/index.js';
import type { ChatRepository } from '../repositories/index.js';

/**
 * Authoritative mapping from Specialist Agent to Billing Operation (§5.3 & §11).
 */
export const AGENT_TO_BILLING_OPERATION: Readonly<
  Record<SpecialistAgentName, BillingOperation>
> = Object.freeze({
  chat: 'chat_turn',
  search: 'web_search',
  coding: 'code_generation',
  pdf: 'pdf_generation',
  ppt: 'ppt_generation',
  rag: 'pdf_rag_query',
  vision: 'vision_analysis',
  image: 'image_generation',
});

/**
 * Default credit reservation units requested per operation before execution (§11).
 */
export const DEFAULT_OPERATION_UNITS: Readonly<Record<BillingOperation, number>> =
  Object.freeze({
    chat_turn: 10,
    web_search: 15,
    code_generation: 20,
    pdf_generation: 15,
    ppt_generation: 20,
    pdf_rag_query: 15,
    vision_analysis: 20,
    image_generation: 30,
  });

/**
 * Lightweight prompt classifier used by Chat prior to Billing reservation when the caller
 * does not explicitly specify `requestedAgent`, matching Agent's deterministic specialist router.
 */
export function resolveTargetSpecialist(input: {
  readonly prompt: string;
  readonly requestedAgent?: SpecialistAgentName;
  readonly attachmentFileIds?: readonly string[];
  readonly hasImageBytes?: boolean;
}): SpecialistAgentName {
  if (input.requestedAgent) {
    return input.requestedAgent;
  }
  if (input.hasImageBytes) {
    return 'vision';
  }
  if (input.attachmentFileIds && input.attachmentFileIds.length > 0) {
    return 'rag';
  }
  const lower = input.prompt.toLowerCase();
  if (
    lower.includes('generate image') ||
    lower.includes('draw ') ||
    lower.includes('create an image')
  ) {
    return 'image';
  }
  if (
    lower.includes('create a ppt') ||
    lower.includes('generate a ppt') ||
    lower.includes('presentation') ||
    lower.includes('slide deck') ||
    lower.includes('powerpoint')
  ) {
    return 'ppt';
  }
  if (
    lower.includes('generate a pdf') ||
    lower.includes('create a pdf') ||
    lower.includes('pdf report') ||
    lower.includes('export pdf')
  ) {
    return 'pdf';
  }
  if (
    lower.includes('write code') ||
    lower.includes('typescript') ||
    lower.includes('react component') ||
    lower.includes('implement ')
  ) {
    return 'coding';
  }
  if (
    lower.includes('search the web') ||
    lower.includes('latest news') ||
    lower.includes('current price')
  ) {
    return 'search';
  }
  return 'chat';
}

export interface ChatTurnResult {
  readonly conversationId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly run: AgentRunRecord;
  readonly userMessage: MessageRecord;
  readonly assistantMessage: MessageRecord;
  readonly remainingCredits: number;
  readonly idempotentReplay: boolean;
}

export interface ChatIdempotencyEntry {
  readonly key: string;
  readonly userId: string;
  readonly requestId: string;
  readonly payloadFingerprint: string;
  readonly response: ChatTurnResult;
  readonly ttlSeconds: number;
  readonly expiresAtMs: number;
}

export interface ChatIdempotencyStore {
  get(key: string): Promise<ChatIdempotencyEntry | null>;
  set(entry: Omit<ChatIdempotencyEntry, 'expiresAtMs'>): Promise<void>;
}

/**
 * In-memory 24-hour Chat Idempotency store (`idem:{userId}:{requestId}`, TTL 86,400s per §5.2).
 */
export class InMemoryChatIdempotencyStore implements ChatIdempotencyStore {
  private readonly store = new Map<string, ChatIdempotencyEntry>();

  public async get(key: string): Promise<ChatIdempotencyEntry | null> {
    const existing = this.store.get(key);
    if (!existing) {
      return null;
    }
    if (existing.expiresAtMs <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return existing;
  }

  public async set(
    entry: Omit<ChatIdempotencyEntry, 'expiresAtMs'>,
  ): Promise<void> {
    this.store.set(
      entry.key,
      Object.freeze({
        ...entry,
        expiresAtMs: Date.now() + entry.ttlSeconds * 1000,
      }),
    );
  }
}

export interface ChatLockStore {
  acquire(key: string, token: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
  isLocked(key: string): Promise<boolean>;
}

/**
 * In-memory distributed lock store supporting `lock:settle:{reservationId}` (5m TTL)
 * and `lock:cleanup:{conversationId}` (10m TTL) per Blueprint §5.2.
 */
export class InMemoryChatLockStore implements ChatLockStore {
  private readonly locks = new Map<
    string,
    { readonly token: string; readonly expiresAtMs: number }
  >();

  public async acquire(
    key: string,
    token: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAtMs > now) {
      return false;
    }
    this.locks.set(key, {
      token,
      expiresAtMs: now + ttlSeconds * 1000,
    });
    return true;
  }

  public async release(key: string, token: string): Promise<void> {
    const existing = this.locks.get(key);
    if (existing && existing.token === token) {
      this.locks.delete(key);
    }
  }

  public async isLocked(key: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (!existing) {
      return false;
    }
    if (existing.expiresAtMs <= Date.now()) {
      this.locks.delete(key);
      return false;
    }
    return true;
  }
}

export interface BillingSettleResult {
  readonly reservationId: string;
  readonly requestId: string;
  readonly status: ReservationState;
  readonly reservedCredits: number;
  readonly settledCredits: number;
  readonly refundedCredits: number;
  readonly remainingBalance: number;
}

export interface BillingReleaseResult {
  readonly reservationId: string;
  readonly requestId: string;
  readonly status: ReservationState;
  readonly releasedCredits: number;
  readonly remainingBalance: number;
}

/**
 * Private contract client from `@kartik/chat` -> `@kartik/billing` (Invariants #5, #6, #7, #14).
 */
export interface BillingServiceClient {
  reserve(request: CreditReserveRequest): Promise<CreditReserveResponse>;
  settle(
    request: CreditSettleRequest & { readonly actualUnits?: number },
  ): Promise<BillingSettleResult>;
  release(request: CreditReleaseRequest): Promise<BillingReleaseResult>;
}

export interface AgentPurgeCascadeResult {
  readonly conversationId: string;
  readonly userId: string;
  readonly purgeOrder: readonly ['vectors', 'objects', 'metadata'];
  readonly deletedVectorsCount: number;
  readonly deletedObjectsCount: number;
  readonly deletedFilesCount: number;
  readonly deletedArtifactsCount: number;
  readonly confirmed: boolean;
}

/**
 * Private contract client from `@kartik/chat` -> `@kartik/agent` (Invariants #4, #6, #7, #14, #18).
 */
export interface AgentServiceClient {
  execute(
    request: AgentExecuteRequest & {
      readonly requestedAgent?: SpecialistAgentName;
      readonly imageMimeType?: string;
      readonly imageBytes?: Uint8Array;
    },
  ): Promise<AgentExecuteResponse & { readonly actualUnits?: number }>;
  purgeResources(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly fileIds: readonly string[];
    readonly artifactIds: readonly string[];
    readonly traceId: string;
    readonly requestId: string;
  }): Promise<AgentPurgeCascadeResult>;
}

export interface SendMessageInput {
  readonly userId: string;
  readonly conversationId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly prompt: string;
  readonly requestedAgent?: SpecialistAgentName;
  readonly attachmentFileIds?: readonly string[];
  readonly imageMimeType?: string;
  readonly imageBytes?: Uint8Array;
}

export interface DeleteConversationResult {
  readonly conversation: ConversationRecord;
  readonly purgeResult: AgentPurgeCascadeResult;
  readonly lockKey: string;
}

/**
 * `@kartik/chat` Orchestrator Service (Micro-step 6.2.a).
 *
 * Enforces Blueprint §5.2, §5.4, §9 (Invariants #3, #6, #7, #15, #17, #18, #20) & §11:
 * 1. Never generates or rewrites `requestId` (`Idempotency-Key` belongs to the client).
 * 2. Enforces 24h Chat idempotency (`idem:{userId}:{requestId}`, TTL 86,400s) and rejects mutated
 *    payloads reusing the same `requestId` with `409 IDEMPOTENCY_CONFLICT`.
 * 3. Coordinates Billing `reserve` -> Agent `execute` -> Billing `settle` (on durable success)
 *    or `release` (on confirmed failure).
 * 4. Transitions ambiguous provider timeouts (`EXECUTION_UNKNOWN`) to `execution_unknown`
 *    instead of blindly releasing or retrying a potentially completed billable call (§10 & §11),
 *    providing `reconcileUnknownRun` guarded by `lock:settle:{reservationId}` (5m TTL).
 * 5. Coordinates conversation deletion (`active` -> `requested` -> `purging` -> `purged`)
 *    guarded by `lock:cleanup:{conversationId}` (10m TTL), marking `purged` only after Agent
 *    confirms `vectors -> objects -> metadata` deletion (Invariant #18).
 */
export class ChatOrchestratorService {
  private readonly repo: ChatRepository;
  private readonly billingClient: BillingServiceClient;
  private readonly agentClient: AgentServiceClient;
  private readonly idempotencyStore: ChatIdempotencyStore;
  private readonly lockStore: ChatLockStore;

  constructor(options: {
    readonly repo: ChatRepository;
    readonly billingClient: BillingServiceClient;
    readonly agentClient: AgentServiceClient;
    readonly idempotencyStore?: ChatIdempotencyStore;
    readonly lockStore?: ChatLockStore;
  }) {
    this.repo = options.repo;
    this.billingClient = options.billingClient;
    this.agentClient = options.agentClient;
    this.idempotencyStore =
      options.idempotencyStore ?? new InMemoryChatIdempotencyStore();
    this.lockStore = options.lockStore ?? new InMemoryChatLockStore();
  }

  public async sendMessage(input: SendMessageInput): Promise<ChatTurnResult> {
    // 1. Validate client Idempotency-Key without ever generating or rewriting it (Invariant #15)
    const requestId = validateIdempotencyKey(input.requestId);
    const trimmedPrompt = input.prompt.trim();
    if (!trimmedPrompt) {
      throw new AppError('VALIDATION_FAILED', 'Message prompt must not be empty', {
        details: { prompt: ['Prompt is required'] },
      });
    }

    // 2. Verify conversation ownership (returns 404 NOT_FOUND on missing or foreign conversation per Invariant #20)
    await this.repo.getConversationForUser(input.userId, input.conversationId);

    const attachmentFileIds = Object.freeze([
      ...(input.attachmentFileIds ?? []),
    ]);
    const targetAgent = resolveTargetSpecialist({
      prompt: trimmedPrompt,
      requestedAgent: input.requestedAgent,
      attachmentFileIds,
      hasImageBytes: Boolean(input.imageBytes && input.imageBytes.byteLength > 0),
    });
    const operation = AGENT_TO_BILLING_OPERATION[targetAgent];

    const payloadFingerprint = computePayloadFingerprint({
      userId: input.userId,
      conversationId: input.conversationId,
      prompt: trimmedPrompt,
      requestedAgent: input.requestedAgent ?? null,
      attachmentFileIds,
      imageByteLength: input.imageBytes?.byteLength ?? 0,
    });

    // 3. Check 24-hour Chat Idempotency store (`idem:{userId}:{requestId}`, TTL 86,400s per §5.2)
    const idemSpec = RedisKeys.idempotency(input.userId, requestId, 'chat');
    const cached = await this.idempotencyStore.get(idemSpec.key);
    if (cached) {
      if (cached.payloadFingerprint !== payloadFingerprint) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used with a different message payload',
        );
      }
      return Object.freeze({
        ...cached.response,
        traceId: input.traceId,
        idempotentReplay: true,
      });
    }

    // 4. Check durable AgentRunRecord in PostgreSQL in case Redis cache expired or run is in flight
    const existingRun = await this.repo.getAgentRunByRequestId(
      input.userId,
      requestId,
    );
    if (existingRun) {
      if (existingRun.payloadFingerprint !== payloadFingerprint) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used with a different message payload',
        );
      }
      if (existingRun.state === 'execution_unknown') {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          `Run "${requestId}" is in execution_unknown state awaiting reconciliation; do not retry blindly`,
        );
      }
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        `Run "${requestId}" already exists in state "${existingRun.state}"`,
      );
    }

    const nowIso = new Date().toISOString();
    const runId = `run_${randomUUID()}`;
    const userMessageId = `msg_user_${randomUUID()}`;

    // 5. Persist initial `pending` AgentRunRecord before calling Billing
    let currentRun = await this.repo.saveAgentRun({
      runId,
      requestId,
      traceId: input.traceId,
      userId: input.userId,
      conversationId: input.conversationId,
      userMessageId,
      assistantMessageId: null,
      agent: targetAgent,
      operation,
      reservationId: null,
      reservedCredits: 0,
      settledCredits: null,
      state: 'pending',
      payloadFingerprint,
      errorCode: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    // 6. Reserve credits via Billing before expensive Agent execution (Invariants #6 & #17, §11)
    let reservation: CreditReserveResponse;
    try {
      reservation = await this.billingClient.reserve({
        requestId,
        traceId: input.traceId,
        userId: input.userId,
        conversationId: input.conversationId,
        agent: targetAgent,
        operation,
      });
    } catch (err) {
      const errorCode = err instanceof AppError ? err.code : 'INTERNAL_ERROR';
      await this.repo.updateAgentRun(requestId, {
        state: 'failed',
        errorCode,
      });
      throw err;
    }

    currentRun = await this.repo.updateAgentRun(requestId, {
      state: 'reserved',
      reservationId: reservation.reservationId,
      reservedCredits: reservation.reservedCredits,
    });

    // 7. Transition run to `executing` and invoke Agent (`POST /internal/agent/execute`)
    currentRun = await this.repo.updateAgentRun(requestId, {
      state: 'executing',
    });

    let agentResponse: AgentExecuteResponse & { readonly actualUnits?: number };
    try {
      agentResponse = await this.agentClient.execute({
        requestId,
        traceId: input.traceId,
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: userMessageId,
        prompt: trimmedPrompt,
        preferredAgent: input.requestedAgent,
        attachmentFileIds,
        imageMimeType: input.imageMimeType,
        imageBytes: input.imageBytes,
      });
    } catch (err) {
      const errorCode = err instanceof AppError ? err.code : 'INTERNAL_ERROR';

      // Blueprint §10 & §11: On ambiguous timeout (EXECUTION_UNKNOWN), NEVER blindly release or
      // retry a potentially completed billable call. Persist `execution_unknown` so reconciliation
      // can inspect and settle/release under lock:settle:{reservationId}.
      if (err instanceof AppError && err.code === 'EXECUTION_UNKNOWN') {
        await this.repo.updateAgentRun(requestId, {
          state: 'execution_unknown',
          errorCode: 'EXECUTION_UNKNOWN',
        });
        throw err;
      }

      // Confirmed failure before completion -> release reservation immediately
      await this.billingClient.release({
        reservationId: reservation.reservationId,
        requestId,
        traceId: input.traceId,
        userId: input.userId,
        reason: `agent_execution_failed:${errorCode}`,
      });

      await this.repo.updateAgentRun(requestId, {
        state: 'released',
        settledCredits: 0,
        errorCode,
      });
      throw err;
    }

    // 8. Persist durable user and assistant messages in `chat.messages`
    const userMessage = await this.repo.saveMessage({
      messageId: userMessageId,
      conversationId: input.conversationId,
      userId: input.userId,
      requestId,
      role: 'user',
      content: trimmedPrompt,
      agentUsed: null,
      attachmentFileIds,
      artifactIds: [],
      citations: [],
      createdAt: new Date().toISOString(),
    });

    const assistantMessageId = `msg_asst_${randomUUID()}`;
    const assistantMessage = await this.repo.saveMessage({
      messageId: assistantMessageId,
      conversationId: input.conversationId,
      userId: input.userId,
      requestId,
      role: 'assistant',
      content: agentResponse.replyContent,
      agentUsed: agentResponse.agent,
      attachmentFileIds: [],
      artifactIds: agentResponse.artifactIds ?? [],
      citations: agentResponse.citations ?? [],
      createdAt: new Date().toISOString(),
    });

    // 9. Settle the credit reservation after the result is durable (§11)
    const actualUnits =
      agentResponse.actualUnits ?? reservation.reservedCredits;
    const settleResult = await this.billingClient.settle({
      reservationId: reservation.reservationId,
      requestId,
      traceId: input.traceId,
      userId: input.userId,
      actualUnits,
    });

    currentRun = await this.repo.updateAgentRun(requestId, {
      state: 'completed',
      settledCredits: settleResult.settledCredits,
      assistantMessageId,
    });

    const turnResult: ChatTurnResult = Object.freeze({
      conversationId: input.conversationId,
      requestId,
      traceId: input.traceId,
      run: currentRun,
      userMessage,
      assistantMessage,
      remainingCredits: settleResult.remainingBalance,
      idempotentReplay: false,
    });

    // 10. Cache in 24-hour Chat Idempotency store (`idem:{userId}:{requestId}`, TTL 86,400s per §5.2)
    await this.idempotencyStore.set({
      key: idemSpec.key,
      userId: input.userId,
      requestId,
      payloadFingerprint,
      response: turnResult,
      ttlSeconds: REDIS_TTL_SECONDS.IDEMPOTENCY_CHAT,
    });

    return turnResult;
  }

  /**
   * Reconciles a run in `execution_unknown` state while holding `lock:settle:{reservationId}`
   * (5m TTL per §5.2 & §11).
   */
  public async reconcileUnknownRun(input: {
    readonly userId: string;
    readonly requestId: string;
    readonly traceId: string;
    readonly outcome: 'completed' | 'failed';
    readonly actualUnits?: number;
  }): Promise<AgentRunRecord> {
    const run = await this.repo.getAgentRunByRequestId(
      input.userId,
      input.requestId,
    );
    if (!run) {
      throw new AppError('NOT_FOUND', 'Agent run was not found');
    }
    if (run.state !== 'execution_unknown' || !run.reservationId) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        `Run "${input.requestId}" is in state "${run.state}" and does not require reconciliation`,
      );
    }

    const lockSpec = RedisKeys.settleLock(run.reservationId);
    const lockToken = `reconcile_${randomUUID()}`;
    const acquired = await this.lockStore.acquire(
      lockSpec.key,
      lockToken,
      lockSpec.ttlSeconds,
    );
    if (!acquired) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        `Settlement reconciliation lock "${lockSpec.key}" is already held`,
      );
    }

    try {
      if (input.outcome === 'completed') {
        const settleRes = await this.billingClient.settle({
          reservationId: run.reservationId,
          requestId: run.requestId,
          traceId: input.traceId,
          userId: run.userId,
          actualUnits: input.actualUnits ?? run.reservedCredits,
        });
        return await this.repo.updateAgentRun(run.requestId, {
          state: 'completed',
          settledCredits: settleRes.settledCredits,
          errorCode: null,
        });
      }

      await this.billingClient.release({
        reservationId: run.reservationId,
        requestId: run.requestId,
        traceId: input.traceId,
        userId: run.userId,
        reason: 'reconciled_timeout_failure',
      });
      return await this.repo.updateAgentRun(run.requestId, {
        state: 'released',
        settledCredits: 0,
      });
    } finally {
      await this.lockStore.release(lockSpec.key, lockToken);
    }
  }

  /**
   * Coordinates cascade deletion (`active` -> `requested` -> `purging` -> `purged`)
   * guarded by `lock:cleanup:{conversationId}` (10m TTL per §5.2 & Invariants #3, #18).
   */
  public async deleteConversation(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly requestId: string;
    readonly traceId: string;
  }): Promise<DeleteConversationResult> {
    const requestId = validateIdempotencyKey(input.requestId);

    // 1. Verify ownership (returns 404 NOT_FOUND on missing or foreign conversation per Invariant #20)
    await this.repo.getConversationForUser(input.userId, input.conversationId);

    // 2. Acquire 10-minute cleanup lock (`lock:cleanup:{conversationId}`, TTL 600s per §5.2)
    const lockSpec = RedisKeys.cleanupLock(input.conversationId);
    const lockToken = `cleanup_${randomUUID()}`;
    const acquired = await this.lockStore.acquire(
      lockSpec.key,
      lockToken,
      lockSpec.ttlSeconds,
    );
    if (!acquired) {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        `Conversation "${input.conversationId}" cleanup is already in progress`,
      );
    }

    try {
      // 3. Transition `active` -> `requested` -> `purging`
      await this.repo.updateConversationDeletionState(
        input.userId,
        input.conversationId,
        'requested',
      );
      const allIds = await this.repo.listAllFileAndArtifactIdsForConversation(
        input.userId,
        input.conversationId,
      );
      await this.repo.updateConversationDeletionState(
        input.userId,
        input.conversationId,
        'purging',
      );

      // 4. Delegate cascade deletion (`vectors -> objects -> metadata`) to Agent
      const purgeResult = await this.agentClient.purgeResources({
        userId: input.userId,
        conversationId: input.conversationId,
        fileIds: allIds.fileIds,
        artifactIds: allIds.artifactIds,
        traceId: input.traceId,
        requestId,
      });

      // Invariant #18: "A report of 'deleted' is only valid once the owner of each record has confirmed it."
      const orderValid =
        purgeResult.purgeOrder[0] === 'vectors' &&
        purgeResult.purgeOrder[1] === 'objects' &&
        purgeResult.purgeOrder[2] === 'metadata';

      if (!purgeResult.confirmed || !orderValid) {
        await this.repo.updateConversationDeletionState(
          input.userId,
          input.conversationId,
          'failed',
        );
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          'Agent did not confirm cascade deletion order (vectors -> objects -> metadata)',
        );
      }

      const purgedConversation = await this.repo.updateConversationDeletionState(
        input.userId,
        input.conversationId,
        'purged',
      );

      return Object.freeze({
        conversation: purgedConversation,
        purgeResult,
        lockKey: lockSpec.key,
      });
    } finally {
      await this.lockStore.release(lockSpec.key, lockToken);
    }
  }
}
