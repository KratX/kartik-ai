import { AppError } from '@kartik/shared/errors';
import type { DatabaseClient } from '@kartik/shared/database';
import type { AgentRunState, DeletionState } from '@kartik/shared/contracts';
import {
  encodePaginationCursor,
  parsePaginationQuery,
} from '@kartik/shared/validation';
import type {
  AgentRunRecord,
  ConversationRecord,
  MessageCitation,
  MessageRecord,
  PaginatedResult,
} from '../models/index.js';

export interface ChatRepository {
  createConversation(conversation: ConversationRecord): Promise<ConversationRecord>;
  getConversationForUser(
    userId: string,
    conversationId: string,
    options?: { readonly includePurging?: boolean },
  ): Promise<ConversationRecord>;
  listConversationsForUser(input: {
    readonly userId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
    readonly cursorSecret?: string;
  }): Promise<PaginatedResult<ConversationRecord>>;
  updateConversationDeletionState(
    userId: string,
    conversationId: string,
    state: DeletionState,
  ): Promise<ConversationRecord>;
  saveMessage(message: MessageRecord): Promise<MessageRecord>;
  listMessagesForConversation(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
    readonly cursorSecret?: string;
  }): Promise<PaginatedResult<MessageRecord>>;
  listAllFileAndArtifactIdsForConversation(
    userId: string,
    conversationId: string,
  ): Promise<{
    readonly fileIds: readonly string[];
    readonly artifactIds: readonly string[];
  }>;
  saveAgentRun(run: AgentRunRecord): Promise<AgentRunRecord>;
  updateAgentRun(
    requestId: string,
    patch: {
      readonly state?: AgentRunState;
      readonly reservationId?: string | null;
      readonly reservedCredits?: number;
      readonly settledCredits?: number | null;
      readonly assistantMessageId?: string | null;
      readonly errorCode?: string | null;
      readonly updatedAt?: string;
    },
  ): Promise<AgentRunRecord>;
  getAgentRunByRequestId(
    userId: string,
    requestId: string,
  ): Promise<AgentRunRecord | null>;
}

function compareDescCreatedAtAndId(
  a: { readonly createdAt: string; readonly id: string },
  b: { readonly createdAt: string; readonly id: string },
): number {
  const timeDiff = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  if (timeDiff !== 0) {
    return timeDiff;
  }
  return b.id.localeCompare(a.id);
}

/**
 * In-memory implementation of `ChatRepository` enforcing:
 * - Strict `userId` ownership (`404 NOT_FOUND` on missing OR foreign conversations per Invariant #20).
 * - Keyset cursor pagination `(createdAt, id)` bound to `scope` and `userId` via `@kartik/shared/validation`.
 * - Durable `AgentRunRecord` state transitions keyed by client `requestId` (Invariant #15).
 */
export class InMemoryChatRepository implements ChatRepository {
  private readonly conversations = new Map<string, ConversationRecord>();
  private readonly messages = new Map<string, MessageRecord>();
  private readonly runsByRequestId = new Map<string, AgentRunRecord>();

  public async createConversation(
    conversation: ConversationRecord,
  ): Promise<ConversationRecord> {
    const frozen = Object.freeze({ ...conversation });
    this.conversations.set(frozen.conversationId, frozen);
    return frozen;
  }

  public async getConversationForUser(
    userId: string,
    conversationId: string,
    options?: { readonly includePurging?: boolean },
  ): Promise<ConversationRecord> {
    const conv = this.conversations.get(conversationId);
    // Invariant #20: missing conversation and foreign-owned conversation both return 404 NOT_FOUND
    if (!conv || conv.userId !== userId) {
      throw new AppError('NOT_FOUND', 'Conversation was not found');
    }
    if (
      !options?.includePurging &&
      (conv.deletionState === 'purging' ||
        conv.deletionState === 'purged' ||
        conv.deletionState === 'requested')
    ) {
      throw new AppError('NOT_FOUND', 'Conversation was not found');
    }
    return conv;
  }

