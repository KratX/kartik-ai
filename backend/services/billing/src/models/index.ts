/**
 * @kartik/billing — Domain Models, Integer Paise Plan Catalogue & 0001_billing_core.sql (Micro-step 4.1.a).
 *
 * Enforces Blueprint §5.1, §9 (Invariants #5, #6, #17) and §11 (Credits & payments):
 * - All monetary amounts in INR are stored and calculated in integer `paise` (1 INR = 100 paise);
 *   floating-point rupees are strictly forbidden.
 * - Credit balances (`available_credits`, `reserved_credits`) are non-negative integers protected
 *   by database CHECK constraints and mutated exclusively inside `SELECT ... FOR UPDATE` transactions.
 */

import type { SqlMigrationFile } from '@kartik/shared';

export type PlanId = 'free' | 'starter_inr_499' | 'pro_inr_1499';

export interface BillingPlan {
  readonly id: PlanId;
  readonly name: string;
  /** Integer paise (e.g. 49900 = ₹499.00). Never floating-point rupees (§11). */
  readonly pricePaise: number;
  readonly currency: 'INR';
  readonly creditsGranted: number;
  readonly active: boolean;
}

/**
 * Authoritative server-side plan catalogue (§11: Billing calculates prices and credits
 * server-side; the browser sends a planId, never an authoritative amount).
 */
export const DEFAULT_BILLING_PLANS: readonly BillingPlan[] = Object.freeze([
  {
    id: 'free',
    name: 'Free Starter Allowance',
    pricePaise: 0,
    currency: 'INR',
    creditsGranted: 100,
    active: true,
  },
  {
    id: 'starter_inr_499',
    name: 'Starter Pack (500 Credits)',
    pricePaise: 49_900, // ₹499.00 in integer paise
    currency: 'INR',
    creditsGranted: 500,
    active: true,
  },
  {
    id: 'pro_inr_1499',
    name: 'Pro Pack (2,000 Credits)',
    pricePaise: 149_900, // ₹1,499.00 in integer paise
    currency: 'INR',
    creditsGranted: 2_000,
    active: true,
  },
]);

export function resolveBillingPlan(planId: string): BillingPlan | null {
  for (const plan of DEFAULT_BILLING_PLANS) {
    if (plan.id === planId && plan.active) {
      return plan;
    }
  }
  return null;
}

export interface CreditAccountRecord {
  readonly userId: string;
  readonly planId: PlanId;
  readonly availableCredits: number;
  readonly reservedCredits: number;
  readonly lifetimeCredited: number;
  readonly lifetimeDebited: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReservationStatus = 'RESERVED' | 'SETTLED' | 'RELEASED' | 'EXPIRED';

export interface CreditReservationRecord {
  readonly id: string;
  readonly userId: string;
  /** Client Idempotency-Key forwarded unchanged as requestId (Invariant #15). */
  readonly requestId: string;
  readonly conversationId: string;
  readonly agentName: string;
  readonly reservedCredits: number;
  readonly settledCredits: number | null;
  readonly status: ReservationStatus;
  readonly payloadFingerprint: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type LedgerEntryType =
  | 'INITIAL_GRANT'
  | 'RESERVE_HOLD'
  | 'SETTLE_DEBIT'
  | 'RELEASE_HOLD'
  | 'PURCHASE_CREDIT';

export interface CreditLedgerEntryRecord {
  readonly id: string;
  readonly userId: string;
  readonly requestId: string;
  readonly entryType: LedgerEntryType;
  /** Signed credit change applied to availableCredits (or settled debit). */
  readonly deltaCredits: number;
  readonly balanceAfter: number;
  readonly reservationId: string | null;
  readonly paymentOrderId: string | null;
  readonly description: string;
  readonly createdAt: string;
}

export type PaymentOrderStatus = 'CREATED' | 'PAID' | 'FAILED';

export interface PaymentOrderRecord {
  readonly id: string;
  readonly userId: string;
  readonly planId: PlanId;
  /** Client Idempotency-Key forwarded unchanged as requestId (Invariant #15). */
  readonly requestId: string;
  readonly providerOrderId: string;
  readonly providerPaymentId: string | null;
  /** Integer paise (never floating-point rupees). */
  readonly amountPaise: number;
  readonly currency: 'INR';
  readonly creditsGranted: number;
  readonly status: PaymentOrderStatus;
  readonly payloadFingerprint: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Forward-only SQL migration `0001_billing_core.sql` for the `billing` PostgreSQL schema.
 */
export const BILLING_INITIAL_MIGRATION: SqlMigrationFile = Object.freeze({
  version: '0001',
  filename: '0001_billing_core.sql',
  sql: `
CREATE SCHEMA IF NOT EXISTS billing;

CREATE TABLE IF NOT EXISTS billing.plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_paise INTEGER NOT NULL CHECK (price_paise >= 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  credits_granted INTEGER NOT NULL CHECK (credits_granted >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing.credit_accounts (
  user_id UUID PRIMARY KEY,
  plan_id TEXT NOT NULL DEFAULT 'free',
  available_credits INTEGER NOT NULL CHECK (available_credits >= 0),
  reserved_credits INTEGER NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  lifetime_credited INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_credited >= 0),
  lifetime_debited INTEGER NOT NULL DEFAULT 0 CHECK (lifetime_debited >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing.credit_reservations (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES billing.credit_accounts(user_id),
  request_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  reserved_credits INTEGER NOT NULL CHECK (reserved_credits > 0),
  settled_credits INTEGER CHECK (settled_credits IS NULL OR settled_credits >= 0),
  status TEXT NOT NULL CHECK (status IN ('RESERVED', 'SETTLED', 'RELEASED', 'EXPIRED')),
  payload_fingerprint TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS billing.credit_ledger_entries (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES billing.credit_accounts(user_id),
  request_id TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('INITIAL_GRANT', 'RESERVE_HOLD', 'SETTLE_DEBIT', 'RELEASE_HOLD', 'PURCHASE_CREDIT')),
  delta_credits INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reservation_id UUID REFERENCES billing.credit_reservations(id),
  payment_order_id UUID,
  description TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, request_id, entry_type)
);

CREATE TABLE IF NOT EXISTS billing.payment_orders (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES billing.credit_accounts(user_id),
  plan_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  provider_order_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT UNIQUE,
  amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
  currency TEXT NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  credits_granted INTEGER NOT NULL CHECK (credits_granted > 0),
  status TEXT NOT NULL CHECK (status IN ('CREATED', 'PAID', 'FAILED')),
  payload_fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, request_id)
);

CREATE TABLE IF NOT EXISTS billing.webhook_events (
  event_id TEXT PRIMARY KEY,
  provider_order_id TEXT NOT NULL,
  provider_payment_id TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
`.trim(),
});
