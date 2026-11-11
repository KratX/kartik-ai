/**
 * @kartik/billing — BillingRepository with `SELECT ... FOR UPDATE` row locking (Micro-step 4.1.a).
 *
 * Enforces Blueprint §9 (Invariants #5, #6, #7, #17, #20):
 * - Invariant #17: Every credit and payment mutation is a single PostgreSQL transaction,
 *   and the balance row is locked with `SELECT ... FOR UPDATE` before it is read or modified.
 * - Never reads or writes another service's schema (`auth`, `chat`, `agent`).
 */

import { randomUUID } from 'node:crypto';
import {
  AppError,
  withTransaction,
  type DatabaseClient,
  type DatabasePool,
  type QueryResultRow,
} from '@kartik/shared';
import type {
  CreditAccountRecord,
  CreditLedgerEntryRecord,
  CreditReservationRecord,
  LedgerEntryType,
  PaymentOrderRecord,
  PlanId,
  ReservationStatus,
} from '../models/index.js';

export interface CreateReservationData {
  readonly userId: string;
  readonly requestId: string;
  readonly conversationId: string;
  readonly agentName: string;
  readonly reservedCredits: number;
  readonly payloadFingerprint: string;
  readonly expiresAt: string;
}

export interface AppendLedgerEntryData {
  readonly userId: string;
  readonly requestId: string;
  readonly entryType: LedgerEntryType;
  readonly deltaCredits: number;
  readonly balanceAfter: number;
  readonly reservationId?: string | null;
  readonly paymentOrderId?: string | null;
  readonly description: string;
}

export interface CreatePaymentOrderData {
  readonly userId: string;
  readonly planId: PlanId;
  readonly requestId: string;
  readonly providerOrderId: string;
  readonly amountPaise: number;
  readonly creditsGranted: number;
  readonly payloadFingerprint: string;
}

/**
 * Scoped transactional context where `credit_accounts` row for `userId` has already been
 * locked with `SELECT ... FOR UPDATE` (Invariant #17).
 */
export interface LockedBillingAccountTx {
  readonly account: CreditAccountRecord;
  updateAccountBalances(patch: {
    readonly availableCredits: number;
    readonly reservedCredits: number;
    readonly lifetimeCredited?: number;
    readonly lifetimeDebited?: number;
    readonly planId?: PlanId;
  }): Promise<CreditAccountRecord>;
  getReservationByRequestId(requestId: string): Promise<CreditReservationRecord | null>;
  createReservation(data: CreateReservationData): Promise<CreditReservationRecord>;
  updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
    settledCredits?: number | null,
  ): Promise<CreditReservationRecord>;
  appendLedgerEntry(data: AppendLedgerEntryData): Promise<CreditLedgerEntryRecord>;
  createPaymentOrder(data: CreatePaymentOrderData): Promise<PaymentOrderRecord>;
  getPaymentOrderByProviderOrderId(providerOrderId: string): Promise<PaymentOrderRecord | null>;
  getPaymentOrderByRequestId(requestId: string): Promise<PaymentOrderRecord | null>;
  markPaymentOrderPaid(
    orderId: string,
    providerPaymentId: string,
  ): Promise<PaymentOrderRecord>;
  recordWebhookEventOnce(
    eventId: string,
    providerOrderId: string,
    providerPaymentId: string,
  ): Promise<boolean>;
}

export interface BillingRepository {
  ensureAccount(userId: string, initialCredits: number): Promise<CreditAccountRecord>;
  withLockedAccount<T>(
    userId: string,
    initialCredits: number,
    fn: (tx: LockedBillingAccountTx) => Promise<T>,
  ): Promise<T>;
  listLedgerEntries(userId: string, limit?: number): Promise<readonly CreditLedgerEntryRecord[]>;
}

interface CreditAccountRow extends QueryResultRow {
  user_id: string;
  plan_id: PlanId;
  available_credits: number;
  reserved_credits: number;
  lifetime_credited: number;
  lifetime_debited: number;
  created_at: string | Date;
  updated_at: string | Date;
}

