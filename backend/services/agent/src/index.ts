export {
  AGENT_CONFIG_SCHEMA,
  loadAgentConfig,
  type AgentConfig,
} from './config/index.js';

export {
  AGENT_INITIAL_MIGRATION,
  AGENT_MIGRATIONS,
  type UploadedFileStatus,
  type UploadedFileRecord,
  type CodingArtifactFile,
  type AgentCitation,
  type ArtifactType,
  type ArtifactRecord,
  type DocumentChunkRecord,
  type VectorSearchHit,
  type ChatModelProvider,
  type CodingModelProvider,
  type SearchResultItem,
  type SearchExecutionBundle,
  type SearchProvider,
  type EmbeddingProvider,
  type ImageGenerationProvider,
  type VisionProvider,
  type VectorStore,
  type SpecialistExecutionResult,
} from './models/index.js';

export {
  MOCK_PNG_BYTES,
  MockChatModelProvider,
  MockCodingModelProvider,
  MockSearchProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockVisionProvider,
  InMemoryVectorStore,
  computeDeterministicEmbedding,
  cosineSimilarity,
} from './services/mock-providers.js';

export {
  DailyLiveBudgetGuard,
  InMemoryDailyBudgetStore,
  RedisDailyBudgetStore,
  type DailyBudgetStore,
  type BudgetCheckDecision,
} from './services/budget-guard.js';

export {
  AgentGraphExecutor,
  routePromptToSpecialist,
  type AgentMetadataStore,
  type AgentGraphDependencies,
} from './graph/index.js';

export {
  InMemoryAgentRepository,
  PostgresAgentRepository,
  type AgentRepository,
} from './repositories/index.js';

export {
  chunkPdfPages,
  extractTextPagesFromPdfBytes,
  FileIngestionAndArtifactService,
  type PdfPageText,
  type CascadeDeletionStep,
  type PurgeExecutionReport,
} from './rag/index.js';

export {
  readSingleHeader,
  requireAgentUserContext,
  requireAgentServiceAuth,
  type HttpHeaderMap,
} from './middleware/index.js';

export {
  AgentController,
  type AgentControllerDependencies,
} from './controllers/index.js';

export {
  createAgentRouter,
  type AgentHttpRequest,
  type AgentHttpResponse,
  type AgentRouterDependencies,
} from './routes/index.js';

export {
  SPECIALIST_EVALUATION_DATASET,
  sanitizeUntrustedRetrievedData,
  SpecialistEvaluationRunner,
  type SpecialistEvaluationCase,
  type EvaluationCaseResult,
  type EvaluationSuiteReport,
  type SpecialistEvaluationRunnerInput,
} from './eval/index.js';

export {
  MAX_PDF_TITLE_CHARS,
  MAX_PDF_SUBTITLE_CHARS,
  MAX_PDF_SECTIONS,
  MAX_PPT_TITLE_CHARS,
  MAX_PPT_SLIDES,
  PDF_DOCUMENT_TYPES,
  stripMarkdownJsonFences,
  validatePdfDocumentSpec,
  validatePptPresentationSpec,
  type PdfDocumentType,
  type PdfMetricSpec,
  type PdfTableSpec,
  type PdfSectionSpec,
  type PdfDocumentSpec,
  type PptSlideSpec,
  type PptPresentationSpec,
} from './schemas/index.js';

export {
  buildPdfBinaryBuffer,
  buildPdfFollowUps,
  buildPdfSystemInstruction,
  classifyPdfDocumentType,
  formatPdfSummaryMarkdown,
  MockPdfDocumentProvider,
  transliterateForPdf,
  type PdfDocumentGenerationResult,
  type PdfDocumentProvider,
} from './agents/pdf/index.js';

export {
  buildPptxBinaryBuffer,
  formatPptSummaryMarkdown,
  MockPptPresentationProvider,
  type PptPresentationGenerationResult,
  type PptPresentationProvider,
} from './agents/ppt/index.js';

export {
  CODING_INTENT_TYPES,
  classifyCodingIntent,
  buildCodingSystemInstruction,
  sanitizeGeneratedCodeBundle,
  buildCodingFollowUps,
  buildRichCodingTemplateBundle,
  buildNonGenerationCodingMarkdown,
  type CodingIntentType,
} from './agents/coding/index.js';

export {
  AGENT_RATE_LIMITS_PER_MINUTE,
  InMemoryAgentRateLimitStore,
  RedisAgentRateLimitStore,
  AgentSlidingWindowRateLimiter,
  type AgentRateLimitStore,
  type AgentRateLimitDecision,
} from './services/agent-rate-limiter.js';

export {
  chunkIdToQdrantPointUuid,
  QdrantHttpVectorStore,
  PersistentDiskVectorStore,
  ResilientQdrantVectorStore,
  createVectorStoreFromEnv,
  type QdrantHttpVectorStoreOptions,
} from './services/qdrant-vector-store.js';

export {
  LiveGeminiChatModelProvider,
  LiveGeminiCodingModelProvider,
  LiveGeminiSearchProvider,
  LiveGeminiEmbeddingProvider,
  LiveGeminiVisionProvider,
  LiveGeminiPdfDocumentProvider,
  LiveGeminiPptPresentationProvider,
  LiveGeminiImageGenerationProvider,
  type SearchImageGalleryItem,
} from './services/live-gemini-providers.js';

export {
  buildDeterministicFollowUps,
  cleanPublicSearchQuery,
  collectRealSearchImages,
  extractCleanDomain,
  extractHtmlPageMetadata,
  fetchMultiSourceLiveWebResults,
  injectGroundingSupportCitations,
  isSafePublicHttpUrl,
  isTechnicalQuery,
  isTimeSensitiveQuery,
  normalizeInlineCitations,
  parseAnswerAndFollowUps,
  readPublicPageSnippet,
  type GeminiGroundingSupport,
} from './services/web-search-engine.js';

export {
  buildAgentBootstrapEnv,
  bootstrapAgentService,
  startAgentServer,
  type AgentServiceBootstrapOptions,
  type AgentServiceRuntime,
} from './server.js';

import { isExecutedAsMainModule } from '@kartik/shared';
import { startAgentServer } from './server.js';

if (isExecutedAsMainModule(import.meta.url)) {
  startAgentServer().catch((err: unknown) => {
    process.stderr.write(
      `[agent] Fatal startup error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  });
}

