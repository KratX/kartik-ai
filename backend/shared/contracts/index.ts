/**
 * @kartik/shared/contracts — Domain State Unions, Agent Catalogue & Wire Contracts
 * (Blueprint §5.3, §5.4, §5.6 & Architecture Invariants #6, #7, #15).
 *
 * Architectural rules enforced here:
 * 1. Closed `AgentName` union (`router`, `chat`, `search`, `coding`, `rag`, `vision`, `image`).
 * 2. Canonical lifecycle state unions (`AgentRunState`, `DeletionState`, `FileIngestionState`, `ReservationState`).
 * 3. Deterministic SHA-256 request payload fingerprinting (`computePayloadFingerprint`) so
 *    retries with the same `Idempotency-Key` + identical payload replay the stored result,
 *    while retries with a mutated payload fail with `409 IDEMPOTENCY_CONFLICT` (§5.4).
 */
import { createHash } from 'node:crypto';
import { AppError } from '../errors/index.js';

export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key' as const;

export const AGENT_NAMES = [
  'router',
  'chat',
  'search',
  'coding',
  'pdf',
  'ppt',
  'rag',
  'vision',
  'image',
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];
export type SpecialistAgentName = Exclude<AgentName, 'router'>;

export const SPECIALIST_AGENT_NAMES: readonly SpecialistAgentName[] = Object.freeze([
  'chat',
  'search',
  'coding',
  'pdf',
  'ppt',
  'rag',
  'vision',
  'image',
]);

export function isAgentName(value: unknown): value is AgentName {
  return typeof value === 'string' && (AGENT_NAMES as readonly string[]).includes(value);
}

export function assertAgentName(value: unknown, fieldName = 'agent'): AgentName {
  if (!isAgentName(value)) {
    throw new AppError('VALIDATION_FAILED', `Invalid ${fieldName}: must be one of ${AGENT_NAMES.join(', ')}`, {
      details: { [fieldName]: [`Expected one of: ${AGENT_NAMES.join(', ')}`] },
    });
  }
  return value;
}

export const AGENT_RUN_STATES = [
  'pending',
  'reserved',
  'executing',
  'completed',
  'execution_unknown',
  'failed',
  'released',
] as const;
export type AgentRunState = (typeof AGENT_RUN_STATES)[number];

export const DELETION_STATES = [
  'active',
  'requested',
  'purging',
  'purged',
  'failed',
] as const;
export type DeletionState = (typeof DELETION_STATES)[number];

export const FILE_INGESTION_STATES = [
  'uploaded',
  'processing',
  'indexed',
  'failed',
  'deleted',
] as const;
export type FileIngestionState = (typeof FILE_INGESTION_STATES)[number];

export const RESERVATION_STATES = [
  'reserved',
  'settled',
  'released',
  'expired',
] as const;
export type ReservationState = (typeof RESERVATION_STATES)[number];

export const BILLING_OPERATIONS = [
  'chat_turn',
  'web_search',
  'code_generation',
  'pdf_generation',
  'ppt_generation',
  'pdf_rag_query',
  'vision_analysis',
  'image_generation',
] as const;
export type BillingOperation = (typeof BILLING_OPERATIONS)[number];

export interface CreditReserveRequest {
  readonly requestId: string;
  readonly traceId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly agent: SpecialistAgentName;
  readonly operation: BillingOperation;
}

export interface CreditReserveResponse {
  readonly reservationId: string;
  readonly requestId: string;
  readonly reservedCredits: number;
  readonly status: ReservationState;
  readonly expiresAt: string;
}

export interface CreditSettleRequest {
  readonly requestId: string;
  readonly reservationId: string;
  readonly traceId: string;
  readonly userId: string;
  readonly actualUnits?: number;
}

export interface CreditReleaseRequest {
  readonly requestId: string;
  readonly reservationId: string;
  readonly traceId: string;
  readonly userId: string;
  readonly reason: string;
}