function mapAccountRow(row: CreditAccountRow): CreditAccountRecord {
  return {
    userId: row.user_id,
    planId: row.plan_id,
    availableCredits: Number(row.available_credits),
    reservedCredits: Number(row.reserved_credits),
    lifetimeCredited: Number(row.lifetime_credited),
    lifetimeDebited: Number(row.lifetime_debited),
    createdAt:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

/**
 * PostgreSQL implementation of `BillingRepository` enforcing `SELECT ... FOR UPDATE`
 * on `billing.credit_accounts` before any balance or reservation read/write (Invariant #17).
 */
export class PostgresBillingRepository implements BillingRepository {
  private readonly pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.pool = pool;
  }

  async ensureAccount(userId: string, initialCredits: number): Promise<CreditAccountRecord> {
    return this.withLockedAccount(userId, initialCredits, async (tx) => tx.account);
  }

  async withLockedAccount<T>(
    userId: string,
    initialCredits: number,
    fn: (tx: LockedBillingAccountTx) => Promise<T>,
  ): Promise<T> {
    return withTransaction(this.pool, async (client: DatabaseClient) => {
      // 1. Ensure row exists without overwriting existing balances
      await client.query(
        `
        INSERT INTO billing.credit_accounts (
          user_id, plan_id, available_credits, reserved_credits, lifetime_credited, lifetime_debited
        )
        VALUES ($1, 'free', $2, 0, $2, 0)
        ON CONFLICT (user_id) DO NOTHING
        `,
        [userId, initialCredits],
      );

      // 2. Lock the user's credit account row with SELECT ... FOR UPDATE (Invariant #17)
      const lockedResult = await client.query<CreditAccountRow>(
        `
        SELECT user_id, plan_id, available_credits, reserved_credits,
               lifetime_credited, lifetime_debited, created_at, updated_at
        FROM billing.credit_accounts
        WHERE user_id = $1
        FOR UPDATE
        `,
        [userId],
      );

      const lockedRow = lockedResult.rows[0];
      if (!lockedRow) {
        throw new AppError('INTERNAL_ERROR', 'Failed to lock billing credit account row');
      }

      // 3. Ensure initial grant ledger entry exists if initialCredits > 0
      if (initialCredits > 0) {
        await client.query(
          `
          INSERT INTO billing.credit_ledger_entries (
            id, user_id, request_id, entry_type, delta_credits, balance_after, description
          )
          VALUES ($1, $2, $3, 'INITIAL_GRANT', $4, $4, 'Initial free-tier credit allowance')
          ON CONFLICT (user_id, request_id, entry_type) DO NOTHING
          `,
          [randomUUID(), userId, `init_grant_${userId}`, initialCredits],
        );
      }

      let currentAccount = mapAccountRow(lockedRow);

      const txContext: LockedBillingAccountTx = {
        get account() {
          return currentAccount;
        },
        updateAccountBalances: async (patch) => {
          if (patch.availableCredits < 0 || patch.reservedCredits < 0) {
            throw new AppError(
              'QUOTA_EXHAUSTED',
              'Credit balance cannot become negative (Invariant #17)',
            );
          }
          const updated = await client.query<CreditAccountRow>(
            `
            UPDATE billing.credit_accounts
            SET available_credits = $2,
                reserved_credits = $3,
                lifetime_credited = COALESCE($4, lifetime_credited),
                lifetime_debited = COALESCE($5, lifetime_debited),
                plan_id = COALESCE($6, plan_id),
                updated_at = NOW()
            WHERE user_id = $1
            RETURNING user_id, plan_id, available_credits, reserved_credits,
                      lifetime_credited, lifetime_debited, created_at, updated_at
            `,
            [
              userId,
              patch.availableCredits,
              patch.reservedCredits,
              patch.lifetimeCredited ?? null,
              patch.lifetimeDebited ?? null,
              patch.planId ?? null,
            ],
          );
          currentAccount = mapAccountRow(updated.rows[0]!);
          return currentAccount;
        },
        getReservationByRequestId: async (requestId) => {
          const res = await client.query<QueryResultRow>(
            `
            SELECT id, user_id, request_id, conversation_id, agent_name,
                   reserved_credits, settled_credits, status, payload_fingerprint,
                   expires_at, created_at, updated_at
            FROM billing.credit_reservations
            WHERE user_id = $1 AND request_id = $2
            `,
            [userId, requestId],
          );
          const row = res.rows[0];
          if (!row) return null;
          return {
            id: String(row.id),
            userId: String(row.user_id),
            requestId: String(row.request_id),
            conversationId: String(row.conversation_id),
            agentName: String(row.agent_name),
            reservedCredits: Number(row.reserved_credits),
            settledCredits: row.settled_credits === null ? null : Number(row.settled_credits),
            status: row.status as ReservationStatus,
            payloadFingerprint: String(row.payload_fingerprint),
            expiresAt: String(row.expires_at),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          };
        },
        createReservation: async (data) => {
          const id = randomUUID();
          const now = new Date().toISOString();
          await client.query(
            `
            INSERT INTO billing.credit_reservations (
              id, user_id, request_id, conversation_id, agent_name,
              reserved_credits, settled_credits, status, payload_fingerprint, expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, NULL, 'RESERVED', $7, $8)
            `,
            [
              id,
              data.userId,
              data.requestId,
              data.conversationId,
              data.agentName,
              data.reservedCredits,
              data.payloadFingerprint,
              data.expiresAt,
            ],
          );
          return {
            id,
            userId: data.userId,
            requestId: data.requestId,
            conversationId: data.conversationId,
            agentName: data.agentName,
            reservedCredits: data.reservedCredits,
            settledCredits: null,
            status: 'RESERVED',
            payloadFingerprint: data.payloadFingerprint,
            expiresAt: data.expiresAt,
            createdAt: now,
            updatedAt: now,
          };
        },
        updateReservationStatus: async (reservationId, status, settledCredits = null) => {
          const res = await client.query<QueryResultRow>(
            `
            UPDATE billing.credit_reservations
            SET status = $2,
                settled_credits = $3,
                updated_at = NOW()
            WHERE id = $1 AND user_id = $4
            RETURNING id, user_id, request_id, conversation_id, agent_name,
                      reserved_credits, settled_credits, status, payload_fingerprint,
                      expires_at, created_at, updated_at
            `,
            [reservationId, status, settledCredits, userId],
          );
          const row = res.rows[0]!;
          return {
            id: String(row.id),
            userId: String(row.user_id),
            requestId: String(row.request_id),
            conversationId: String(row.conversation_id),
            agentName: String(row.agent_name),
            reservedCredits: Number(row.reserved_credits),
            settledCredits: row.settled_credits === null ? null : Number(row.settled_credits),
            status: row.status as ReservationStatus,
            payloadFingerprint: String(row.payload_fingerprint),
            expiresAt: String(row.expires_at),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          };
        },
        appendLedgerEntry: async (data) => {
          const id = randomUUID();
          const now = new Date().toISOString();
          await client.query(
            `
            INSERT INTO billing.credit_ledger_entries (
              id, user_id, request_id, entry_type, delta_credits, balance_after,
              reservation_id, payment_order_id, description
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            `,
            [
              id,
              data.userId,
              data.requestId,
              data.entryType,
              data.deltaCredits,
              data.balanceAfter,
              data.reservationId ?? null,
              data.paymentOrderId ?? null,
              data.description,
            ],
          );
          return {
            id,
            userId: data.userId,
            requestId: data.requestId,
            entryType: data.entryType,
            deltaCredits: data.deltaCredits,
            balanceAfter: data.balanceAfter,
            reservationId: data.reservationId ?? null,
            paymentOrderId: data.paymentOrderId ?? null,
            description: data.description,
            createdAt: now,
          };
        },
        createPaymentOrder: async (data) => {
          const id = randomUUID();
          const now = new Date().toISOString();
          await client.query(
            `
            INSERT INTO billing.payment_orders (
              id, user_id, plan_id, request_id, provider_order_id, provider_payment_id,
              amount_paise, currency, credits_granted, status, payload_fingerprint
            )
            VALUES ($1, $2, $3, $4, $5, NULL, $6, 'INR', $7, 'CREATED', $8)
            `,
            [
              id,
              data.userId,
              data.planId,
              data.requestId,
              data.providerOrderId,
              data.amountPaise,
              data.creditsGranted,
              data.payloadFingerprint,
            ],
          );
          return {
            id,
            userId: data.userId,
            planId: data.planId,
            requestId: data.requestId,
            providerOrderId: data.providerOrderId,
            providerPaymentId: null,
            amountPaise: data.amountPaise,
            currency: 'INR',
            creditsGranted: data.creditsGranted,
            status: 'CREATED',
            payloadFingerprint: data.payloadFingerprint,
            createdAt: now,
            updatedAt: now,
          };
        },
        getPaymentOrderByProviderOrderId: async (providerOrderId) => {
          const res = await client.query<QueryResultRow>(
            `
            SELECT id, user_id, plan_id, request_id, provider_order_id, provider_payment_id,
                   amount_paise, currency, credits_granted, status, payload_fingerprint,
                   created_at, updated_at
            FROM billing.payment_orders
            WHERE user_id = $1 AND provider_order_id = $2
            `,
            [userId, providerOrderId],
          );
          const row = res.rows[0];
          if (!row) return null;
          return {
            id: String(row.id),
            userId: String(row.user_id),
            planId: row.plan_id as PlanId,
            requestId: String(row.request_id),
            providerOrderId: String(row.provider_order_id),
            providerPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
            amountPaise: Number(row.amount_paise),
            currency: 'INR',
            creditsGranted: Number(row.credits_granted),
            status: row.status as PaymentOrderRecord['status'],
            payloadFingerprint: String(row.payload_fingerprint),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          };
        },
        getPaymentOrderByRequestId: async (requestId) => {
          const res = await client.query<QueryResultRow>(
            `
            SELECT id, user_id, plan_id, request_id, provider_order_id, provider_payment_id,
                   amount_paise, currency, credits_granted, status, payload_fingerprint,
                   created_at, updated_at
            FROM billing.payment_orders
            WHERE user_id = $1 AND request_id = $2
            `,
            [userId, requestId],
          );
          const row = res.rows[0];
          if (!row) return null;
          return {
            id: String(row.id),
            userId: String(row.user_id),
            planId: row.plan_id as PlanId,
            requestId: String(row.request_id),
            providerOrderId: String(row.provider_order_id),
            providerPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
            amountPaise: Number(row.amount_paise),
            currency: 'INR',
            creditsGranted: Number(row.credits_granted),
            status: row.status as PaymentOrderRecord['status'],
            payloadFingerprint: String(row.payload_fingerprint),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          };
        },
        markPaymentOrderPaid: async (orderId, providerPaymentId) => {
          const res = await client.query<QueryResultRow>(
            `
            UPDATE billing.payment_orders
            SET status = 'PAID',
                provider_payment_id = $2,
                updated_at = NOW()
            WHERE id = $1 AND user_id = $3
            RETURNING id, user_id, plan_id, request_id, provider_order_id, provider_payment_id,
                      amount_paise, currency, credits_granted, status, payload_fingerprint,
                      created_at, updated_at
            `,
            [orderId, providerPaymentId, userId],
          );
          const row = res.rows[0]!;
          return {
            id: String(row.id),
            userId: String(row.user_id),
            planId: row.plan_id as PlanId,
            requestId: String(row.request_id),
            providerOrderId: String(row.provider_order_id),
            providerPaymentId: row.provider_payment_id ? String(row.provider_payment_id) : null,
            amountPaise: Number(row.amount_paise),
            currency: 'INR',
            creditsGranted: Number(row.credits_granted),
            status: row.status as PaymentOrderRecord['status'],
            payloadFingerprint: String(row.payload_fingerprint),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          };
        },
        recordWebhookEventOnce: async (eventId, providerOrderId, providerPaymentId) => {
          const res = await client.query(
            `
            INSERT INTO billing.webhook_events (event_id, provider_order_id, provider_payment_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (event_id) DO NOTHING
            `,
            [eventId, providerOrderId, providerPaymentId],
          );
          return res.rowCount > 0;
        },
      };

      return fn(txContext);
    });
  }

  async listLedgerEntries(
    userId: string,
    limit = 50,
  ): Promise<readonly CreditLedgerEntryRecord[]> {
    const client = await this.pool.connect();
    try {
      const res = await client.query<QueryResultRow>(
        `
        SELECT id, user_id, request_id, entry_type, delta_credits, balance_after,
               reservation_id, payment_order_id, description, created_at
        FROM billing.credit_ledger_entries
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        `,
        [userId, limit],
      );
      return res.rows.map((row) => ({
        id: String(row.id),
        userId: String(row.user_id),
        requestId: String(row.request_id),
        entryType: row.entry_type as LedgerEntryType,
        deltaCredits: Number(row.delta_credits),
        balanceAfter: Number(row.balance_after),
        reservationId: row.reservation_id ? String(row.reservation_id) : null,
        paymentOrderId: row.payment_order_id ? String(row.payment_order_id) : null,
        description: String(row.description),
        createdAt: String(row.created_at),
      }));
    } finally {
      client.release();
    }
  }
}

/**
 * Deterministic in-memory `BillingRepository` with per-user async mutex row locks
 * and atomic snapshot rollback on error, modeling PostgreSQL `SELECT ... FOR UPDATE`
 * semantics for fast unit & concurrency testing (Invariant #17).
 */
export class InMemoryBillingRepository implements BillingRepository {
  private readonly accounts = new Map<string, CreditAccountRecord>();
  private readonly reservations = new Map<string, CreditReservationRecord>();
  private readonly ledgerEntries: CreditLedgerEntryRecord[] = [];
  private readonly paymentOrders = new Map<string, PaymentOrderRecord>();
  private readonly webhookEvents = new Set<string>();
  private readonly userLocks = new Map<string, Promise<void>>();

  async ensureAccount(userId: string, initialCredits: number): Promise<CreditAccountRecord> {
    return this.withLockedAccount(userId, initialCredits, async (tx) => tx.account);
  }

  async withLockedAccount<T>(
    userId: string,
    initialCredits: number,
    fn: (tx: LockedBillingAccountTx) => Promise<T>,
  ): Promise<T> {
    const previousLock = this.userLocks.get(userId) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.userLocks.set(
      userId,
      previousLock.then(() => currentLock),
    );

    await previousLock;

    const snapshotAccounts = new Map(this.accounts);
    const snapshotReservations = new Map(this.reservations);
    const snapshotLedgerLength = this.ledgerEntries.length;
    const snapshotOrders = new Map(this.paymentOrders);
    const snapshotWebhooks = new Set(this.webhookEvents);

    try {
      let currentAccount = this.accounts.get(userId);
      if (!currentAccount) {
        const now = new Date().toISOString();
        currentAccount = {
          userId,
          planId: 'free',
          availableCredits: initialCredits,
          reservedCredits: 0,
          lifetimeCredited: initialCredits,
          lifetimeDebited: 0,
          createdAt: now,
          updatedAt: now,
        };
        this.accounts.set(userId, currentAccount);

        if (initialCredits > 0) {
          this.ledgerEntries.push({
            id: randomUUID(),
            userId,
            requestId: `init_grant_${userId}`,
            entryType: 'INITIAL_GRANT',
            deltaCredits: initialCredits,
            balanceAfter: initialCredits,
            reservationId: null,
            paymentOrderId: null,
            description: 'Initial free-tier credit allowance',
            createdAt: now,
          });
        }
      }

      const txContext: LockedBillingAccountTx = {
        get account() {
          return currentAccount!;
        },
        updateAccountBalances: async (patch) => {
          if (patch.availableCredits < 0 || patch.reservedCredits < 0) {
            throw new AppError(
              'QUOTA_EXHAUSTED',
              'Credit balance cannot become negative (Invariant #17)',
            );
          }
          currentAccount = {
            ...currentAccount!,
            availableCredits: patch.availableCredits,
            reservedCredits: patch.reservedCredits,
            lifetimeCredited: patch.lifetimeCredited ?? currentAccount!.lifetimeCredited,
            lifetimeDebited: patch.lifetimeDebited ?? currentAccount!.lifetimeDebited,
            planId: patch.planId ?? currentAccount!.planId,
            updatedAt: new Date().toISOString(),
          };
          this.accounts.set(userId, currentAccount);
          return currentAccount;
        },
        getReservationByRequestId: async (requestId) => {
          for (const res of this.reservations.values()) {
            if (res.userId === userId && res.requestId === requestId) {
              return res;
            }
          }
          return null;
        },
        createReservation: async (data) => {
          const now = new Date().toISOString();
          const record: CreditReservationRecord = {
            id: randomUUID(),
            userId: data.userId,
            requestId: data.requestId,
            conversationId: data.conversationId,
            agentName: data.agentName,
            reservedCredits: data.reservedCredits,
            settledCredits: null,
            status: 'RESERVED',
            payloadFingerprint: data.payloadFingerprint,
            expiresAt: data.expiresAt,
            createdAt: now,
            updatedAt: now,
          };
          this.reservations.set(record.id, record);
          return record;
        },
        updateReservationStatus: async (reservationId, status, settledCredits = null) => {
          const existing = this.reservations.get(reservationId);
          if (!existing || existing.userId !== userId) {
            throw new AppError('NOT_FOUND', 'Credit reservation not found');
          }
          const updated: CreditReservationRecord = {
            ...existing,
            status,
            settledCredits,
            updatedAt: new Date().toISOString(),
          };
          this.reservations.set(reservationId, updated);
          return updated;
        },
        appendLedgerEntry: async (data) => {
          const entry: CreditLedgerEntryRecord = {
            id: randomUUID(),
            userId: data.userId,
            requestId: data.requestId,
            entryType: data.entryType,
            deltaCredits: data.deltaCredits,
            balanceAfter: data.balanceAfter,
            reservationId: data.reservationId ?? null,
            paymentOrderId: data.paymentOrderId ?? null,
            description: data.description,
            createdAt: new Date().toISOString(),
          };
          this.ledgerEntries.push(entry);
          return entry;
        },
        createPaymentOrder: async (data) => {
          const now = new Date().toISOString();
          const record: PaymentOrderRecord = {
            id: randomUUID(),
            userId: data.userId,
            planId: data.planId,
            requestId: data.requestId,
            providerOrderId: data.providerOrderId,
            providerPaymentId: null,
            amountPaise: data.amountPaise,
            currency: 'INR',
            creditsGranted: data.creditsGranted,
            status: 'CREATED',
            payloadFingerprint: data.payloadFingerprint,
            createdAt: now,
            updatedAt: now,
          };
          this.paymentOrders.set(record.id, record);
          return record;
        },
        getPaymentOrderByProviderOrderId: async (providerOrderId) => {
          for (const order of this.paymentOrders.values()) {
            if (order.userId === userId && order.providerOrderId === providerOrderId) {
              return order;
            }
          }
          return null;
        },
        getPaymentOrderByRequestId: async (requestId) => {
          for (const order of this.paymentOrders.values()) {
            if (order.userId === userId && order.requestId === requestId) {
              return order;
            }
          }
          return null;
        },
        markPaymentOrderPaid: async (orderId, providerPaymentId) => {
          const existing = this.paymentOrders.get(orderId);
          if (!existing || existing.userId !== userId) {
            throw new AppError('NOT_FOUND', 'Payment order not found');
          }
          const updated: PaymentOrderRecord = {
            ...existing,
            status: 'PAID',
            providerPaymentId,
            updatedAt: new Date().toISOString(),
          };
          this.paymentOrders.set(orderId, updated);
          return updated;
        },
        recordWebhookEventOnce: async (eventId) => {
          if (this.webhookEvents.has(eventId)) {
            return false;
          }
          this.webhookEvents.add(eventId);
          return true;
        },
      };

      return await fn(txContext);
    } catch (err) {
      this.accounts.clear();
      for (const [k, v] of snapshotAccounts) this.accounts.set(k, v);
      this.reservations.clear();
      for (const [k, v] of snapshotReservations) this.reservations.set(k, v);
      this.ledgerEntries.length = snapshotLedgerLength;
      this.paymentOrders.clear();
      for (const [k, v] of snapshotOrders) this.paymentOrders.set(k, v);
      this.webhookEvents.clear();
      for (const k of snapshotWebhooks) this.webhookEvents.add(k);
      throw err;
    } finally {
      releaseLock();
    }
  }

  async listLedgerEntries(
    userId: string,
    limit = 50,
  ): Promise<readonly CreditLedgerEntryRecord[]> {
    return this.ledgerEntries
      .filter((entry) => entry.userId === userId)
      .slice()
      .reverse()
      .slice(0, limit);
  }
}
