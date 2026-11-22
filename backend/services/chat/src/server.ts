/**
 * @kartik/chat/server — Executable Service Bootstrap & Real `node:http` Server
 *
 * Implements:
 * 1. `HttpBillingServiceClient` (`@kartik/chat` -> `@kartik/billing` internal credit reserve/settle/release)
 * 2. `HttpAgentServiceClient` (`@kartik/chat` -> `@kartik/agent` internal turn execute & cascade purge)
 * 3. `bootstrapChatService` (validates config, wires repository, idempotency/lock/rate-limit stores,
 *    orchestrator, router, and `createManagedHttpServer`)
 * 4. `startChatServer` + `isExecutedAsMainModule` auto-start with `SIGINT`/`SIGTERM` graceful shutdown.
 */

import {
  AppError,
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  INTERNAL_AUTH_HEADERS,
  RedisRateLimitStore,
  createLazyPostgresPool,
  createLogger,
  createManagedHttpServer,
  createRedisClientFromUrl,
  isExecutedAsMainModule,
  signUserContextAssertion,
  verifyDatabaseConnectivity,
  type AgentExecuteRequest,
  type AgentExecuteResponse,
  type CreditReleaseRequest,
  type CreditReserveRequest,
  type CreditReserveResponse,
  type CreditSettleRequest,
  type DatabaseConnectivityCheckResult,
  type DatabasePool,
  type ErrorCode,
  type Logger,
  type ManagedHttpServer,
  type RateLimitCounterStore,
  type ReservationState,
  type SpecialistAgentName,
} from '@kartik/shared';
import { loadChatConfig, type ChatConfig } from './config/index.js';
import type {
  AgentRunRecord,
  ConversationRecord,
  MessageRecord,
  PaginatedResult,
} from './models/index.js';
import {
  InMemoryChatRepository,
  PostgresChatRepository,
  type ChatRepository,
} from './repositories/index.js';
import { createChatRouter } from './routes/index.js';
import {
  ChatOrchestratorService,
  RedisChatIdempotencyStore,
  RedisChatLockStore,
  type AgentPurgeCascadeResult,
  type AgentServiceClient,
  type BillingReleaseResult,
  type BillingServiceClient,
  type BillingSettleResult,
  type ChatIdempotencyStore,
  type ChatLockStore,
} from './services/index.js';

import type {
  AgentRunState,
  DeletionState,
} from '@kartik/shared';

class ResilientChatRepository implements ChatRepository {
  private readonly primary: PostgresChatRepository;
  private readonly fallback: InMemoryChatRepository;
  private readonly failHard: boolean;
  private primaryHealthy = true;

  constructor(primary: PostgresChatRepository, failHard: boolean) {
    this.primary = primary;
    this.fallback = new InMemoryChatRepository();
    this.failHard = failHard;
  }

  private async run<T>(
    primaryFn: () => Promise<T>,
    fallbackFn: () => Promise<T>,
  ): Promise<T> {
    if (this.failHard) {
      return primaryFn();
    }
    if (this.primaryHealthy) {
      try {
        return await primaryFn();
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        this.primaryHealthy = false;
      }
    }
    return fallbackFn();
  }

  public createConversation(
    conversation: ConversationRecord,
  ): Promise<ConversationRecord> {
    return this.run(
      () => this.primary.createConversation(conversation),
      () => this.fallback.createConversation(conversation),
    );
  }

  public getConversationForUser(
    userId: string,
    conversationId: string,
    options?: { readonly includePurging?: boolean },
  ): Promise<ConversationRecord> {
    return this.run(
      () => this.primary.getConversationForUser(userId, conversationId, options),
      () => this.fallback.getConversationForUser(userId, conversationId, options),
    );
  }

  public listConversationsForUser(input: {
    readonly userId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
    readonly cursorSecret?: string;
  }): Promise<PaginatedResult<ConversationRecord>> {
    return this.run(
      () => this.primary.listConversationsForUser(input),
      () => this.fallback.listConversationsForUser(input),
    );
  }

  public updateConversationDeletionState(
    userId: string,
    conversationId: string,
    state: DeletionState,
  ): Promise<ConversationRecord> {
    return this.run(
      () =>
        this.primary.updateConversationDeletionState(
          userId,
          conversationId,
          state,
        ),
      () =>
        this.fallback.updateConversationDeletionState(
          userId,
          conversationId,
          state,
        ),
    );
  }

