import crypto from 'node:crypto';
import { AppError } from '@kartik/shared/errors';
import {
  assertAgentName,
  classifySpecialistRoute,
  type AgentExecuteRequest,
  type AgentExecuteResponse,
  type SearchImageGalleryItem,
  type SpecialistAgentName,
  type SpecialistRoutingDecision,
} from '@kartik/shared/contracts';
import { validateArtifactManifest } from '@kartik/shared/validation';
import { buildObjectStorageKey, type ObjectStorage } from '@kartik/shared/storage';
import type { AgentConfig } from '../config/index.js';
import type {
  AgentCitation,
  ArtifactRecord,
  ChatModelProvider,
  CodingArtifactFile,
  CodingModelProvider,
  EmbeddingProvider,
  ImageGenerationProvider,
  SearchProvider,
  UploadedFileRecord,
  VectorStore,
  VisionProvider,
} from '../models/index.js';
import {
  buildPdfFollowUps,
  MockPdfDocumentProvider,
  type PdfDocumentProvider,
} from '../agents/pdf/index.js';
import {
  buildPptFollowUps,
  MockPptPresentationProvider,
  type PptPresentationProvider,
} from '../agents/ppt/index.js';
import {
  buildCodingFollowUps,
  buildCodingSystemInstruction,
  buildNonGenerationCodingMarkdown,
  classifyCodingIntent,
} from '../agents/coding/index.js';
import {
  buildRagFollowUps,
  buildRagSystemInstruction,
  buildRagUserPrompt,
  classifyRagIntent,
  formatOfflineRagReply,
  normalizeRagInlineCitations,
  rerankRagHits,
} from '../agents/rag/index.js';
import {
  buildVisionFollowUps,
  buildVisionSystemInstruction,
  classifyVisionIntent,
  parseImageDimensions,
} from '../agents/vision/index.js';
import {
  buildEnhancedImagePrompt,
  buildImageFollowUps,
  buildImageSpecManifestPayload,
  classifyImageStyle,
  detectImageAspectRatio,
  type ImageStyleArchetype,
} from '../agents/image/index.js';
import {
  buildChatSystemInstruction,
  classifyChatMode,
  normalizeChatResponseDepth,
  parseChatReplyAndFollowUps,
  sanitizeConversationHistory,
} from '../agents/chat/index.js';
import type { DailyLiveBudgetGuard } from '../services/budget-guard.js';
import type { AgentSlidingWindowRateLimiter } from '../services/agent-rate-limiter.js';
import {
  buildDeterministicFollowUps,
  extractCleanDomain,
  normalizeInlineCitations,
  parseAnswerAndFollowUps,
} from '../services/web-search-engine.js';

export interface AgentMetadataStore {
  getFileById(userId: string, fileId: string): Promise<UploadedFileRecord | null>;
  saveArtifact(artifact: ArtifactRecord): Promise<void>;
  getArtifactByRequestId(userId: string, requestId: string): Promise<ArtifactRecord | null>;
}

/**
 * Fix #21: Smart Hybrid Routing Decision (`resolveSpecialistRoutingDecision`).
 *
 * Precedence:
 * 1. Explicit `preferredAgent` validated against closed `SpecialistAgentName` union (rejects `"router"`).
 * 2. Uploaded attachment MIME types (`application/pdf` -> `rag`; `image/*` -> `vision`).
 * 3. Canonical `classifySpecialistRoute` shared with `@kartik/chat` so conceptual technical
 *    questions stay in Chat (`1 cr`) while explicit builds, documents, decks, artwork, and
 *    live web lookups delegate cleanly with a human-readable attribution reason.
 */
export function resolveSpecialistRoutingDecision(input: {
  readonly prompt: string;
  readonly preferredAgent?: SpecialistAgentName;
  readonly attachedFiles?: readonly UploadedFileRecord[];
}): SpecialistRoutingDecision {
  if (input.preferredAgent !== undefined) {
    const validated = assertAgentName(input.preferredAgent, 'preferredAgent');
    if (validated === 'router') {
      throw new AppError(
        'VALIDATION_FAILED',
        'preferredAgent must be a specialist agent, not "router"',
      );
    }
    return {
      agent: validated,
      routedFromChat: false,
    };
  }

  const hasPdfAttachment = Boolean(
    input.attachedFiles?.some((f) => f.mimeType === 'application/pdf'),
  );
  const hasImageAttachment = Boolean(
    input.attachedFiles?.some((f) => f.mimeType.startsWith('image/')),
  );

  return classifySpecialistRoute({
    prompt: input.prompt,
    hasPdfAttachment,
    hasImageAttachment,
  });
}

export function routePromptToSpecialist(input: {
  readonly prompt: string;
  readonly preferredAgent?: SpecialistAgentName;
  readonly attachedFiles?: readonly UploadedFileRecord[];
}): SpecialistAgentName {
  return resolveSpecialistRoutingDecision(input).agent;
}

