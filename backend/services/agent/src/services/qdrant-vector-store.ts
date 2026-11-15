import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '@kartik/shared/errors';
import type {
  DocumentChunkRecord,
  VectorSearchHit,
  VectorStore,
} from '../models/index.js';
import { cosineSimilarity } from './mock-providers.js';

export interface QdrantHttpVectorStoreOptions {
  readonly baseUrl: string;
  readonly collectionName?: string;
  readonly apiKey?: string;
  readonly vectorSize?: number;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Deterministically maps a string chunkId (`chk_...`) to a valid UUIDv5-style string
 * accepted by Qdrant point IDs.
 */
export function chunkIdToQdrantPointUuid(chunkId: string): string {
  const hash = crypto.createHash('sha256').update(`qdrant:${chunkId}`, 'utf8').digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ].join('-');
}

interface QdrantSearchResponsePayload {
  readonly result?: ReadonlyArray<{
    readonly id: string | number;
    readonly score: number;
    readonly payload?: Record<string, unknown>;
  }>;
}

function stripEnvQuotes(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  return trimmed.replace(/^["']|["']$/g, '');
}

/**
 * Production Qdrant HTTP REST API (`v1`) adapter implementing `VectorStore`
 * and strictly enforcing Invariant #9:
 * "Vector retrieval is filtered by authenticated userId and document identity.
 * A result from another user must never be returned."
 */
export class QdrantHttpVectorStore implements VectorStore {
  private readonly baseUrl: string;
  private readonly collectionName: string;
  private readonly apiKey: string | undefined;
  private readonly defaultVectorSize: number;
  private readonly fetchImpl: typeof fetch;
  private ensuredDimension: number | null = null;

  constructor(options: QdrantHttpVectorStoreOptions) {
    const cleanUrl = stripEnvQuotes(options.baseUrl);
    if (!cleanUrl || cleanUrl.length === 0) {
      throw new AppError('INTERNAL_ERROR', 'QdrantHttpVectorStore requires a non-empty baseUrl');
    }
    this.baseUrl = cleanUrl.replace(/\/+$/, '');
    this.collectionName = stripEnvQuotes(options.collectionName) ?? 'kartik_document_chunks';
    this.apiKey = stripEnvQuotes(options.apiKey);
    this.defaultVectorSize = options.vectorSize ?? 768;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (this.apiKey && this.apiKey.trim().length > 0) {
      headers['api-key'] = this.apiKey;
    }
    return headers;
  }

  private async ensurePayloadIndexes(): Promise<void> {
    const indexUrl = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/index?wait=true`;
    for (const fieldName of ['userId', 'fileId'] as const) {
      await this.fetchImpl(indexUrl, {
        method: 'PUT',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          field_name: fieldName,
          field_schema: 'keyword',
        }),
      }).catch(() => undefined);
    }
  }

  private async ensureCollection(vectorSize: number): Promise<void> {
    const dim = Math.max(1, vectorSize || this.defaultVectorSize);
    if (this.ensuredDimension === dim) {
      return;
    }

    const collectionUrl = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}`;
    const getResp = await this.fetchImpl(collectionUrl, {
      method: 'GET',
      headers: this.buildHeaders(),
    });

    let needsCreate = getResp.status === 404;
    if (getResp.ok) {
      try {
        const info = (await getResp.json()) as {
          readonly result?: {
            readonly config?: {
              readonly params?: {
                readonly vectors?: { readonly size?: number };
              };
            };
          };
        };
        const existingSize = info.result?.config?.params?.vectors?.size;
        if (typeof existingSize === 'number' && existingSize !== dim) {
          await this.fetchImpl(collectionUrl, {
            method: 'DELETE',
            headers: this.buildHeaders(),
          });
          needsCreate = true;
        }
      } catch {
        // Ignore JSON inspection error on mock responses that return minimal JSON
      }
    } else if (getResp.status !== 404) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Failed to inspect Qdrant collection "${this.collectionName}" (HTTP ${getResp.status})`,
      );
    }

    if (needsCreate) {
      const createResp = await this.fetchImpl(collectionUrl, {
        method: 'PUT',
        headers: this.buildHeaders(),
        body: JSON.stringify({
          vectors: {
            size: dim,
            distance: 'Cosine',
          },
        }),
      });
      if (!createResp.ok && createResp.status !== 409) {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          `Failed to create Qdrant collection "${this.collectionName}" (HTTP ${createResp.status})`,
        );
      }
      await this.ensurePayloadIndexes();
    }

    this.ensuredDimension = dim;
  }

  public async upsertChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    if (chunks.length === 0) {
      return;
    }

    for (const chunk of chunks) {
      if (!chunk.userId || !chunk.fileId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Every vector chunk must carry an authenticated userId and fileId (Invariant #9)',
        );
      }
    }

    const firstDim = chunks[0]?.embeddingVector.length ?? this.defaultVectorSize;
    await this.ensureCollection(firstDim);

    const points = chunks.map((chunk) => ({
      id: chunkIdToQdrantPointUuid(chunk.chunkId),
      vector: [...chunk.embeddingVector],
      payload: {
        chunkId: chunk.chunkId,
        fileId: chunk.fileId,
        userId: chunk.userId,
        documentTitle: chunk.documentTitle,
        pageNumber: chunk.pageNumber,
        chunkIndex: chunk.chunkIndex,
        textContent: chunk.textContent,
        createdAt: chunk.createdAt,
      },
    }));

    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/points?wait=true`;
    const response = await this.fetchImpl(url, {
      method: 'PUT',
      headers: this.buildHeaders(),
      body: JSON.stringify({ points }),
    });

    if (!response.ok) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Qdrant points upsert failed with HTTP ${response.status}`,
      );
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

    await this.ensureCollection(input.queryVector.length || this.defaultVectorSize);

    const mustClauses: Array<Record<string, unknown>> = [
      {
        key: 'userId',
        match: { value: input.userId },
      },
    ];

    if (input.fileIds && input.fileIds.length > 0) {
      mustClauses.push({
        key: 'fileId',
        match: { any: [...input.fileIds] },
      });
    }

    const topK = Math.max(1, Math.min(input.topK ?? 5, 20));
    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/points/search`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        vector: [...input.queryVector],
        limit: topK,
        with_payload: true,
        filter: {
          must: mustClauses,
        },
      }),
    });

    if (!response.ok) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Qdrant vector search failed with HTTP ${response.status}`,
      );
    }

    const body = (await response.json()) as QdrantSearchResponsePayload;
    const rawHits = body.result ?? [];
    const allowedFiles =
      input.fileIds && input.fileIds.length > 0 ? new Set(input.fileIds) : null;

    const hits: VectorSearchHit[] = [];
    for (const item of rawHits) {
      const payload = item.payload ?? {};
      const payloadUserId = typeof payload['userId'] === 'string' ? payload['userId'] : '';
      const payloadFileId = typeof payload['fileId'] === 'string' ? payload['fileId'] : '';

      // Defense-in-depth post-filter enforcing Invariant #9 even if upstream filter is misconfigured
      if (payloadUserId !== input.userId) {
        continue;
      }
      if (allowedFiles && !allowedFiles.has(payloadFileId)) {
        continue;
      }

      hits.push({
        chunkId:
          typeof payload['chunkId'] === 'string' ? payload['chunkId'] : String(item.id),
        fileId: payloadFileId,
        userId: payloadUserId,
        documentTitle:
          typeof payload['documentTitle'] === 'string'
            ? payload['documentTitle']
            : 'Document',
        pageNumber:
          typeof payload['pageNumber'] === 'number' ? payload['pageNumber'] : 1,
        textContent:
          typeof payload['textContent'] === 'string' ? payload['textContent'] : '',
        score: typeof item.score === 'number' ? item.score : 0,
      });
    }

    return Object.freeze(hits);
  }

  public async deleteByFileIds(input: {
    readonly userId: string;
    readonly fileIds: readonly string[];
  }): Promise<number> {
    if (input.fileIds.length === 0) {
      return 0;
    }
    await this.ensureCollection(this.defaultVectorSize);

    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/points/delete?wait=true`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        filter: {
          must: [
            { key: 'userId', match: { value: input.userId } },
            { key: 'fileId', match: { any: [...input.fileIds] } },
          ],
        },
      }),
    });

    if (!response.ok) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Qdrant deleteByFileIds failed with HTTP ${response.status}`,
      );
    }

    return input.fileIds.length;
  }

  public async deleteByUserId(userId: string): Promise<number> {
    if (!userId || userId.trim().length === 0) {
      return 0;
    }
    await this.ensureCollection(this.defaultVectorSize);

    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/points/delete?wait=true`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        filter: {
          must: [{ key: 'userId', match: { value: userId } }],
        },
      }),
    });

    if (!response.ok) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Qdrant deleteByUserId failed with HTTP ${response.status}`,
      );
    }

    return 1;
  }
}

/**
 * Durable local-disk VectorStore persisting embedded chunks to a JSON file on disk
 * while enforcing Invariant #9 (`userId` + `fileIds` tenant isolation).
 */
export class PersistentDiskVectorStore implements VectorStore {
  private readonly storageFilePath: string;
  private loaded = false;
  private readonly chunks = new Map<string, DocumentChunkRecord>();

  constructor(options?: { readonly storageFilePath?: string }) {
    this.storageFilePath = path.resolve(
      options?.storageFilePath ??
        path.join(os.tmpdir(), 'kartik-ai-storage', 'qdrant-vectors.json'),
    );
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.storageFilePath, 'utf8');
      const parsed = JSON.parse(raw) as DocumentChunkRecord[];
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item.chunkId === 'string' && item.userId && item.fileId) {
            this.chunks.set(item.chunkId, item);
          }
        }
      }
    } catch {
      // File does not exist yet; initialized empty.
    }
  }

  private async flushToDisk(): Promise<void> {
    await fs.mkdir(path.dirname(this.storageFilePath), { recursive: true });
    const serialized = JSON.stringify(Array.from(this.chunks.values()));
    await fs.writeFile(this.storageFilePath, serialized, 'utf8');
  }

  public async upsertChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    await this.ensureLoaded();
    for (const chunk of chunks) {
      if (!chunk.userId || !chunk.fileId) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Every vector chunk must carry an authenticated userId and fileId',
        );
      }
      this.chunks.set(chunk.chunkId, chunk);
    }
    await this.flushToDisk();
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
    await this.ensureLoaded();

    const allowedFiles =
      input.fileIds && input.fileIds.length > 0 ? new Set(input.fileIds) : null;
    const topK = Math.max(1, Math.min(input.topK ?? 5, 20));

    const hits: VectorSearchHit[] = [];
    for (const chunk of this.chunks.values()) {
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
    await this.ensureLoaded();
    const fileIdSet = new Set(input.fileIds);
    let deleted = 0;
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.userId === input.userId && fileIdSet.has(chunk.fileId)) {
        this.chunks.delete(chunkId);
        deleted += 1;
      }
    }
    if (deleted > 0) {
      await this.flushToDisk();
    }
    return deleted;
  }

  public async deleteByUserId(userId: string): Promise<number> {
    await this.ensureLoaded();
    let deleted = 0;
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.userId === userId) {
        this.chunks.delete(chunkId);
        deleted += 1;
      }
    }
    if (deleted > 0) {
      await this.flushToDisk();
    }
    return deleted;
  }
}

/**
 * Resilient Qdrant adapter that routes vector operations to `QdrantHttpVectorStore`
 * when a Qdrant server is reachable and transparently mirrors/falls back to
 * `PersistentDiskVectorStore` when Qdrant is unreachable.
 */
export class ResilientQdrantVectorStore implements VectorStore {
  private readonly primary: QdrantHttpVectorStore;
  private readonly fallback: PersistentDiskVectorStore;
  private primaryHealthy = true;

  constructor(options: {
    readonly qdrantUrl: string;
    readonly collectionName?: string;
    readonly apiKey?: string;
    readonly storageFilePath?: string;
    readonly fetchImpl?: typeof fetch;
  }) {
    this.primary = new QdrantHttpVectorStore({
      baseUrl: options.qdrantUrl,
      ...(options.collectionName ? { collectionName: options.collectionName } : {}),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.fallback = new PersistentDiskVectorStore(
      options.storageFilePath ? { storageFilePath: options.storageFilePath } : undefined,
    );
  }

  public async upsertChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    await this.fallback.upsertChunks(chunks);
    if (this.primaryHealthy) {
      try {
        await this.primary.upsertChunks(chunks);
      } catch {
        this.primaryHealthy = false;
      }
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
    if (this.primaryHealthy) {
      try {
        return await this.primary.searchChunks(input);
      } catch {
        this.primaryHealthy = false;
      }
    }
    return this.fallback.searchChunks(input);
  }

  public async deleteByFileIds(input: {
    readonly userId: string;
    readonly fileIds: readonly string[];
  }): Promise<number> {
    const fallbackDeleted = await this.fallback.deleteByFileIds(input);
    if (this.primaryHealthy) {
      try {
        await this.primary.deleteByFileIds(input);
      } catch {
        this.primaryHealthy = false;
      }
    }
    return fallbackDeleted;
  }

  public async deleteByUserId(userId: string): Promise<number> {
    const fallbackDeleted = await this.fallback.deleteByUserId(userId);
    if (this.primaryHealthy) {
      try {
        await this.primary.deleteByUserId(userId);
      } catch {
        this.primaryHealthy = false;
      }
    }
    return fallbackDeleted;
  }
}

export function createVectorStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): VectorStore {
  const qdrantUrl = stripEnvQuotes(env.QDRANT_URL);
  const collectionName = stripEnvQuotes(env.QDRANT_COLLECTION);
  const apiKey = stripEnvQuotes(env.QDRANT_API_KEY);
  const storageFilePath = stripEnvQuotes(env.QDRANT_STORAGE_FILE);

  if (qdrantUrl && qdrantUrl.length > 0) {
    return new ResilientQdrantVectorStore({
      qdrantUrl,
      ...(collectionName ? { collectionName } : {}),
      ...(apiKey ? { apiKey } : {}),
      ...(storageFilePath ? { storageFilePath } : {}),
    });
  }

  return new PersistentDiskVectorStore(
    storageFilePath ? { storageFilePath } : undefined,
  );
}
