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
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export interface QdrantCollectionHealth {
  readonly ok: boolean;
  readonly collectionName: string;
  readonly status?: string;
  readonly pointsCount?: number;
  readonly vectorSize?: number;
  readonly indexedFields?: readonly string[];
  readonly error?: string;
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

interface QdrantCollectionInspectPayload {
  readonly result?: {
    readonly status?: string;
    readonly points_count?: number;
    readonly config?: {
      readonly params?: {
        readonly vectors?: { readonly size?: number };
      };
    };
    readonly payload_schema?: Record<string, { readonly data_type?: string }>;
  };
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

const REQUIRED_TENANT_INDEX_FIELDS = ['userId', 'fileId'] as const;

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
  private readonly timeoutMs: number;
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
    this.timeoutMs = Math.max(1_000, options.timeoutMs ?? 15_000);
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

  private async qdrantFetch(url: string, init: RequestInit): Promise<Response> {
    const signal =
      init.signal ??
      (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(this.timeoutMs)
        : undefined);
    return this.fetchImpl(url, {
      ...init,
      headers: this.buildHeaders(),
      ...(signal ? { signal } : {}),
    });
  }

  private async ensurePayloadIndexes(
    fields: readonly ('userId' | 'fileId')[] = REQUIRED_TENANT_INDEX_FIELDS,
  ): Promise<void> {
    if (fields.length === 0) {
      return;
    }
    const indexUrl = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/index?wait=true`;
    for (const fieldName of fields) {
      await this.qdrantFetch(indexUrl, {
        method: 'PUT',
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
    const getResp = await this.qdrantFetch(collectionUrl, {
      method: 'GET',
    });

    let needsCreate = getResp.status === 404;
    let missingIndexes: Array<'userId' | 'fileId'> = [];

    if (getResp.ok) {
      try {
        const info = (await getResp.json()) as QdrantCollectionInspectPayload;
        const existingSize = info.result?.config?.params?.vectors?.size;
        const pointsCount = info.result?.points_count ?? 0;
        if (typeof existingSize === 'number' && existingSize !== dim) {
          if (pointsCount === 0) {
            await this.qdrantFetch(collectionUrl, { method: 'DELETE' });
            needsCreate = true;
          } else {
            throw new AppError(
              'VALIDATION_FAILED',
              `Qdrant collection "${this.collectionName}" has vector size ${existingSize} with ${pointsCount} stored points, but received ${dim}-dimensional vectors. Refusing destructive recreation.`,
            );
          }
        } else if (info.result?.payload_schema && typeof info.result.payload_schema === 'object') {
          // Qdrant Cloud strict mode requires keyword payload indexes on userId and fileId
          for (const fieldName of REQUIRED_TENANT_INDEX_FIELDS) {
            if (!info.result.payload_schema[fieldName]) {
              missingIndexes.push(fieldName);
            }
          }
        }
      } catch (err) {
        if (err instanceof AppError) {
          throw err;
        }
        // Ignore JSON inspection error on minimal mock responses
      }
    } else if (getResp.status !== 404) {
      throw new AppError(
        'PROVIDER_UNAVAILABLE',
        `Failed to inspect Qdrant collection "${this.collectionName}" (HTTP ${getResp.status})`,
      );
    }

    if (needsCreate) {
      const createResp = await this.qdrantFetch(collectionUrl, {
        method: 'PUT',
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
      await this.ensurePayloadIndexes(REQUIRED_TENANT_INDEX_FIELDS);
    } else if (missingIndexes.length > 0) {
      await this.ensurePayloadIndexes(missingIndexes);
    }

    this.ensuredDimension = dim;
  }

  /**
   * Non-mutating health check for the configured Qdrant collection.
   */
  public async checkHealth(): Promise<QdrantCollectionHealth> {
    try {
      const collectionUrl = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}`;
      const resp = await this.qdrantFetch(collectionUrl, { method: 'GET' });
      if (!resp.ok) {
        return {
          ok: false,
          collectionName: this.collectionName,
          error: `HTTP ${resp.status}`,
        };
      }
      const body = (await resp.json()) as QdrantCollectionInspectPayload;
      const result = body.result;
      return {
        ok: true,
        collectionName: this.collectionName,
        status: result?.status,
        pointsCount: result?.points_count ?? 0,
        vectorSize: result?.config?.params?.vectors?.size,
        indexedFields: result?.payload_schema ? Object.keys(result.payload_schema) : [],
      };
    } catch (err) {
      return {
        ok: false,
        collectionName: this.collectionName,
        error: err instanceof Error ? err.message : 'Qdrant health check failed',
      };
    }
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
    const response = await this.qdrantFetch(url, {
      method: 'PUT',
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

    const topK = Math.max(1, Math.min(input.topK ?? 5, 100));
    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/points/search`;
    const payloadBody = JSON.stringify({
      vector: [...input.queryVector],
      limit: topK,
      with_payload: true,
      filter: {
        must: mustClauses,
      },
    });

    let response = await this.qdrantFetch(url, {
      method: 'POST',
      body: payloadBody,
    });

    // Self-heal once if Qdrant Cloud strict mode reports a missing payload index
    if (response.status === 400) {
      const errText = await response.text().catch(() => '');
      if (errText.toLowerCase().includes('index required')) {
        await this.ensurePayloadIndexes(REQUIRED_TENANT_INDEX_FIELDS);
        response = await this.qdrantFetch(url, {
          method: 'POST',
          body: payloadBody,
        });
      } else {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          `Qdrant vector search failed with HTTP 400`,
        );
      }
    }

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

    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/points/delete?wait=true`;
    const payloadBody = JSON.stringify({
      filter: {
        must: [
          { key: 'userId', match: { value: input.userId } },
          { key: 'fileId', match: { any: [...input.fileIds] } },
        ],
      },
    });

    let response = await this.qdrantFetch(url, {
      method: 'POST',
      body: payloadBody,
    });

    if (response.status === 404) {
      return 0;
    }

    if (response.status === 400) {
      const errText = await response.text().catch(() => '');
      if (errText.toLowerCase().includes('index required')) {
        await this.ensurePayloadIndexes(REQUIRED_TENANT_INDEX_FIELDS);
        response = await this.qdrantFetch(url, {
          method: 'POST',
          body: payloadBody,
        });
      } else {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          `Qdrant deleteByFileIds failed with HTTP 400`,
        );
      }
    }

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

    const url = `${this.baseUrl}/collections/${encodeURIComponent(this.collectionName)}/points/delete?wait=true`;
    const payloadBody = JSON.stringify({
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
    });

    let response = await this.qdrantFetch(url, {
      method: 'POST',
      body: payloadBody,
    });

    if (response.status === 404) {
      return 0;
    }

    if (response.status === 400) {
      const errText = await response.text().catch(() => '');
      if (errText.toLowerCase().includes('index required')) {
        await this.ensurePayloadIndexes(REQUIRED_TENANT_INDEX_FIELDS);
        response = await this.qdrantFetch(url, {
          method: 'POST',
          body: payloadBody,
        });
      } else {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          `Qdrant deleteByUserId failed with HTTP 400`,
        );
      }
    }

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
    const topK = Math.max(1, Math.min(input.topK ?? 5, 100));

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
 * when a Qdrant server is reachable, transparently mirrors/falls back to
 * `PersistentDiskVectorStore` during transient outages, and automatically probes
 * Qdrant again after `retryCooldownMs` (default 30s).
 */
export class ResilientQdrantVectorStore implements VectorStore {
  private readonly primary: QdrantHttpVectorStore;
  private readonly fallback: PersistentDiskVectorStore;
  private readonly retryCooldownMs: number;
  private readonly nowFn: () => number;
  private primaryDegradedUntilMs = 0;

  constructor(options: {
    readonly qdrantUrl: string;
    readonly collectionName?: string;
    readonly apiKey?: string;
    readonly storageFilePath?: string;
    readonly retryCooldownMs?: number;
    readonly timeoutMs?: number;
    readonly nowFn?: () => number;
    readonly fetchImpl?: typeof fetch;
  }) {
    this.primary = new QdrantHttpVectorStore({
      baseUrl: options.qdrantUrl,
      ...(options.collectionName ? { collectionName: options.collectionName } : {}),
      ...(options.apiKey ? { apiKey: options.apiKey } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
    this.fallback = new PersistentDiskVectorStore(
      options.storageFilePath ? { storageFilePath: options.storageFilePath } : undefined,
    );
    this.retryCooldownMs = Math.max(0, options.retryCooldownMs ?? 30_000);
    this.nowFn = options.nowFn ?? Date.now;
  }

  private shouldUsePrimary(): boolean {
    return this.nowFn() >= this.primaryDegradedUntilMs;
  }

  private markPrimaryDegraded(operation: string, err: unknown): void {
    const wasHealthy = this.shouldUsePrimary();
    this.primaryDegradedUntilMs = this.nowFn() + this.retryCooldownMs;
    if (wasHealthy) {
      const msg = err instanceof Error ? err.message : 'Qdrant request failed';
      console.warn(
        `[kartik-qdrant] ${operation} failed (${msg}); falling back to local disk vector store for ${Math.round(this.retryCooldownMs / 1000)}s.`,
      );
    }
  }

  public async checkPrimaryHealth(): Promise<QdrantCollectionHealth> {
    return this.primary.checkHealth();
  }

  public async upsertChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    await this.fallback.upsertChunks(chunks);
    if (this.shouldUsePrimary()) {
      try {
        await this.primary.upsertChunks(chunks);
      } catch (err) {
        this.markPrimaryDegraded('upsertChunks', err);
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
    if (this.shouldUsePrimary()) {
      try {
        return await this.primary.searchChunks(input);
      } catch (err) {
        this.markPrimaryDegraded('searchChunks', err);
      }
    }
    return this.fallback.searchChunks(input);
  }

  public async deleteByFileIds(input: {
    readonly userId: string;
    readonly fileIds: readonly string[];
  }): Promise<number> {
    const fallbackDeleted = await this.fallback.deleteByFileIds(input);
    if (this.shouldUsePrimary()) {
      try {
        await this.primary.deleteByFileIds(input);
      } catch (err) {
        this.markPrimaryDegraded('deleteByFileIds', err);
      }
    }
    return fallbackDeleted;
  }

  public async deleteByUserId(userId: string): Promise<number> {
    const fallbackDeleted = await this.fallback.deleteByUserId(userId);
    if (this.shouldUsePrimary()) {
      try {
        await this.primary.deleteByUserId(userId);
      } catch (err) {
        this.markPrimaryDegraded('deleteByUserId', err);
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
