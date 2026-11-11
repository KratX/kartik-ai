import { randomUUID } from 'node:crypto';
import {
  AppError,
  assertAgentName,
  validateIdempotencyKey,
  type SpecialistAgentName,
} from '@kartik/shared';
import type { ChatConfig } from '../config/index.js';
import type {
  ConversationRecord,
  MessageRecord,
  PaginatedResult,
} from '../models/index.js';
import type { ChatRepository } from '../repositories/index.js';
import type {
  ChatOrchestratorService,
  ChatTurnResult,
  DeleteConversationResult,
} from '../services/index.js';

export interface ChatControllerDependencies {
  readonly config: ChatConfig;
  readonly repository: ChatRepository;
  readonly orchestrator: ChatOrchestratorService;
  readonly checkReadiness?: () => Promise<boolean>;
}

/**
 * HTTP Controller for the Chat Service (`@kartik/chat`, Micro-step 6.3.a).
 *
 * Handles:
 * - Health & readiness probes (`/healthz`, `/readyz`)
 * - Conversation CRUD & keyset cursor pagination (`POST /conversations`, `GET /conversations`, `GET /conversations/:id`)
 * - Message listing & turn orchestration (`GET /conversations/:id/messages`, `POST /conversations/:id/messages`)
 * - Cascade conversation deletion (`DELETE /conversations/:id`)
 */
export class ChatController {
  private readonly deps: ChatControllerDependencies;

  constructor(deps: ChatControllerDependencies) {
    this.deps = deps;
  }

  public getHealthz(): { readonly status: 'ok'; readonly service: 'chat' } {
    return { status: 'ok', service: 'chat' };
  }

  public async getReadyz(): Promise<{
    readonly status: 'ready';
    readonly service: 'chat';
  }> {
    if (this.deps.checkReadiness) {
      const ok = await this.deps.checkReadiness();
      if (!ok) {
        throw new AppError(
          'PROVIDER_UNAVAILABLE',
          'Chat service dependencies are not ready',
        );
      }
    }
    return { status: 'ready', service: 'chat' };
  }

  public async createConversation(input: {
    readonly userId: string;
    readonly requestId: string | undefined;
    readonly body: unknown;
  }): Promise<ConversationRecord> {
    validateIdempotencyKey(input.requestId);

    if (
      typeof input.body !== 'object' ||
      input.body === null ||
      Array.isArray(input.body)
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Request body must be a JSON object',
      );
    }

    const payload = input.body as Record<string, unknown>;
    const rawTitle =
      typeof payload.title === 'string' ? payload.title.trim() : 'New Chat';
    if (rawTitle.length === 0 || rawTitle.length > 200) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Conversation title must be between 1 and 200 characters',
        { details: { title: ['Must be 1..200 characters'] } },
      );
    }

    const nowIso = new Date().toISOString();
    return this.deps.repository.createConversation({
      conversationId: `conv_${randomUUID()}`,
      userId: input.userId,
      title: rawTitle,
      deletionState: 'active',
      messageCount: 0,
      lastMessageAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  public async listConversations(input: {
    readonly userId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
  }): Promise<PaginatedResult<ConversationRecord>> {
    return this.deps.repository.listConversationsForUser({
      userId: input.userId,
      limit: input.limit,
      cursor: input.cursor,
      cursorSecret: this.deps.config.cursorSigningSecret,
    });
  }

  public async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationRecord> {
    return this.deps.repository.getConversationForUser(userId, conversationId);
  }

  public async listMessages(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly limit?: unknown;
    readonly cursor?: unknown;
  }): Promise<PaginatedResult<MessageRecord>> {
    return this.deps.repository.listMessagesForConversation({
      userId: input.userId,
      conversationId: input.conversationId,
      limit: input.limit,
      cursor: input.cursor,
      cursorSecret: this.deps.config.cursorSigningSecret,
    });
  }

  public async sendMessage(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly requestId: string | undefined;
    readonly traceId: string;
    readonly body: unknown;
  }): Promise<ChatTurnResult> {
    const requestId = validateIdempotencyKey(input.requestId);

    if (
      typeof input.body !== 'object' ||
      input.body === null ||
      Array.isArray(input.body)
    ) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Request body must be a JSON object',
      );
    }

    const payload = input.body as Record<string, unknown>;
    if (typeof payload.prompt !== 'string' || payload.prompt.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Message prompt is required', {
        details: { prompt: ['Prompt must be a non-empty string'] },
      });
    }

    const trimmedPrompt = payload.prompt.trim();
    if (trimmedPrompt.length > this.deps.config.maxMessageChars) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Message prompt length (${trimmedPrompt.length}) exceeds MAX_MESSAGE_CHARS (${this.deps.config.maxMessageChars})`,
      );
    }

    let requestedAgent: SpecialistAgentName | undefined;
    if (payload.requestedAgent !== undefined && payload.requestedAgent !== null) {
      const checked = assertAgentName(payload.requestedAgent, 'requestedAgent');
      if (checked === 'router') {
        throw new AppError(
          'VALIDATION_FAILED',
          'requestedAgent must be a specialist agent, not "router"',
        );
      }
      requestedAgent = checked;
    }

    const attachmentFileIds = Array.isArray(payload.attachmentFileIds)
      ? payload.attachmentFileIds.map((id) => String(id))
      : undefined;

    return this.deps.orchestrator.sendMessage({
      userId: input.userId,
      conversationId: input.conversationId,
      requestId,
      traceId: input.traceId,
      prompt: trimmedPrompt,
      requestedAgent,
      attachmentFileIds,
    });
  }

  public async deleteConversation(input: {
    readonly userId: string;
    readonly conversationId: string;
    readonly requestId: string | undefined;
    readonly traceId: string;
  }): Promise<DeleteConversationResult> {
    const requestId = validateIdempotencyKey(input.requestId);
    return this.deps.orchestrator.deleteConversation({
      userId: input.userId,
      conversationId: input.conversationId,
      requestId,
      traceId: input.traceId,
    });
  }
}