  public saveMessage(message: MessageRecord): Promise<MessageRecord> {
    return this.run(
      () => this.primary.saveMessage(message),
      () => this.fallback.saveMessage(message),
    );
  }

  public listMessagesForConversation(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
    readonly cursorSecret?: string;
  }): Promise<PaginatedResult<MessageRecord>> {
    return this.run(
      () => this.primary.listMessagesForConversation(input),
      () => this.fallback.listMessagesForConversation(input),
    );
  }

  public listAllFileAndArtifactIdsForConversation(
    userId: string,
    conversationId: string,
  ): Promise<{
    readonly fileIds: readonly string[];
    readonly artifactIds: readonly string[];
  }> {
    return this.run(
      () =>
        this.primary.listAllFileAndArtifactIdsForConversation(
          userId,
          conversationId,
        ),
      () =>
        this.fallback.listAllFileAndArtifactIdsForConversation(
          userId,
          conversationId,
        ),
    );
  }

  public saveAgentRun(run: AgentRunRecord): Promise<AgentRunRecord> {
    return this.run(
      () => this.primary.saveAgentRun(run),
      () => this.fallback.saveAgentRun(run),
    );
  }

  public updateAgentRun(
    requestId: string,
    patch: {
      readonly state?: AgentRunState;
      readonly reservationId?: string | null;
      readonly reservedCredits?: number;
      readonly settledCredits?: number | null;
      readonly assistantMessageId?: string | null;
      readonly errorCode?: string | null;
      readonly updatedAt?: string;
    },
  ): Promise<AgentRunRecord> {
    return this.run(
      () => this.primary.updateAgentRun(requestId, patch),
      () => this.fallback.updateAgentRun(requestId, patch),
    );
  }

  public getAgentRunByRequestId(
    userId: string,
    requestId: string,
  ): Promise<AgentRunRecord | null> {
    return this.run(
      () => this.primary.getAgentRunByRequestId(userId, requestId),
      () => this.fallback.getAgentRunByRequestId(userId, requestId),
    );
  }
}

interface StandardHttpEnvelope<T = unknown> {
  readonly ok?: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly retryAfterSeconds?: number;
    readonly details?: Record<string, string[]>;
  };
}

function throwFromUpstreamEnvelope(
  statusCode: number,
  envelope: StandardHttpEnvelope | null,
  fallbackMessage: string,
): never {
  const errCode: ErrorCode = (envelope?.error?.code as ErrorCode | undefined) ?? (
    statusCode === 402
      ? 'QUOTA_EXHAUSTED'
      : statusCode === 404
        ? 'NOT_FOUND'
        : statusCode === 409
          ? 'IDEMPOTENCY_CONFLICT'
          : statusCode === 429
            ? 'RATE_LIMITED'
            : statusCode === 503
              ? 'PROVIDER_UNAVAILABLE'
              : 'INTERNAL_ERROR'
  );
  const errMessage = envelope?.error?.message ?? fallbackMessage;
  throw new AppError(errCode, errMessage, {
    ...(envelope?.error?.retryAfterSeconds !== undefined
      ? { retryAfterSeconds: envelope.error.retryAfterSeconds }
      : {}),
    ...(envelope?.error?.details !== undefined ? { details: envelope.error.details } : {}),
  });
}

/**
 * Real HTTP client from `@kartik/chat` -> `@kartik/billing` (`/internal/credits/{reserve,settle,release}`).
 */
export class HttpBillingServiceClient implements BillingServiceClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly signingPrivateKeyPem: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: {
    readonly baseUrl: string;
    readonly serviceToken: string;
    readonly signingPrivateKeyPem?: string;
    readonly fetchImpl?: typeof globalThis.fetch;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.serviceToken = options.serviceToken;
    this.signingPrivateKeyPem =
      options.signingPrivateKeyPem ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.userContextPrivateKeyPem;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private buildHeaders(params: {
    readonly userId: string;
    readonly requestId: string;
    readonly traceId: string;
  }): Record<string, string> {
    const assertion = signUserContextAssertion(
      {
        sub: params.userId,
        aud: 'billing',
        traceId: params.traceId,
        sessionId: `s2s_chat_${params.requestId}`,
      },
      this.signingPrivateKeyPem,
    );
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'chat',
      [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: this.serviceToken,
      [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: assertion,
      [INTERNAL_AUTH_HEADERS.REQUEST_ID]: params.requestId,
      [INTERNAL_AUTH_HEADERS.TRACE_ID]: params.traceId,
    };
  }

  public async reserve(request: CreditReserveRequest): Promise<CreditReserveResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/credits/reserve`, {
      method: 'POST',
      headers: this.buildHeaders({
        userId: request.userId,
        requestId: request.requestId,
        traceId: request.traceId,
      }),
      body: JSON.stringify(request),
    });

    const parsed = (await res.json().catch(() => null)) as StandardHttpEnvelope<CreditReserveResponse> | null;
    if (!res.ok || !parsed?.data) {
      throwFromUpstreamEnvelope(res.status, parsed, 'Billing credit reserve call failed');
    }
    return parsed.data;
  }

  public async settle(
    request: CreditSettleRequest & { readonly actualUnits?: number },
  ): Promise<BillingSettleResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/credits/settle`, {
      method: 'POST',
      headers: this.buildHeaders({
        userId: request.userId,
        requestId: request.requestId,
        traceId: request.traceId,
      }),
      body: JSON.stringify(request),
    });

