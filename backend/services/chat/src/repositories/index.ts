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

interface MessageRow {
  message_id: string;
  conversation_id: string;
  user_id: string;
  request_id: string;
  role: MessageRecord['role'];
  content: string;
  agent_used: MessageRecord['agentUsed'];
  attachment_file_ids: readonly string[] | string;
  artifact_ids: readonly string[] | string;
  citations: readonly MessageCitation[] | string;
  created_at: string | Date;
}

interface AgentRunRow {
  run_id: string;
  request_id: string;
  trace_id: string;
  user_id: string;
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  agent: AgentRunRecord['agent'];
  operation: AgentRunRecord['operation'];
  reservation_id: string | null;
  reserved_credits: number;
  settled_credits: number | null;
  state: AgentRunState;
  payload_fingerprint: string;
  error_code: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

function parseJsonArray<T>(val: readonly T[] | string | null | undefined): readonly T[] {
  if (!val) return Object.freeze([]);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val) as T[];
      return Object.freeze(Array.isArray(parsed) ? parsed : []);
    } catch {
      return Object.freeze([]);
    }
  }
  return Object.freeze([...val]);
}

function mapMessageRow(row: MessageRow): MessageRecord {
  const toIso = (val: string | Date) =>
    val instanceof Date ? val.toISOString() : String(val);
  return Object.freeze({
    messageId: row.message_id,
    conversationId: row.conversation_id,
    userId: row.user_id,
    requestId: row.request_id,
    role: row.role,
    content: row.content,
    agentUsed: row.agent_used ?? null,
    attachmentFileIds: parseJsonArray<string>(row.attachment_file_ids),
    artifactIds: parseJsonArray<string>(row.artifact_ids),
    citations: parseJsonArray<MessageCitation>(row.citations),
    createdAt: toIso(row.created_at),
  });
}

