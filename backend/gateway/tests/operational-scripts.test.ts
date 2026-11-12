/**
 * @file backend/gateway/tests/operational-scripts.test.ts
 * @description Unit tests for root operational CLI scripts (`scripts/check-env.mjs`,
 * `scripts/migrate.mjs`, `scripts/seed-dev-data.mjs` — Micro-step 8.3.a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadScripts() {
  const rootDir = path.resolve(process.cwd());
  const checkEnvPath = rootDir.endsWith('gateway')
    ? path.resolve(rootDir, '../../scripts/check-env.mjs')
    : path.resolve(rootDir, 'scripts/check-env.mjs');
  const migratePath = rootDir.endsWith('gateway')
    ? path.resolve(rootDir, '../../scripts/migrate.mjs')
    : path.resolve(rootDir, 'scripts/migrate.mjs');
  const seedPath = rootDir.endsWith('gateway')
    ? path.resolve(rootDir, '../../scripts/seed-dev-data.mjs')
    : path.resolve(rootDir, 'scripts/seed-dev-data.mjs');

  const checkEnvMod = (await import(pathToFileURL(checkEnvPath).href)) as {
    validateOperationalEnvironment: (
      env: Record<string, string | undefined>,
    ) => {
      valid: boolean;
      errors: readonly string[];
      redactedSummary: Readonly<Record<string, string>>;
    };
  };
  const migrateMod = (await import(pathToFileURL(migratePath).href)) as {
    buildOrderedSchemaMigrationPlan: (url: string | undefined) => {
      connectionMode: string;
      schemaCount: number;
      steps: readonly {
        order: number;
        schema: string;
        serviceRole: string;
        checksumSha256: string;
      }[];
    };
  };
  const seedMod = (await import(pathToFileURL(seedPath).href)) as {
    buildIdempotentDevSeedManifest: (url: string | undefined) => {
      idempotent: boolean;
      plans: readonly {
        planId: string;
        amountPaise: number;
        creditsGranted: number;
      }[];
      sqlStatements: readonly string[];
    };
  };

  return { checkEnvMod, migrateMod, seedMod };
}

describe('Operational CLI Scripts: check-env, db:migrate & db:seed (8.3.a)', () => {
  it('validates operational environment variables, enforces ADR 0004 Neon 10s idle timeout, blocks rzp_live_*, and redacts URLs (check-env.mjs)', async () => {
    const { checkEnvMod } = await loadScripts();

    const valid = checkEnvMod.validateOperationalEnvironment({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://kartik_chat:secret@localhost:5432/kartik',
      DIRECT_DATABASE_URL: 'postgresql://kartik:secret@localhost:5432/kartik',
      DATABASE_SCHEMA: 'chat',
      REDIS_URL: 'redis://localhost:6379',
      PGPOOL_IDLE_TIMEOUT_MS: '10000',
    });

    assert.equal(valid.valid, true);
    assert.equal(valid.errors.length, 0);
    assert.equal(valid.redactedSummary.DATABASE_URL, '[REDACTED_URL]');

    // Rejects -pooler in DIRECT_DATABASE_URL, >10000ms idle timeout, and rzp_live_* keys
    const invalid = checkEnvMod.validateOperationalEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://kartik_chat:secret@ep-demo-pooler.neon.tech/kartik',
      DIRECT_DATABASE_URL: 'postgresql://kartik:secret@ep-demo-pooler.neon.tech/kartik',
      DATABASE_SCHEMA: 'chat',
      REDIS_URL: 'redis://localhost:6379',
      PGPOOL_IDLE_TIMEOUT_MS: '30000',
      RAZORPAY_KEY_ID: 'rzp_live_forbidden_key',
    });

    assert.equal(invalid.valid, false);
    assert.equal(invalid.errors.length, 3);
  });

  it('builds the ordered 4-schema migration plan (auth -> billing -> agent -> chat) and rejects -pooler endpoints (migrate.mjs, ADR 0004)', async () => {
    const { migrateMod } = await loadScripts();

    const plan = migrateMod.buildOrderedSchemaMigrationPlan(
      'postgresql://kartik:kartik@localhost:5432/kartik',
    );
    assert.equal(plan.connectionMode, 'direct_unpooled');
    assert.equal(plan.schemaCount, 4);
    assert.deepEqual(
      plan.steps.map((s) => s.schema),
      ['auth', 'billing', 'agent', 'chat'],
    );
    assert.ok(plan.steps.every((s) => s.checksumSha256.length === 64));

    assert.throws(
      () =>
        migrateMod.buildOrderedSchemaMigrationPlan(
          'postgresql://kartik:kartik@ep-cool-pooler.us-east-2.aws.neon.tech/kartik',
        ),
      /-pooler/,
    );
  });

  it('builds idempotent ON CONFLICT DO NOTHING seed statements with integer paise billing plans (seed-dev-data.mjs, §11 & §12)', async () => {
    const { seedMod } = await loadScripts();

    const manifest = seedMod.buildIdempotentDevSeedManifest(
      'postgresql://kartik:kartik@localhost:5432/kartik',
    );
    assert.equal(manifest.idempotent, true);
    assert.equal(manifest.plans.length, 4);
    assert.ok(
      manifest.plans.every(
        (p) => Number.isSafeInteger(p.amountPaise) && p.amountPaise >= 0,
      ),
    );
    assert.ok(
      manifest.sqlStatements.every((sql) =>
        sql.includes('ON CONFLICT (plan_id) DO NOTHING'),
      ),
    );
  });
});