    const parsed = (await res.json().catch(() => null)) as StandardHttpEnvelope<{
      readonly reservationId: string;
      readonly requestId: string;
      readonly status: ReservationState;
      readonly reservedCredits: number;
      readonly settledCredits: number;
      readonly refundedCredits: number;
      readonly availableCreditsAfter?: number;
      readonly remainingBalance?: number;
    }> | null;

    if (!res.ok || !parsed?.data) {
      throwFromUpstreamEnvelope(res.status, parsed, 'Billing credit settle call failed');
    }

    const d = parsed.data;
    return Object.freeze({
      reservationId: d.reservationId,
      requestId: d.requestId,
      status: d.status,
      reservedCredits: d.reservedCredits,
      settledCredits: d.settledCredits,
      refundedCredits: d.refundedCredits,
      remainingBalance: d.remainingBalance ?? d.availableCreditsAfter ?? 0,
    });
  }

  public async release(request: CreditReleaseRequest): Promise<BillingReleaseResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/credits/release`, {
      method: 'POST',
      headers: this.buildHeaders({
        userId: request.userId,
        requestId: request.requestId,
        traceId: request.traceId,
      }),
      body: JSON.stringify(request),
    });

    const parsed = (await res.json().catch(() => null)) as StandardHttpEnvelope<{
      readonly reservationId: string;
      readonly requestId: string;
      readonly status: ReservationState;
      readonly releasedCredits: number;
      readonly availableCreditsAfter?: number;
      readonly remainingBalance?: number;
    }> | null;

    if (!res.ok || !parsed?.data) {
      throwFromUpstreamEnvelope(res.status, parsed, 'Billing credit release call failed');
    }

    const d = parsed.data;
    return Object.freeze({
      reservationId: d.reservationId,
      requestId: d.requestId,
      status: d.status,
      releasedCredits: d.releasedCredits,
      remainingBalance: d.remainingBalance ?? d.availableCreditsAfter ?? 0,
    });
  }
}

/**
 * Real HTTP client from `@kartik/chat` -> `@kartik/agent` (`/internal/agent/{execute,purge}`).
 */
export class HttpAgentServiceClient implements AgentServiceClient {
  private readonly baseUrl: string;
  private readonly serviceToken: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(options: {
    readonly baseUrl: string;
    readonly serviceToken: string;
    readonly fetchImpl?: typeof globalThis.fetch;
  }) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.serviceToken = options.serviceToken;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private buildHeaders(params: {
    readonly requestId: string;
    readonly traceId: string;
  }): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'application/json',
      [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'chat',
      [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: this.serviceToken,
      [INTERNAL_AUTH_HEADERS.REQUEST_ID]: params.requestId,
      [INTERNAL_AUTH_HEADERS.TRACE_ID]: params.traceId,
    };
  }

  public async execute(
    request: AgentExecuteRequest & {
      readonly requestedAgent?: SpecialistAgentName;
      readonly imageMimeType?: string;
      readonly imageBytes?: Uint8Array;
    },
  ): Promise<AgentExecuteResponse & { readonly actualUnits?: number }> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/agent/execute`, {
      method: 'POST',
      headers: this.buildHeaders({
        requestId: request.requestId,
        traceId: request.traceId,
      }),
      body: JSON.stringify({
        requestId: request.requestId,
        traceId: request.traceId,
        userId: request.userId,
        conversationId: request.conversationId,
        messageId: request.messageId,
        prompt: request.prompt,
        preferredAgent: request.preferredAgent ?? request.requestedAgent,
        attachmentFileIds: request.attachmentFileIds ?? [],
        ...(request.imageMimeType ? { imageMimeType: request.imageMimeType } : {}),
        ...(request.imageBytes
          ? { imageBase64: Buffer.from(request.imageBytes).toString('base64') }
          : {}),
      }),
    });

    const parsed = (await res.json().catch(() => null)) as StandardHttpEnvelope<
      AgentExecuteResponse & { readonly actualUnits?: number }
    > | null;
    if (!res.ok || !parsed?.data) {
      throwFromUpstreamEnvelope(res.status, parsed, 'Agent execute call failed');
    }
    return parsed.data;
  }

  public async purgeResources(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly fileIds: readonly string[];
    readonly artifactIds: readonly string[];
    readonly traceId: string;
    readonly requestId: string;
  }): Promise<AgentPurgeCascadeResult> {
    const res = await this.fetchImpl(`${this.baseUrl}/internal/agent/purge`, {
      method: 'POST',
      headers: this.buildHeaders({
        requestId: input.requestId,
        traceId: input.traceId,
      }),
      body: JSON.stringify({
        userId: input.userId,
        conversationId: input.conversationId,
        fileIds: input.fileIds,
        artifactIds: input.artifactIds,
      }),
    });

    const parsed = (await res.json().catch(() => null)) as StandardHttpEnvelope<
      Partial<AgentPurgeCascadeResult> & {
        readonly deletionOrder?: readonly ['vectors', 'objects', 'metadata'];
        readonly vectorsDeleted?: number;
        readonly objectsDeleted?: number;
        readonly filesDeleted?: number;
        readonly artifactsDeleted?: number;
      }
    > | null;
    if (!res.ok || !parsed?.data) {
      throwFromUpstreamEnvelope(res.status, parsed, 'Agent cascade purge call failed');
    }
    const d = parsed.data;
    return Object.freeze({
      conversationId: d.conversationId ?? input.conversationId,
      userId: d.userId ?? input.userId,
      purgeOrder: d.purgeOrder ?? d.deletionOrder ?? (['vectors', 'objects', 'metadata'] as const),
      deletedVectorsCount: d.deletedVectorsCount ?? d.vectorsDeleted ?? 0,
      deletedObjectsCount: d.deletedObjectsCount ?? d.objectsDeleted ?? 0,
      deletedFilesCount: d.deletedFilesCount ?? d.filesDeleted ?? 0,
      deletedArtifactsCount: d.deletedArtifactsCount ?? d.artifactsDeleted ?? 0,
      confirmed: Boolean(d.confirmed),
    });
  }
}

