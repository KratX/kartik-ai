/**
 * @kartik/billing — Transactional Credit Reservation State Machine (Micro-step 4.2.a).
 *
 * Enforces Blueprint §5.2, §5.4, §5.6, §9 (Invariants #5, #6, #15, #16, #17, #20) & §11:
 * - Reserve before expensive execution; settle after the result is durable; release on confirmed failure.
 * - Every mutation runs inside `BillingRepository.withLockedAccount` (`SELECT ... FOR UPDATE`).
 * - Reusing `requestId` (`Idempotency-Key`) with identical payload replays the result idempotently;
 *   reusing `requestId` with a different payload fails with `409 IDEMPOTENCY_CONFLICT`.
 * - Writes 30-day money idempotency keys (`idem:{userId}:{requestId}`, TTL 2,592,000s) to Redis
 *   as a fast cache while PostgreSQL remains the authoritative store (Invariant #16).
 */

import {
  AppError,
  REDIS_TTL_SECONDS,
  RedisKeys,
  assertAgentName,
  computePayloadFingerprint,
  validateIdempotencyKey,
  type BillingOperation,
  type CreditReleaseRequest,
  type CreditReserveRequest,
  type CreditReserveResponse,
  type CreditSettleRequest,
  type ReservationState,
  type SpecialistAgentName,
} from '@kartik/shared';
import type {
  CreditAccountRecord,
  CreditReservationRecord,
  ReservationStatus,
} from '../models/index.js';
import type { BillingRepository } from '../repositories/index.js';

/**
 * Authoritative server-side credit cost per operation (§11).
 * The caller sends an operation and specialist agent, never an untrusted client amount.
 */
export const OPERATION_CREDIT_COSTS: Readonly<Record<BillingOperation, number>> = Object.freeze({
  chat_turn: 10,
  web_search: 15,
  code_generation: 20,
  pdf_rag_query: 15,
  vision_analysis: 20,
  image_generation: 30,
});

export function resolveOperationCreditCost(operation: BillingOperation): number {
  const cost = OPERATION_CREDIT_COSTS[operation];
  if (typeof cost !== 'number' || cost <= 0) {
    throw new AppError('VALIDATION_FAILED', `Unsupported billing operation: ${String(operation)}`);
  }
  return cost;
}

export interface MoneyIdempotencyRecord {
  readonly key: string;
  readonly payloadFingerprint: string;
  readonly reservationId: string;
  readonly status: ReservationState;
  readonly ttlSeconds: number;
}

export interface MoneyIdempotencyStore {
  get(key: string): Promise<MoneyIdempotencyRecord | null>;
  set(record: MoneyIdempotencyRecord): Promise<void>;
}

/**
 * In-memory 30-day money idempotency cache (`idem:{userId}:{requestId}`) for fast tests and mock mode.
 */
export class InMemoryMoneyIdempotencyStore implements MoneyIdempotencyStore {
  private readonly store = new Map<string, MoneyIdempotencyRecord>();

  async get(key: string): Promise<MoneyIdempotencyRecord | null> {
    return this.store.get(key) ?? null;
  }

  async set(record: MoneyIdempotencyRecord): Promise<void> {
    this.store.set(record.key, record);
  }
}

export interface CreditSettleResponse {
  readonly reservationId: string;
  readonly requestId: string;
  readonly status: ReservationState;
  readonly reservedCredits: number;
  readonly settledCredits: number;
  readonly refundedCredits: number;
  readonly availableCreditsAfter: number;
  readonly reservedCreditsAfter: number;
}

export interface CreditReleaseResponse {
  readonly reservationId: string;
  readonly requestId: string;
  readonly status: ReservationState;
  readonly releasedCredits: number;
  readonly availableCreditsAfter: number;
  readonly reservedCreditsAfter: number;
}

export interface CreditReservationServiceOptions {
  readonly repository: BillingRepository;
  readonly idempotencyStore?: MoneyIdempotencyStore;
  readonly initialFreeCredits?: number;
  readonly reservationTtlSeconds?: number;
}

function toWireStatus(status: ReservationStatus): ReservationState {
  switch (status) {
    case 'RESERVED':
      return 'reserved';
    case 'SETTLED':
      return 'settled';
    case 'RELEASED':
      return 'released';
    case 'EXPIRED':
      return 'expired';
  }
}

function toReserveResponse(record: CreditReservationRecord): CreditReserveResponse {
  return {
    reservationId: record.id,
    requestId: record.requestId,
    reservedCredits: record.reservedCredits,
    status: toWireStatus(record.status),
    expiresAt: record.expiresAt,
  };
}

export class CreditReservationService {
  private readonly repository: BillingRepository;
  private readonly idempotencyStore: MoneyIdempotencyStore;
  private readonly initialFreeCredits: number;
  private readonly reservationTtlSeconds: number;