  public async listConversationsForUser(input: {
    readonly userId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
    readonly cursorSecret?: string;
  }): Promise<PaginatedResult<ConversationRecord>> {
    const scope = 'conversations:list';
    const parsed = parsePaginationQuery(
      { limit: input.limit, cursor: input.cursor },
      {
        expectedScope: scope,
        expectedUserId: input.userId,
        secret: input.cursorSecret,
      },
    );

    const allOwned: ConversationRecord[] = [];
    for (const conv of this.conversations.values()) {
      if (conv.userId === input.userId && conv.deletionState === 'active') {
        allOwned.push(conv);
      }
    }

    allOwned.sort((a, b) =>
      compareDescCreatedAtAndId(
        { createdAt: a.createdAt, id: a.conversationId },
        { createdAt: b.createdAt, id: b.conversationId },
      ),
    );

    const filtered = parsed.cursor
      ? allOwned.filter((item) => {
          const cmp = compareDescCreatedAtAndId(
            { createdAt: parsed.cursor!.createdAt, id: parsed.cursor!.id },
            { createdAt: item.createdAt, id: item.conversationId },
          );
          return cmp < 0;
        })
      : allOwned;

    const slice = filtered.slice(0, parsed.limit);
    const hasMore = filtered.length > parsed.limit;
    const lastItem = slice[slice.length - 1];

    const nextCursor =
      hasMore && lastItem
        ? encodePaginationCursor(
            {
              scope,
              userId: input.userId,
              createdAt: lastItem.createdAt,
              id: lastItem.conversationId,
            },
            input.cursorSecret,
          )
        : null;

    return Object.freeze({
      items: Object.freeze(slice),
      nextCursor,
    });
  }

  public async updateConversationDeletionState(
    userId: string,
    conversationId: string,
    state: DeletionState,
  ): Promise<ConversationRecord> {
    const conv = await this.getConversationForUser(userId, conversationId, {
      includePurging: true,
    });
    const updated: ConversationRecord = Object.freeze({
      ...conv,
      deletionState: state,
      updatedAt: new Date().toISOString(),
    });
    this.conversations.set(conversationId, updated);
    return updated;
  }

  public async saveMessage(message: MessageRecord): Promise<MessageRecord> {
    const conv = await this.getConversationForUser(
      message.userId,
      message.conversationId,
    );
    const frozenMsg = Object.freeze({
      ...message,
      attachmentFileIds: Object.freeze([...message.attachmentFileIds]),
      artifactIds: Object.freeze([...message.artifactIds]),
      citations: Object.freeze([...message.citations]),
    });
    this.messages.set(frozenMsg.messageId, frozenMsg);

    const updatedConv: ConversationRecord = Object.freeze({
      ...conv,
      messageCount: conv.messageCount + 1,
      lastMessageAt: frozenMsg.createdAt,
      updatedAt: frozenMsg.createdAt,
    });
    this.conversations.set(conv.conversationId, updatedConv);

    return frozenMsg;
  }

  public async listMessagesForConversation(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
    readonly cursorSecret?: string;
  }): Promise<PaginatedResult<MessageRecord>> {
    await this.getConversationForUser(input.userId, input.conversationId);

    const scope = `messages:${input.conversationId}`;
    const parsed = parsePaginationQuery(
      { limit: input.limit, cursor: input.cursor },
      {
        expectedScope: scope,
        expectedUserId: input.userId,
        secret: input.cursorSecret,
      },
    );

    const convMessages: MessageRecord[] = [];
    for (const msg of this.messages.values()) {
      if (
        msg.conversationId === input.conversationId &&
        msg.userId === input.userId
      ) {
        convMessages.push(msg);
      }
    }

    convMessages.sort((a, b) =>
      compareDescCreatedAtAndId(
        { createdAt: a.createdAt, id: a.messageId },
        { createdAt: b.createdAt, id: b.messageId },
      ),
    );

    const filtered = parsed.cursor
      ? convMessages.filter((item) => {
          const cmp = compareDescCreatedAtAndId(
            { createdAt: parsed.cursor!.createdAt, id: parsed.cursor!.id },
            { createdAt: item.createdAt, id: item.messageId },
          );
          return cmp < 0;
        })
      : convMessages;

    const slice = filtered.slice(0, parsed.limit);
    const hasMore = filtered.length > parsed.limit;
    const lastItem = slice[slice.length - 1];

    const nextCursor =
      hasMore && lastItem
        ? encodePaginationCursor(
            {
              scope,
              userId: input.userId,
              createdAt: lastItem.createdAt,
              id: lastItem.messageId,
            },
            input.cursorSecret,
          )
        : null;

    return Object.freeze({
      items: Object.freeze(slice),
      nextCursor,
    });
  }

  public async listAllFileAndArtifactIdsForConversation(
    userId: string,
    conversationId: string,
  ): Promise<{
    readonly fileIds: readonly string[];
    readonly artifactIds: readonly string[];
  }> {
    await this.getConversationForUser(userId, conversationId, {
      includePurging: true,
    });

    const fileIdSet = new Set<string>();
    const artifactIdSet = new Set<string>();

    for (const msg of this.messages.values()) {
      if (msg.conversationId === conversationId && msg.userId === userId) {
        for (const fid of msg.attachmentFileIds) {
          fileIdSet.add(fid);
        }
        for (const aid of msg.artifactIds) {
          artifactIdSet.add(aid);
        }
      }
    }

    return Object.freeze({
      fileIds: Object.freeze([...fileIdSet]),
      artifactIds: Object.freeze([...artifactIdSet]),
    });
  }

  public async saveAgentRun(run: AgentRunRecord): Promise<AgentRunRecord> {
    const frozen = Object.freeze({ ...run });
    this.runsByRequestId.set(frozen.requestId, frozen);
    return frozen;
  }

  public async updateAgentRun(
    requestId: string,
    patch: {
      readonly state?: AgentRunState;
      readonly reservationId?: string | null;
      readonly reservedCredits?: number;
      readonly settledCredits?: number | null;
      readonly assistantMessageId?: string | null;
      readonly errorCode?: string | null;
      readonly updatedAt?: string;
    },
  ): Promise<AgentRunRecord> {
    const existing = this.runsByRequestId.get(requestId);
    if (!existing) {
      throw new AppError('NOT_FOUND', `AgentRun for requestId "${requestId}" was not found`);
    }
    const updated: AgentRunRecord = Object.freeze({
      ...existing,
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.reservationId !== undefined ? { reservationId: patch.reservationId } : {}),
      ...(patch.reservedCredits !== undefined
        ? { reservedCredits: patch.reservedCredits }
        : {}),
      ...(patch.settledCredits !== undefined
        ? { settledCredits: patch.settledCredits }
        : {}),
      ...(patch.assistantMessageId !== undefined
        ? { assistantMessageId: patch.assistantMessageId }
        : {}),
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    });
    this.runsByRequestId.set(requestId, updated);
    return updated;
  }

  public async getAgentRunByRequestId(
    userId: string,
    requestId: string,
  ): Promise<AgentRunRecord | null> {
    const run = this.runsByRequestId.get(requestId);
    if (!run || run.userId !== userId) {
      return null;
    }
    return run;
  }
}

