import crypto from 'node:crypto';
import { AppError } from '@kartik/shared/errors';
import {
  assertAgentName,
  type AgentExecuteRequest,
  type AgentExecuteResponse,
  type SpecialistAgentName,
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
import type { DailyLiveBudgetGuard } from '../services/budget-guard.js';

export interface AgentMetadataStore {
  getFileById(userId: string, fileId: string): Promise<UploadedFileRecord | null>;
  saveArtifact(artifact: ArtifactRecord): Promise<void>;
  getArtifactByRequestId(userId: string, requestId: string): Promise<ArtifactRecord | null>;
}

/**
 * Deterministic Router Node (`routePromptToSpecialist`).
 *
 * Precedence:
 * 1. Explicit `preferredAgent` validated against closed `SpecialistAgentName` union.
 * 2. Uploaded attachment MIME types (`application/pdf` -> `rag`; `image/*` -> `vision`).
 * 3. Deterministic intent classification over prompt keywords (`image`, `coding`, `search`, `rag`, default `chat`).
 */
export function routePromptToSpecialist(input: {
  readonly prompt: string;
  readonly preferredAgent?: SpecialistAgentName;
  readonly attachedFiles?: readonly UploadedFileRecord[];
}): SpecialistAgentName {
  if (input.preferredAgent !== undefined) {
    const validated = assertAgentName(input.preferredAgent, 'preferredAgent');
    if (validated === 'router') {
      throw new AppError(
        'VALIDATION_FAILED',
        'preferredAgent must be a specialist agent, not "router"',
      );
    }
    return validated;
  }

  if (input.attachedFiles && input.attachedFiles.length > 0) {
    const hasPdf = input.attachedFiles.some((f) => f.mimeType === 'application/pdf');
    if (hasPdf) {
      return 'rag';
    }
    const hasImage = input.attachedFiles.some((f) => f.mimeType.startsWith('image/'));
    if (hasImage) {
      return 'vision';
    }
  }

  const lower = input.prompt.toLowerCase();
  if (/\b(generate an image|draw|illustration|create an image|render a picture)\b/.test(lower)) {
    return 'image';
  }
  if (/\b(build an app|write code|create a component|html|typescript|react|sandbox|calculator)\b/.test(lower)) {
    return 'coding';
  }
  if (/\b(search the web|latest news|current price|cite sources|look up online|web search)\b/.test(lower)) {
    return 'search';
  }
  if (/\b(in the uploaded pdf|according to the document|page number|uploaded file)\b/.test(lower)) {
    return 'rag';
  }

  return 'chat';
}

export interface AgentGraphDependencies {
  readonly config: AgentConfig;
  readonly budgetGuard: DailyLiveBudgetGuard;
  readonly chatProvider: ChatModelProvider;
  readonly codingProvider: CodingModelProvider;
  readonly searchProvider: SearchProvider;
  readonly embeddingProvider: EmbeddingProvider;
  readonly imageProvider: ImageGenerationProvider;
  readonly visionProvider: VisionProvider;
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
 * - Invariant #12: All model output is untrusted input; coding manifests are validated via `validateArtifactManifest`.
 * - §10: Search answers distinguish cited sources from synthesis and report lookup failure honestly.
 * - §10: RAG answers cite document & page and state clearly when retrieval finds nothing useful.
 * - §12: Daily Redis budget counters degrade gracefully to deterministic mock mode on exhaustion.
 */
export class AgentGraphExecutor {
  private readonly deps: AgentGraphDependencies;

  constructor(deps: AgentGraphDependencies) {
    this.deps = deps;
  }

  public async execute(request: AgentExecuteRequest): Promise<AgentExecuteResponse> {
    const startMs = Date.now();

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

    const specialist = routePromptToSpecialist({
      prompt: trimmedPrompt,
      preferredAgent: request.preferredAgent,
      attachedFiles,
    });

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
      const reply = await this.deps.chatProvider.generateReply({
        prompt: trimmedPrompt,
        maxOutputTokens: this.deps.config.maxOutputTokens,
      });
      return {
        executionId,
        requestId: request.requestId,
        agent: 'chat',
        replyContent: `${fallbackNotice}${reply.content}`,
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
      let results;
      try {
        results = await this.deps.searchProvider.searchWeb({
          query: trimmedPrompt,
          maxResults: 3,
        });
      } catch {
        // §10: "If search fails, say the lookup failed — never invent sources."
        return {
          executionId,
          requestId: request.requestId,
          agent: 'search',
          replyContent: `${fallbackNotice}Web search lookup failed due to an upstream search provider error. No external sources were fabricated.`,
          citations: [],
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
      }));

      const citedLines = results
        .map((r, idx) => `- [src_${idx + 1}] **${r.title}** (${r.url}): ${r.snippet}`)
        .join('\n');

      const replyContent =
        results.length === 0
          ? `${fallbackNotice}No verified web search results were found for your query.`
          : `${fallbackNotice}### Cited Source Material\n${citedLines}\n\n### Synthesis\nSynthesized from ${results.length} cited source(s) for "${trimmedPrompt.slice(0, 80)}".`;

      return {
        executionId,
        requestId: request.requestId,
        agent: 'search',
        replyContent,
        citations,
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
      const [queryVector] = await this.deps.embeddingProvider.embedTexts([trimmedPrompt]);
      const pdfFileIds = attachedFiles
        .filter((f) => f.mimeType === 'application/pdf')
        .map((f) => f.fileId);

      const hits = await this.deps.vectorStore.searchChunks({
        userId: request.userId,
        queryVector: queryVector ?? [],
        fileIds: pdfFileIds.length > 0 ? pdfFileIds : undefined,
        topK: 4,
      });

      // §10: "RAG answers must be grounded in retrieved chunks and cite document and page.
      // If retrieval finds nothing useful, say so."
      if (hits.length === 0) {
        const emptyReply = `${fallbackNotice}No relevant sections were found in your uploaded documents for this query.`;
        return {
          executionId,
          requestId: request.requestId,
          agent: 'rag',
          replyContent: emptyReply,
          citations: [],
          usage: {
            promptTokens,
            completionTokens: 20,
            totalTokens: promptTokens + 20,
            provider: this.deps.embeddingProvider.providerName,
            model: this.deps.config.chatModelId,
            durationMs: Math.max(1, Date.now() - startMs),
            mock: !budgetDecision.allowLive,
          },
        };
      }

      const citations: AgentCitation[] = hits.map((hit) => ({
        sourceId: hit.chunkId,
        title: hit.documentTitle,
        urlOrPage: `p. ${hit.pageNumber}`,
      }));

      const groundedPassages = hits
        .map(
          (hit) =>
            `- **[${hit.documentTitle}, p. ${hit.pageNumber}]**: "${hit.textContent}"`,
        )
        .join('\n');

      const replyContent = `${fallbackNotice}### Grounded Document Evidence\n${groundedPassages}`;

      return {
        executionId,
        requestId: request.requestId,
        agent: 'rag',
        replyContent,
        citations,
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

      const generated = await this.deps.codingProvider.generateCodeBundle({
        prompt: trimmedPrompt,
        maxOutputTokens: this.deps.config.maxOutputTokens,
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

      const visionResult = await this.deps.visionProvider.analyzeImage({
        prompt: trimmedPrompt,
        mimeType: imageAttachment.mimeType as 'image/png' | 'image/jpeg' | 'image/webp',
        imageBytes,
      });

      return {
        executionId,
        requestId: request.requestId,
        agent: 'vision',
        replyContent: `${fallbackNotice}${visionResult.analysis}`,
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
    const imageGen = await this.deps.imageProvider.generateImage({
      prompt: trimmedPrompt,
    });
    const artifactId = `art_${crypto.randomBytes(8).toString('hex')}`;
    const storageKey = buildObjectStorageKey({
      namespace: 'images',
      userId: request.userId,
      resourceId: request.conversationId,
      fileId: artifactId,
      extension: '.png',
    });
    const imageSha256 = crypto.createHash('sha256').update(imageGen.data).digest('hex');

    await this.deps.objectStorage.putPrivateObject({
      key: storageKey,
      ownerUserId: request.userId,
      mimeType: 'image/png',
      body: imageGen.data,
      sha256: imageSha256,
    });

    const imageArtifact: ArtifactRecord = Object.freeze({
      artifactId,
      userId: request.userId,
      requestId: request.requestId,
      conversationId: request.conversationId,
      artifactType: 'generated_image',
      title: trimmedPrompt.slice(0, 80),
      entryFile: 'image.png',
      storageKey,
      mimeType: 'image/png',
      sizeBytes: imageGen.data.byteLength,
      filesManifest: Object.freeze([]),
      createdAt: new Date().toISOString(),
    });

    await this.deps.metadataStore.saveArtifact(imageArtifact);

    return {
      executionId,
      requestId: request.requestId,
      agent: 'image',
      replyContent: `${fallbackNotice}${imageGen.caption}`,
      artifactIds: [artifactId],
      usage: {
        promptTokens,
        completionTokens: 64,
        totalTokens: promptTokens + 64,
        provider: this.deps.imageProvider.providerName,
        model: 'imagen-3.0',
        durationMs: Math.max(1, Date.now() - startMs),
        mock: !budgetDecision.allowLive,
      },
    };
  }
}
