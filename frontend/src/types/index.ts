/**
 * @kartik/frontend/types — Frontend Domain & API Envelope Contracts (Micro-steps 7.1.a–7.3.a).
 *
 * Mirrors the public API Gateway (`/api/v1/*`) contracts without importing backend service internals
 * (Invariant #1: The browser talks to the backend only through the API Gateway).
 */

export type SpecialistAgentName =
  | 'chat'
  | 'search'
  | 'coding'
  | 'pdf'
  | 'ppt'
  | 'rag'
  | 'vision'
  | 'image';

export type ChatResponseDepth = 'concise' | 'balanced' | 'deep';

export type FrontendErrorCode =
  | 'VALIDATION_FAILED'
  | 'INVALID_CURSOR'
  | 'IDEMPOTENCY_KEY_REQUIRED'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'UNAUTHENTICATED'
  | 'QUOTA_EXHAUSTED'
  | 'FORBIDDEN'
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
  readonly domain?: string;
  readonly snippet?: string;
  readonly score?: number;
  readonly publishedAt?: string;
  readonly sourceType?:
    | 'gemini_grounding'
    | 'news'
    | 'encyclopedia'
    | 'technical'
    | 'community'
    | 'web'
    | 'document';
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

export type BillingPlanId = 'starter_100' | 'pro_500' | 'scale_2000';

export interface PaymentOrderSummary {
  readonly orderId: string;
  readonly razorpayOrderId: string;
  readonly planId: BillingPlanId;
  readonly amountPaise: number;
  readonly creditsGranted: number;
  readonly currency: 'INR';
  readonly status: 'CREATED' | 'PAID';
}

export interface PaymentVerificationResult {
  readonly orderId: string;
  readonly razorpayOrderId: string;
  readonly status: 'PAID';
  readonly creditsAdded: number;
  readonly availableCreditsAfter: number;
  readonly alreadyCredited: boolean;
}

export interface UploadedFileSummary {
  readonly fileId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly signedDownloadUrl?: string;
}

export type UploadedFileStatus = 'ready' | 'deleted';

export interface UploadedFileRecord {
  readonly fileId: string;
  readonly userId: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly sha256Hex: string;
  readonly pageCount: number | null;
  readonly chunkCount: number;
  readonly status: UploadedFileStatus;
  readonly createdAt: string;
}

export interface CodingArtifactFile {
  readonly path: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly content?: string;
}

export type ArtifactType =
  | 'code_bundle'
  | 'pdf_document'
  | 'ppt_presentation'
  | 'generated_image';

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

export interface SearchImageGalleryItem {
  readonly id: string;
  readonly title: string;
  readonly imageUrl: string;
  readonly sourceUrl: string;
  readonly domain?: string;
}

export interface PlatformUser {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly planId: 'plan_free' | 'plan_starter_199' | 'plan_pro_499';
}

export interface PlatformMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly agentUsed?: SpecialistAgentName;
  readonly routedFromChat?: boolean;
  readonly routingReason?: string;
  readonly chatMode?: string;
  readonly responseDepth?: ChatResponseDepth;
  readonly requestId?: string;
  readonly creditsCharged?: number;
  readonly idempotentReplay?: boolean;
  readonly citations?: readonly MessageCitation[];
  readonly searchImages?: readonly SearchImageGalleryItem[];
  readonly followUpQueries?: readonly string[];
  readonly artifactIds?: readonly string[];
  readonly artifacts?: readonly ArtifactRecord[];
  readonly attachedFiles?: readonly UploadedFileRecord[];
  readonly createdAt: string;
}

export interface PlatformConversation {
  readonly conversationId: string;
  readonly userId: string;
  readonly title: string;
  readonly deletionState: 'active' | 'deleted';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlatformCreditPlan {
  readonly planId: 'plan_starter_199' | 'plan_pro_499';
  readonly name: string;
  readonly badge: string;
  readonly amountPaise: number;
  readonly amountInrLabel: string;
  readonly creditsGranted: number;
  readonly features: readonly string[];
}

export interface PlatformLedgerEntry {
  readonly entryId: string;
  readonly timestamp: string;
  readonly description: string;
  readonly deltaCredits: number;
  readonly balanceAfter: number;
  readonly requestId: string;
}

export type ApiEnvelope<T> =
  | {
      readonly ok: true;
      readonly traceId: string;
      readonly requestId?: string;
      readonly data: T;
    }
  | {
      readonly ok: false;
      readonly traceId: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
      };
    };