export interface ChatServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
  readonly dbPool?: DatabasePool;
  readonly verifyDatabaseOnStart?: boolean;
  readonly repository?: ChatRepository;
  readonly billingClient?: BillingServiceClient;
  readonly agentClient?: AgentServiceClient;
  readonly idempotencyStore?: ChatIdempotencyStore;
  readonly lockStore?: ChatLockStore;
  readonly rateLimitStore?: RateLimitCounterStore;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly logger?: Logger;
}

export interface ChatServiceRuntime {
  readonly config: ChatConfig;
  readonly logger: Logger;
  readonly dbPool: DatabasePool;
  readonly repository: ChatRepository;
  readonly billingClient: BillingServiceClient;
  readonly agentClient: AgentServiceClient;
  readonly orchestrator: ChatOrchestratorService;
  readonly router: ReturnType<typeof createChatRouter>;
  readonly httpServer: ManagedHttpServer;
  verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult>;
}

export function buildChatBootstrapEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const isProd = env.NODE_ENV === 'production';
  if (isProd) {
    return env;
  }
  return {
    NODE_ENV: env.NODE_ENV ?? 'development',
    PORT: env.PORT ?? env.PORT_CHAT ?? '8002',
    DATABASE_URL: env.DATABASE_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.databaseUrl,
    REDIS_URL: env.REDIS_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.redisUrl,
    USER_CONTEXT_PUBLIC_KEY:
      env.USER_CONTEXT_PUBLIC_KEY ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.userContextPublicKeyPem,
    AGENT_SERVICE_URL: env.AGENT_SERVICE_URL ?? 'http://127.0.0.1:8003',
    BILLING_SERVICE_URL: env.BILLING_SERVICE_URL ?? 'http://127.0.0.1:8004',
    CHAT_TO_AGENT_TOKEN:
      env.CHAT_TO_AGENT_TOKEN ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.chatToAgentToken,
    CHAT_TO_BILLING_TOKEN:
      env.CHAT_TO_BILLING_TOKEN ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.chatToBillingToken,
    CURSOR_SIGNING_SECRET:
      env.CURSOR_SIGNING_SECRET ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.cursorSigningSecret,
    ...env,
  };
}