  constructor(options: CreditReservationServiceOptions) {
    this.repository = options.repository;
    this.idempotencyStore = options.idempotencyStore ?? new InMemoryMoneyIdempotencyStore();
    this.initialFreeCredits = options.initialFreeCredits ?? 100;
    this.reservationTtlSeconds = options.reservationTtlSeconds ?? 900;
  }

  async getBalance(userId: string): Promise<CreditAccountRecord> {
    if (!userId || !userId.trim()) {
      throw new AppError('VALIDATION_FAILED', 'userId is required');
    }
    return this.repository.ensureAccount(userId.trim(), this.initialFreeCredits);
  }

  /**
   * Reserves credits inside a `SELECT ... FOR UPDATE` transaction before Agent execution.
   *
   * - Enforces `Idempotency-Key` (`requestId`) validation without rewriting it (Invariant #15).
   * - Computes a deterministic SHA-256 fingerprint of `{ userId, conversationId, agent, operation }`.
   * - If `(userId, requestId)` already exists with the same fingerprint, replays the existing reservation.
   * - If `(userId, requestId)` already exists with a different fingerprint, throws `409 IDEMPOTENCY_CONFLICT`.
   * - If `availableCredits < requiredCredits`, throws `402 QUOTA_EXHAUSTED` without mutating the balance.
   */
  async reserveCredits(
    req: CreditReserveRequest & { readonly creditsOverride?: number },
  ): Promise<CreditReserveResponse> {
    const requestId = validateIdempotencyKey(req.requestId);
    const userId = req.userId?.trim();
    const conversationId = req.conversationId?.trim();
    if (!userId || !conversationId) {
      throw new AppError('VALIDATION_FAILED', 'userId and conversationId are required');
    }

    const agent = assertAgentName(req.agent, 'agent') as SpecialistAgentName;
    if (agent === ('router' as unknown as SpecialistAgentName)) {
      throw new AppError('VALIDATION_FAILED', 'Specialist agent cannot be router');
    }

    const creditsToReserve =
      req.creditsOverride !== undefined
        ? req.creditsOverride
        : resolveOperationCreditCost(req.operation);

    if (!Number.isInteger(creditsToReserve) || creditsToReserve <= 0) {
      throw new AppError('VALIDATION_FAILED', 'creditsToReserve must be a positive integer');
    }

    const payloadFingerprint = computePayloadFingerprint({
      userId,
      conversationId,
      agent,
      operation: req.operation,
      creditsToReserve,
    });

    const idemKeySpec = RedisKeys.idempotency(userId, requestId, 'money');

    return this.repository.withLockedAccount(
      userId,
      this.initialFreeCredits,
      async (tx) => {
        const existing = await tx.getReservationByRequestId(requestId);
        if (existing) {
          if (existing.payloadFingerprint !== payloadFingerprint) {
            throw new AppError(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency-Key was already used with a different reservation payload (§5.4)',
            );
          }
          return toReserveResponse(existing);
        }

        if (tx.account.availableCredits < creditsToReserve) {
          throw new AppError(
            'QUOTA_EXHAUSTED',
            `Insufficient available credits: required ${creditsToReserve}, available ${tx.account.availableCredits}`,
          );
        }

        const newAvailable = tx.account.availableCredits - creditsToReserve;
        const newReserved = tx.account.reservedCredits + creditsToReserve;

        await tx.updateAccountBalances({
          availableCredits: newAvailable,
          reservedCredits: newReserved,
        });

        const expiresAt = new Date(
          Date.now() + this.reservationTtlSeconds * 1000,
        ).toISOString();

        const reservation = await tx.createReservation({
          userId,
          requestId,
          conversationId,
          agentName: agent,
          reservedCredits: creditsToReserve,
          payloadFingerprint,
          expiresAt,
        });

        await tx.appendLedgerEntry({
          userId,
          requestId,
          entryType: 'RESERVE_HOLD',
          deltaCredits: -creditsToReserve,
          balanceAfter: newAvailable,
          reservationId: reservation.id,
          description: `Reserved ${creditsToReserve} credits for ${agent} (${req.operation})`,
        });

        await this.idempotencyStore.set({
          key: idemKeySpec.key,
          payloadFingerprint,
          reservationId: reservation.id,
          status: 'reserved',
          ttlSeconds: REDIS_TTL_SECONDS.IDEMPOTENCY_MONEY,
        });

        return toReserveResponse(reservation);
      },
    );
  }

