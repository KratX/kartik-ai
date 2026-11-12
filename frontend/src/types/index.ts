/**
 * @kartik/frontend/types — Frontend Domain & API Envelope Contracts (Micro-step 7.1.a).
 *
 * Mirrors the public API Gateway (`/api/v1/*`) contracts without importing backend service internals
 * (Invariant #1: The browser talks to the backend only through the API Gateway).
 */

export type SpecialistAgentName =
  | 'chat'
  | 'search'
  | 'coding'
  | 'rag'
  | 'vision'
  | 'image';

export type FrontendErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CURSOR'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'QUOTA_EXHAUSTED'
  | 'FORBIDDEN'
  | 'DEMO_READ_ONLY'
  | 'NOT_FOUND'
  | 'RESOURCE_IN_USE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'EXECUTION_UNKNOWN'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'ARTIFACT_INVALID'
  | 'LIMITER_UNAVAILABLE'
  | 'PROVIDER_UNAVAILABLE'
  | 'BILLING_UNAVAILABLE'
  | 'PROVIDER_TIMEOUT';

/**
 * Deterministic client recovery action derived from Blueprint §5.5 error catalogue.
 */
export type ClientRecoveryAction =
  | 'retry_same_key'
  | 'retry_new_key'
  | 'reauthenticate'
  | 'top_up_quota'
  | 'read_only_mode'
  | 'back_off'
  | 'restart_list'
  | 'do_not_retry';

export interface ApiErrorPayload {
  readonly code: FrontendErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, readonly string[]>>;
}

export interface ApiResponseEnvelope<T> {
  readonly requestId?: string;
  readonly traceId: string;
  readonly data: T | null;
  readonly meta: {
    readonly nextCursor: string | null;
  };
  readonly error: ApiErrorPayload | null;
}

export interface AuthenticatedUserProfile {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface ConversationSummary {
  readonly conversationId: string;
  readonly userId: string;
  readonly title: string;
  readonly deletionState: 'active' | 'requested' | 'purging' | 'purged' | 'failed';
  readonly messageCount: number;
  readonly lastMessageAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MessageCitation {
  readonly sourceId: string;
  readonly title: string;
  readonly urlOrPage: string;
}

export interface ChatMessageItem {
  readonly messageId: string;
  readonly conversationId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly agentUsed: SpecialistAgentName | null;
  readonly attachmentFileIds: readonly string[];
  readonly artifactIds: readonly string[];
  readonly citations: readonly MessageCitation[];
  readonly createdAt: string;
}

export interface SendMessageTurnResponse {
  readonly conversationId: string;
  readonly requestId: string;
  readonly traceId: string;
  readonly userMessage: ChatMessageItem;
  readonly assistantMessage: ChatMessageItem;
  readonly remainingCredits: number;
  readonly idempotentReplay: boolean;
}

export interface CreditBalanceSnapshot {
  readonly userId: string;
  readonly availableCredits: number;
  readonly reservedCredits: number;
  readonly lifetimeCredited: number;
  readonly lifetimeDebited: number;
}