export interface AgentGraphDependencies {
  readonly config: AgentConfig;
  readonly budgetGuard: DailyLiveBudgetGuard;
  readonly rateLimiter?: AgentSlidingWindowRateLimiter;
  readonly chatProvider: ChatModelProvider;
  readonly codingProvider: CodingModelProvider;
  readonly searchProvider: SearchProvider;
  readonly embeddingProvider: EmbeddingProvider;
  readonly imageProvider: ImageGenerationProvider;
  readonly visionProvider: VisionProvider;
  readonly pdfProvider?: PdfDocumentProvider;
  readonly pptProvider?: PptPresentationProvider;
  readonly vectorStore: VectorStore;
  readonly objectStorage: ObjectStorage;
  readonly metadataStore: AgentMetadataStore;
  readonly loadImageBytes?: (storageKey: string, userId: string) => Promise<Uint8Array>;
}

/**
 * LangGraph-style Router -> Specialist State Machine Executor (`@kartik/agent`).
 *
 * Enforces:
 * - Invariant #6: Agent never calculates, reserves, settles, or mutates credits.
 * - Invariant #9: Vector retrieval is filtered by authenticated `userId` and `fileIds`.
 * - Invariant #12: All model output is untrusted input; coding, PDF, and PPT manifests are schema-validated.
 * - §10: Search answers distinguish cited sources from synthesis and report lookup failure honestly.
 * - §10: RAG answers cite document & page and state clearly when retrieval finds nothing useful.
 * - §12: Daily Redis budget counters degrade gracefully to deterministic mock mode on exhaustion.
 */
export interface AgentProgressEvent {
  readonly stage: string;
  readonly label: string;
  readonly agent: SpecialistAgentName;
}

export interface AgentExecutionOptions {
  readonly activeArtifactContext?: {
    readonly artifactType: 'code_bundle' | 'pdf_document' | 'ppt_presentation';
    readonly title: string;
    readonly serializedContext: string;
  };
  readonly onProgress?: (event: AgentProgressEvent) => void;
  readonly onTextDelta?: (delta: string) => void;
  readonly signal?: AbortSignal;
}

export class AgentGraphExecutor {
  private readonly deps: AgentGraphDependencies;
  private readonly pdfProvider: PdfDocumentProvider;
  private readonly pptProvider: PptPresentationProvider;

  constructor(deps: AgentGraphDependencies) {
    this.deps = deps;
    this.pdfProvider = deps.pdfProvider ?? new MockPdfDocumentProvider();
    this.pptProvider = deps.pptProvider ?? new MockPptPresentationProvider();
  }

