import type { DatabaseClient } from '@kartik/shared/database';
import type { AgentMetadataStore } from '../graph/index.js';
import type {
  ArtifactRecord,
  CodingArtifactFile,
  DocumentChunkRecord,
  UploadedFileRecord,
  UploadedFileStatus,
} from '../models/index.js';

export interface AgentRepository extends AgentMetadataStore {
  saveFile(file: UploadedFileRecord): Promise<void>;
  listFilesByUser(userId: string): Promise<readonly UploadedFileRecord[]>;
  getArtifactById(userId: string, artifactId: string): Promise<ArtifactRecord | null>;
  listArtifactsByConversation(
    userId: string,
    conversationId: string,
  ): Promise<readonly ArtifactRecord[]>;
  saveDocumentChunks(chunks: readonly DocumentChunkRecord[]): Promise<void>;
  deleteFileMetadata(userId: string, fileId: string): Promise<boolean>;
  deleteArtifactMetadata(userId: string, artifactId: string): Promise<boolean>;
}

/**
 * In-memory implementation of `AgentRepository` for deterministic unit and contract testing.
 * Enforces strict `userId` ownership on every lookup and deletion (Invariants #4 & #20).
 */
export class InMemoryAgentRepository implements AgentRepository {
  private readonly files = new Map<string, UploadedFileRecord>();
  private readonly artifacts = new Map<string, ArtifactRecord>();
  private readonly chunks = new Map<string, DocumentChunkRecord>();

  public async saveFile(file: UploadedFileRecord): Promise<void> {
    this.files.set(file.fileId, Object.freeze({ ...file }));
  }

  public async getFileById(
    userId: string,
    fileId: string,
  ): Promise<UploadedFileRecord | null> {
    const file = this.files.get(fileId);
    if (!file || file.userId !== userId || file.status === 'deleted') {
      return null;
    }
    return file;
  }

  public async listFilesByUser(userId: string): Promise<readonly UploadedFileRecord[]> {
    const result: UploadedFileRecord[] = [];
    for (const file of this.files.values()) {
      if (file.userId === userId && file.status !== 'deleted') {
        result.push(file);
      }
    }
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Object.freeze(result);
  }

  public async saveArtifact(artifact: ArtifactRecord): Promise<void> {
    this.artifacts.set(artifact.artifactId, Object.freeze({ ...artifact }));
  }

  public async getArtifactById(
    userId: string,
    artifactId: string,
  ): Promise<ArtifactRecord | null> {
    const artifact = this.artifacts.get(artifactId);
    if (!artifact || artifact.userId !== userId) {
      return null;
    }
    return artifact;
  }

  public async getArtifactByRequestId(
    userId: string,
    requestId: string,
  ): Promise<ArtifactRecord | null> {
    for (const artifact of this.artifacts.values()) {
      if (artifact.userId === userId && artifact.requestId === requestId) {
        return artifact;
      }
    }
    return null;
  }

  public async listArtifactsByConversation(
    userId: string,
    conversationId: string,
  ): Promise<readonly ArtifactRecord[]> {
    const result: ArtifactRecord[] = [];
    for (const artifact of this.artifacts.values()) {
      if (artifact.userId === userId && artifact.conversationId === conversationId) {
        result.push(artifact);
      }
    }
    result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return Object.freeze(result);
  }

  public async saveDocumentChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    for (const chunk of chunks) {
      this.chunks.set(chunk.chunkId, Object.freeze({ ...chunk }));
    }
  }

  public async deleteFileMetadata(userId: string, fileId: string): Promise<boolean> {
    const existing = this.files.get(fileId);
    if (!existing || existing.userId !== userId) {
      return false;
    }
    this.files.delete(fileId);
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.fileId === fileId && chunk.userId === userId) {
        this.chunks.delete(chunkId);
      }
    }
    return true;
  }

  public async deleteArtifactMetadata(
    userId: string,
    artifactId: string,
  ): Promise<boolean> {
    const existing = this.artifacts.get(artifactId);
    if (!existing || existing.userId !== userId) {
      return false;
    }
    return this.artifacts.delete(artifactId);
  }

  public countChunks(): number {
    return this.chunks.size;
  }
}

interface FileRow {
  file_id: string;
  user_id: string;
  original_filename: string;
  mime_type: UploadedFileRecord['mimeType'];
  size_bytes: number;
  storage_key: string;
  sha256_hex: string;
  page_count: number | null;
  chunk_count: number;
  status: UploadedFileStatus;
  created_at: string | Date;
}

interface ArtifactRow {
  artifact_id: string;
  user_id: string;
  request_id: string;
  conversation_id: string;
  artifact_type: ArtifactRecord['artifactType'];
  title: string;
  entry_file: string;
  storage_key: string;
  mime_type: string;
  size_bytes: number;
  files_manifest: CodingArtifactFile[] | string;
  created_at: string | Date;
}

function mapFileRow(row: FileRow): UploadedFileRecord {
  return Object.freeze({
    fileId: row.file_id,
    userId: row.user_id,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    storageKey: row.storage_key,
    sha256Hex: row.sha256_hex,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    chunkCount: Number(row.chunk_count),
    status: row.status,
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  });
}