export interface ArtifactManifestFile {
  readonly path: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

export interface ArtifactManifest {
  readonly title: string;
  readonly entryFile: string;
  readonly files: readonly ArtifactManifestFile[];
}

export interface AgentUsageMetrics {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
  readonly mock: boolean;
}

export type ChatResponseDepth = 'concise' | 'balanced' | 'deep';

export interface ConversationHistoryTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly agentUsed?: SpecialistAgentName;
}

export interface ThreadContextFile {
  readonly filename: string;
  readonly mimeType: string;
  readonly pageCount?: number | null;
}

export interface ThreadContextArtifact {
  readonly title: string;
  readonly artifactType: string;
}

export interface ConversationThreadContext {
  readonly files?: readonly ThreadContextFile[];
  readonly artifacts?: readonly ThreadContextArtifact[];
}

export interface SpecialistRoutingDecision {
  readonly agent: SpecialistAgentName;
  readonly routedFromChat: boolean;
  readonly reason?: string;
}

export interface AgentExecuteRequest {
  readonly requestId: string;
  readonly traceId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly prompt: string;
  readonly preferredAgent?: SpecialistAgentName;
  readonly attachmentFileIds?: readonly string[];
  readonly responseDepth?: ChatResponseDepth;
  readonly conversationHistory?: readonly ConversationHistoryTurn[];
  readonly threadContext?: ConversationThreadContext;
}

export interface AgentCitation {
  readonly sourceId: string;
  readonly title: string;
  readonly urlOrPage: string;
  readonly domain?: string;
  readonly snippet?: string;
  readonly score?: number;
  readonly publishedAt?: string;
  readonly sourceType?: 'web' | 'news' | 'encyclopedia' | 'technical' | 'document';
}

export interface SearchImageGalleryItem {
  readonly id: string;
  readonly title: string;
  readonly imageUrl: string;
  readonly sourceUrl: string;
  readonly domain?: string;
}

export interface AgentExecuteResponse {
  readonly executionId: string;
  readonly requestId: string;
  readonly agent: SpecialistAgentName;
  readonly replyContent: string;
  readonly citations?: readonly AgentCitation[];
  readonly searchImages?: readonly SearchImageGalleryItem[];
  readonly followUpQueries?: readonly string[];
  readonly artifactIds?: readonly string[];
  readonly routedFromChat?: boolean;
  readonly routingReason?: string;
  readonly chatMode?: string;
  readonly responseDepth?: ChatResponseDepth;
  readonly usage: AgentUsageMetrics;
}

/**
 * Shared deterministic detector for live / real-time / verifiable web-search queries.
 * Used by both `@kartik/chat` (`resolveTargetSpecialist`) and `@kartik/agent`
 * (`routePromptToSpecialist`) so pre-execution credit reservation and graph routing stay aligned.
 */
export function isLiveWebSearchPrompt(prompt: string): boolean {
  const lower = prompt.trim().toLowerCase();
  if (!lower) {
    return false;
  }
  return (
    /\b(search the web|web search|look up online|cite sources|latest news|breaking news|recent news|news about|news on)\b/.test(
      lower,
    ) ||
    /\b(current price|stock price|share price|market cap|exchange rate|bitcoin price|crypto price|weather in|forecast for)\b/.test(
      lower,
    ) ||
    /\b(who won|match score|final score|standings|release date|when does .+ come out|what happened (?:today|yesterday|this week|recently))\b/.test(
      lower,
    ) ||
    /\b(latest|newest|current|recent|today(?:'s)?|this week(?:'s)?)\s+(version|release|update|benchmark|benchmarks|model|report|stats|status|ceo|president|prime minister|election|laws|regulations)\b/.test(
      lower,
    ) ||
    (/\b(2025|2026|2027)\b/.test(lower) &&
      /\b(latest|new|release|benchmark|news|price|update|announced|launch|winner|report|compare|vs)\b/.test(
        lower,
      ))
  );
}

/**
 * Fix #21: Single canonical Smart Hybrid Router shared by `@kartik/chat` (`resolveTargetSpecialist`)
 * and `@kartik/agent` (`routePromptToSpecialist`).
 *
 * Keeps conceptual technical/programming Q&A inside Chat (`1 credit`) while transparently delegating
 * explicit builds, documents, decks, visual generation, live web lookups, and file attachments to the
 * matching specialist with a crisp human-readable routing reason.
 */
