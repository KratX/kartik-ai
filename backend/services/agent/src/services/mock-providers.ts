import crypto from 'node:crypto';
import { AppError } from '@kartik/shared/errors';
import type {
  ChatModelProvider,
  CodingModelProvider,
  DocumentChunkRecord,
  EmbeddingProvider,
  ImageGenerationProvider,
  SearchProvider,
  SearchResultItem,
  VectorSearchHit,
  VectorStore,
  VisionProvider,
} from '../models/index.js';

/**
 * Deterministic 1x1 PNG bytes for mock image generation (valid magic bytes: 89 50 4E 47 0D 0A 1A 0A).
 */
export const MOCK_PNG_BYTES: Uint8Array = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

export class MockChatModelProvider implements ChatModelProvider {
  public readonly providerName = 'mock-gemini-chat';

  public async generateReply(input: {
    readonly prompt: string;
    readonly systemInstruction?: string;
    readonly maxOutputTokens: number;
  }): Promise<{ readonly content: string; readonly tokensUsed: number }> {
    const trimmed = input.prompt.trim();
    const content = `[Mock Chat] Processed prompt (${trimmed.length} chars): ${trimmed.slice(0, 120)}`;
    const tokensUsed = Math.min(
      input.maxOutputTokens,
      Math.max(16, Math.ceil(content.length / 4)),
    );
    return { content, tokensUsed };
  }
}

export class MockCodingModelProvider implements CodingModelProvider {
  public readonly providerName = 'mock-gemini-coding';

  public async generateCodeBundle(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
  }): Promise<{
    readonly summary: string;
    readonly rawManifestJson: string;
    readonly tokensUsed: number;
  }> {
    const cleanTitle = input.prompt.trim().slice(0, 60) || 'Generated Sandbox App';
    const rawFiles = [
      {
        path: 'index.html',
        mimeType: 'text/html',
        content: `<!doctype html><html><head><meta charset="utf-8"><title>${cleanTitle}</title><link rel="stylesheet" href="styles.css"></head><body><main id="app"><h1>${cleanTitle}</h1></main><script src="app.js"></script></body></html>`,
      },
      {
        path: 'styles.css',
        mimeType: 'text/css',
        content: 'body { font-family: system-ui, sans-serif; margin: 2rem; background: #0f172a; color: #f8fafc; }',
      },
      {
        path: 'app.js',
        mimeType: 'application/javascript',
        content: 'console.log("Kartik.ai isolated sandbox preview ready");',
      },
    ];

    const files = rawFiles.map((f) => ({
      path: f.path,
      mimeType: f.mimeType,
      sizeBytes: Buffer.byteLength(f.content, 'utf8'),
      sha256: crypto.createHash('sha256').update(f.content, 'utf8').digest('hex'),
      content: f.content,
    }));

    const manifest = {
      title: cleanTitle,
      entryFile: 'index.html',
      files,
    };

    const rawManifestJson = JSON.stringify(manifest);
    return {
      summary: `[Mock Coding] Generated 3-file isolated preview bundle for "${cleanTitle}".`,
      rawManifestJson,
      tokensUsed: Math.min(input.maxOutputTokens, 180),
    };
  }
}

export class MockSearchProvider implements SearchProvider {
  public readonly providerName = 'mock-tavily-search';

  public async searchWeb(input: {
    readonly query: string;
    readonly maxResults?: number;
  }): Promise<readonly SearchResultItem[]> {
    const q = input.query.trim();
    const limit = Math.max(1, Math.min(input.maxResults ?? 3, 5));
    const items: SearchResultItem[] = [
      {
        title: `Reference Overview: ${q}`,
        url: 'https://docs.kartik.ai/reference/overview',
        snippet: `Verified architectural synthesis and documentation covering "${q}".`,
      },
      {
        title: `Specification & Standards for ${q}`,
        url: 'https://docs.kartik.ai/reference/specification',
        snippet: `Normative contracts, security boundaries, and verification gates for "${q}".`,
      },
      {
        title: `Operational Playbook: ${q}`,
        url: 'https://docs.kartik.ai/reference/operations',
        snippet: `Production runbook, observability traces, and fallback handling for "${q}".`,
      },
    ];
    return items.slice(0, limit);
  }
}

/**
 * Deterministic normalized 16-dimensional embedding vector generator from text content.
 * Ensures repeatable cosine similarity in mock RAG tests without external API calls.
 */