  public async execute(
    request: AgentExecuteRequest,
    options?: AgentExecutionOptions,
  ): Promise<AgentExecuteResponse> {
    const startMs = Date.now();
    const emitProgress = (stage: string, label: string, agent: SpecialistAgentName) => {
      options?.onProgress?.({ stage, label, agent });
    };

    if (!request.requestId || !request.userId || !request.conversationId) {
      throw new AppError(
        'VALIDATION_FAILED',
        'AgentExecuteRequest requires requestId, userId, and conversationId',
      );
    }

    const trimmedPrompt = request.prompt.trim();
    if (trimmedPrompt.length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Agent prompt must not be empty');
    }
    if (trimmedPrompt.length > this.deps.config.maxPromptChars) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Prompt length (${trimmedPrompt.length}) exceeds MAX_PROMPT_CHARS (${this.deps.config.maxPromptChars})`,
      );
    }

    const attachmentIds = request.attachmentFileIds ?? [];
    if (attachmentIds.length > this.deps.config.maxAttachments) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Attachment count (${attachmentIds.length}) exceeds MAX_ATTACHMENTS (${this.deps.config.maxAttachments})`,
      );
    }

    // Verify ownership of every attached file (Invariant #20: missing or foreign -> 404 NOT_FOUND)
    const attachedFiles: UploadedFileRecord[] = [];
    for (const fileId of attachmentIds) {
      const record = await this.deps.metadataStore.getFileById(request.userId, fileId);
      if (!record || record.status === 'deleted') {
        throw new AppError('NOT_FOUND', `Attached file "${fileId}" was not found`);
      }
      attachedFiles.push(record);
    }

    const routingDecision = resolveSpecialistRoutingDecision({
      prompt: trimmedPrompt,
      preferredAgent: request.preferredAgent,
      attachedFiles,
    });
    const specialist = routingDecision.agent;
    const routingAttribution = routingDecision.routedFromChat
      ? {
          routedFromChat: true as const,
          ...(routingDecision.reason ? { routingReason: routingDecision.reason } : {}),
        }
      : {};

    if (this.deps.rateLimiter) {
      await this.deps.rateLimiter.checkAgentLimit({
        userId: request.userId,
        agent: specialist,
      });
    }

    const budgetDecision = await this.deps.budgetGuard.checkAndConsumeLiveCall({
      userId: request.userId,
      providerField: specialist,
    });

    const fallbackNotice = budgetDecision.degradedToMock
      ? '[Budget Guard: Daily live provider allowance reached; served via deterministic mock fallback.]\n\n'
      : '';

    const executionId = `exec_${crypto.randomBytes(8).toString('hex')}`;
    const promptTokens = Math.max(4, Math.ceil(trimmedPrompt.length / 4));

    if (specialist === 'chat') {
      const chatMode = classifyChatMode(trimmedPrompt);
      const responseDepth = normalizeChatResponseDepth(request.responseDepth);
      const boundedHistory = sanitizeConversationHistory(request.conversationHistory);
      const systemInstruction = buildChatSystemInstruction({
        mode: chatMode,
        responseDepth,
        threadContext: request.threadContext,
      });
      emitProgress('generating', 'Streaming response…', 'chat');
      const reply = await this.deps.chatProvider.generateReply({
        prompt: trimmedPrompt,
        systemInstruction,
        maxOutputTokens: this.deps.config.maxOutputTokens,
        conversationHistory: boundedHistory,
        threadContext: request.threadContext,
        responseDepth,
        chatMode,
        onDelta: options?.onTextDelta,
        signal: options?.signal,
      });
      const parsed = parseChatReplyAndFollowUps(reply.content, trimmedPrompt, chatMode);
      return {
        executionId,
        requestId: request.requestId,
        agent: 'chat',
        replyContent: `${fallbackNotice}${parsed.answer}`,
        followUpQueries: parsed.followUpQueries,
        routedFromChat: false,
        chatMode,
        responseDepth,
        usage: {
          promptTokens,
          completionTokens: reply.tokensUsed,
          totalTokens: promptTokens + reply.tokensUsed,
          provider: this.deps.chatProvider.providerName,
          model: this.deps.config.chatModelId,
          durationMs: Math.max(1, Date.now() - startMs),
          mock: !budgetDecision.allowLive,
        },
      };
    }

    if (specialist === 'search') {
      emitProgress('searching', 'Searching live web sources & verifying citations…', 'search');
      let results: readonly {
        readonly title: string;
        readonly url: string;
        readonly snippet: string;
        readonly domain?: string;
        readonly publishedAt?: string;
        readonly imageUrl?: string;
        readonly sourceType?: 'web' | 'news' | 'encyclopedia' | 'technical';
      }[];
      let synthesisText = '';
      let searchImages: readonly SearchImageGalleryItem[] = [];
      let followUpQueries: readonly string[] = [];

      try {
        if (typeof this.deps.searchProvider.executeSearch === 'function') {
          const bundle = await this.deps.searchProvider.executeSearch({
            query: trimmedPrompt,
            maxResults: 6,
            maxOutputTokens: this.deps.config.maxOutputTokens,
          });
          results = bundle.results;
          synthesisText = (bundle.synthesizedAnswer ?? '').trim();
          searchImages = bundle.searchImages;
          followUpQueries = bundle.followUpQueries;
        } else {
          results = await this.deps.searchProvider.searchWeb({
            query: trimmedPrompt,
            maxResults: 6,
          });
          synthesisText =
            typeof this.deps.searchProvider.lastSynthesizedAnswer === 'string'
              ? this.deps.searchProvider.lastSynthesizedAnswer.trim()
              : '';
        }
      } catch {
        // §10: "If search fails, say the lookup failed — never invent sources."
        return {
          executionId,
          requestId: request.requestId,
          agent: 'search',
          replyContent: `${fallbackNotice}Web search lookup failed due to an upstream search provider error. No external sources were fabricated.`,
          citations: [],
          searchImages: [],
          followUpQueries: [],
          ...routingAttribution,
          usage: {
            promptTokens,
            completionTokens: 24,
            totalTokens: promptTokens + 24,
            provider: this.deps.searchProvider.providerName,
            model: this.deps.config.chatModelId,
            durationMs: Math.max(1, Date.now() - startMs),
            mock: !budgetDecision.allowLive,
          },
        };
      }

      const citations: AgentCitation[] = results.map((item, idx) => ({
        sourceId: `src_${idx + 1}`,
        title: item.title,
        urlOrPage: item.url,
        domain: item.domain ?? extractCleanDomain(item.url, item.title),
        snippet: item.snippet,
        publishedAt: item.publishedAt,
        sourceType: item.sourceType ?? 'web',
      }));

      const citedContextLines = results
        .map((r, idx) => `[${idx + 1}] ${r.title} (${r.url}): ${r.snippet}`)
        .join('\n');

      if (!synthesisText && results.length > 0 && budgetDecision.allowLive && !this.deps.config.mockAi) {
        try {
          const synthReply = await this.deps.chatProvider.generateReply({
            prompt: `User question: "${trimmedPrompt}"\n\nCited web search results:\n${citedContextLines}\n\nSynthesize a clear, direct, accurate Markdown answer grounded in these cited sources. Cite sources inline as [1], [2], etc. Do not append a raw URL list.\n\nEnd with:\nFOLLOW_UP_QUESTIONS:\n- <follow-up 1>\n- <follow-up 2>\n- <follow-up 3>`,
            systemInstruction:
              'You are Kartik.ai Web Search Synthesis Agent. Answer directly and accurately using the provided search results and cite [1], [2] inline.',
            maxOutputTokens: this.deps.config.maxOutputTokens,
          });
          if (synthReply.content.trim().length > 0) {
            const parsed = parseAnswerAndFollowUps(synthReply.content, trimmedPrompt, results);
            synthesisText = parsed.answer;
            if (followUpQueries.length === 0) {
              followUpQueries = parsed.followUpQueries;
            }
          }
        } catch {
          // Fall back to structured summary if synthesis call fails
        }
      }

      if (!synthesisText && results.length > 0) {
        const snippetBullets = results
          .slice(0, 4)
          .map((r, idx) => `- **${r.title}** [${idx + 1}]: ${r.snippet}`)
          .join('\n');
        synthesisText = `Summary grounded in ${results.length} retrieved web source(s) for **"${trimmedPrompt.slice(0, 80)}"**:\n\n${snippetBullets}`;
      }

      if (results.length > 0) {
        synthesisText = normalizeInlineCitations(synthesisText, results.length);
        if (followUpQueries.length === 0) {
          followUpQueries = buildDeterministicFollowUps(trimmedPrompt, results);
        }
      }

      const replyContent =
        results.length === 0
          ? `${fallbackNotice}No verified web search results were found for your query.`
          : `${fallbackNotice}${synthesisText}`;

      return {
        executionId,
        requestId: request.requestId,
        agent: 'search',
        replyContent,
        citations,
        searchImages,
        followUpQueries,
        ...routingAttribution,
        usage: {
          promptTokens,
          completionTokens: Math.ceil(replyContent.length / 4),
          totalTokens: promptTokens + Math.ceil(replyContent.length / 4),
          provider: this.deps.searchProvider.providerName,
          model: this.deps.config.chatModelId,
          durationMs: Math.max(1, Date.now() - startMs),
          mock: !budgetDecision.allowLive,
        },
      };
    }

    if (specialist === 'rag') {
      emitProgress('retrieving', 'Searching indexed document passages…', 'rag');
      const [queryVector] = await this.deps.embeddingProvider.embedTexts([trimmedPrompt]);
      const pdfFileIds = attachedFiles
        .filter((f) => f.mimeType === 'application/pdf')
        .map((f) => f.fileId);

      // Fetch wider userId-scoped candidate pool (Invariant #9) for hybrid semantic + BM25 reranking
      const rawHits = await this.deps.vectorStore.searchChunks({
        userId: request.userId,
        queryVector: queryVector ?? [],
        fileIds: pdfFileIds.length > 0 ? pdfFileIds : undefined,
        topK: 16,
      });

      // §10: "RAG answers must be grounded in retrieved chunks and cite document and page.
      // If retrieval finds nothing useful, say so."
      if (rawHits.length === 0) {
        const emptyReply = `${fallbackNotice}No relevant sections were found in your uploaded documents for this query. Attach a \`.pdf\` file using the paperclip button below to index and query its pages.`;
        return {
          executionId,
          requestId: request.requestId,
          agent: 'rag',
          replyContent: emptyReply,
          citations: [],
          ...routingAttribution,
          usage: {
            promptTokens,
            completionTokens: 28,
            totalTokens: promptTokens + 28,
            provider: this.deps.embeddingProvider.providerName,
            model: this.deps.config.chatModelId,
            durationMs: Math.max(1, Date.now() - startMs),
            mock: !budgetDecision.allowLive,
          },
        };
      }

      const ragIntent = classifyRagIntent(trimmedPrompt);
      const rankedHits = rerankRagHits(trimmedPrompt, rawHits, { topK: 6 });

      const citations: AgentCitation[] = rankedHits.map((hit) => ({
        sourceId: hit.chunkId,
        title: hit.documentTitle,
        urlOrPage: `p. ${hit.pageNumber}`,
        snippet: hit.excerpt,
        score: Number(hit.hybridScore.toFixed(3)),
        sourceType: 'document',
      }));

      let groundedAnswer = '';
      if (budgetDecision.allowLive && !this.deps.config.mockAi) {
        try {
          const ragReply = await this.deps.chatProvider.generateReply({
            prompt: buildRagUserPrompt(trimmedPrompt, rankedHits),
            systemInstruction: buildRagSystemInstruction(ragIntent),
            maxOutputTokens: this.deps.config.maxOutputTokens,
          });
          groundedAnswer = normalizeRagInlineCitations(
            ragReply.content.trim(),
            rankedHits,
          );
        } catch {
          // Fall back to deterministic grounded findings below
        }
      }

      const replyContent = groundedAnswer
        ? `${fallbackNotice}${groundedAnswer}`
        : `${fallbackNotice}${formatOfflineRagReply(rankedHits, trimmedPrompt)}`;

      const followUpQueries = buildRagFollowUps(rankedHits, trimmedPrompt, ragIntent);

      return {
        executionId,
        requestId: request.requestId,
        agent: 'rag',
        replyContent,
        citations,
        followUpQueries,
        ...routingAttribution,
        usage: {
          promptTokens,
          completionTokens: Math.ceil(replyContent.length / 4),
          totalTokens: promptTokens + Math.ceil(replyContent.length / 4),
          provider: this.deps.embeddingProvider.providerName,
          model: this.deps.config.chatModelId,
          durationMs: Math.max(1, Date.now() - startMs),
          mock: !budgetDecision.allowLive,
        },
      };
    }

    if (specialist === 'coding') {
      const codingIntent = classifyCodingIntent(trimmedPrompt);
      if (codingIntent !== 'CODE_GENERATION') {
        let inlineMarkdown = '';
        if (budgetDecision.allowLive && !this.deps.config.mockAi) {
          try {
            const codingReply = await this.deps.chatProvider.generateReply({
              prompt: trimmedPrompt,
              systemInstruction: buildCodingSystemInstruction(codingIntent),
              maxOutputTokens: this.deps.config.maxOutputTokens,
            });
            inlineMarkdown = codingReply.content.trim();
          } catch {
            // Fall through to deterministic markdown template
          }
        }
        if (!inlineMarkdown) {
          inlineMarkdown = buildNonGenerationCodingMarkdown(codingIntent, trimmedPrompt);
        }
        return {
          executionId,
          requestId: request.requestId,
          agent: 'coding',
          replyContent: `${fallbackNotice}${inlineMarkdown}`,
          followUpQueries: buildCodingFollowUps(trimmedPrompt, trimmedPrompt.slice(0, 48), codingIntent),
          ...routingAttribution,
          usage: {
            promptTokens,
            completionTokens: Math.ceil(inlineMarkdown.length / 4),
            totalTokens: promptTokens + Math.ceil(inlineMarkdown.length / 4),
            provider: this.deps.codingProvider.providerName,
            model: this.deps.config.codingModelId,
            durationMs: Math.max(1, Date.now() - startMs),
            mock: !budgetDecision.allowLive,
          },
        };
      }

      // Idempotent artifact check by requestId (Invariant #15)
      const existingArtifact = await this.deps.metadataStore.getArtifactByRequestId(
        request.userId,
        request.requestId,
      );
      if (existingArtifact) {
        return {
          executionId,
          requestId: request.requestId,
          agent: 'coding',
          replyContent: `${fallbackNotice}Replayed validated coding artifact "${existingArtifact.title}".`,
          artifactIds: [existingArtifact.artifactId],
          ...routingAttribution,
          usage: {
            promptTokens,
            completionTokens: 32,
            totalTokens: promptTokens + 32,
            provider: this.deps.codingProvider.providerName,
            model: this.deps.config.codingModelId,
            durationMs: Math.max(1, Date.now() - startMs),
            mock: !budgetDecision.allowLive,
          },
        };
      }

      const matchingCodeContext =
        options?.activeArtifactContext?.artifactType === 'code_bundle'
          ? options.activeArtifactContext.serializedContext
          : undefined;
      emitProgress(
        'generating',
        matchingCodeContext
          ? `Refining "${options!.activeArtifactContext!.title}" sandbox…`
          : 'Building interactive HTML/CSS/JS sandbox…',
        'coding',
      );

      const generated = await this.deps.codingProvider.generateCodeBundle({
        prompt: trimmedPrompt,
        maxOutputTokens: this.deps.config.maxOutputTokens,
        existingArtifactContext: matchingCodeContext,
        signal: options?.signal,
      });

      // §10 & Invariant #12: "Never ask a model for JSON and then trust it.
      // Parse, validate against a schema, reject unexpected fields, and handle malformed output."
      let rawParsed: unknown;
      try {
        rawParsed = JSON.parse(generated.rawManifestJson);
      } catch {
        throw new AppError(
          'ARTIFACT_INVALID',
          'Coding model returned malformed JSON instead of a valid artifact manifest',
        );
      }

      const validatedManifest = validateArtifactManifest(rawParsed);
      const rawFilesArray = (rawParsed as { files: Array<{ path: string; content?: unknown }> }).files;
      const contentByPath = new Map<string, string>();
      for (const item of rawFilesArray) {
        if (typeof item.content !== 'string') {
          throw new AppError(
            'ARTIFACT_INVALID',
            `Coding manifest file "${item.path}" is missing string content`,
          );
        }
        contentByPath.set(item.path, item.content);
      }

      const filesManifest: CodingArtifactFile[] = validatedManifest.files.map((f) => ({
        ...f,
        content: contentByPath.get(f.path) ?? '',
      }));

      const artifactId = `art_${crypto.randomBytes(8).toString('hex')}`;
      const storageKey = buildObjectStorageKey({
        namespace: 'artifacts',
        userId: request.userId,
        resourceId: request.conversationId,
        fileId: artifactId,
        extension: '.json',
      });

      const serializedBundle = Buffer.from(
        JSON.stringify({
          title: validatedManifest.title,
          entryFile: validatedManifest.entryFile,
          files: filesManifest,
        }),
        'utf8',
      );
      const bundleSha256 = crypto
        .createHash('sha256')
        .update(serializedBundle)
        .digest('hex');

      await this.deps.objectStorage.putPrivateObject({
        key: storageKey,
        ownerUserId: request.userId,
        mimeType: 'application/json',
        body: serializedBundle,
        sha256: bundleSha256,
      });

      const artifactRecord: ArtifactRecord = Object.freeze({
        artifactId,
        userId: request.userId,
        requestId: request.requestId,
        conversationId: request.conversationId,
        artifactType: 'code_bundle',
        title: validatedManifest.title,
        entryFile: validatedManifest.entryFile,
        storageKey,
        mimeType: 'application/json',
        sizeBytes: serializedBundle.byteLength,
        filesManifest: Object.freeze(filesManifest),
        createdAt: new Date().toISOString(),
      });

      await this.deps.metadataStore.saveArtifact(artifactRecord);

      return {
        executionId,
        requestId: request.requestId,
        agent: 'coding',
        replyContent: `${fallbackNotice}${generated.summary}`,
        artifactIds: [artifactId],
        followUpQueries: buildCodingFollowUps(
          trimmedPrompt,
          validatedManifest.title,
          'CODE_GENERATION',
        ),
        ...routingAttribution,
        usage: {
          promptTokens,
          completionTokens: generated.tokensUsed,
          totalTokens: promptTokens + generated.tokensUsed,
          provider: this.deps.codingProvider.providerName,
          model: this.deps.config.codingModelId,
          durationMs: Math.max(1, Date.now() - startMs),
          mock: !budgetDecision.allowLive,
        },
      };
    }

    if (specialist === 'pdf') {
      const existingPdf = await this.deps.metadataStore.getArtifactByRequestId(
        request.userId,
        request.requestId,
      );
      if (existingPdf) {
        return {
          executionId,
          requestId: request.requestId,
          agent: 'pdf',
          replyContent: `${fallbackNotice}Replayed generated PDF document "${existingPdf.title}".`,
          artifactIds: [existingPdf.artifactId],
          ...routingAttribution,
          usage: {
            promptTokens,
            completionTokens: 24,
            totalTokens: promptTokens + 24,
            provider: this.pdfProvider.providerName,
            model: this.deps.config.chatModelId,
            durationMs: Math.max(1, Date.now() - startMs),
            mock: !budgetDecision.allowLive,
          },
        };
      }

      const matchingPdfContext =
        options?.activeArtifactContext?.artifactType === 'pdf_document'
          ? options.activeArtifactContext.serializedContext
          : undefined;
      emitProgress(
        'compiling',
        matchingPdfContext
          ? `Refining "${options!.activeArtifactContext!.title}" PDF & compiling %PDF-1.4…`
          : 'Drafting structured sections & compiling %PDF-1.4…',
        'pdf',
      );

      const generatedPdf = await this.pdfProvider.generatePdfDocument({
        prompt: trimmedPrompt,
        maxOutputTokens: this.deps.config.maxOutputTokens,
        existingArtifactContext: matchingPdfContext,
        signal: options?.signal,
      });

      const artifactId = `art_${crypto.randomBytes(8).toString('hex')}`;
      const storageKey = buildObjectStorageKey({
        namespace: 'artifacts',
        userId: request.userId,
        resourceId: request.conversationId,
        fileId: artifactId,
        extension: '.pdf',
      });
      const pdfSha256 = crypto
        .createHash('sha256')
        .update(generatedPdf.pdfBytes)
        .digest('hex');

      await this.deps.objectStorage.putPrivateObject({
        key: storageKey,
        ownerUserId: request.userId,
        mimeType: 'application/pdf',
        body: generatedPdf.pdfBytes,
        sha256: pdfSha256,
      });

      const specJson = JSON.stringify({
        pageCount: generatedPdf.pageCount,
        documentType: generatedPdf.spec.documentType ?? 'general_guide',
        spec: generatedPdf.spec,
      });
      const specSha = crypto.createHash('sha256').update(specJson, 'utf8').digest('hex');

      const pdfArtifact: ArtifactRecord = Object.freeze({
        artifactId,
        userId: request.userId,
        requestId: request.requestId,
        conversationId: request.conversationId,
        artifactType: 'pdf_document',
        title: generatedPdf.spec.title,
        entryFile: 'document.pdf',
        storageKey,
        mimeType: 'application/pdf',
        sizeBytes: generatedPdf.pdfBytes.byteLength,
        filesManifest: Object.freeze([
          {
            path: 'document-spec.json',
            mimeType: 'application/json',
            sizeBytes: Buffer.byteLength(specJson, 'utf8'),
            sha256: specSha,
            content: specJson,
          },
        ]),
        createdAt: new Date().toISOString(),
      });

      await this.deps.metadataStore.saveArtifact(pdfArtifact);

      return {
        executionId,
        requestId: request.requestId,
        agent: 'pdf',
        replyContent: `${fallbackNotice}${generatedPdf.summaryMarkdown}`,
        artifactIds: [artifactId],
        followUpQueries: buildPdfFollowUps(generatedPdf.spec, trimmedPrompt),
        ...routingAttribution,
        usage: {
          promptTokens,
          completionTokens: generatedPdf.tokensUsed,
          totalTokens: promptTokens + generatedPdf.tokensUsed,
          provider: this.pdfProvider.providerName,
          model: this.deps.config.chatModelId,
          durationMs: Math.max(1, Date.now() - startMs),
          mock: !budgetDecision.allowLive,
        },
      };
    }

    if (specialist === 'ppt') {
      const existingPpt = await this.deps.metadataStore.getArtifactByRequestId(
        request.userId,
        request.requestId,
      );
      if (existingPpt) {
        return {
          executionId,
          requestId: request.requestId,
          agent: 'ppt',
          replyContent: `${fallbackNotice}Replayed generated PPT presentation "${existingPpt.title}".`,
          artifactIds: [existingPpt.artifactId],
          ...routingAttribution,
          usage: {
            promptTokens,
            completionTokens: 24,
            totalTokens: promptTokens + 24,
            provider: this.pptProvider.providerName,
            model: this.deps.config.chatModelId,
            durationMs: Math.max(1, Date.now() - startMs),
            mock: !budgetDecision.allowLive,
          },
        };
      }

      const matchingPptContext =
        options?.activeArtifactContext?.artifactType === 'ppt_presentation'
          ? options.activeArtifactContext.serializedContext
          : undefined;
      emitProgress(
        'compiling',
        matchingPptContext
          ? `Refining "${options!.activeArtifactContext!.title}" deck & compiling .pptx…`
          : 'Designing slide layouts & compiling OpenXML .pptx…',
        'ppt',
      );

      const generatedPpt = await this.pptProvider.generatePptPresentation({
        prompt: trimmedPrompt,
        maxOutputTokens: this.deps.config.maxOutputTokens,
        existingArtifactContext: matchingPptContext,
        signal: options?.signal,
      });

      const artifactId = `art_${crypto.randomBytes(8).toString('hex')}`;
      const storageKey = buildObjectStorageKey({
        namespace: 'artifacts',
        userId: request.userId,
        resourceId: request.conversationId,
        fileId: artifactId,
        extension: '.pptx',
      });
      const pptSha256 = crypto
        .createHash('sha256')
        .update(generatedPpt.pptxBytes)
        .digest('hex');
      const pptMimeType =
        'application/vnd.openxmlformats-officedocument.presentationml.presentation';

      await this.deps.objectStorage.putPrivateObject({
        key: storageKey,
        ownerUserId: request.userId,
        mimeType: pptMimeType,
        body: generatedPpt.pptxBytes,
        sha256: pptSha256,
      });

      const deckJson = JSON.stringify({
        slideCount: generatedPpt.slideCount,
        theme: generatedPpt.spec.theme ?? 'editorial_story',
        surfaceMode: generatedPpt.spec.surfaceMode ?? 'dark',
        spec: generatedPpt.spec,
      });
      const deckSha = crypto.createHash('sha256').update(deckJson, 'utf8').digest('hex');

      const pptArtifact: ArtifactRecord = Object.freeze({
        artifactId,
        userId: request.userId,
        requestId: request.requestId,
        conversationId: request.conversationId,
        artifactType: 'ppt_presentation',
        title: generatedPpt.spec.title,
        entryFile: 'presentation.pptx',
        storageKey,
        mimeType: pptMimeType,
        sizeBytes: generatedPpt.pptxBytes.byteLength,
        filesManifest: Object.freeze([
          {
            path: 'slides-spec.json',
            mimeType: 'application/json',
            sizeBytes: Buffer.byteLength(deckJson, 'utf8'),
            sha256: deckSha,
            content: deckJson,
          },
        ]),
        createdAt: new Date().toISOString(),
      });

      await this.deps.metadataStore.saveArtifact(pptArtifact);

      return {
        executionId,
        requestId: request.requestId,
        agent: 'ppt',
        replyContent: `${fallbackNotice}${generatedPpt.summaryMarkdown}`,
        artifactIds: [artifactId],
        followUpQueries: buildPptFollowUps(generatedPpt.spec, trimmedPrompt),
        ...routingAttribution,
        usage: {
          promptTokens,
          completionTokens: generatedPpt.tokensUsed,
          totalTokens: promptTokens + generatedPpt.tokensUsed,
          provider: this.pptProvider.providerName,
          model: this.deps.config.chatModelId,
          durationMs: Math.max(1, Date.now() - startMs),
          mock: !budgetDecision.allowLive,
        },
      };
    }

    if (specialist === 'vision') {
      const imageAttachment = attachedFiles.find((f) => f.mimeType.startsWith('image/'));
      if (!imageAttachment) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Vision specialist requires at least one uploaded image attachment (PNG, JPEG, or WebP)',
        );
      }

      const imageBytes = this.deps.loadImageBytes
        ? await this.deps.loadImageBytes(imageAttachment.storageKey, request.userId)
        : new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const visionIntent = classifyVisionIntent(trimmedPrompt);
      const visionSystemInstruction = buildVisionSystemInstruction(visionIntent);

      emitProgress('analyzing', 'Inspecting image pixels & extracting structured findings…', 'vision');
      const visionResult = await this.deps.visionProvider.analyzeImage({
        prompt: trimmedPrompt,
        mimeType: imageAttachment.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
        imageBytes,
        filename: imageAttachment.originalFilename,
        systemInstruction: visionSystemInstruction,
      });

      return {
        executionId,
        requestId: request.requestId,
        agent: 'vision',
        replyContent: `${fallbackNotice}${visionResult.analysis}`,
        followUpQueries: buildVisionFollowUps(
          visionIntent,
          trimmedPrompt,
          imageAttachment.originalFilename,
        ),
        ...routingAttribution,
        usage: {
          promptTokens,
          completionTokens: visionResult.tokensUsed,
          totalTokens: promptTokens + visionResult.tokensUsed,
          provider: this.deps.visionProvider.providerName,
          model: this.deps.config.chatModelId,
          durationMs: Math.max(1, Date.now() - startMs),
          mock: !budgetDecision.allowLive,
        },
      };
    }

    // specialist === 'image'
    emitProgress('rendering', 'Art-directing prompt & rendering studio image…', 'image');
    const imageStyle = classifyImageStyle(trimmedPrompt);
    const aspectRatio = detectImageAspectRatio(trimmedPrompt);
    const referenceFile = attachedFiles.find((f) => f.mimeType.startsWith('image/'));
    let referenceImage:
      | {
          readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
          readonly data: Uint8Array;
          readonly filename?: string;
        }
      | undefined;

    if (referenceFile && this.deps.loadImageBytes) {
      const refBytes = await this.deps.loadImageBytes(
        referenceFile.storageKey,
        request.userId,
      );
      referenceImage = {
        mimeType: referenceFile.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
        data: refBytes,
        filename: referenceFile.originalFilename,
      };
    }

    const enhancedPrompt = buildEnhancedImagePrompt({
      prompt: trimmedPrompt,
      style: imageStyle,
      aspectRatio,
      isEdit: Boolean(referenceImage),
    });

    const imageGen = await this.deps.imageProvider.generateImage({
      prompt: trimmedPrompt,
      enhancedPrompt,
      aspectRatio,
      style: imageStyle,
      referenceImage,
    });
    const finalStyle =
      (imageGen.style as ImageStyleArchetype | undefined) ?? imageStyle;
    const finalAspectRatio = imageGen.aspectRatio ?? aspectRatio;
    const finalEnhancedPrompt = imageGen.enhancedPrompt ?? enhancedPrompt;
    const finalModel = imageGen.modelUsed ?? 'gemini-3.1-flash-lite-image';
    const parsedDims = parseImageDimensions(imageGen.mimeType, imageGen.data);

    const imageExt =
      imageGen.mimeType === 'image/jpeg'
        ? '.jpg'
        : imageGen.mimeType === 'image/webp'
          ? '.webp'
          : '.png';
    const artifactId = `art_${crypto.randomBytes(8).toString('hex')}`;
    const storageKey = buildObjectStorageKey({
      namespace: 'images',
      userId: request.userId,
      resourceId: request.conversationId,
      fileId: artifactId,
      extension: imageExt,
    });
    const imageSha256 = crypto.createHash('sha256').update(imageGen.data).digest('hex');

    await this.deps.objectStorage.putPrivateObject({
      key: storageKey,
      ownerUserId: request.userId,
      mimeType: imageGen.mimeType,
      body: imageGen.data,
      sha256: imageSha256,
    });

    const imageSpecPayload = buildImageSpecManifestPayload({
      originalPrompt: trimmedPrompt,
      enhancedPrompt: finalEnhancedPrompt,
      style: finalStyle,
      aspectRatio: finalAspectRatio,
      width: parsedDims?.width ?? null,
      height: parsedDims?.height ?? null,
      model: finalModel,
      isEdit: Boolean(referenceImage),
      ...(referenceImage?.filename ? { referenceFilename: referenceImage.filename } : {}),
      liveGenerated: imageGen.liveGenerated ?? budgetDecision.allowLive,
    });
    const imageSpecJson = JSON.stringify(imageSpecPayload);
    const imageSpecSha = crypto
      .createHash('sha256')
      .update(imageSpecJson, 'utf8')
      .digest('hex');

    const imageArtifact: ArtifactRecord = Object.freeze({
      artifactId,
      userId: request.userId,
      requestId: request.requestId,
      conversationId: request.conversationId,
      artifactType: 'generated_image',
      title: trimmedPrompt.slice(0, 80),
      entryFile: `image${imageExt}`,
      storageKey,
      mimeType: imageGen.mimeType,
      sizeBytes: imageGen.data.byteLength,
      filesManifest: Object.freeze([
        {
          path: 'image-spec.json',
          mimeType: 'application/json',
          sizeBytes: Buffer.byteLength(imageSpecJson, 'utf8'),
          sha256: imageSpecSha,
          content: imageSpecJson,
        },
      ]),
      createdAt: new Date().toISOString(),
    });

    await this.deps.metadataStore.saveArtifact(imageArtifact);

    return {
      executionId,
      requestId: request.requestId,
      agent: 'image',
      replyContent: `${fallbackNotice}${imageGen.caption}`,
      artifactIds: [artifactId],
      followUpQueries: buildImageFollowUps(
        trimmedPrompt,
        finalStyle,
        finalAspectRatio,
      ),
      ...routingAttribution,
      usage: {
        promptTokens,
        completionTokens: 64,
        totalTokens: promptTokens + 64,
        provider: this.deps.imageProvider.providerName,
        model: finalModel,
        durationMs: Math.max(1, Date.now() - startMs),
        mock: !budgetDecision.allowLive,
      },
    };
  }
}
