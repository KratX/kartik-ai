# Kartik.ai Build State

- Current phase: Phase 1 — Shared libraries (`@kartik/shared`)
- Current blueprint item: 1.7 — Domain contracts & boundary validation (`backend/shared/contracts` & `backend/shared/validation`)
- Current micro-step: 1.7.a — implement `backend/shared/contracts` and `backend/shared/validation` (`AgentName`, state unions, `computePayloadFingerprint`, `validateIdempotencyKey`, scoped cursor pagination, `validateArtifactManifest`) and unit tests in `backend/shared/tests/contracts.test.ts`
- Status: verification pending on owner's host
- Last completed micro-step: 1.7.a — implemented `backend/shared/contracts/index.ts` and `backend/shared/validation/index.ts`, re-exported from `backend/shared/index.ts`, and verified all 4 test groups in `backend/shared/tests/contracts.test.ts`
- Next micro-step: 1.8.a — implement `backend/shared/database` & `backend/shared/storage` (PostgreSQL pool config with `idleTimeoutMillis: 10_000` for Neon scale-to-zero CU-hour protection per §3.4, `withTransaction` helper, migration runner contract, and `ObjectStorage` private-bucket interface + unit tests)
- Current branch: `main`
- Last known commit: `1.6.a` completed

## Current objective
Implement `backend/shared/contracts` and `backend/shared/validation` (Blueprint §5.3, §5.4, §10 & OpenAPI Contract): closed `AgentName` union, deterministic SHA-256 request payload fingerprinting, client `Idempotency-Key` validation without rewriting, HMAC-signed scoped cursor pagination, and coding artifact manifest path traversal protection.

## Completed work
- **Micro-step 1.1.a & 1.1.b:** TypeScript 7 (`tsc -b --force`) + zero-dependency `node:test` runner verified on host.
- **Micro-step 1.2.a:** `backend/shared/config` (`loadConfig`, `ConfigValidationError`, `redactConfig`, `SHARED_INFRA_CONFIG_SCHEMA`) verified on host.
- **Micro-step 1.3.a:** `backend/shared/errors` (`ERROR_CATALOGUE` 19 codes, `AppError`, `createSuccessEnvelope`, `mapErrorToHttpResponse`) verified on host.
- **Micro-step 1.4.a:** `backend/shared/logger` (`createLogger`, `redactLogValue`, child bindings, Gate G9 redaction) completed.
- **Micro-step 1.5.a:** `backend/shared/redis` (`RedisKeys` 7 builders, `REDIS_TTL_SECONDS`, `assertSafeKeySegment`) completed.
- **Micro-step 1.6.a:** `backend/shared/auth` (Ed25519 user-context assertions & constant-time service caller auth) completed.
- **Micro-step 1.7.a:**
  - Created `backend/shared/contracts/index.ts`: `AGENT_NAMES`, state unions, service DTOs, `canonicalizeJson`, and `computePayloadFingerprint`.
  - Created `backend/shared/validation/index.ts`: `validateIdempotencyKey`, `encodePaginationCursor`, `decodePaginationCursor`, `parsePaginationQuery`, `validateSafeRelativePath`, and `validateArtifactManifest`.
  - Re-exported `./contracts/index.js` and `./validation/index.js` from `backend/shared/index.ts`.
  - Created `backend/shared/tests/contracts.test.ts`: 4 unit tests covering `AgentName` + payload fingerprinting, `Idempotency-Key` validation, scoped cursor pagination, and artifact manifest path safety.

## Changed files
- `backend/shared/contracts/index.ts` — domain state unions, DTOs & payload fingerprinting (§5.3, §5.4)
- `backend/shared/validation/index.ts` — `Idempotency-Key`, scoped cursor pagination & artifact manifest validation (§5.4, §10)
- `backend/shared/index.ts` — re-exported `./contracts/index.js` and `./validation/index.js`
- `backend/shared/tests/contracts.test.ts` — 4 unit tests for `@kartik/shared/contracts` & `@kartik/shared/validation`
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `1.7.a`

## Verification evidence
- `npm test` (`tsc -b --force && node --test "./dist/tests/*.test.js"`) — PASS — 7 suites, 21 tests passing (`index.test.js`, `config.test.js`, `errors.test.js`, `logger.test.js`, `redis.test.js`, `auth.test.js`, `contracts.test.js`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-1.7.a.zip`, run `pnpm --filter @kartik/shared test` (`21/21` tests), and reply **"continue"** for Micro-step `1.8.a` (`backend/shared/database` & `backend/shared/storage`).

## Safe resume instruction
Micro-step `1.7.a` is complete. Proceed to **micro-step `1.8.a`**: implement `backend/shared/database` (PostgreSQL pool config with `idleTimeoutMillis: 10_000`, `withTransaction`, and schema migration runner) and `backend/shared/storage` (`ObjectStorage` private-bucket driver interface + server-generated storage key builder) with unit tests.