function mapAgentRunRow(row: AgentRunRow): AgentRunRecord {
  const toIso = (val: string | Date) =>
    val instanceof Date ? val.toISOString() : String(val);
  return Object.freeze({
    runId: row.run_id,
    requestId: row.request_id,
    traceId: row.trace_id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    userMessageId: row.user_message_id,
    assistantMessageId: row.assistant_message_id ?? null,
    agent: row.agent,
    operation: row.operation,
    reservationId: row.reservation_id ?? null,
    reservedCredits: Number(row.reserved_credits),
    settledCredits: row.settled_credits === null ? null : Number(row.settled_credits),
    state: row.state,
    payloadFingerprint: row.payload_fingerprint,
    errorCode: row.error_code ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

/**
 * PostgreSQL implementation of `ChatRepository` targeting `chat.conversations`,
 * `chat.messages`, and `chat.agent_runs` (Invariants #3 & #7).
 */
export class PostgresChatRepository implements ChatRepository {
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
    return Object.freeze({ ...conversation });
  }

  public async getConversationForUser(
    userId: string,
    conversationId: string,
    options?: { readonly includePurging?: boolean },
  ): Promise<ConversationRecord> {
    const res = await this.db.query<ConversationRow>(
      options?.includePurging
        ? `SELECT * FROM chat.conversations
           WHERE conversation_id = $1 AND user_id = $2
           LIMIT 1`
        : `SELECT * FROM chat.conversations
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

    const fetchLimit = parsed.limit + 1;
    const res = parsed.cursor
      ? await this.db.query<ConversationRow>(
          `SELECT * FROM chat.conversations
           WHERE user_id = $1
             AND deletion_state = 'active'
             AND (created_at, conversation_id) < ($2::timestamptz, $3)
           ORDER BY created_at DESC, conversation_id DESC
           LIMIT $4`,
          [input.userId, parsed.cursor.createdAt, parsed.cursor.id, fetchLimit],
        )
      : await this.db.query<ConversationRow>(
          `SELECT * FROM chat.conversations
           WHERE user_id = $1
             AND deletion_state = 'active'
           ORDER BY created_at DESC, conversation_id DESC
           LIMIT $2`,
          [input.userId, fetchLimit],
        );

    const mapped = res.rows.map(mapConversationRow);
    const hasMore = mapped.length > parsed.limit;
    const slice = mapped.slice(0, parsed.limit);
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
    await this.getConversationForUser(message.userId, message.conversationId);
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
    await this.db.query(
      `UPDATE chat.conversations
       SET message_count = message_count + 1,
           last_message_at = $3,
           updated_at = $3
       WHERE conversation_id = $1 AND user_id = $2`,
      [message.conversationId, message.userId, message.createdAt],
    );
    return Object.freeze({
      ...message,
      attachmentFileIds: Object.freeze([...message.attachmentFileIds]),
      artifactIds: Object.freeze([...message.artifactIds]),
      citations: Object.freeze([...message.citations]),
    });
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

    const fetchLimit = parsed.limit + 1;
    const res = parsed.cursor
      ? await this.db.query<MessageRow>(
          `SELECT * FROM chat.messages
           WHERE conversation_id = $1
             AND user_id = $2
             AND (created_at, message_id) < ($3::timestamptz, $4)
           ORDER BY created_at DESC, message_id DESC
           LIMIT $5`,
          [
            input.conversationId,
            input.userId,
            parsed.cursor.createdAt,
            parsed.cursor.id,
            fetchLimit,
          ],
        )
      : await this.db.query<MessageRow>(
          `SELECT * FROM chat.messages
           WHERE conversation_id = $1 AND user_id = $2
           ORDER BY created_at DESC, message_id DESC
           LIMIT $3`,
          [input.conversationId, input.userId, fetchLimit],
        );

    const mapped = res.rows.map(mapMessageRow);
    const hasMore = mapped.length > parsed.limit;
    const slice = mapped.slice(0, parsed.limit);
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

    const res = await this.db.query<
      Pick<MessageRow, 'attachment_file_ids' | 'artifact_ids'>
    >(
      `SELECT attachment_file_ids, artifact_ids
       FROM chat.messages
       WHERE conversation_id = $1 AND user_id = $2`,
      [conversationId, userId],
    );

    const fileIdSet = new Set<string>();
    const artifactIdSet = new Set<string>();

    for (const row of res.rows) {
      for (const fid of parseJsonArray<string>(row.attachment_file_ids)) {
        fileIdSet.add(fid);
      }
      for (const aid of parseJsonArray<string>(row.artifact_ids)) {
        artifactIdSet.add(aid);
      }
    }

    return Object.freeze({
      fileIds: Object.freeze([...fileIdSet]),
      artifactIds: Object.freeze([...artifactIdSet]),
    });
  }

  public async saveAgentRun(run: AgentRunRecord): Promise<AgentRunRecord> {
    await this.db.query(
      `INSERT INTO chat.agent_runs (
         run_id, request_id, trace_id, user_id, conversation_id,
         user_message_id, assistant_message_id, agent, operation,
         reservation_id, reserved_credits, settled_credits, state,
         payload_fingerprint, error_code, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        run.runId,
        run.requestId,
        run.traceId,
        run.userId,
        run.conversationId,
        run.userMessageId,
        run.assistantMessageId,
        run.agent,
        run.operation,
        run.reservationId,
        run.reservedCredits,
        run.settledCredits,
        run.state,
        run.payloadFingerprint,
        run.errorCode,
        run.createdAt,
        run.updatedAt,
      ],
    );
    return Object.freeze({ ...run });
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
    const existingRes = await this.db.query<AgentRunRow>(
      `SELECT * FROM chat.agent_runs WHERE request_id = $1 LIMIT 1`,
      [requestId],
    );
    const existingRow = existingRes.rows[0];
    if (!existingRow) {
      throw new AppError('NOT_FOUND', `AgentRun for requestId "${requestId}" was not found`);
    }
    const existing = mapAgentRunRow(existingRow);
    const updated: AgentRunRecord = Object.freeze({
      ...existing,
      ...(patch.state !== undefined ? { state: patch.state } : {}),
      ...(patch.reservationId !== undefined ? { reservationId: patch.reservationId } : {}),
      ...(patch.reservedCredits !== undefined ? { reservedCredits: patch.reservedCredits } : {}),
      ...(patch.settledCredits !== undefined ? { settledCredits: patch.settledCredits } : {}),
      ...(patch.assistantMessageId !== undefined
        ? { assistantMessageId: patch.assistantMessageId }
        : {}),
      ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    });

    await this.db.query(
      `UPDATE chat.agent_runs
       SET state = $2,
           reservation_id = $3,
           reserved_credits = $4,
           settled_credits = $5,
           assistant_message_id = $6,
           error_code = $7,
           updated_at = $8
       WHERE request_id = $1`,
      [
        requestId,
        updated.state,
        updated.reservationId,
        updated.reservedCredits,
        updated.settledCredits,
        updated.assistantMessageId,
        updated.errorCode,
        updated.updatedAt,
      ],
    );

    return updated;
  }

  public async getAgentRunByRequestId(
    userId: string,
    requestId: string,
  ): Promise<AgentRunRecord | null> {
    const res = await this.db.query<AgentRunRow>(
      `SELECT * FROM chat.agent_runs
       WHERE request_id = $1 AND user_id = $2
       LIMIT 1`,
      [requestId, userId],
    );
    const row = res.rows[0];
    return row ? mapAgentRunRow(row) : null;
  }
}

