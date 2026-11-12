import type { SqlMigrationFile } from '@kartik/shared/database';
import type {
  AgentName,
  ArtifactManifestFile,
} from '@kartik/shared/contracts';

export type UploadedFileStatus = 'ready' | 'processing' | 'failed' | 'deleted';

export interface UploadedFileRecord {
  readonly fileId: string;
  readonly userId: string;
  readonly originalFilename: string;
  readonly mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'image/webp';
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly sha256Hex: string;
  readonly pageCount: number | null;
  readonly chunkCount: number;
  readonly status: UploadedFileStatus;
  readonly createdAt: string;
}

export interface CodingArtifactFile extends ArtifactManifestFile {
  readonly content: string;
}

export interface AgentCitation {
  readonly sourceId: string;
  readonly title: string;
  readonly urlOrPage: string;
}

export type ArtifactType =
  | 'code_bundle'
  | 'generated_image'
  | 'pdf_document'
  | 'ppt_presentation';

export interface ArtifactRecord {
  readonly artifactId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly artifactType: ArtifactType;
  readonly title: string;
  readonly entryFile: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly filesManifest: readonly CodingArtifactFile[];
  readonly createdAt: string;
}

export interface DocumentChunkRecord {
  readonly chunkId: string;
  readonly fileId: string;
  readonly userId: string;
  readonly documentTitle: string;
  readonly pageNumber: number;
  readonly chunkIndex: number;
  readonly textContent: string;
  readonly embeddingVector: readonly number[];
  readonly createdAt: string;
}

export interface VectorSearchHit {
  readonly chunkId: string;
  readonly fileId: string;
  readonly userId: string;
  readonly documentTitle: string;
  readonly pageNumber: number;
  readonly textContent: string;
  readonly score: number;
}

/**
 * Provider adapter interfaces isolating specialist graph nodes from vendor SDKs
 * (Blueprint §10 & Invariant #13).
 */
export interface ChatModelProvider {
  readonly providerName: string;
  generateReply(input: {
    readonly prompt: string;
    readonly systemInstruction?: string;
    readonly maxOutputTokens: number;
  }): Promise<{
    readonly content: string;
    readonly tokensUsed: number;
  }>;
}

export interface CodingModelProvider {
  readonly providerName: string;
  generateCodeBundle(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
  }): Promise<{
    readonly summary: string;
    readonly rawManifestJson: string;
    readonly tokensUsed: number;
  }>;
}

export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface SearchProvider {
  readonly providerName: string;
  searchWeb(input: {
    readonly query: string;
    readonly maxResults?: number;
  }): Promise<readonly SearchResultItem[]>;
}

export interface EmbeddingProvider {
  readonly providerName: string;
  readonly dimensions: number;
  embedTexts(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

export interface ImageGenerationProvider {
  readonly providerName: string;
  generateImage(input: {
    readonly prompt: string;
  }): Promise<{
    readonly mimeType: 'image/png';
    readonly data: Uint8Array;
    readonly caption: string;
  }>;
}

export interface VisionProvider {
  readonly providerName: string;
  analyzeImage(input: {
    readonly prompt: string;
    readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
    readonly imageBytes: Uint8Array;
  }): Promise<{
    readonly analysis: string;
    readonly tokensUsed: number;
  }>;
}

/**
 * VectorStore interface enforcing authenticated userId and document identity filtering
 * (Invariant #9: "Vector retrieval is filtered by authenticated userId and document identity.
 * A result from another user must never be returned.")
 */
export interface VectorStore {
  upsertChunks(chunks: readonly DocumentChunkRecord[]): Promise<void>;
  searchChunks(input: {
    readonly userId: string;
    readonly queryVector: readonly number[];
    readonly fileIds?: readonly string[];
    readonly topK?: number;
  }): Promise<readonly VectorSearchHit[]>;
  deleteByFileIds(input: {
    readonly userId: string;
    readonly fileIds: readonly string[];
  }): Promise<number>;
  deleteByUserId(userId: string): Promise<number>;
}

export interface SpecialistExecutionResult {
  readonly agentUsed: AgentName;
  readonly content: string;
  readonly citations: readonly AgentCitation[];
  readonly artifact?: ArtifactRecord;
  readonly actualCreditsUsed: number;
  readonly degradedToMock: boolean;
}

/**
 * Initial forward-only SQL migration for the `agent` PostgreSQL schema.
 * Owns `agent.files`, `agent.artifacts`, and `agent.document_chunks` (Invariant #4).
 */
export const AGENT_INITIAL_MIGRATION: SqlMigrationFile = Object.freeze({
  version: '0001_agent_core',
  filename: '0001_agent_core.sql',
  description:
    'Create agent.files, agent.artifacts, and agent.document_chunks tables with strict ownership and size constraints',
  sql: `
CREATE SCHEMA IF NOT EXISTS agent;

CREATE TABLE IF NOT EXISTS agent.files (
  file_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  storage_key TEXT NOT NULL UNIQUE,
  sha256_hex TEXT NOT NULL,
  page_count INTEGER CHECK (page_count IS NULL OR (page_count > 0 AND page_count <= 25)),
  chunk_count INTEGER NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('ready', 'processing', 'failed', 'deleted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_files_user_id ON agent.files (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent.artifacts (
  artifact_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('code_bundle', 'generated_image', 'pdf_document', 'ppt_presentation')),
  title TEXT NOT NULL,
  entry_file TEXT NOT NULL,
  storage_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
  files_manifest JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_artifacts_user_id ON agent.artifacts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent.document_chunks (
  chunk_id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL REFERENCES agent.files(file_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  document_title TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number >= 1),
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  text_content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_chunks_user_file ON agent.document_chunks (user_id, file_id, page_number);
`.trim(),
});

export const AGENT_MIGRATIONS: readonly SqlMigrationFile[] = Object.freeze([
  AGENT_INITIAL_MIGRATION,
]);
