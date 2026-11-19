import { and, asc, desc, eq } from 'drizzle-orm';
import type {
  AgentCitation,
  ArtifactRecord,
  CodingArtifactFile,
  DocumentChunkRecord,
  SearchImageGalleryItem,
  UploadedFileRecord,
} from '../../backend/services/agent/src/index.js';
import {
  InMemoryAgentRepository,
  type AgentRepository,
} from '../../backend/services/agent/src/repositories/index.js';
import type { SpecialistAgentName } from '../../backend/shared/contracts/index.js';
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

function isPlaceholderDatabaseUrl(rawUrl: string): boolean {
  const normalized = rawUrl.trim().toLowerCase();
  return (
    normalized.includes('placeholder_password') ||
    normalized.includes('ep-example') ||
    normalized.includes('<your-endpoint>') ||
    normalized.includes('replace_me')
  );
}

export function isCloudSqlConfigured(): boolean {
  if (process.env.NODE_ENV === 'test') {
    return false;
  }
  const hasCloudSql = Boolean(
    process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME,
  );
  const rawDbUrl = process.env.DATABASE_URL?.trim() ?? '';
  const hasDatabaseUrl = Boolean(rawDbUrl && !isPlaceholderDatabaseUrl(rawDbUrl));
  return hasCloudSql || hasDatabaseUrl;
}

export interface PersistedUserProfileRecord {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly planId: 'plan_free' | 'plan_starter_199' | 'plan_pro_499';
  readonly availableCredits: number;
  readonly reservedCredits?: number;
}

export interface PersistedConversationRecord {
  readonly conversationId: string;
  readonly userId: string;
  readonly title: string;
  readonly deletionState: 'active' | 'deleted';
  readonly messageCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PersistedMessageRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly agentUsed?: SpecialistAgentName;
  readonly requestId?: string;
  readonly creditsCharged?: number;
  readonly idempotentReplay?: boolean;
  readonly citations: readonly AgentCitation[];
  readonly searchImages: readonly SearchImageGalleryItem[];
  readonly artifactIds: readonly string[];
  readonly attachedFileIds: readonly string[];
  readonly createdAt: string;
}

export interface PersistedLedgerRecord {
  readonly entryId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly description: string;
  readonly deltaCredits: number;
  readonly balanceAfter: number;
  readonly timestamp: string;
}

export interface PersistedPaymentOrderRecord {
  readonly orderId: string;
  readonly userId: string;
  readonly planId: string;
  readonly requestId: string;
  readonly amountPaise: number;
  readonly creditsGranted: number;
  readonly paymentId: string | null;
  readonly settled: boolean;
}

export interface PersistedPlatformUserSnapshot {
  readonly user: PersistedUserProfileRecord | null;
  readonly conversations: readonly PersistedConversationRecord[];
  readonly messages: readonly PersistedMessageRecord[];
  readonly ledgerEntries: readonly PersistedLedgerRecord[];
  readonly paymentOrders: readonly PersistedPaymentOrderRecord[];
  readonly artifacts: readonly ArtifactRecord[];
  readonly uploadedFiles: readonly UploadedFileRecord[];
}

export interface SyncConversationInput {
  readonly conversationId: string;
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly title: string;
  readonly deletionState: 'active' | 'deleted';
  readonly messageCount: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface SyncMessageInput {
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
  readonly createdAt?: string;
}

export interface SyncBillingLedgerInput {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly planId: string;
  readonly availableCredits: number;
  readonly reservedCredits?: number;
  readonly entryId: string;
  readonly requestId: string;
  readonly description: string;
  readonly deltaCredits: number;
  readonly balanceAfter: number;
  readonly timestamp?: string;
}

export interface SyncPaymentOrderInput {
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
}

export interface PlatformPersistenceAdapter {
  loadUserSnapshot(userId: string): Promise<PersistedPlatformUserSnapshot | null>;
  syncUser(input: {
    readonly userId: string;
    readonly email: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  }): Promise<void>;
  syncConversation(input: SyncConversationInput): Promise<void>;
  syncMessage(input: SyncMessageInput): Promise<void>;
  syncBillingLedger(input: SyncBillingLedgerInput): Promise<void>;
  syncPaymentOrder(input: SyncPaymentOrderInput): Promise<void>;
}

function normalizePlanId(
  raw: string | null | undefined,
): 'plan_free' | 'plan_starter_199' | 'plan_pro_499' {
  if (raw === 'plan_starter_199' || raw === 'plan_pro_499') {
    return raw;
  }
  return 'plan_free';
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
    await getOrCreateUser(userId, `${userId}@kartik.ai`, userId, null);
  }