interface ConversationRow {
  conversation_id: string;
  user_id: string;
  title: string;
  deletion_state: DeletionState;
  message_count: number;
  last_message_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapConversationRow(row: ConversationRow): ConversationRecord {
  const toIso = (val: string | Date) =>
    val instanceof Date ? val.toISOString() : String(val);
  return Object.freeze({
    conversationId: row.conversation_id,
    userId: row.user_id,
    title: row.title,
    deletionState: row.deletion_state,
    messageCount: Number(row.message_count),
    lastMessageAt: toIso(row.last_message_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

/**
 * PostgreSQL implementation of `ChatRepository` targeting `chat.conversations`,
 * `chat.messages`, and `chat.agent_runs` (Invariants #3 & #7).
 */
export class PostgresChatRepository implements Pick<
  ChatRepository,
  'createConversation' | 'getConversationForUser' | 'updateConversationDeletionState' | 'saveMessage'
> {
  private readonly db: Pick<DatabaseClient, 'query'>;

  constructor(db: Pick<DatabaseClient, 'query'>) {
    this.db = db;
  }

  public async createConversation(
    conversation: ConversationRecord,
  ): Promise<ConversationRecord> {
    await this.db.query(
      `INSERT INTO chat.conversations (
         conversation_id, user_id, title, deletion_state, message_count,
         last_message_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        conversation.conversationId,
        conversation.userId,
        conversation.title,
        conversation.deletionState,
        conversation.messageCount,
        conversation.lastMessageAt,
        conversation.createdAt,
        conversation.updatedAt,
      ],
    );
    return conversation;
  }

  public async getConversationForUser(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRecord> {
    const res = await this.db.query<ConversationRow>(
      `SELECT * FROM chat.conversations
       WHERE conversation_id = $1 AND user_id = $2 AND deletion_state = 'active'
       LIMIT 1`,
      [conversationId, userId],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', 'Conversation was not found');
    }
    return mapConversationRow(row);
  }

  public async updateConversationDeletionState(
    userId: string,
    conversationId: string,
    state: DeletionState,
  ): Promise<ConversationRecord> {
    const nowIso = new Date().toISOString();
    const res = await this.db.query<ConversationRow>(
      `UPDATE chat.conversations
       SET deletion_state = $3, updated_at = $4
       WHERE conversation_id = $1 AND user_id = $2
       RETURNING *`,
      [conversationId, userId, state, nowIso],
    );
    const row = res.rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', 'Conversation was not found');
    }
    return mapConversationRow(row);
  }

  public async saveMessage(message: MessageRecord): Promise<MessageRecord> {
    await this.db.query(
      `INSERT INTO chat.messages (
         message_id, conversation_id, user_id, request_id, role, content,
         agent_used, attachment_file_ids, artifact_ids, citations, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11)`,
      [
        message.messageId,
        message.conversationId,
        message.userId,
        message.requestId,
        message.role,
        message.content,
        message.agentUsed,
        JSON.stringify(message.attachmentFileIds),
        JSON.stringify(message.artifactIds),
        JSON.stringify(message.citations as readonly MessageCitation[]),
        message.createdAt,
      ],
    );
    return message;
  }
}
