/**
 * @kartik/agent/server — Executable Service Bootstrap & Real `node:http` Server
 *
 * Implements:
 * 1. `bootstrapAgentService` (validates config, initializes `InMemoryAgentRepository`,
 *    `InMemoryObjectStorage`, `InMemoryVectorStore`, `DailyLiveBudgetGuard`,
 *    `AgentSlidingWindowRateLimiter`, mock/live specialist providers,
 *    `FileIngestionAndArtifactService`, `AgentGraphExecutor`, `createAgentRouter`,
 *    and `createManagedHttpServer`)
 * 2. `startAgentServer` + `isExecutedAsMainModule` auto-start with `SIGINT`/`SIGTERM` graceful shutdown.
 */

import os from 'node:os';
import path from 'node:path';
import {
  AppError,
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  createLazyPostgresPool,
  createLogger,
  createManagedHttpServer,
  createObjectStorageFromEnv,
  createRedisClientFromUrl,
  isExecutedAsMainModule,
  verifyDatabaseConnectivity,
  type DatabaseConnectivityCheckResult,
  type DatabasePool,
  type Logger,
  type ManagedHttpServer,
  type ObjectStorage,
} from '@kartik/shared';
import {
  MockPdfDocumentProvider,
  type PdfDocumentProvider,
} from './agents/pdf/index.js';
import {
  MockPptPresentationProvider,
  type PptPresentationProvider,
} from './agents/ppt/index.js';
import { loadAgentConfig, type AgentConfig } from './config/index.js';
import { AgentGraphExecutor } from './graph/index.js';
import type {
  ArtifactRecord,
  ChatModelProvider,
  CodingModelProvider,
  DocumentChunkRecord,
  EmbeddingProvider,
  ImageGenerationProvider,
  SearchProvider,
  UploadedFileRecord,
  VectorStore,
  VisionProvider,
} from './models/index.js';
import { FileIngestionAndArtifactService } from './rag/index.js';
import {
  InMemoryAgentRepository,
  PostgresAgentRepository,
  type AgentRepository,
} from './repositories/index.js';
import { createAgentRouter } from './routes/index.js';
import {
  AgentSlidingWindowRateLimiter,
  RedisAgentRateLimitStore,
} from './services/agent-rate-limiter.js';
import {
  DailyLiveBudgetGuard,
  RedisDailyBudgetStore,
  type DailyBudgetStore,
} from './services/budget-guard.js';
import {
  LiveGeminiChatModelProvider,
  LiveGeminiCodingModelProvider,
  LiveGeminiEmbeddingProvider,
  LiveGeminiImageGenerationProvider,
  LiveGeminiPdfDocumentProvider,
  LiveGeminiPdfOcrExtractor,
  LiveGeminiPptPresentationProvider,
  LiveGeminiSearchProvider,
  LiveGeminiVisionProvider,
} from './services/live-gemini-providers.js';
import { CloudflareWorkersAiImageProvider } from './services/cloudflare-image-provider.js';
import {
  MockChatModelProvider,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockSearchProvider,
  MockVisionProvider,
} from './services/mock-providers.js';
import { createVectorStoreFromEnv } from './services/qdrant-vector-store.js';

class ResilientAgentRepository implements AgentRepository {
  private readonly primary: PostgresAgentRepository;
  private readonly fallback: InMemoryAgentRepository;
  private readonly failHard: boolean;
  private primaryHealthy = true;