  public async warmCacheFromSnapshot(snapshot: {
    readonly artifacts: readonly ArtifactRecord[];
    readonly uploadedFiles: readonly UploadedFileRecord[];
  }): Promise<void> {
    for (const file of snapshot.uploadedFiles) {
      await this.cache.saveFile(file);
    }
    for (const artifact of snapshot.artifacts) {
      await this.cache.saveArtifact(artifact);
    }
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
          setWhere: eq(uploadedFiles.userUid, file.userId),
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

export async function loadPlatformUserSnapshotFromCloudSql(
  userId: string,
): Promise<PersistedPlatformUserSnapshot | null> {
  if (!isCloudSqlConfigured()) {
    return null;
  }
  try {
    const [
      userRows,
      conversationRows,
      messageRows,
      ledgerRows,
      orderRows,
      artifactRows,
      fileRows,
    ] = await Promise.all([
      db.select().from(users).where(eq(users.uid, userId)).limit(1),
      db
        .select()
        .from(conversations)
        .where(eq(conversations.userUid, userId))
        .orderBy(desc(conversations.updatedAt)),
      db
        .select()
        .from(messages)
        .where(eq(messages.userUid, userId))
        .orderBy(asc(messages.createdAt)),
      db
        .select()
        .from(creditLedgerEntries)
        .where(eq(creditLedgerEntries.userUid, userId))
        .orderBy(desc(creditLedgerEntries.createdAt)),
      db
        .select()
        .from(paymentOrders)
        .where(eq(paymentOrders.userUid, userId))
        .orderBy(desc(paymentOrders.createdAt)),
      db
        .select()
        .from(artifacts)
        .where(eq(artifacts.userUid, userId))
        .orderBy(desc(artifacts.createdAt)),
      db
        .select()
        .from(uploadedFiles)
        .where(eq(uploadedFiles.userUid, userId))
        .orderBy(desc(uploadedFiles.createdAt)),
    ]);

    const userRow = userRows[0];
    if (
      !userRow &&
      conversationRows.length === 0 &&
      messageRows.length === 0 &&
      ledgerRows.length === 0 &&
      orderRows.length === 0
    ) {
      return null;
    }

    const mappedUser: PersistedUserProfileRecord | null = userRow
      ? Object.freeze({
          userId: userRow.uid,
          email: userRow.email,
          displayName: userRow.displayName,
          avatarUrl: userRow.avatarUrl,
          planId: normalizePlanId(userRow.planId),
          availableCredits: userRow.availableCredits,
          reservedCredits: userRow.reservedCredits,
        })
      : null;

    const mappedConversations: PersistedConversationRecord[] = conversationRows.map(
      (row) =>
        Object.freeze({
          conversationId: row.conversationId,
          userId: row.userUid,
          title: row.title,
          deletionState:
            row.deletionState === 'deleted' ? ('deleted' as const) : ('active' as const),
          messageCount: row.messageCount,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        }),
    );

    const mappedMessages: PersistedMessageRecord[] = messageRows.map((row) =>
      Object.freeze({
        messageId: row.messageId,
        conversationId: row.conversationId,
        userId: row.userUid,
        role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: row.content,
        agentUsed: (row.agentUsed ?? undefined) as SpecialistAgentName | undefined,
        requestId: row.requestId ?? undefined,
        creditsCharged: row.creditsCharged ?? 0,
        idempotentReplay: Boolean(row.idempotentReplay),
        citations: Array.isArray(row.citationsJson)
          ? (row.citationsJson as AgentCitation[])
          : [],
        searchImages: Array.isArray(row.searchImagesJson)
          ? (row.searchImagesJson as SearchImageGalleryItem[])
          : [],
        artifactIds: Array.isArray(row.artifactIdsJson)
          ? (row.artifactIdsJson as string[])
          : [],
        attachedFileIds: Array.isArray(row.attachedFileIdsJson)
          ? (row.attachedFileIdsJson as string[])
          : [],
        createdAt: row.createdAt.toISOString(),
      }),
    );

    const mappedLedger: PersistedLedgerRecord[] = ledgerRows.map((row) =>
      Object.freeze({
        entryId: row.entryId,
        userId: row.userUid,
        requestId: row.requestId,
        description: row.description,
        deltaCredits: row.deltaCredits,
        balanceAfter: row.balanceAfter,
        timestamp: row.createdAt.toISOString(),
      }),
    );

    const mappedOrders: PersistedPaymentOrderRecord[] = orderRows.map((row) =>
      Object.freeze({
        orderId: row.orderId,
        userId: row.userUid,
        planId: row.planId,
        requestId: row.requestId,
        amountPaise: row.amountPaise,
        creditsGranted: row.creditsGranted,
        paymentId: row.paymentId ?? null,
        settled: Boolean(row.settled),
      }),
    );

    const mappedArtifacts: ArtifactRecord[] = artifactRows.map((row) =>
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

    const mappedFiles: UploadedFileRecord[] = fileRows
      .filter((row) => row.status !== 'deleted')
      .map((row) =>
        Object.freeze({
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
        }),
      );

    return Object.freeze({
      user: mappedUser,
      conversations: Object.freeze(mappedConversations),
      messages: Object.freeze(mappedMessages),
      ledgerEntries: Object.freeze(mappedLedger),
      paymentOrders: Object.freeze(mappedOrders),
      artifacts: Object.freeze(mappedArtifacts),
      uploadedFiles: Object.freeze(mappedFiles),
    });
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function syncPlatformConversationToCloudSql(
  input: SyncConversationInput,
): Promise<void> {
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
        setWhere: eq(conversations.userUid, input.userId),
      });
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export async function syncPlatformMessageToCloudSql(
  input: SyncMessageInput,
): Promise<void> {
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

export async function syncPlatformBillingLedgerToCloudSql(
  input: SyncBillingLedgerInput,
): Promise<void> {
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
        ...(input.reservedCredits !== undefined
          ? { reservedCredits: input.reservedCredits }
          : {}),
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

export async function syncPlatformPaymentOrderToCloudSql(
  input: SyncPaymentOrderInput,
): Promise<void> {
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
        setWhere: eq(paymentOrders.userUid, input.userId),
      });
  } catch (error) {
    throw new Error('Database query failed. Please try again later.', {
      cause: error,
    });
  }
}

export const cloudSqlPlatformPersistenceAdapter: PlatformPersistenceAdapter = {
  async loadUserSnapshot(userId: string) {
    return loadPlatformUserSnapshotFromCloudSql(userId);
  },
  async syncUser(input) {
    if (!isCloudSqlConfigured()) {
      return;
    }
    await getOrCreateUser(
      input.userId,
      input.email,
      input.displayName,
      input.avatarUrl,
    );
  },
  async syncConversation(input) {
    await syncPlatformConversationToCloudSql(input);
  },
  async syncMessage(input) {
    await syncPlatformMessageToCloudSql(input);
  },
  async syncBillingLedger(input) {
    await syncPlatformBillingLedgerToCloudSql(input);
  },
  async syncPaymentOrder(input) {
    await syncPlatformPaymentOrderToCloudSql(input);
  },
};

/**
 * Relational-equivalent persistence store for deterministic multi-instance restart & hydration testing
 * when `NODE_ENV=test` or no external PostgreSQL daemon is connected.
 */
export class InMemoryPlatformPersistenceAdapter
  implements PlatformPersistenceAdapter
{
  private readonly usersById = new Map<string, PersistedUserProfileRecord>();
  private readonly conversationsById = new Map<string, PersistedConversationRecord>();
  private readonly messagesById = new Map<string, PersistedMessageRecord>();
  private readonly ledgerById = new Map<string, PersistedLedgerRecord>();
  private readonly ordersById = new Map<string, PersistedPaymentOrderRecord>();

  private ensureUserRecord(input: {
    readonly userId: string;
    readonly email: string;
    readonly displayName: string;
    readonly avatarUrl?: string | null;
  }): PersistedUserProfileRecord {
    const existing = this.usersById.get(input.userId);
    const normalizedEmail = input.email.trim().toLowerCase();
    const isSyntheticEmail =
      !normalizedEmail ||
      normalizedEmail === `${input.userId.toLowerCase()}@kartik.ai` ||
      normalizedEmail === 'guest@local.kartik.ai';

    const next: PersistedUserProfileRecord = {
      userId: input.userId,
      email:
        !isSyntheticEmail && normalizedEmail
          ? normalizedEmail
          : (existing?.email ?? (normalizedEmail || `${input.userId}@kartik.ai`)),
      displayName:
        input.displayName.trim() && input.displayName.trim() !== input.userId
          ? input.displayName.trim()
          : (existing?.displayName ?? (input.displayName.trim() || input.userId)),
      avatarUrl:
        input.avatarUrl !== undefined && input.avatarUrl !== null
          ? input.avatarUrl
          : (existing?.avatarUrl ?? null),
      planId: existing?.planId ?? 'plan_free',
      availableCredits: existing?.availableCredits ?? 250,
      reservedCredits: existing?.reservedCredits ?? 0,
    };
    this.usersById.set(input.userId, next);
    return next;
  }

  public async loadUserSnapshot(
    userId: string,
  ): Promise<PersistedPlatformUserSnapshot | null> {
    const user = this.usersById.get(userId) ?? null;
    const conversationsList = Array.from(this.conversationsById.values())
      .filter((c) => c.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const messagesList = Array.from(this.messagesById.values())
      .filter((m) => m.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ledgerList = Array.from(this.ledgerById.values())
      .filter((l) => l.userId === userId)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const ordersList = Array.from(this.ordersById.values()).filter(
      (o) => o.userId === userId,
    );

    if (
      !user &&
      conversationsList.length === 0 &&
      messagesList.length === 0 &&
      ledgerList.length === 0 &&
      ordersList.length === 0
    ) {
      return null;
    }

    return Object.freeze({
      user,
      conversations: Object.freeze(conversationsList),
      messages: Object.freeze(messagesList),
      ledgerEntries: Object.freeze(ledgerList),
      paymentOrders: Object.freeze(ordersList),
      artifacts: Object.freeze([]),
      uploadedFiles: Object.freeze([]),
    });
  }

  public async syncUser(input: {
    readonly userId: string;
    readonly email: string;
    readonly displayName: string;
    readonly avatarUrl: string | null;
  }): Promise<void> {
    this.ensureUserRecord(input);
  }

  public async syncConversation(input: SyncConversationInput): Promise<void> {
    this.ensureUserRecord({
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
    });
    const existing = this.conversationsById.get(input.conversationId);
    if (existing && existing.userId !== input.userId) {
      return;
    }
    const nowIso = new Date().toISOString();
    this.conversationsById.set(input.conversationId, {
      conversationId: input.conversationId,
      userId: input.userId,
      title: input.title,
      deletionState: input.deletionState,
      messageCount: input.messageCount,
      createdAt: existing?.createdAt ?? input.createdAt ?? nowIso,
      updatedAt: input.updatedAt ?? nowIso,
    });
  }

  public async syncMessage(input: SyncMessageInput): Promise<void> {
    if (this.messagesById.has(input.messageId)) {
      return;
    }
    const nowIso = input.createdAt ?? new Date().toISOString();
    this.messagesById.set(input.messageId, {
      messageId: input.messageId,
      conversationId: input.conversationId,
      userId: input.userId,
      role: input.role,
      content: input.content,
      agentUsed: input.agentUsed as SpecialistAgentName | undefined,
      requestId: input.requestId,
      creditsCharged: input.creditsCharged ?? 0,
      idempotentReplay: input.idempotentReplay ?? false,
      citations: Array.isArray(input.citationsJson)
        ? (input.citationsJson as AgentCitation[])
        : [],
      searchImages: Array.isArray(input.searchImagesJson)
        ? (input.searchImagesJson as SearchImageGalleryItem[])
        : [],
      artifactIds: Array.isArray(input.artifactIdsJson)
        ? (input.artifactIdsJson as string[])
        : [],
      attachedFileIds: Array.isArray(input.attachedFileIdsJson)
        ? (input.attachedFileIdsJson as string[])
        : [],
      createdAt: nowIso,
    });
  }

  public async syncBillingLedger(input: SyncBillingLedgerInput): Promise<void> {
    const existingUser = this.ensureUserRecord({
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
    });
    this.usersById.set(input.userId, {
      ...existingUser,
      planId: normalizePlanId(input.planId),
      availableCredits: input.availableCredits,
      reservedCredits:
        input.reservedCredits ?? existingUser.reservedCredits ?? 0,
    });
    if (!this.ledgerById.has(input.entryId)) {
      this.ledgerById.set(input.entryId, {
        entryId: input.entryId,
        userId: input.userId,
        requestId: input.requestId,
        description: input.description,
        deltaCredits: input.deltaCredits,
        balanceAfter: input.balanceAfter,
        timestamp: input.timestamp ?? new Date().toISOString(),
      });
    }
  }

  public async syncPaymentOrder(input: SyncPaymentOrderInput): Promise<void> {
    this.ensureUserRecord({
      userId: input.userId,
      email: input.email,
      displayName: input.displayName,
    });
    const existing = this.ordersById.get(input.orderId);
    if (existing && existing.userId !== input.userId) {
      return;
    }
    this.ordersById.set(input.orderId, {
      orderId: input.orderId,
      userId: input.userId,
      planId: input.planId,
      requestId: input.requestId,
      amountPaise: input.amountPaise,
      creditsGranted: input.creditsGranted,
      paymentId: input.paymentId ?? existing?.paymentId ?? null,
      settled: input.settled,
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
        input.ownerUserId,
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
          setWhere: eq(privateObjects.ownerUserUid, input.ownerUserId),
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
