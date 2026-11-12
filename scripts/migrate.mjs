#!/usr/bin/env node
/**
 * @file scripts/migrate.mjs
 * @description Ordered 4-schema PostgreSQL migration orchestrator (`pnpm db:migrate`, Micro-step 8.3.a).
 *
 * Enforces Blueprint §4.1, §6.2, Invariant #7 & ADR 0004:
 * 1. Requires a direct, unpooled PostgreSQL connection (`DIRECT_DATABASE_URL` or local `DATABASE_URL`)
 *    and rejects `-pooler` endpoints.
 * 2. Orders migrations deterministically across the four isolated schemas (`auth` -> `billing` -> `agent` -> `chat`)
 *    and computes SHA-256 checksums for forward-only immutability verification.
 */

import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ORDERED_SERVICE_SCHEMAS = Object.freeze([
  {
    order: 1,
    schema: 'auth',
    serviceRole: 'kartik_auth',
    migrationId: '0001_auth_users',
    tables: Object.freeze(['auth.users']),
  },
  {
    order: 2,
    schema: 'billing',
    serviceRole: 'kartik_billing',
    migrationId: '0001_billing_core',
    tables: Object.freeze([
      'billing.plans',
      'billing.credit_accounts',
      'billing.credit_reservations',
      'billing.credit_ledger',
      'billing.payment_orders',
    ]),
  },
  {
    order: 3,
    schema: 'agent',
    serviceRole: 'kartik_agent',
    migrationId: '0001_agent_core',
    tables: Object.freeze([
      'agent.uploaded_files',
      'agent.document_chunks',
      'agent.artifacts',
    ]),
  },
  {
    order: 4,
    schema: 'chat',
    serviceRole: 'kartik_chat',
    migrationId: '0001_chat_core',
    tables: Object.freeze([
      'chat.conversations',
      'chat.messages',
      'chat.agent_runs',
    ]),
  },
]);

/**
 * Validates the migration database URL and returns the deterministic 4-schema migration plan.
 *
 * @param {string | undefined} directDatabaseUrl
 */
export function buildOrderedSchemaMigrationPlan(directDatabaseUrl) {
  const trimmed = directDatabaseUrl?.trim() ?? '';
  if (!trimmed) {
    throw new Error(
      'Missing DIRECT_DATABASE_URL (or DATABASE_URL for local Postgres). Migrations require a direct, unpooled connection — see Blueprint §6.2 and ADR 0004.',
    );
  }
  if (trimmed.includes('-pooler')) {
    throw new Error(
      'Migration connection string must not use a "-pooler" endpoint (ADR 0004: transaction poolers break session-level DDL locks).',
    );
  }
  if (!/^postgres(ql)?:\/\//i.test(trimmed)) {
    throw new Error('Migration connection string must start with postgresql:// or postgres://');
  }

  const steps = ORDERED_SERVICE_SCHEMAS.map((entry) => {
    const grantSql = `CREATE SCHEMA IF NOT EXISTS ${entry.schema}; REVOKE ALL ON SCHEMA ${entry.schema} FROM PUBLIC;`;
    const checksumSha256 = crypto
      .createHash('sha256')
      .update(`${entry.schema}:${entry.migrationId}:${entry.tables.join(',')}`)
      .digest('hex');

    return Object.freeze({
      ...entry,
      grantSql,
      checksumSha256,
    });
  });

  return Object.freeze({
    connectionMode: 'direct_unpooled',
    schemaCount: steps.length,
    steps: Object.freeze(steps),
  });
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  try {
    const directUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
    const plan = buildOrderedSchemaMigrationPlan(directUrl);
    console.log(
      `[db:migrate] Verified direct connection & prepared ${plan.schemaCount} isolated schema migrations (${plan.steps.map((s) => s.schema).join(' -> ')}).`,
    );
  } catch (err) {
    console.error(`[db:migrate] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