  /**
   * Settles a previously reserved credit hold inside a `SELECT ... FOR UPDATE` transaction
   * after the Agent result is durably stored by Chat.
   */
  async settleCredits(req: CreditSettleRequest): Promise<CreditSettleResponse> {
    const requestId = validateIdempotencyKey(req.requestId);
    const userId = req.userId?.trim();
    const reservationId = req.reservationId?.trim();
    if (!userId || !reservationId) {
      throw new AppError('VALIDATION_FAILED', 'userId and reservationId are required');
    }

    return this.repository.withLockedAccount(
      userId,
      this.initialFreeCredits,
      async (tx) => {
        const reservation = await tx.getReservationByRequestId(requestId);
        if (!reservation || reservation.id !== reservationId) {
          throw new AppError('NOT_FOUND', 'Credit reservation not found');
        }

        const settledCredits =
          req.actualUnits !== undefined
            ? Math.min(Math.max(0, Math.trunc(req.actualUnits)), reservation.reservedCredits)
            : reservation.reservedCredits;

        if (reservation.status === 'SETTLED') {
          const prevSettled = reservation.settledCredits ?? reservation.reservedCredits;
          if (req.actualUnits !== undefined && prevSettled !== settledCredits) {
            throw new AppError(
              'IDEMPOTENCY_CONFLICT',
              'Reservation was already settled with a different credit amount',
            );
          }
          return {
            reservationId: reservation.id,
            requestId: reservation.requestId,
            status: 'settled',
            reservedCredits: reservation.reservedCredits,
            settledCredits: prevSettled,
            refundedCredits: reservation.reservedCredits - prevSettled,
            availableCreditsAfter: tx.account.availableCredits,
            reservedCreditsAfter: tx.account.reservedCredits,
          };
        }

        if (reservation.status !== 'RESERVED') {
          throw new AppError(
            'IDEMPOTENCY_CONFLICT',
            `Cannot settle reservation in status ${reservation.status}`,
          );
        }

        const refundedCredits = reservation.reservedCredits - settledCredits;
        const newAvailable = tx.account.availableCredits + refundedCredits;
        const newReserved = tx.account.reservedCredits - reservation.reservedCredits;
        const newLifetimeDebited = tx.account.lifetimeDebited + settledCredits;

        const updatedAccount = await tx.updateAccountBalances({
          availableCredits: newAvailable,
          reservedCredits: newReserved,
          lifetimeDebited: newLifetimeDebited,
        });

        await tx.updateReservationStatus(reservation.id, 'SETTLED', settledCredits);

        await tx.appendLedgerEntry({
          userId,
          requestId,
          entryType: 'SETTLE_DEBIT',
          deltaCredits: -settledCredits,
          balanceAfter: updatedAccount.availableCredits,
          reservationId: reservation.id,
          description: `Settled ${settledCredits} credits (refunded ${refundedCredits} unused hold)`,
        });

        return {
          reservationId: reservation.id,
          requestId: reservation.requestId,
          status: 'settled',
          reservedCredits: reservation.reservedCredits,
          settledCredits,
          refundedCredits,
          availableCreditsAfter: updatedAccount.availableCredits,
          reservedCreditsAfter: updatedAccount.reservedCredits,
        };
      },
    );
  }

  /**
   * Releases a previously reserved credit hold inside a `SELECT ... FOR UPDATE` transaction
   * when an Agent execution fails definitively, restoring the user's `availableCredits`.
   */
  async releaseCredits(req: CreditReleaseRequest): Promise<CreditReleaseResponse> {
    const requestId = validateIdempotencyKey(req.requestId);
    const userId = req.userId?.trim();
    const reservationId = req.reservationId?.trim();
    if (!userId || !reservationId) {
      throw new AppError('VALIDATION_FAILED', 'userId and reservationId are required');
    }

    return this.repository.withLockedAccount(
      userId,
      this.initialFreeCredits,
      async (tx) => {
        const reservation = await tx.getReservationByRequestId(requestId);
        if (!reservation || reservation.id !== reservationId) {
          throw new AppError('NOT_FOUND', 'Credit reservation not found');
        }

        if (reservation.status === 'RELEASED') {
          return {
            reservationId: reservation.id,
            requestId: reservation.requestId,
            status: 'released',
            releasedCredits: reservation.reservedCredits,
            availableCreditsAfter: tx.account.availableCredits,
            reservedCreditsAfter: tx.account.reservedCredits,
          };
        }

        if (reservation.status !== 'RESERVED') {
          throw new AppError(
            'IDEMPOTENCY_CONFLICT',
            `Cannot release reservation in status ${reservation.status}`,
          );
        }

        const newAvailable = tx.account.availableCredits + reservation.reservedCredits;
        const newReserved = tx.account.reservedCredits - reservation.reservedCredits;

        const updatedAccount = await tx.updateAccountBalances({
          availableCredits: newAvailable,
          reservedCredits: newReserved,
        });

        await tx.updateReservationStatus(reservation.id, 'RELEASED', 0);

        await tx.appendLedgerEntry({
          userId,
          requestId,
          entryType: 'RELEASE_HOLD',
          deltaCredits: reservation.reservedCredits,
          balanceAfter: updatedAccount.availableCredits,
          reservationId: reservation.id,
          description: `Released ${reservation.reservedCredits} reserved credits (${req.reason || 'run failed'})`,
        });

        return {
          reservationId: reservation.id,
          requestId: reservation.requestId,
          status: 'released',
          releasedCredits: reservation.reservedCredits,
          availableCreditsAfter: updatedAccount.availableCredits,
          reservedCreditsAfter: updatedAccount.reservedCredits,
        };
      },
    );
  }
}
