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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPlaceholderKeyMaterial,
  resolveKeyFromEnvOrFile,
  validateProductionEd25519KeyPair,
} from './manage-ed25519-keys.mjs';

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

export function validatePostgresUriInEnv(rawUrl, envName, nodeEnv) {
  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return `${envName} is required and must be a valid postgres:// or postgresql:// URI`;
  }
  const trimmed = rawUrl.trim();
  if (!/^postgres(ql)?:\/\/.+/i.test(trimmed)) {
    return `${envName} must use the postgres:// or postgresql:// protocol`;
  }
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.trim().toLowerCase();
    const dbName = parsed.pathname.replace(/^\/+/, '').trim();
    if (!host || !dbName) {
      return `${envName} must include a valid hostname and database path`;
    }
    if (nodeEnv === 'production' && host === 'postgres') {
      return `${envName} points to nonexistent Compose hostname "postgres"; production requires an explicit Neon PostgreSQL URI`;
    }
    return null;
  } catch {
    return `${envName} must be a valid postgres:// or postgresql:// URL`;
  }
}

/**
 * Validates an environment map against Kartik.ai operational rules without leaking secret values.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ valid: boolean; errors: readonly string[]; redactedSummary: Readonly<Record<string, string>> }}
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

  const nodeEnv = env.NODE_ENV?.trim() ?? 'development';
  const dbUrl = env.DATABASE_URL?.trim();
  if (dbUrl) {
    const dbErr = validatePostgresUriInEnv(dbUrl, 'DATABASE_URL', nodeEnv);
    if (dbErr) {
      errors.push(dbErr);
    }
  }

  const schema = env.DATABASE_SCHEMA?.trim();
  if (schema && !ALLOWED_DATABASE_SCHEMAS.includes(schema)) {
    errors.push(
      `Invalid DATABASE_SCHEMA "${schema}": must be one of ${ALLOWED_DATABASE_SCHEMAS.join(', ')}`,
    );
  }

  const billingDbUrl = env.BILLING_DATABASE_URL?.trim();
  if (billingDbUrl !== undefined && billingDbUrl !== '') {
    const billingErr = validatePostgresUriInEnv(
      billingDbUrl,
      'BILLING_DATABASE_URL',
      nodeEnv,
    );
    if (billingErr) {
      errors.push(billingErr);
    }
  } else if (schema === 'billing' && nodeEnv === 'production') {
    errors.push(
      'Missing required environment variable: BILLING_DATABASE_URL (required when DATABASE_SCHEMA=billing in production)',
    );
  }

  const directUrl = env.DIRECT_DATABASE_URL?.trim();
  if (directUrl) {
    const directErr = validatePostgresUriInEnv(
      directUrl,
      'DIRECT_DATABASE_URL',
      nodeEnv,
    );
    if (directErr) {
      errors.push(directErr);
    } else if (directUrl.includes('-pooler')) {
      errors.push(
        'DIRECT_DATABASE_URL must be an unpooled PostgreSQL connection (found "-pooler" host — ADR 0004)',
      );
    }
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

  const signingKey = resolveKeyFromEnvOrFile(
    env,
    'USER_CONTEXT_SIGNING_KEY',
    'USER_CONTEXT_SIGNING_KEY_FILE',
  );
  const publicKey =
    resolveKeyFromEnvOrFile(
      env,
      'USER_CONTEXT_PUBLIC_KEY',
      'USER_CONTEXT_PUBLIC_KEY_FILE',
    ) ??
    resolveKeyFromEnvOrFile(
      env,
      'USER_CONTEXT_VERIFY_KEY',
      'USER_CONTEXT_VERIFY_KEY_FILE',
    );

  if (signingKey !== undefined && publicKey !== undefined) {
    const keyPairValidation = validateProductionEd25519KeyPair({
      privateKey: signingKey,
      publicKey,
    });
    if (!keyPairValidation.valid) {
      errors.push(...keyPairValidation.errors);
    }
  } else if (signingKey !== undefined && isPlaceholderKeyMaterial(signingKey)) {
    errors.push(
      'USER_CONTEXT_SIGNING_KEY contains placeholder key material (must be a valid Ed25519 PKCS#8 private key)',
    );
  } else if (publicKey !== undefined && isPlaceholderKeyMaterial(publicKey)) {
    errors.push(
      'USER_CONTEXT_PUBLIC_KEY contains placeholder key material (must be a valid Ed25519 SPKI public key)',
    );
  }

  const authProviderMode = env.AUTH_PROVIDER_MODE?.trim();
  if (nodeEnv === 'production' && authProviderMode === 'mock') {
    errors.push(
      'AUTH_PROVIDER_MODE=mock is forbidden in production; configure AUTH_PROVIDER_MODE=firebase',
    );
  }

  const shouldValidateFirebase =
    authProviderMode === 'firebase' ||
    (nodeEnv === 'production' && schema === 'auth');
  if (shouldValidateFirebase) {
    const fbProjectId = env.FIREBASE_PROJECT_ID?.trim() ?? '';
    if (
      !fbProjectId ||
      ['kartik-mock-project', 'your-firebase-project', 'replace_me', 'placeholder'].includes(
        fbProjectId.toLowerCase(),
      )
    ) {
      errors.push(
        'FIREBASE_PROJECT_ID must be a valid non-placeholder Firebase project ID when AUTH_PROVIDER_MODE=firebase',
      );
    }

    const fbClientEmail = env.FIREBASE_CLIENT_EMAIL?.trim() ?? '';
    if (
      !fbClientEmail ||
      !fbClientEmail.includes('@') ||
      [
        'firebase-adminsdk@kartik-mock-project.iam.gserviceaccount.com',
        'firebase-adminsdk@your-project.iam.gserviceaccount.com',
      ].includes(fbClientEmail.toLowerCase())
    ) {
      errors.push(
        'FIREBASE_CLIENT_EMAIL must be a valid non-placeholder service account email when AUTH_PROVIDER_MODE=firebase',
      );
    }

    const fbPrivateKey =
      resolveKeyFromEnvOrFile(env, 'FIREBASE_PRIVATE_KEY', 'FIREBASE_PRIVATE_KEY_FILE') ?? '';
    if (
      !fbPrivateKey ||
      !fbPrivateKey.includes('BEGIN') ||
      ['MOCK_KEY', 'REPLACE_ME', 'REPLACE_WITH_FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY'].some((m) =>
        fbPrivateKey.includes(m),
      )
    ) {
      errors.push(
        'FIREBASE_PRIVATE_KEY must be a valid non-placeholder PEM private key when AUTH_PROVIDER_MODE=firebase',
      );
    }
  }

  const redactedSummary = {
    NODE_ENV: env.NODE_ENV ?? '<unset>',
    DATABASE_SCHEMA: env.DATABASE_SCHEMA ?? '<unset>',
    DATABASE_URL: env.DATABASE_URL ? '[REDACTED_URL]' : '<unset>',
    BILLING_DATABASE_URL: env.BILLING_DATABASE_URL ? '[REDACTED_URL]' : '<unset>',
    DIRECT_DATABASE_URL: env.DIRECT_DATABASE_URL ? '[REDACTED_URL]' : '<unset>',
    REDIS_URL: env.REDIS_URL ? '[REDACTED_URL]' : '<unset>',
    AUTH_PROVIDER_MODE: authProviderMode ?? (nodeEnv === 'production' ? 'firebase' : 'mock'),
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID ?? '<unset>',
    FIREBASE_PRIVATE_KEY: env.FIREBASE_PRIVATE_KEY ? '[REDACTED]' : '<unset>',
    USER_CONTEXT_SIGNING_KEY: signingKey ? '[VALIDATED_ED25519_PRIVATE_KEY]' : '<unset>',
    USER_CONTEXT_PUBLIC_KEY: publicKey ? '[VALIDATED_ED25519_PUBLIC_KEY]' : '<unset>',
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
  process.argv[1] &&
  (fileURLToPath(import.meta.url).toLowerCase() ===
    process.argv[1].replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase() ||
    process.argv[1].endsWith('check-env.mjs'));

if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const defaultPrivPath = path.join(
    repoRoot,
    'infra',
    'aws',
    'ec2-compose',
    'secrets',
    'user_context_signing_key.pem',
  );
  const defaultPubPath = path.join(
    repoRoot,
    'infra',
    'aws',
    'ec2-compose',
    'secrets',
    'user_context_public_key.pem',
  );
  const effectiveEnv = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    DATABASE_URL:
      process.env.DATABASE_URL || 'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
    DIRECT_DATABASE_URL:
      process.env.DIRECT_DATABASE_URL ||
      'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
    DATABASE_SCHEMA: process.env.DATABASE_SCHEMA || 'auth',
    REDIS_URL: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    ...(fs.existsSync(defaultPrivPath)
      ? { USER_CONTEXT_SIGNING_KEY_FILE: defaultPrivPath }
      : {}),
    ...(fs.existsSync(defaultPubPath)
      ? { USER_CONTEXT_PUBLIC_KEY_FILE: defaultPubPath }
      : {}),
    ...process.env,
  };
  const result = validateOperationalEnvironment(effectiveEnv);
  if (!result.valid) {
    for (const err of result.errors) {
      console.error(`[check-env] ERROR: ${err}`);
    }
    process.exit(1);
  }
  console.log('[check-env] Environment validated:', JSON.stringify(result.redactedSummary));
}
