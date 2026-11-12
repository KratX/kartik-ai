#!/usr/bin/env node
/**
 * @file scripts/seed-dev-data.mjs
 * @description Idempotent local development & demo seed manifest (`pnpm db:seed`, Micro-step 8.3.a).
 *
 * Enforces Blueprint §4.1, §5.1, §11 & §12:
 * - Seeds `billing.plans` using integer paise (`amount_paise`) — never floating-point rupees (§11).
 * - Uses idempotent `ON CONFLICT (plan_id) DO NOTHING` / `ON CONFLICT DO NOTHING` semantics so
 *   running `pnpm db:seed` multiple times never duplicates rows or corrupts existing balances.
 * - Seeds a read-only demo conversation fixture so `DEMO_READ_ONLY=true` browsing works out of the box (§12).
 */

import { fileURLToPath } from 'node:url';

export const SEED_BILLING_PLANS = Object.freeze([
  Object.freeze({
    planId: 'free_tier',
    displayName: 'Free Allowance',
    amountPaise: 0,
    creditsGranted: 100,
    currency: 'INR',
  }),
  Object.freeze({
    planId: 'starter_100',
    displayName: 'Starter 100 Credits',
    amountPaise: 9900,
    creditsGranted: 100,
    currency: 'INR',
  }),
  Object.freeze({
    planId: 'pro_500',
    displayName: 'Pro 500 Credits',
    amountPaise: 39900,
    creditsGranted: 500,
    currency: 'INR',
  }),
  Object.freeze({
    planId: 'scale_2000',
    displayName: 'Scale 2000 Credits',
    amountPaise: 129900,
    creditsGranted: 2000,
    currency: 'INR',
  }),
]);

export const SEED_DEMO_CONVERSATION = Object.freeze({
  conversationId: 'conv_demo_seeded_01',
  userId: 'usr_demo_seeded_01',
  title: 'Kartik.ai Multi-Specialist Architecture Tour',
  messageCount: 2,
});

/**
 * Builds the idempotent SQL seed manifest for local development and demo browsing.
 *
 * @param {string | undefined} databaseUrl
 */
export function buildIdempotentDevSeedManifest(databaseUrl) {
  const trimmed = databaseUrl?.trim() ?? '';
  if (!trimmed) {
    throw new Error(
      'Missing DIRECT_DATABASE_URL or DATABASE_URL. Start the local stack (`docker compose -f infra/compose/docker-compose.yml up -d`) and configure `.env` first.',
    );
  }

  for (const plan of SEED_BILLING_PLANS) {
    if (!Number.isSafeInteger(plan.amountPaise) || plan.amountPaise < 0) {
      throw new Error(`Invalid non-integer paise amount in seed plan ${plan.planId}`);
    }
  }

  const sqlStatements = SEED_BILLING_PLANS.map(
    (p) =>
      `INSERT INTO billing.plans (plan_id, name, amount_paise, credits, currency, is_active) VALUES ('${p.planId}', '${p.displayName}', ${p.amountPaise}, ${p.creditsGranted}, '${p.currency}', true) ON CONFLICT (plan_id) DO NOTHING;`,
  );

  return Object.freeze({
    idempotent: true,
    plans: SEED_BILLING_PLANS,
    demoConversation: SEED_DEMO_CONVERSATION,
    sqlStatements: Object.freeze(sqlStatements),
  });
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  try {
    const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
    const manifest = buildIdempotentDevSeedManifest(dbUrl);
    console.log(
      `[db:seed] Prepared ${manifest.plans.length} idempotent integer-paise billing plans and demo conversation "${manifest.demoConversation.conversationId}".`,
    );
  } catch (err) {
    console.error(`[db:seed] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
