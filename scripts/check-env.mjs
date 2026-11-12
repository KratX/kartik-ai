#!/usr/bin/env node
/**
 * @file scripts/check-env.mjs
 * @description Production-grade environment preflight validator (`pnpm check:env`, Micro-step 8.3.a).
 *
 * Enforces Blueprint §6.2, §11, §12 & ADR 0004:
 * 1. Verifies required baseline variables (`NODE_ENV`, `DATABASE_URL`, `DATABASE_SCHEMA`, `REDIS_URL`).
 * 2. Enforces ADR 0004: `DIRECT_DATABASE_URL` (when set) must never point to a `-pooler` endpoint,
 *    and `PGPOOL_IDLE_TIMEOUT_MS` must not exceed `10000` ms so Neon compute can scale to zero.
 * 3. Enforces Blueprint §11: Rejects live Razorpay keys (`rzp_live_*`) on public/demo deployments
 *    and never prints secret values in error messages.
 */

import { fileURLToPath } from 'node:url';

export const CORE_REQUIRED_ENV_KEYS = Object.freeze([
  'NODE_ENV',
  'DATABASE_URL',
  'DATABASE_SCHEMA',
  'REDIS_URL',
]);

export const ALLOWED_DATABASE_SCHEMAS = Object.freeze([
  'auth',
  'chat',
  'agent',
  'billing',
]);

/**
 * Validates an environment map against Kartik.ai operational rules without leaking secret values.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ valid: boolean; errors: string[]; redactedSummary: Record<string, string> }}
 */
export function validateOperationalEnvironment(env = process.env) {
  /** @type {string[]} */
  const errors = [];

  for (const key of CORE_REQUIRED_ENV_KEYS) {
    const val = env[key]?.trim();
    if (!val) {
      errors.push(`Missing required environment variable: ${key}`);
    }
  }

  const schema = env.DATABASE_SCHEMA?.trim();
  if (schema && !ALLOWED_DATABASE_SCHEMAS.includes(schema)) {
    errors.push(
      `Invalid DATABASE_SCHEMA "${schema}": must be one of ${ALLOWED_DATABASE_SCHEMAS.join(', ')}`,
    );
  }

  const directUrl = env.DIRECT_DATABASE_URL?.trim();
  if (directUrl && directUrl.includes('-pooler')) {
    errors.push(
      'DIRECT_DATABASE_URL must be an unpooled PostgreSQL connection (found "-pooler" host — ADR 0004)',
    );
  }

  const idleTimeoutRaw = env.PGPOOL_IDLE_TIMEOUT_MS?.trim();
  if (idleTimeoutRaw !== undefined && idleTimeoutRaw !== '') {
    const parsedIdle = Number(idleTimeoutRaw);
    if (!Number.isInteger(parsedIdle) || parsedIdle <= 0 || parsedIdle > 10000) {
      errors.push(
        `PGPOOL_IDLE_TIMEOUT_MS (${idleTimeoutRaw}) must be between 1 and 10000 ms for Neon scale-to-zero (ADR 0004)`,
      );
    }
  }

  const rzpKeyId = env.RAZORPAY_KEY_ID?.trim() ?? '';
  if (rzpKeyId.startsWith('rzp_live_')) {
    errors.push(
      'RAZORPAY_KEY_ID starts with "rzp_live_": live Razorpay keys are forbidden on public/demo deployments (§11)',
    );
  }

  const redactedSummary = {
    NODE_ENV: env.NODE_ENV ?? '<unset>',
    DATABASE_SCHEMA: env.DATABASE_SCHEMA ?? '<unset>',
    DATABASE_URL: env.DATABASE_URL ? '[REDACTED_URL]' : '<unset>',
    DIRECT_DATABASE_URL: env.DIRECT_DATABASE_URL ? '[REDACTED_URL]' : '<unset>',
    REDIS_URL: env.REDIS_URL ? '[REDACTED_URL]' : '<unset>',
    AI_PROVIDER_MODE: env.AI_PROVIDER_MODE ?? env.MOCK_AI ?? 'mock',
    BILLING_MODE: env.BILLING_MODE ?? 'mock',
  };

  return Object.freeze({
    valid: errors.length === 0,
    errors: Object.freeze(errors),
    redactedSummary: Object.freeze(redactedSummary),
  });
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const result = validateOperationalEnvironment(process.env);
  if (!result.valid) {
    for (const err of result.errors) {
      console.error(`[check-env] ERROR: ${err}`);
    }
    process.exit(1);
  }
  console.log('[check-env] Environment validated:', JSON.stringify(result.redactedSummary));
}
