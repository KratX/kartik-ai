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

export interface AgentExecuteRequest {
  readonly requestId: string;
  readonly traceId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly prompt: string;
  readonly preferredAgent?: SpecialistAgentName;
  readonly attachmentFileIds?: readonly string[];
}

export interface AgentExecuteResponse {
  readonly executionId: string;
  readonly requestId: string;
  readonly agent: SpecialistAgentName;
  readonly replyContent: string;
  readonly citations?: readonly {
    readonly sourceId: string;
    readonly title: string;
    readonly urlOrPage: string;
  }[];
  readonly artifactIds?: readonly string[];
  readonly usage: AgentUsageMetrics;
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