/**
 * Initializes all Chat Service dependencies and returns a ready-to-listen `ChatServiceRuntime`.
 */
export function bootstrapChatService(
  options: ChatServiceBootstrapOptions = {},
): ChatServiceRuntime {
  const config = loadChatConfig(buildChatBootstrapEnv(options.env ?? process.env));
  const logger =
    options.logger ??
    createLogger({
      service: 'chat',
      level: config.nodeEnv === 'test' ? 'error' : 'info',
    });

  const dbPool =
    options.dbPool ??
    createLazyPostgresPool({
      schema: 'chat',
      connectionString: config.databaseUrl,
    });
  const postgresChatRepo = new PostgresChatRepository(dbPool);
  const redisClient = createRedisClientFromUrl(config.redisUrl);

  const repository =
    options.repository ??
    new ResilientChatRepository(postgresChatRepo, config.nodeEnv === 'production');

  const billingClient =
    options.billingClient ??
    new HttpBillingServiceClient({
      baseUrl: config.billingServiceUrl,
      serviceToken: config.chatToBillingToken,
    });

  const agentClient =
    options.agentClient ??
    new HttpAgentServiceClient({
      baseUrl: config.agentServiceUrl,
      serviceToken: config.chatToAgentToken,
    });

  const idempotencyStore =
    options.idempotencyStore ?? new RedisChatIdempotencyStore(redisClient);
  const lockStore = options.lockStore ?? new RedisChatLockStore(redisClient);
  const rateLimitStore =
    options.rateLimitStore ?? new RedisRateLimitStore(redisClient);

  const orchestrator = new ChatOrchestratorService({
    repo: repository,
    billingClient,
    agentClient,
    idempotencyStore,
    lockStore,
  });

  async function verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult> {
    const check = await verifyDatabaseConnectivity(dbPool, 'chat');
    logger.info('Chat Service database connectivity verified', {
      schema: check.schema,
      latencyMs: check.latencyMs,
    });
    return check;
  }

  const defaultReadiness = async (): Promise<boolean> => {
    if (config.nodeEnv === 'production' || options.verifyDatabaseOnStart) {
      await verifyDatabaseConnectivity(dbPool, 'chat');
    }
    return true;
  };

  const router = createChatRouter({
    config,
    repository,
    orchestrator,
    rateLimitStore,
    checkReadiness: options.checkReadiness ?? defaultReadiness,
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'chat',
    router,
    logger,
    onShutdown: async () => {
      await dbPool.end().catch(() => undefined);
    },
  });

  return Object.freeze({
    config,
    logger,
    dbPool,
    repository,
    billingClient,
    agentClient,
    orchestrator,
    router,
    httpServer,
    verifyDatabaseConnection,
  });
}

/**
 * Starts the Chat Service HTTP listener and registers `SIGINT`/`SIGTERM` graceful shutdown hooks.
 */
export async function startChatServer(
  options: ChatServiceBootstrapOptions & { readonly host?: string; readonly port?: number } = {},
): Promise<ChatServiceRuntime & { readonly boundPort: number }> {
  const runtime = bootstrapChatService(options);
  const shouldVerifyDb =
    options.verifyDatabaseOnStart ?? runtime.config.nodeEnv === 'production';
  if (shouldVerifyDb) {
    await runtime.verifyDatabaseConnection();
  }
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? runtime.config.port;
  const { port: boundPort } = await runtime.httpServer.listen(port, host);

  const shutdown = async (signal: string) => {
    runtime.logger.info('Received shutdown signal; closing Chat HTTP server', { signal });
    try {
      await runtime.httpServer.close();
      await runtime.dbPool.end().catch(() => undefined);
    } finally {
      process.exit(0);
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  return Object.freeze({
    ...runtime,
    boundPort,
  });
}

if (isExecutedAsMainModule(import.meta.url)) {
  startChatServer().catch((err: unknown) => {
    process.stderr.write(
      `[chat] Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
