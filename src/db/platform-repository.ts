import { and, desc, eq } from 'drizzle-orm';
import type {
  ArtifactRecord,
  CodingArtifactFile,
  DocumentChunkRecord,
  UploadedFileRecord,
} from '../../backend/services/agent/src/index.js';
import {
  InMemoryAgentRepository,
  type AgentRepository,
} from '../../backend/services/agent/src/repositories/index.js';
import { AppError } from '../../backend/shared/errors/index.js';
import {
  InMemoryObjectStorage,
  type ObjectStorage,
  type PutPrivateObjectInput,
  type SignedDownloadUrlResult,
  type SignedUrlIssueOptions,
  type StoredPrivateObjectMetadata,
} from '../../backend/shared/storage/index.js';
import { db } from './index.ts';
import {
  artifacts,
  conversations,
  creditLedgerEntries,
  messages,
  paymentOrders,
  privateObjects,
  uploadedFiles,
  users,
} from './schema.ts';
import { getOrCreateUser } from './users.ts';

function isCloudSqlConfigured(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  const hasCloudSql = Boolean(
    process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME,
  );
  const hasDatabaseUrl = Boolean(process.env.DATABASE_URL?.trim());
  return hasCloudSql || hasDatabaseUrl;
}

/**
 * Drizzle ORM + Cloud SQL PostgreSQL repository for `AgentRepository` (`uploaded_files` & `artifacts`)
 * with an automatic mirror in `InMemoryAgentRepository` for instant reads and unit-test safety.
 * Follows `cloudsql-setup` 5.3: uses Drizzle query builders wrapped in sanitized `try/catch`.
 */
export class DrizzleCloudSqlAgentRepository implements AgentRepository {
  private readonly cache = new InMemoryAgentRepository();

  private async ensureUserRow(userId: string): Promise<void> {
    if (!isCloudSqlConfigured()) {
      return;
    }
    await getOrCreateUser(userId, `${userId}@kartik.ai`, 'Kartik Rawat', null);
  }