function mapArtifactRow(row: ArtifactRow): ArtifactRecord {
  const manifest: CodingArtifactFile[] =
    typeof row.files_manifest === 'string'
      ? (JSON.parse(row.files_manifest) as CodingArtifactFile[])
      : row.files_manifest;
  return Object.freeze({
    artifactId: row.artifact_id,
    userId: row.user_id,
    requestId: row.request_id,
    conversationId: row.conversation_id,
    artifactType: row.artifact_type,
    title: row.title,
    entryFile: row.entry_file,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    filesManifest: Object.freeze(manifest),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  });
}

/**
 * PostgreSQL implementation of `AgentRepository` targeting `agent.files`, `agent.artifacts`,
 * and `agent.document_chunks` (Invariant #4 & #7).
 */
export class PostgresAgentRepository implements AgentRepository {
  private readonly db: Pick<DatabaseClient, 'query'>;

  constructor(db: Pick<DatabaseClient, 'query'>) {
    this.db = db;
  }

  public async saveFile(file: UploadedFileRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO agent.files (
         file_id, user_id, original_filename, mime_type, size_bytes,
         storage_key, sha256_hex, page_count, chunk_count, status, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        file.fileId,
        file.userId,
        file.originalFilename,
        file.mimeType,
        file.sizeBytes,
        file.storageKey,
        file.sha256Hex,
        file.pageCount,
        file.chunkCount,
        file.status,
        file.createdAt,
      ],
    );
  }

  public async getFileById(
    userId: string,
    fileId: string,
  ): Promise<UploadedFileRecord | null> {
    const res = await this.db.query<FileRow>(
      `SELECT * FROM agent.files
       WHERE file_id = $1 AND user_id = $2 AND status <> 'deleted'
       LIMIT 1`,
      [fileId, userId],
    );
    const row = res.rows[0];
    return row ? mapFileRow(row) : null;
  }

  public async listFilesByUser(userId: string): Promise<readonly UploadedFileRecord[]> {
    const res = await this.db.query<FileRow>(
      `SELECT * FROM agent.files
       WHERE user_id = $1 AND status <> 'deleted'
       ORDER BY created_at DESC`,
      [userId],
    );
    return Object.freeze(res.rows.map(mapFileRow));
  }

  public async saveArtifact(artifact: ArtifactRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO agent.artifacts (
         artifact_id, user_id, request_id, conversation_id, artifact_type,
         title, entry_file, storage_key, mime_type, size_bytes, files_manifest, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
      [
        artifact.artifactId,
        artifact.userId,
        artifact.requestId,
        artifact.conversationId,
        artifact.artifactType,
        artifact.title,
        artifact.entryFile,
        artifact.storageKey,
        artifact.mimeType,
        artifact.sizeBytes,
        JSON.stringify(artifact.filesManifest),
        artifact.createdAt,
      ],
    );
  }

  public async getArtifactById(
    userId: string,
    artifactId: string,
  ): Promise<ArtifactRecord | null> {
    const res = await this.db.query<ArtifactRow>(
      `SELECT * FROM agent.artifacts
       WHERE artifact_id = $1 AND user_id = $2
       LIMIT 1`,
      [artifactId, userId],
    );
    const row = res.rows[0];
    return row ? mapArtifactRow(row) : null;
  }

  public async getArtifactByRequestId(
    userId: string,
    requestId: string,
  ): Promise<ArtifactRecord | null> {
    const res = await this.db.query<ArtifactRow>(
      `SELECT * FROM agent.artifacts
       WHERE request_id = $1 AND user_id = $2
       LIMIT 1`,
      [requestId, userId],
    );
    const row = res.rows[0];
    return row ? mapArtifactRow(row) : null;
  }

  public async listArtifactsByConversation(
    userId: string,
    conversationId: string,
  ): Promise<readonly ArtifactRecord[]> {
    const res = await this.db.query<ArtifactRow>(
      `SELECT * FROM agent.artifacts
       WHERE user_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC`,
      [userId, conversationId],
    );
    return Object.freeze(res.rows.map(mapArtifactRow));
  }

  public async saveDocumentChunks(chunks: readonly DocumentChunkRecord[]): Promise<void> {
    for (const chunk of chunks) {
      await this.db.query(
        `INSERT INTO agent.document_chunks (
           chunk_id, file_id, user_id, document_title, page_number, chunk_index, text_content, created_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          chunk.chunkId,
          chunk.fileId,
          chunk.userId,
          chunk.documentTitle,
          chunk.pageNumber,
          chunk.chunkIndex,
          chunk.textContent,
          chunk.createdAt,
        ],
      );
    }
  }

  public async deleteFileMetadata(userId: string, fileId: string): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM agent.files WHERE file_id = $1 AND user_id = $2`,
      [fileId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }

  public async deleteArtifactMetadata(
    userId: string,
    artifactId: string,
  ): Promise<boolean> {
    const res = await this.db.query(
      `DELETE FROM agent.artifacts WHERE artifact_id = $1 AND user_id = $2`,
      [artifactId, userId],
    );
    return (res.rowCount ?? 0) > 0;
  }
}