export function computeDeterministicEmbedding(
  text: string,
  dimensions = 16,
): readonly number[] {
  const normalized = text.toLowerCase().trim();
  const vector = new Array<number>(dimensions).fill(0);

  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.length === 0) {
    vector[0] = 1;
    return Object.freeze(vector);
  }

  for (const token of tokens) {
    const digest = crypto.createHash('sha256').update(token).digest();
    for (let i = 0; i < dimensions; i += 1) {
      const byteVal = digest[i % digest.length] ?? 0;
      vector[i] = (vector[i] ?? 0) + (byteVal / 255 - 0.5);
    }
  }

  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) {
    vector[0] = 1;
    return Object.freeze(vector);
  }

  return Object.freeze(vector.map((v) => Number((v / magnitude).toFixed(6))));
}

export function cosineSimilarity(
  a: readonly number[],
  b: readonly number[],
): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i += 1) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  public readonly providerName = 'mock-gemini-embedding';
  public readonly dimensions = 16;

  public async embedTexts(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    return texts.map((text) => computeDeterministicEmbedding(text, this.dimensions));
  }
}

export class MockImageGenerationProvider implements ImageGenerationProvider {
  public readonly providerName = 'mock-image-generator';

  public async generateImage(input: {
    readonly prompt: string;
  }): Promise<{
    readonly mimeType: 'image/png';
    readonly data: Uint8Array;
    readonly caption: string;
  }> {
    return {
      mimeType: 'image/png',
      data: new Uint8Array(MOCK_PNG_BYTES),
      caption: `[Mock Image] Generated PNG illustration for "${input.prompt.trim().slice(0, 80)}"`,
    };
  }
}

export class MockVisionProvider implements VisionProvider {
  public readonly providerName = 'mock-gemini-vision';

  public async analyzeImage(input: {
    readonly prompt: string;
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly imageBytes: Uint8Array;
  }): Promise<{ readonly analysis: string; readonly tokensUsed: number }> {
    const analysis = `[Mock Vision] Inspected ${input.mimeType} image (${input.imageBytes.byteLength} bytes) for prompt: "${input.prompt.trim().slice(0, 100)}"`;
    return {
      analysis,
      tokensUsed: 64,
    };
  }
}

/**
 * In-memory Qdrant-compatible VectorStore enforcing Invariant #9:
 * "Vector retrieval is filtered by authenticated userId and document identity.
 * A result from another user must never be returned."
 */
export class InMemoryVectorStore implements VectorStore {
  private readonly chunks = new Map<string, DocumentChunkRecord>();

  public async upsertChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    for (const chunk of chunks) {
      if (!chunk.userId || !chunk.fileId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Every vector chunk must carry an authenticated userId and fileId',
        );
      }
      this.chunks.set(chunk.chunkId, chunk);
    }
  }

  public async searchChunks(input: {
    readonly userId: string;
    readonly queryVector: readonly number[];
    readonly fileIds?: readonly string[];
    readonly topK?: number;
  }): Promise<readonly VectorSearchHit[]> {
    if (!input.userId || input.userId.trim().length === 0) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Vector search requires a non-empty authenticated userId (Invariant #9)',
      );
    }

    const allowedFiles =
      input.fileIds && input.fileIds.length > 0 ? new Set(input.fileIds) : null;
    const topK = Math.max(1, Math.min(input.topK ?? 5, 20));

    const hits: VectorSearchHit[] = [];
    for (const chunk of this.chunks.values()) {
      // Strict tenant & document filter before similarity scoring (Invariant #9)
      if (chunk.userId !== input.userId) {
        continue;
      }
      if (allowedFiles && !allowedFiles.has(chunk.fileId)) {
        continue;
      }
      const score = cosineSimilarity(input.queryVector, chunk.embeddingVector);
      hits.push({
        chunkId: chunk.chunkId,
        fileId: chunk.fileId,
        userId: chunk.userId,
        documentTitle: chunk.documentTitle,
        pageNumber: chunk.pageNumber,
        textContent: chunk.textContent,
        score,
      });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  public async deleteByFileIds(input: {
    readonly userId: string;
    readonly fileIds: readonly string[];
  }): Promise<number> {
    const fileIdSet = new Set(input.fileIds);
    let deleted = 0;
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.userId === input.userId && fileIdSet.has(chunk.fileId)) {
        this.chunks.delete(chunkId);
        deleted += 1;
      }
    }
    return deleted;
  }

  public async deleteByUserId(userId: string): Promise<number> {
    let deleted = 0;
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.userId === userId) {
        this.chunks.delete(chunkId);
        deleted += 1;
      }
    }
    return deleted;
  }

  public countAll(): number {
    return this.chunks.size;
  }
}