export function classifySpecialistRoute(input: {
  readonly prompt: string;
  readonly preferredAgent?: SpecialistAgentName;
  readonly hasPdfAttachment?: boolean;
  readonly hasImageAttachment?: boolean;
}): SpecialistRoutingDecision {
  if (input.preferredAgent !== undefined) {
    return {
      agent: input.preferredAgent,
      routedFromChat: false,
    };
  }

  if (input.hasPdfAttachment) {
    return {
      agent: 'rag',
      routedFromChat: true,
      reason: 'Attached PDF document',
    };
  }
  if (input.hasImageAttachment) {
    return {
      agent: 'vision',
      routedFromChat: true,
      reason: 'Attached image inspection',
    };
  }

  const lower = input.prompt.trim().toLowerCase();

  if (
    /\b(generate an? image|generate image|draw\s+(?:a|an|me|the)\b|illustration of|create an? image|create image|make an? image|render a picture|render an? illustration|generate artwork|design a logo|generate a poster|concept art of|photorealistic image)\b/.test(
      lower,
    )
  ) {
    return {
      agent: 'image',
      routedFromChat: true,
      reason: 'Visual artwork request',
    };
  }

  if (
    /\b(create a ppt|generate a ppt|create a presentation|generate a presentation|make a presentation|slide deck|powerpoint|slides on|slides about|\d+-slide\s+(?:deck|presentation))\b/.test(
      lower,
    )
  ) {
    return {
      agent: 'ppt',
      routedFromChat: true,
      reason: 'Slide deck generation',
    };
  }

  if (
    /\b(generate a pdf|create a pdf|compile a pdf|pdf report|export pdf|export as pdf|write a pdf)\b/.test(
      lower,
    )
  ) {
    return {
      agent: 'pdf',
      routedFromChat: true,
      reason: 'PDF document generation',
    };
  }

  if (
    /\b(build an app|build a [a-z0-9\s-]{1,36}?(?:app|clone|calculator|dashboard|game|website|tool|widget|tracker|ui)|write code|create a (?:react |html )?component|react component|html,\s*css|sandbox|debug this|fix this bug|refactor this|implement (?:a |an |the )?[a-z0-9_-]+(?:\s+(?:function|class|hook|algorithm|component|api|endpoint|service|parser)))\b/.test(
      lower,
    )
  ) {
    return {
      agent: 'coding',
      routedFromChat: true,
      reason: 'Code & sandbox request',
    };
  }

  if (isLiveWebSearchPrompt(input.prompt)) {
    return {
      agent: 'search',
      routedFromChat: true,
      reason: 'Live web lookup',
    };
  }

  if (
    /\b(in the uploaded pdf|according to the uploaded|according to the document|page number in the pdf|uploaded file)\b/.test(
      lower,
    )
  ) {
    return {
      agent: 'rag',
      routedFromChat: true,
      reason: 'Uploaded document query',
    };
  }

  return {
    agent: 'chat',
    routedFromChat: false,
  };
}

/**
 * Recursively canonicalizes a JSON-serializable value by sorting object keys
 * lexicographically so equivalent payloads always produce the same string.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalizeJson(item));
    return `[${items.join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const sortedKeys = Object.keys(record)
      .filter((k) => record[k] !== undefined)
      .sort();
    const pairs = sortedKeys.map((k) => `${JSON.stringify(k)}:${canonicalizeJson(record[k])}`);
    return `{${pairs.join(',')}}`;
  }
  return 'null';
}

/**
 * Computes a deterministic 64-char hex SHA-256 fingerprint of a request payload (§5.4).
 * Used by Chat and Billing to detect when a client reuses an `Idempotency-Key`
 * (`requestId`) with a different request body (`409 IDEMPOTENCY_CONFLICT`).
 */
export function computePayloadFingerprint(payload: unknown): string {
  const canonical = canonicalizeJson(payload);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
