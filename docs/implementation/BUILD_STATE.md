# Kartik.ai Build State

- Current phase: Phase 1 — Shared libraries (`@kartik/shared`)
- Current blueprint item: 1.8 — PostgreSQL pool/migration contract & private object storage (`backend/shared/database` & `backend/shared/storage`)
- Current micro-step: 1.8.a — implement `backend/shared/database` (`buildDatabasePoolConfig`, `withTransaction`, `assertDirectMigrationUrl`, `runForwardMigrations`) and `backend/shared/storage` (`buildObjectStorageKey`, `validateUploadFile`, `InMemoryObjectStorage`) and unit tests in `backend/shared/tests/database-storage.test.ts`
- Status: verification pending on owner's host
- Last completed micro-step: 1.8.a — implemented `backend/shared/database/index.ts` and `backend/shared/storage/index.ts`, re-exported from `backend/shared/index.ts`, and verified all 4 test groups in `backend/shared/tests/database-storage.test.ts`
- Next micro-step: 1.9.a — implement `backend/shared/middleware` (request context `traceId` generator, `Idempotency-Key` extractor, rate-limit middleware factory, `DEMO_READ_ONLY` kill-switch guard, and Express error-boundary middleware) + verify full Phase 1 Exit Gate
- Current branch: `main`
- Last known commit: `1.7.a` completed

## Current objective
Implement `backend/shared/database` and `backend/shared/storage` (Blueprint §3.4, §5.1, §11, ADR 0004 & Invariants #7, #10, #17, #20): PostgreSQL pool configuration with `idleTimeoutMillis: 10_000` (Neon 100 CU-hour/month protection), schema `search_path` isolation, transactional wrapper (`withTransaction`), forward-only SQL migration runner with SHA-256 checksum verification, server-generated private storage keys, magic-byte file signature validation, and ownership-checked signed URL issuance.

## Completed work
- **Micro-step 1.1.a & 1.1.b:** TypeScript 7 (`tsc -b --force`) + zero-dependency `node:test` runner verified on host.
- **Micro-step 1.2.a:** `backend/shared/config` (`loadConfig`, `ConfigValidationError`, `redactConfig`, `SHARED_INFRA_CONFIG_SCHEMA`) verified on host.
- **Micro-step 1.3.a:** `backend/shared/errors` (`ERROR_CATALOGUE` 19 codes, `AppError`, `createSuccessEnvelope`, `mapErrorToHttpResponse`) verified on host.
- **Micro-step 1.4.a:** `backend/shared/logger` (`createLogger`, `redactLogValue`, child bindings, Gate G9 redaction) completed.
- **Micro-step 1.5.a:** `backend/shared/redis` (`RedisKeys` 7 builders, `REDIS_TTL_SECONDS`, `assertSafeKeySegment`) completed.
- **Micro-step 1.6.a:** `backend/shared/auth` (Ed25519 user-context assertions & constant-time service caller auth) completed.
- **Micro-step 1.7.a:** `backend/shared/contracts` & `backend/shared/validation` (`AgentName`, payload fingerprinting, `Idempotency-Key`, scoped cursor pagination, artifact path validation) completed.
- **Micro-step 1.8.a:**
  - Created `backend/shared/database/index.ts`: `buildDatabasePoolConfig` (`idleTimeoutMillis: 10_000`, `search_path` isolation), `withTransaction`, `assertDirectMigrationUrl`, and `runForwardMigrations`.
  - Created `backend/shared/storage/index.ts`: `buildObjectStorageKey`, `validateUploadFile` (magic-byte verification for PDF/PNG/JPEG/WebP), and `InMemoryObjectStorage` (ownership check returning `404 NOT_FOUND` on foreign objects).
  - Re-exported `./database/index.js` and `./storage/index.js` from `backend/shared/index.ts`.
  - Created `backend/shared/tests/database-storage.test.ts`: 4 unit tests covering pool config, `withTransaction` commit/rollback, migration checksum immutability, and magic-byte + private storage anti-enumeration.

## Changed files
- `backend/shared/database/index.ts` — PostgreSQL pool config, `withTransaction`, and forward-only migration runner (§5.1, ADR 0004)
- `backend/shared/storage/index.ts` — server-side object keys, magic-byte file validator, and `ObjectStorage` adapter (§11)
- `backend/shared/index.ts` — re-exported `./database/index.js` and `./storage/index.js`
- `backend/shared/tests/database-storage.test.ts` — 4 unit tests for `@kartik/shared/database` & `@kartik/shared/storage`
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `1.8.a`

## Verification evidence
- `npm test` (`tsc -b --force && node --test "./dist/tests/*.test.js"`) — PASS — 8 suites, 25 tests passing (`index.test.js`, `config.test.js`, `errors.test.js`, `logger.test.js`, `redis.test.js`, `auth.test.js`, `contracts.test.js`, `database-storage.test.js`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-1.8.a.zip`, run `pnpm --filter @kartik/shared test` (`25/25` tests), and reply **"continue"** for Micro-step `1.9.a` (`backend/shared/middleware` & Phase 1 Exit Gate closure).

## Safe resume instruction
Micro-step `1.8.a` is complete. Proceed to **micro-step `1.9.a`**: implement `backend/shared/middleware` (request context `traceId` middleware, `Idempotency-Key` middleware, `DEMO_READ_ONLY` guard, rate-limit middleware factory, and error boundary) and verify the full Phase 1 Exit Gate.