  constructor(primary: PostgresAgentRepository, failHard: boolean) {
    this.primary = primary;
    this.fallback = new InMemoryAgentRepository();
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

  public saveFile(file: UploadedFileRecord): Promise<void> {
    return this.run(
      () => this.primary.saveFile(file),
      () => this.fallback.saveFile(file),
    );
  }

  public getFileById(userId: string, fileId: string): Promise<UploadedFileRecord | null> {
    return this.run(
      () => this.primary.getFileById(userId, fileId),
      () => this.fallback.getFileById(userId, fileId),
    );
  }

  public listFilesByUser(userId: string): Promise<readonly UploadedFileRecord[]> {
    return this.run(
      () => this.primary.listFilesByUser(userId),
      () => this.fallback.listFilesByUser(userId),
    );
  }

  public saveArtifact(artifact: ArtifactRecord): Promise<void> {
    return this.run(
      () => this.primary.saveArtifact(artifact),
      () => this.fallback.saveArtifact(artifact),
    );
  }

  public getArtifactById(userId: string, artifactId: string): Promise<ArtifactRecord | null> {
    return this.run(
      () => this.primary.getArtifactById(userId, artifactId),
      () => this.fallback.getArtifactById(userId, artifactId),
    );
  }

  public getArtifactByRequestId(
    userId: string,
    requestId: string,
  ): Promise<ArtifactRecord | null> {
    return this.run(
      () => this.primary.getArtifactByRequestId(userId, requestId),
      () => this.fallback.getArtifactByRequestId(userId, requestId),
    );
  }

  public listArtifactsByConversation(
    userId: string,
    conversationId: string,
  ): Promise<readonly ArtifactRecord[]> {
    return this.run(
      () => this.primary.listArtifactsByConversation(userId, conversationId),
      () => this.fallback.listArtifactsByConversation(userId, conversationId),
    );
  }

  public saveDocumentChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    return this.run(
      () => this.primary.saveDocumentChunks(chunks),
      () => this.fallback.saveDocumentChunks(chunks),
    );
  }

  public deleteFileMetadata(userId: string, fileId: string): Promise<boolean> {
    return this.run(
      () => this.primary.deleteFileMetadata(userId, fileId),
      () => this.fallback.deleteFileMetadata(userId, fileId),
    );
  }

  public deleteArtifactMetadata(userId: string, artifactId: string): Promise<boolean> {
    return this.run(
      () => this.primary.deleteArtifactMetadata(userId, artifactId),
      () => this.fallback.deleteArtifactMetadata(userId, artifactId),
    );
  }
}

export interface AgentServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
  readonly dbPool?: DatabasePool;
  readonly verifyDatabaseOnStart?: boolean;
  readonly repository?: AgentRepository;
  readonly objectStorage?: ObjectStorage;
  readonly vectorStore?: VectorStore;
  readonly budgetStore?: DailyBudgetStore;
  readonly rateLimiter?: AgentSlidingWindowRateLimiter;
  readonly chatProvider?: ChatModelProvider;
  readonly codingProvider?: CodingModelProvider;
  readonly searchProvider?: SearchProvider;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly imageProvider?: ImageGenerationProvider;
  readonly visionProvider?: VisionProvider;
  readonly pdfProvider?: PdfDocumentProvider;
  readonly pptProvider?: PptPresentationProvider;
  readonly checkReadiness?: () => Promise<boolean>;
  readonly logger?: Logger;
}

export interface AgentServiceRuntime {
  readonly config: AgentConfig;
  readonly logger: Logger;
  readonly dbPool: DatabasePool;
  readonly repository: AgentRepository;
  readonly objectStorage: ObjectStorage;
  readonly vectorStore: VectorStore;
  readonly budgetGuard: DailyLiveBudgetGuard;
  readonly ingestionService: FileIngestionAndArtifactService;
  readonly graphExecutor: AgentGraphExecutor;
  readonly router: ReturnType<typeof createAgentRouter>;
  readonly httpServer: ManagedHttpServer;
  verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult>;
}

