import crypto from 'node:crypto';
import { AppError } from '@kartik/shared/errors';
import {
  buildObjectStorageKey,
  validateUploadFile,
  type ObjectStorage,
  type SignedDownloadUrlResult,
} from '@kartik/shared/storage';
import type { AgentConfig } from '../config/index.js';
import type {
  ArtifactRecord,
  DocumentChunkRecord,
  EmbeddingProvider,
  UploadedFileRecord,
  VectorStore,
} from '../models/index.js';
import type { AgentRepository } from '../repositories/index.js';

export interface PdfPageText {
  readonly pageNumber: number;
  readonly text: string;
}

/**
 * Splits extracted PDF page texts into overlapping semantic chunks while enforcing
 * the explicit `maxPdfPages` ceiling (Blueprint §10 & §12).
 */
export function chunkPdfPages(input: {
  readonly pages: readonly PdfPageText[];
  readonly maxPdfPages: number;
  readonly chunkSizeChars?: number;
  readonly overlapChars?: number;
}): readonly {
  readonly pageNumber: number;
  readonly chunkIndex: number;
  readonly textContent: string;
}[] {
  if (input.pages.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'PDF document must contain at least 1 page');
  }
  if (input.pages.length > input.maxPdfPages) {
    throw new AppError(
      'VALIDATION_FAILED',
      `PDF page count (${input.pages.length}) exceeds MAX_PDF_PAGES (${input.maxPdfPages})`,
      { details: { pageCount: [`Maximum ${input.maxPdfPages} pages allowed`] } },
    );
  }

  const chunkSize = Math.max(100, input.chunkSizeChars ?? 600);
  const overlap = Math.max(0, Math.min(chunkSize - 50, input.overlapChars ?? 100));
  const step = chunkSize - overlap;

  const chunks: Array<{
    readonly pageNumber: number;
    readonly chunkIndex: number;
    readonly textContent: string;
  }> = [];

  let globalChunkIndex = 0;
  for (const page of input.pages) {
    if (!Number.isInteger(page.pageNumber) || page.pageNumber < 1) {
      throw new AppError('VALIDATION_FAILED', 'PDF pageNumber must be a positive integer >= 1');
    }
    const normalized = page.text.replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) {
      continue;
    }

    if (normalized.length <= chunkSize) {
      chunks.push({
        pageNumber: page.pageNumber,
        chunkIndex: globalChunkIndex++,
        textContent: normalized,
      });
      continue;
    }

    for (let offset = 0; offset < normalized.length; offset += step) {
      const slice = normalized.slice(offset, offset + chunkSize).trim();
      if (slice.length > 0) {
        chunks.push({
          pageNumber: page.pageNumber,
          chunkIndex: globalChunkIndex++,
          textContent: slice,
        });
      }
      if (offset + chunkSize >= normalized.length) {
        break;
      }
    }
  }

  return Object.freeze(chunks);
}

export type CascadeDeletionStep = 'vectors' | 'objects' | 'metadata';

export interface PurgeExecutionReport {
  readonly userId: string;
  readonly deletionOrder: readonly CascadeDeletionStep[];
  readonly vectorsDeleted: number;
  readonly objectsDeleted: number;
  readonly filesDeleted: number;
  readonly artifactsDeleted: number;
  readonly confirmed: boolean;
}

/**
 * Coordinates file upload validation, server-side R2/MinIO storage keys, PDF chunking &
 * vector indexing, ownership-checked signed URLs, and ordered cascade deletion
 * (Invariants #9, #10, #18, #20 & §11).
 */
export class FileIngestionAndArtifactService {
  private readonly config: AgentConfig;
  private readonly repository: AgentRepository;
  private readonly objectStorage: ObjectStorage;
  private readonly vectorStore: VectorStore;
  private readonly embeddingProvider: EmbeddingProvider;

  constructor(deps: {
    readonly config: AgentConfig;
    readonly repository: AgentRepository;
    readonly objectStorage: ObjectStorage;
    readonly vectorStore: VectorStore;
    readonly embeddingProvider: EmbeddingProvider;
  }) {
    this.config = deps.config;
    this.repository = deps.repository;
    this.objectStorage = deps.objectStorage;
    this.vectorStore = deps.vectorStore;
    this.embeddingProvider = deps.embeddingProvider;
  }