  public async saveFile(file: UploadedFileRecord): Promise<void> {
    await this.cache.saveFile(file);
    if (!isCloudSqlConfigured()) {
      return;
    }
    try {
      await this.ensureUserRow(file.userId);
      const parts = file.storageKey.split('/');
      const convId = parts[2] ?? 'conv_welcome_01';
      await db
        .insert(uploadedFiles)
        .values({
          fileId: file.fileId,
          userUid: file.userId,
          conversationId: convId,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          storageKey: file.storageKey,
          sha256Hex: file.sha256Hex,
          pageCount: file.pageCount,
          chunkCount: file.chunkCount,
          status: file.status,
          createdAt: new Date(file.createdAt),
        })
        .onConflictDoUpdate({
          target: uploadedFiles.fileId,
          set: {
            chunkCount: file.chunkCount,
            status: file.status,
          },
        });
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async getFileById(
    userId: string,
    fileId: string,
  ): Promise<UploadedFileRecord | null> {
    const cached = await this.cache.getFileById(userId, fileId);
    if (cached) {
      return cached;
    }
    if (!isCloudSqlConfigured()) {
      return null;
    }
    try {
      const rows = await db
        .select()
        .from(uploadedFiles)
        .where(
          and(
            eq(uploadedFiles.fileId, fileId),
            eq(uploadedFiles.userUid, userId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row || row.status === 'deleted') {
        return null;
      }
      const mapped: UploadedFileRecord = Object.freeze({
        fileId: row.fileId,
        userId: row.userUid,
        originalFilename: row.originalFilename,
        mimeType: row.mimeType as UploadedFileRecord['mimeType'],
        sizeBytes: row.sizeBytes,
        storageKey: row.storageKey,
        sha256Hex: row.sha256Hex,
        pageCount: row.pageCount,
        chunkCount: row.chunkCount,
        status: row.status as UploadedFileRecord['status'],
        createdAt: row.createdAt.toISOString(),
      });
      await this.cache.saveFile(mapped);
      return mapped;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async listFilesByUser(
    userId: string,
  ): Promise<readonly UploadedFileRecord[]> {
    if (!isCloudSqlConfigured()) {
      return this.cache.listFilesByUser(userId);
    }
    try {
      const rows = await db
        .select()
        .from(uploadedFiles)
        .where(eq(uploadedFiles.userUid, userId))
        .orderBy(desc(uploadedFiles.createdAt));
      const list: UploadedFileRecord[] = [];
      for (const row of rows) {
        if (row.status === 'deleted') {
          continue;
        }
        const item: UploadedFileRecord = Object.freeze({
          fileId: row.fileId,
          userId: row.userUid,
          originalFilename: row.originalFilename,
          mimeType: row.mimeType as UploadedFileRecord['mimeType'],
          sizeBytes: row.sizeBytes,
          storageKey: row.storageKey,
          sha256Hex: row.sha256Hex,
          pageCount: row.pageCount,
          chunkCount: row.chunkCount,
          status: row.status as UploadedFileRecord['status'],
          createdAt: row.createdAt.toISOString(),
        });
        await this.cache.saveFile(item);
        list.push(item);
      }
      return list.length > 0 ? Object.freeze(list) : this.cache.listFilesByUser(userId);
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async saveArtifact(artifact: ArtifactRecord): Promise<void> {
    await this.cache.saveArtifact(artifact);
    if (!isCloudSqlConfigured()) {
      return;
    }
    try {
      await this.ensureUserRow(artifact.userId);
      await db
        .insert(artifacts)
        .values({
          artifactId: artifact.artifactId,
          userUid: artifact.userId,
          requestId: artifact.requestId,
          conversationId: artifact.conversationId,
          artifactType: artifact.artifactType,
          title: artifact.title,
          entryFile: artifact.entryFile,
          storageKey: artifact.storageKey,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes,
          filesManifestJson: artifact.filesManifest,
          createdAt: new Date(artifact.createdAt),
        })
        .onConflictDoNothing();
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async getArtifactById(
    userId: string,
    artifactId: string,
  ): Promise<ArtifactRecord | null> {
    const cached = await this.cache.getArtifactById(userId, artifactId);
    if (cached) {
      return cached;
    }
    if (!isCloudSqlConfigured()) {
      return null;
    }
    try {
      const rows = await db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.artifactId, artifactId),
            eq(artifacts.userUid, userId),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      const mapped: ArtifactRecord = Object.freeze({
        artifactId: row.artifactId,
        userId: row.userUid,
        requestId: row.requestId,
        conversationId: row.conversationId,
        artifactType: row.artifactType as ArtifactRecord['artifactType'],
        title: row.title,
        entryFile: row.entryFile,
        storageKey: row.storageKey,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        filesManifest: Object.freeze(
          Array.isArray(row.filesManifestJson)
            ? (row.filesManifestJson as CodingArtifactFile[])
            : [],
        ),
        createdAt: row.createdAt.toISOString(),
      });
      await this.cache.saveArtifact(mapped);
      return mapped;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async getArtifactByRequestId(
    userId: string,
    requestId: string,
  ): Promise<ArtifactRecord | null> {
    const cached = await this.cache.getArtifactByRequestId(userId, requestId);
    if (cached) {
      return cached;
    }
    if (!isCloudSqlConfigured()) {
      return null;
    }
    try {
      const rows = await db
        .select()
        .from(artifacts)
        .where(
          and(eq(artifacts.requestId, requestId), eq(artifacts.userUid, userId)),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      const mapped: ArtifactRecord = Object.freeze({
        artifactId: row.artifactId,
        userId: row.userUid,
        requestId: row.requestId,
        conversationId: row.conversationId,
        artifactType: row.artifactType as ArtifactRecord['artifactType'],
        title: row.title,
        entryFile: row.entryFile,
        storageKey: row.storageKey,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        filesManifest: Object.freeze(
          Array.isArray(row.filesManifestJson)
            ? (row.filesManifestJson as CodingArtifactFile[])
            : [],
        ),
        createdAt: row.createdAt.toISOString(),
      });
      await this.cache.saveArtifact(mapped);
      return mapped;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async listArtifactsByConversation(
    userId: string,
    conversationId: string,
  ): Promise<readonly ArtifactRecord[]> {
    const cached = await this.cache.listArtifactsByConversation(
      userId,
      conversationId,
    );
    if (!isCloudSqlConfigured()) {
      return cached;
    }
    try {
      const rows = await db
        .select()
        .from(artifacts)
        .where(
          and(
            eq(artifacts.userUid, userId),
            eq(artifacts.conversationId, conversationId),
          ),
        )
        .orderBy(desc(artifacts.createdAt));
      const list: ArtifactRecord[] = rows.map((row) =>
        Object.freeze({
          artifactId: row.artifactId,
          userId: row.userUid,
          requestId: row.requestId,
          conversationId: row.conversationId,
          artifactType: row.artifactType as ArtifactRecord['artifactType'],
          title: row.title,
          entryFile: row.entryFile,
          storageKey: row.storageKey,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
          filesManifest: Object.freeze(
            Array.isArray(row.filesManifestJson)
              ? (row.filesManifestJson as CodingArtifactFile[])
              : [],
          ),
          createdAt: row.createdAt.toISOString(),
        }),
      );
      return list.length > 0 ? Object.freeze(list) : cached;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async saveDocumentChunks(
    chunks: readonly DocumentChunkRecord[],
  ): Promise<void> {
    await this.cache.saveDocumentChunks(chunks);
  }

  public async deleteFileMetadata(
    userId: string,
    fileId: string,
  ): Promise<boolean> {
    const deletedCache = await this.cache.deleteFileMetadata(userId, fileId);
    if (!isCloudSqlConfigured()) {
      return deletedCache;
    }
    try {
      const deletedRows = await db
        .delete(uploadedFiles)
        .where(
          and(
            eq(uploadedFiles.fileId, fileId),
            eq(uploadedFiles.userUid, userId),
          ),
        )
        .returning({ fileId: uploadedFiles.fileId });
      return deletedCache || deletedRows.length > 0;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async deleteArtifactMetadata(
    userId: string,
    artifactId: string,
  ): Promise<boolean> {
    const deletedCache = await this.cache.deleteArtifactMetadata(
      userId,
      artifactId,
    );
    if (!isCloudSqlConfigured()) {
      return deletedCache;
    }
    try {
      const deletedRows = await db
        .delete(artifacts)
        .where(
          and(
            eq(artifacts.artifactId, artifactId),
            eq(artifacts.userUid, userId),
          ),
        )
        .returning({ artifactId: artifacts.artifactId });
      return deletedCache || deletedRows.length > 0;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }
}

export async function syncPlatformConversationToCloudSql(input: {
  readonly conversationId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly title: string;
  readonly deletionState: 'active' | 'deleted';
  readonly messageCount: number;
}): Promise<void> {
  if (!isCloudSqlConfigured()) {
    return;
  }
  try {
    await getOrCreateUser(
      input.userId,
      input.email,
      input.displayName,
      null,
    );
    await db
      .insert(conversations)
      .values({
        conversationId: input.conversationId,
        userUid: input.userId,
        title: input.title,
        deletionState: input.deletionState,
        messageCount: input.messageCount,
      })
      .onConflictDoUpdate({
        target: conversations.conversationId,
        set: {
          title: input.title,
          deletionState: input.deletionState,
          messageCount: input.messageCount,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function syncPlatformMessageToCloudSql(input: {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly agentUsed?: string;
  readonly requestId?: string;
  readonly creditsCharged?: number;
  readonly idempotentReplay?: boolean;
  readonly citationsJson?: unknown;
  readonly searchImagesJson?: unknown;
  readonly artifactIdsJson?: unknown;
  readonly attachedFileIdsJson?: unknown;
}): Promise<void> {
  if (!isCloudSqlConfigured()) {
    return;
  }
  try {
    await db
      .insert(messages)
      .values({
        messageId: input.messageId,
        conversationId: input.conversationId,
        userUid: input.userId,
        role: input.role,
        content: input.content,
        agentUsed: input.agentUsed ?? null,
        requestId: input.requestId ?? null,
        creditsCharged: input.creditsCharged ?? 0,
        idempotentReplay: input.idempotentReplay ?? false,
        citationsJson: input.citationsJson ?? [],
        searchImagesJson: input.searchImagesJson ?? [],
        artifactIdsJson: input.artifactIdsJson ?? [],
        attachedFileIdsJson: input.attachedFileIdsJson ?? [],
      })
      .onConflictDoNothing();
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function syncPlatformBillingLedgerToCloudSql(input: {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly planId: string;
  readonly availableCredits: number;
  readonly entryId: string;
  readonly requestId: string;
  readonly description: string;
  readonly deltaCredits: number;
  readonly balanceAfter: number;
}): Promise<void> {
  if (!isCloudSqlConfigured()) {
    return;
  }
  try {
    await getOrCreateUser(input.userId, input.email, input.displayName, null);
    await db
      .update(users)
      .set({
        planId: input.planId,
        availableCredits: input.availableCredits,
        updatedAt: new Date(),
      })
      .where(eq(users.uid, input.userId));

    await db
      .insert(creditLedgerEntries)
      .values({
        entryId: input.entryId,
        userUid: input.userId,
        requestId: input.requestId,
        description: input.description,
        deltaCredits: input.deltaCredits,
        balanceAfter: input.balanceAfter,
      })
      .onConflictDoNothing();
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function syncPlatformPaymentOrderToCloudSql(input: {
  readonly orderId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly planId: string;
  readonly requestId: string;
  readonly amountPaise: number;
  readonly creditsGranted: number;
  readonly paymentId?: string | null;
  readonly settled: boolean;
}): Promise<void> {
  if (!isCloudSqlConfigured()) {
    return;
  }
  try {
    await getOrCreateUser(input.userId, input.email, input.displayName, null);
    await db
      .insert(paymentOrders)
      .values({
        orderId: input.orderId,
        userUid: input.userId,
        planId: input.planId,
        requestId: input.requestId,
        amountPaise: input.amountPaise,
        creditsGranted: input.creditsGranted,
        paymentId: input.paymentId ?? null,
        settled: input.settled,
      })
      .onConflictDoUpdate({
        target: paymentOrders.orderId,
        set: {
          paymentId: input.paymentId ?? null,
          settled: input.settled,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

/**
 * Drizzle ORM + Cloud SQL PostgreSQL (`asia-south1`) implementation of `ObjectStorage`.
 * Persists uploaded PDFs/images and generated `.pdf`/`.pptx`/`.png`/code artifacts directly
 * in the `private_objects` PostgreSQL table while mirroring in `InMemoryObjectStorage` for
 * instant sub-millisecond reads and enforcing Invariants #10 & #20 (`404 NOT_FOUND` on foreign objects).
 */
export class DrizzleCloudSqlObjectStorage implements ObjectStorage {
  private readonly cache = new InMemoryObjectStorage();

  public async putPrivateObject(
    input: PutPrivateObjectInput,
  ): Promise<StoredPrivateObjectMetadata> {
    const metadata = await this.cache.putPrivateObject(input);
    if (!isCloudSqlConfigured()) {
      return metadata;
    }
    try {
      await getOrCreateUser(
        input.ownerUserId,
        `${input.ownerUserId}@kartik.ai`,
        'Kartik Rawat',
        null,
      );
      const contentBase64 = Buffer.from(input.body).toString('base64');
      await db
        .insert(privateObjects)
        .values({
          storageKey: input.key,
          ownerUserUid: input.ownerUserId,
          mimeType: input.mimeType,
          sizeBytes: input.body.byteLength,
          sha256Hex: input.sha256,
          contentBase64,
          createdAt: new Date(metadata.createdAt),
        })
        .onConflictDoUpdate({
          target: privateObjects.storageKey,
          set: {
            mimeType: input.mimeType,
            sizeBytes: input.body.byteLength,
            sha256Hex: input.sha256,
            contentBase64,
          },
        });
      return metadata;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async headPrivateObject(
    key: string,
    requesterUserId: string,
  ): Promise<StoredPrivateObjectMetadata> {
    try {
      return await this.cache.headPrivateObject(key, requesterUserId);
    } catch (err) {
      if (!isCloudSqlConfigured()) {
        throw err;
      }
    }
    try {
      const rows = await db
        .select({
          storageKey: privateObjects.storageKey,
          ownerUserUid: privateObjects.ownerUserUid,
          mimeType: privateObjects.mimeType,
          sizeBytes: privateObjects.sizeBytes,
          sha256Hex: privateObjects.sha256Hex,
          createdAt: privateObjects.createdAt,
        })
        .from(privateObjects)
        .where(eq(privateObjects.storageKey, key))
        .limit(1);
      const row = rows[0];
      if (!row || row.ownerUserUid !== requesterUserId) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      return Object.freeze({
        key: row.storageKey,
        ownerUserId: row.ownerUserUid,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256Hex,
        createdAt: row.createdAt.toISOString(),
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async getPrivateObject(
    key: string,
    requesterUserId: string,
  ): Promise<{
    readonly metadata: StoredPrivateObjectMetadata;
    readonly body: Uint8Array;
  }> {
    try {
      return await this.cache.getPrivateObject(key, requesterUserId);
    } catch (err) {
      if (!isCloudSqlConfigured()) {
        throw err;
      }
    }
    try {
      const rows = await db
        .select()
        .from(privateObjects)
        .where(eq(privateObjects.storageKey, key))
        .limit(1);
      const row = rows[0];
      if (!row || row.ownerUserUid !== requesterUserId) {
        throw new AppError('NOT_FOUND', 'Requested object was not found');
      }
      const body = new Uint8Array(Buffer.from(row.contentBase64, 'base64'));
      const metadata: StoredPrivateObjectMetadata = Object.freeze({
        key: row.storageKey,
        ownerUserId: row.ownerUserUid,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        sha256: row.sha256Hex,
        createdAt: row.createdAt.toISOString(),
      });
      await this.cache.putPrivateObject({
        key: row.storageKey,
        ownerUserId: row.ownerUserUid,
        mimeType: row.mimeType,
        body,
        sha256: row.sha256Hex,
      });
      return Object.freeze({ metadata, body });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }

  public async createSignedDownloadUrl(
    options: SignedUrlIssueOptions,
  ): Promise<SignedDownloadUrlResult> {
    await this.headPrivateObject(options.key, options.requesterUserId);
    return this.cache.createSignedDownloadUrl(options);
  }

  public async deletePrivateObject(
    key: string,
    ownerUserId: string,
  ): Promise<boolean> {
    const deletedCache = await this.cache.deletePrivateObject(key, ownerUserId);
    if (!isCloudSqlConfigured()) {
      return deletedCache;
    }
    try {
      await db
        .delete(privateObjects)
        .where(
          and(
            eq(privateObjects.storageKey, key),
            eq(privateObjects.ownerUserUid, ownerUserId),
          ),
        );
      return true;
    } catch (error) {
      throw new Error('Database query failed. Please try again later.', {
        cause: error,
      });
    }
  }
}