export function buildAgentBootstrapEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const isProd = env.NODE_ENV === 'production';
  if (isProd) {
    return env;
  }
  return {
    NODE_ENV: env.NODE_ENV ?? 'development',
    PORT: env.PORT ?? env.PORT_AGENT ?? '8003',
    DATABASE_URL: env.DATABASE_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.databaseUrl,
    REDIS_URL: env.REDIS_URL ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.redisUrl,
    USER_CONTEXT_PUBLIC_KEY:
      env.USER_CONTEXT_PUBLIC_KEY ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.userContextPublicKeyPem,
    INTERNAL_CALLER_TOKEN_CHAT:
      env.INTERNAL_CALLER_TOKEN_CHAT ?? DEV_SHARED_BOOTSTRAP_DEFAULTS.chatToAgentToken,
    MOCK_AI: env.MOCK_AI ?? 'true',
    IMAGE_PROVIDER: env.IMAGE_PROVIDER ?? 'mock',
    QDRANT_URL: env.QDRANT_URL ?? 'http://127.0.0.1:6333',
    ...env,
  };
}

/**
 * Initializes all Agent Service dependencies and returns a ready-to-listen `AgentServiceRuntime`.
 */
export function bootstrapAgentService(
  options: AgentServiceBootstrapOptions = {},
): AgentServiceRuntime {
  const effectiveEnv = buildAgentBootstrapEnv(options.env ?? process.env);
  const config = loadAgentConfig(effectiveEnv);
  const logger =
    options.logger ??
    createLogger({
      service: 'agent',
      level: config.nodeEnv === 'test' ? 'error' : 'info',
    });

  const dbPool =
    options.dbPool ??
    createLazyPostgresPool({
      schema: 'agent',
      connectionString: config.databaseUrl,
    });
  const postgresAgentRepo = new PostgresAgentRepository(dbPool);
  const redisClient = createRedisClientFromUrl(config.redisUrl);

  const testRunSuffix =
    config.nodeEnv === 'test'
      ? `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
      : null;

  const storageEnv =
    testRunSuffix && !effectiveEnv.OBJECT_STORAGE_ROOT_DIR
      ? {
          ...effectiveEnv,
          OBJECT_STORAGE_ROOT_DIR: path.join(
            os.tmpdir(),
            `kartik-agent-objects-${testRunSuffix}`,
          ),
        }
      : effectiveEnv;

  const vectorEnv =
    testRunSuffix && !effectiveEnv.QDRANT_STORAGE_FILE
      ? {
          ...effectiveEnv,
          QDRANT_STORAGE_FILE: path.join(
            os.tmpdir(),
            `kartik-agent-vectors-${testRunSuffix}.json`,
          ),
        }
      : effectiveEnv;

  const repository =
    options.repository ??
    new ResilientAgentRepository(postgresAgentRepo, config.nodeEnv === 'production');
  const objectStorage = options.objectStorage ?? createObjectStorageFromEnv(storageEnv);
  const vectorStore = options.vectorStore ?? createVectorStoreFromEnv(vectorEnv);
  const budgetGuard = new DailyLiveBudgetGuard({
    store: options.budgetStore ?? new RedisDailyBudgetStore(redisClient),
    dailyLimit: config.dailyLiveCallBudget,
    mockAiDefault: config.mockAi,
  });
  const rateLimiter =
    options.rateLimiter ??
    new AgentSlidingWindowRateLimiter({
      store: new RedisAgentRateLimitStore(redisClient),
    });

  const useLiveProviders = !config.mockAi;
  const geminiKey = config.geminiApiKey;

  const chatProvider =
    options.chatProvider ??
    (useLiveProviders
      ? new LiveGeminiChatModelProvider({ apiKey: geminiKey })
      : new MockChatModelProvider());
  const codingProvider =
    options.codingProvider ??
    (useLiveProviders
      ? new LiveGeminiCodingModelProvider({ apiKey: geminiKey })
      : new MockCodingModelProvider());
  const searchProvider =
    options.searchProvider ??
    (useLiveProviders
      ? new LiveGeminiSearchProvider({ apiKey: geminiKey })
      : new MockSearchProvider());
  const embeddingProvider =
    options.embeddingProvider ??
    (useLiveProviders
      ? new LiveGeminiEmbeddingProvider({ apiKey: geminiKey })
      : new MockEmbeddingProvider());
  const imageProvider =
    options.imageProvider ??
    (config.imageProvider === 'cloudflare'
      ? new CloudflareWorkersAiImageProvider({
          apiToken: config.cloudflareApiToken,
          accountId: config.cloudflareAccountId,
          model: config.cloudflareImageModel,
        })
      : useLiveProviders && config.imageProvider === 'live'
        ? new LiveGeminiImageGenerationProvider({ apiKey: geminiKey })
        : new MockImageGenerationProvider());
  const visionProvider =
    options.visionProvider ??
    (useLiveProviders
      ? new LiveGeminiVisionProvider({ apiKey: geminiKey })
      : new MockVisionProvider());
  const pdfProvider =
    options.pdfProvider ??
    (useLiveProviders
      ? new LiveGeminiPdfDocumentProvider({ apiKey: geminiKey })
      : new MockPdfDocumentProvider());
  const pptProvider =
    options.pptProvider ??
    (useLiveProviders
      ? new LiveGeminiPptPresentationProvider({ apiKey: geminiKey })
      : new MockPptPresentationProvider());

  const pdfOcrExtractor = useLiveProviders
    ? new LiveGeminiPdfOcrExtractor({ apiKey: geminiKey })
    : undefined;

  const ingestionService = new FileIngestionAndArtifactService({
    config,
    repository,
    objectStorage,
    vectorStore,
    embeddingProvider,
    pdfOcrExtractor,
  });

  const graphExecutor = new AgentGraphExecutor({
    config,
    budgetGuard,
    rateLimiter,
    chatProvider,
    codingProvider,
    searchProvider,
    embeddingProvider,
    imageProvider,
    visionProvider,
    pdfProvider,
    pptProvider,
    vectorStore,
    objectStorage,
    metadataStore: repository,
    loadImageBytes: async (storageKey, userId) => {
      const obj = await objectStorage.getPrivateObject(storageKey, userId);
      return obj.body;
    },
  });

  async function verifyDatabaseConnection(): Promise<DatabaseConnectivityCheckResult> {
    const check = await verifyDatabaseConnectivity(dbPool, 'agent');
    logger.info('Agent Service database connectivity verified', {
      schema: check.schema,
      latencyMs: check.latencyMs,
    });
    return check;
  }

  const defaultReadiness = async (): Promise<boolean> => {
    if (config.nodeEnv === 'production' || options.verifyDatabaseOnStart) {
      await verifyDatabaseConnectivity(dbPool, 'agent');
    }
    return true;
  };

  const router = createAgentRouter({
    config,
    repository,
    ingestionService,
    graphExecutor,
    checkReadiness: options.checkReadiness ?? defaultReadiness,
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'agent',
    router,
    logger,
    maxBodyBytes: config.maxUploadBytes + 2 * 1024 * 1024,
    onShutdown: async () => {
      await dbPool.end().catch(() => undefined);
    },
  });

  return Object.freeze({
    config,
    logger,
    dbPool,
    repository,
    objectStorage,
    vectorStore,
    budgetGuard,
    ingestionService,
    graphExecutor,
    router,
    httpServer,
    verifyDatabaseConnection,
  });
}

/**
 * Starts the Agent Service HTTP listener and registers `SIGINT`/`SIGTERM` graceful shutdown hooks.
 */
export async function startAgentServer(
  options: AgentServiceBootstrapOptions & { readonly host?: string; readonly port?: number } = {},
): Promise<AgentServiceRuntime & { readonly boundPort: number }> {
  const runtime = bootstrapAgentService(options);
  const shouldVerifyDb =
    options.verifyDatabaseOnStart ?? runtime.config.nodeEnv === 'production';
  if (shouldVerifyDb) {
    await runtime.verifyDatabaseConnection();
  }
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? runtime.config.port;
  const { port: boundPort } = await runtime.httpServer.listen(port, host);

  const shutdown = async (signal: string) => {
    runtime.logger.info('Received shutdown signal; closing Agent HTTP server', { signal });
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
  startAgentServer().catch((err: unknown) => {
    process.stderr.write(
      `[agent] Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}