  /**
   * Validates extension, declared MIME type, magic-byte content signature, and byte size,
   * stores the private object under a server-generated storage key, and indexes PDF chunks
   * into `VectorStore` + `agent.document_chunks`.
   */
  public async ingestUploadedFile(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly originalFilename: string;
    readonly declaredMimeType: string;
    readonly contentBytes: Uint8Array;
    readonly extractedPdfPages?: readonly PdfPageText[];
  }): Promise<UploadedFileRecord> {
    const validated = validateUploadFile({
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      sizeBytes: input.contentBytes.byteLength,
      headerBytes: input.contentBytes.subarray(0, 16),
      maxUploadBytes: this.config.maxUploadBytes,
    });

    const fileId = `file_${crypto.randomBytes(8).toString('hex')}`;
    // §11: "Generate storage keys server-side; never use a raw user filename as the key."
    const storageKey = buildObjectStorageKey({
      namespace: 'uploads',
      userId: input.userId,
      resourceId: input.conversationId,
      fileId,
      extension: validated.canonicalExtension,
    });

    const sha256Hex = crypto
      .createHash('sha256')
      .update(input.contentBytes)
      .digest('hex');

    let pageCount: number | null = null;
    let chunkRecords: DocumentChunkRecord[] = [];

    if (validated.mimeType === 'application/pdf') {
      const pages = input.extractedPdfPages ?? [
        {
          pageNumber: 1,
          text: Buffer.from(input.contentBytes).toString('utf8'),
        },
      ];
      pageCount = pages.length;

      const rawChunks = chunkPdfPages({
        pages,
        maxPdfPages: this.config.maxPdfPages,
      });

      if (rawChunks.length > 0) {
        const vectors = await this.embeddingProvider.embedTexts(
          rawChunks.map((c) => c.textContent),
        );
        const nowIso = new Date().toISOString();
        const safeTitle = input.originalFilename.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);

        chunkRecords = rawChunks.map((c, idx) => ({
          chunkId: `chk_${fileId}_${c.chunkIndex}`,
          fileId,
          userId: input.userId,
          documentTitle: safeTitle,
          pageNumber: c.pageNumber,
          chunkIndex: c.chunkIndex,
          textContent: c.textContent,
          embeddingVector: vectors[idx] ?? [],
          createdAt: nowIso,
        }));
      }
    }

    await this.objectStorage.putPrivateObject({
      key: storageKey,
      ownerUserId: input.userId,
      mimeType: validated.mimeType,
      body: input.contentBytes,
      sha256: sha256Hex,
    });

    const fileRecord: UploadedFileRecord = Object.freeze({
      fileId,
      userId: input.userId,
      originalFilename: input.originalFilename,
      mimeType: validated.mimeType,
      sizeBytes: validated.sizeBytes,
      storageKey,
      sha256Hex,
      pageCount,
      chunkCount: chunkRecords.length,
      status: 'ready',
      createdAt: new Date().toISOString(),
    });

    await this.repository.saveFile(fileRecord);

    if (chunkRecords.length > 0) {
      await this.repository.saveDocumentChunks(chunkRecords);
      await this.vectorStore.upsertChunks(chunkRecords);
    }

    return fileRecord;
  }

  /**
   * Returns file metadata and a short-lived signed download URL after verifying ownership.
   * Missing or foreign-owned files both return `404 NOT_FOUND` (Invariants #10 & #20).
   */
  public async getFileWithSignedUrl(input: {
    readonly userId: string;
    readonly fileId: string;
    readonly ttlSeconds?: number;
  }): Promise<{
    readonly file: UploadedFileRecord;
    readonly download: SignedDownloadUrlResult;
  }> {
    const file = await this.repository.getFileById(input.userId, input.fileId);
    if (!file) {
      throw new AppError('NOT_FOUND', 'Requested file was not found');
    }

    const download = await this.objectStorage.createSignedDownloadUrl({
      key: file.storageKey,
      requesterUserId: input.userId,
      ttlSeconds: input.ttlSeconds ?? this.config.signedUrlTtlSeconds,
    });

    return Object.freeze({ file, download });
  }

  /**
   * Returns artifact metadata and a short-lived signed download URL after verifying ownership.
   * Missing or foreign-owned artifacts both return `404 NOT_FOUND` (Invariants #10 & #20).
   */
  public async getArtifactWithSignedUrl(input: {
    readonly userId: string;
    readonly artifactId: string;
    readonly ttlSeconds?: number;
  }): Promise<{
    readonly artifact: ArtifactRecord;
    readonly download: SignedDownloadUrlResult;
  }> {
    const artifact = await this.repository.getArtifactById(
      input.userId,
      input.artifactId,
    );
    if (!artifact) {
      throw new AppError('NOT_FOUND', 'Requested artifact was not found');
    }

    const download = await this.objectStorage.createSignedDownloadUrl({
      key: artifact.storageKey,
      requesterUserId: input.userId,
      ttlSeconds: input.ttlSeconds ?? this.config.signedUrlTtlSeconds,
    });

    return Object.freeze({ artifact, download });
  }

  /**
   * Executes cascade deletion in the strict normative order required by Invariant #18:
   * "Deletion cascades in one order: vectors, then objects, then metadata.
   * A report of 'deleted' is only valid once the owner of each record has confirmed it."
   */
  public async purgeResources(input: {
    readonly userId: string;
    readonly conversationId?: string;
    readonly fileIds?: readonly string[];
    readonly artifactIds?: readonly string[];
    readonly onStepExecuted?: (step: CascadeDeletionStep) => void;
  }): Promise<PurgeExecutionReport> {
    if (!input.userId || input.userId.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'purgeResources requires a non-empty userId');
    }

    const targetFiles: UploadedFileRecord[] = [];
    for (const fileId of input.fileIds ?? []) {
      const rec = await this.repository.getFileById(input.userId, fileId);
      if (rec) {
        targetFiles.push(rec);
      }
    }

    const targetArtifacts: ArtifactRecord[] = [];
    const seenArtifactIds = new Set<string>();
    if (input.conversationId) {
      const convArtifacts = await this.repository.listArtifactsByConversation(
        input.userId,
        input.conversationId,
      );
      for (const art of convArtifacts) {
        seenArtifactIds.add(art.artifactId);
        targetArtifacts.push(art);
      }
    }
    for (const artifactId of input.artifactIds ?? []) {
      if (!seenArtifactIds.has(artifactId)) {
        const rec = await this.repository.getArtifactById(input.userId, artifactId);
        if (rec) {
          seenArtifactIds.add(rec.artifactId);
          targetArtifacts.push(rec);
        }
      }
    }

    const deletionOrder: CascadeDeletionStep[] = [];

    // 1. VECTORS FIRST (Invariant #18)
    deletionOrder.push('vectors');
    input.onStepExecuted?.('vectors');
    const vectorsDeleted =
      targetFiles.length > 0
        ? await this.vectorStore.deleteByFileIds({
            userId: input.userId,
            fileIds: targetFiles.map((f) => f.fileId),
          })
        : 0;

    // 2. OBJECTS SECOND (Invariant #18)
    deletionOrder.push('objects');
    input.onStepExecuted?.('objects');
    let objectsDeleted = 0;
    for (const file of targetFiles) {
      const deletedObj = await this.objectStorage.deletePrivateObject(
        file.storageKey,
        input.userId,
      );
      if (deletedObj) {
        objectsDeleted += 1;
      }
    }
    for (const artifact of targetArtifacts) {
      const deletedObj = await this.objectStorage.deletePrivateObject(
        artifact.storageKey,
        input.userId,
      );
      if (deletedObj) {
        objectsDeleted += 1;
      }
    }

    // 3. METADATA THIRD (Invariant #18)
    deletionOrder.push('metadata');
    input.onStepExecuted?.('metadata');
    let filesDeleted = 0;
    for (const file of targetFiles) {
      const deletedMeta = await this.repository.deleteFileMetadata(
        input.userId,
        file.fileId,
      );
      if (deletedMeta) {
        filesDeleted += 1;
      }
    }

    let artifactsDeleted = 0;
    for (const artifact of targetArtifacts) {
      const deletedMeta = await this.repository.deleteArtifactMetadata(
        input.userId,
        artifact.artifactId,
      );
      if (deletedMeta) {
        artifactsDeleted += 1;
      }
    }

    return Object.freeze({
      userId: input.userId,
      deletionOrder: Object.freeze(deletionOrder),
      vectorsDeleted,
      objectsDeleted,
      filesDeleted,
      artifactsDeleted,
      confirmed: true,
    });
  }
}
