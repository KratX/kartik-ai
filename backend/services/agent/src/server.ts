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

import {
  DEV_SHARED_BOOTSTRAP_DEFAULTS,
  InMemoryObjectStorage,
  createLogger,
  createManagedHttpServer,
  isExecutedAsMainModule,
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
  ChatModelProvider,
  CodingModelProvider,
  EmbeddingProvider,
  ImageGenerationProvider,
  SearchProvider,
  VectorStore,
  VisionProvider,
} from './models/index.js';
import { FileIngestionAndArtifactService } from './rag/index.js';
import { InMemoryAgentRepository, type AgentRepository } from './repositories/index.js';
import { createAgentRouter } from './routes/index.js';
import {
  AgentSlidingWindowRateLimiter,
  InMemoryAgentRateLimitStore,
} from './services/agent-rate-limiter.js';
import {
  DailyLiveBudgetGuard,
  InMemoryDailyBudgetStore,
  type DailyBudgetStore,
} from './services/budget-guard.js';
import {
  LiveGeminiChatModelProvider,
  LiveGeminiCodingModelProvider,
  LiveGeminiEmbeddingProvider,
  LiveGeminiImageGenerationProvider,
  LiveGeminiPdfDocumentProvider,
  LiveGeminiPptPresentationProvider,
  LiveGeminiSearchProvider,
  LiveGeminiVisionProvider,
} from './services/live-gemini-providers.js';
import {
  InMemoryVectorStore,
  MockChatModelProvider,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockSearchProvider,
  MockVisionProvider,
} from './services/mock-providers.js';

export interface AgentServiceBootstrapOptions {
  readonly env?: Record<string, string | undefined>;
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
  readonly repository: AgentRepository;
  readonly objectStorage: ObjectStorage;
  readonly vectorStore: VectorStore;
  readonly budgetGuard: DailyLiveBudgetGuard;
  readonly ingestionService: FileIngestionAndArtifactService;
  readonly graphExecutor: AgentGraphExecutor;
  readonly router: ReturnType<typeof createAgentRouter>;
  readonly httpServer: ManagedHttpServer;
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
  const config = loadAgentConfig(buildAgentBootstrapEnv(options.env ?? process.env));
  const logger =
    options.logger ??
    createLogger({
      service: 'agent',
      level: config.nodeEnv === 'test' ? 'error' : 'info',
    });

  const repository = options.repository ?? new InMemoryAgentRepository();
  const objectStorage = options.objectStorage ?? new InMemoryObjectStorage();
  const vectorStore = options.vectorStore ?? new InMemoryVectorStore();
  const budgetGuard = new DailyLiveBudgetGuard({
    store: options.budgetStore ?? new InMemoryDailyBudgetStore(),
    dailyLimit: config.dailyLiveCallBudget,
    mockAiDefault: config.mockAi,
  });
  const rateLimiter =
    options.rateLimiter ??
    new AgentSlidingWindowRateLimiter({
      store: new InMemoryAgentRateLimitStore(),
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
    (useLiveProviders && config.imageProvider === 'live'
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

  const ingestionService = new FileIngestionAndArtifactService({
    config,
    repository,
    objectStorage,
    vectorStore,
    embeddingProvider,
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

  const router = createAgentRouter({
    config,
    repository,
    ingestionService,
    graphExecutor,
    ...(options.checkReadiness ? { checkReadiness: options.checkReadiness } : {}),
  });

  const httpServer = createManagedHttpServer({
    serviceName: 'agent',
    router,
    logger,
    maxBodyBytes: config.maxUploadBytes + 2 * 1024 * 1024,
  });

  return Object.freeze({
    config,
    logger,
    repository,
    objectStorage,
    vectorStore,
    budgetGuard,
    ingestionService,
    graphExecutor,
    router,
    httpServer,
  });
}

/**
 * Starts the Agent Service HTTP listener and registers `SIGINT`/`SIGTERM` graceful shutdown hooks.
 */
export async function startAgentServer(
  options: AgentServiceBootstrapOptions & { readonly host?: string; readonly port?: number } = {},
): Promise<AgentServiceRuntime & { readonly boundPort: number }> {
  const runtime = bootstrapAgentService(options);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const port = options.port ?? runtime.config.port;
  const { port: boundPort } = await runtime.httpServer.listen(port, host);

  const shutdown = async (signal: string) => {
    runtime.logger.info('Received shutdown signal; closing Agent HTTP server', { signal });
    try {
      await runtime.httpServer.close();
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
