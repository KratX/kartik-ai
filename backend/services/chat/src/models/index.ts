import type { SqlMigrationFile } from '@kartik/shared/database';
import type {
  AgentRunState,
  BillingOperation,
  DeletionState,
  SpecialistAgentName,
} from '@kartik/shared/contracts';

export type MessageRole = 'user' | 'assistant' | 'system';

export interface MessageCitation {
  readonly sourceId: string;
  readonly title: string;
  readonly urlOrPage: string;
}

export interface ConversationRecord {
  readonly conversationId: string;
  readonly userId: string;
  readonly title: string;
  readonly deletionState: DeletionState;
  readonly messageCount: number;
  readonly lastMessageAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageRecord {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly agentUsed: SpecialistAgentName | null;
  readonly attachmentFileIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly citations: readonly MessageCitation[];
  readonly createdAt: string;
}

/**
 * Durable Agent Run record owned by `@kartik/chat` (Invariants #3, #6, #15 & §11).
 *
 * Tracks the exact client `requestId` (`Idempotency-Key`), `payloadFingerprint`,
 * `reservationId`, and `AgentRunState` (`pending` -> `reserved` -> `executing` ->
 * `completed` | `execution_unknown` | `failed` | `released`) so interrupted runs can be
 * recovered without double-charging.
 */
export interface AgentRunRecord {
  readonly runId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly userMessageId: string;
  readonly assistantMessageId: string | null;
  readonly agent: SpecialistAgentName;
  readonly operation: BillingOperation;
  readonly reservationId: string | null;
  readonly reservedCredits: number;
  readonly settledCredits: number | null;
  readonly state: AgentRunState;
  readonly payloadFingerprint: string;
  readonly errorCode: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PaginatedResult<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

/**
 * Initial forward-only SQL migration for the `chat` PostgreSQL schema.
 * Owns `chat.conversations`, `chat.messages`, and `chat.agent_runs` (Invariant #3 & #7).
 */
export const CHAT_INITIAL_MIGRATION: SqlMigrationFile = Object.freeze({
  version: '0001_chat_core',
  filename: '0001_chat_core.sql',
  description:
    'Create chat.conversations, chat.messages, and chat.agent_runs tables with run-state and deletion-lifecycle constraints',
  sql: `
CREATE SCHEMA IF NOT EXISTS chat;

CREATE TABLE IF NOT EXISTS chat.conversations (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  deletion_state TEXT NOT NULL DEFAULT 'active' CHECK (deletion_state IN ('active', 'requested', 'purging', 'purged', 'failed')),
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user_cursor
  ON chat.conversations (user_id, created_at DESC, conversation_id DESC);

CREATE TABLE IF NOT EXISTS chat.messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat.conversations(conversation_id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  agent_used TEXT CHECK (agent_used IS NULL OR agent_used IN ('chat', 'search', 'coding', 'rag', 'vision', 'image')),
  attachment_file_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  artifact_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_cursor
  ON chat.messages (conversation_id, user_id, created_at DESC, message_id DESC);

CREATE TABLE IF NOT EXISTS chat.agent_runs (
  run_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  trace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL REFERENCES chat.conversations(conversation_id) ON DELETE CASCADE,
  user_message_id TEXT NOT NULL,
  assistant_message_id TEXT,
  agent TEXT NOT NULL CHECK (agent IN ('chat', 'search', 'coding', 'rag', 'vision', 'image')),
  operation TEXT NOT NULL CHECK (operation IN ('chat_turn', 'web_search', 'code_generation', 'pdf_rag_query', 'vision_analysis', 'image_generation')),
  reservation_id TEXT,
  reserved_credits INTEGER NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  settled_credits INTEGER CHECK (settled_credits IS NULL OR settled_credits >= 0),
  state TEXT NOT NULL CHECK (state IN ('pending', 'reserved', 'executing', 'completed', 'execution_unknown', 'failed', 'released')),
  payload_fingerprint TEXT NOT NULL,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_runs_user_request
  ON chat.agent_runs (user_id, request_id);
`.trim(),
});

export const CHAT_MIGRATIONS: readonly SqlMigrationFile[] = Object.freeze([
  CHAT_INITIAL_MIGRATION,
]);
