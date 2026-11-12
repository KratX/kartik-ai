# Kartik.ai Learning Log

---

## Entry 30 — Phase 8 / Step 8.3 (Micro-step 8.3.a): Operational CLI Scripts (`check-env.mjs`, `migrate.mjs`, `seed-dev-data.mjs`)

### 1. Concept learned
- **Why Operational CLI Scripts Must Enforce the Same Architectural Boundaries as Services (`ADR 0004 & Blueprint §11`):**
  1. `scripts/check-env.mjs` (`pnpm check:env`): Validates required environment keys before boot, enforces `PGPOOL_IDLE_TIMEOUT_MS <= 10000` so Neon compute scales to zero, rejects `-pooler` hosts in `DIRECT_DATABASE_URL`, blocks live Razorpay keys (`rzp_live_*`), and redacts database/Redis URLs in output.
  2. `scripts/migrate.mjs` (`pnpm db:migrate`): Rejects `-pooler` endpoints (which break session-level advisory locks and DDL transactions) and builds the deterministic 4-schema migration plan (`auth -> billing -> agent -> chat`) with SHA-256 checksums.
  3. `scripts/seed-dev-data.mjs` (`pnpm db:seed`): Seeds `billing.plans` in integer paise using `ON CONFLICT (plan_id) DO NOTHING` so re-running the seed script is 100% idempotent.

### 2. What was implemented
- `scripts/check-env.mjs` (`validateOperationalEnvironment`)
- `scripts/migrate.mjs` (`buildOrderedSchemaMigrationPlan`)
- `scripts/seed-dev-data.mjs` (`buildIdempotentDevSeedManifest`)
- `backend/gateway/tests/operational-scripts.test.ts` (3 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` (`33` suites, `124` tests passing).
