# Kartik.ai Build State

- Current phase: Phase 1 — Shared libraries (`@kartik/shared`)
- Current blueprint item: 1.6 — Ed25519 user-context assertion & constant-time caller credentials (`backend/shared/auth`)
- Current micro-step: 1.6.a — implement `backend/shared/auth` (`signUserContextAssertion`, `verifyUserContextAssertion`, `verifyServiceCaller`, `constantTimeTokenEquals`, `generateEd25519KeyPair`) and Contract Test T14 in `backend/shared/tests/auth.test.ts`
- Status: verification pending on owner's host
- Last completed micro-step: 1.6.a — implemented Ed25519 user-context assertion sign/verify (`iss: "gateway"`, `aud` enforcement, 5s clock-skew check, `requestId` forbidden per §6.4) and constant-time caller token verification (`timingSafeEqual` per §6.3) in `backend/shared/auth/index.ts`, re-exported from `backend/shared/index.ts`, and verified Contract Test T14 + Phase 1 Exit Gate in `backend/shared/tests/auth.test.ts`
- Next micro-step: 1.7.a — implement `backend/shared/contracts` & `backend/shared/validation` (request/response envelope schemas, `Idempotency-Key` UUID/ULID validator, cursor pagination encoder/decoder from §5.4, and `AgentName` validator + unit tests)
- Current branch: `main`
- Last known commit: `1.5.a` completed

## Current objective
Implement `backend/shared/auth` (Blueprint §6.3, §6.4, Contract Test T14 & Phase 1 Exit Gate): Ed25519 user-context assertion signing and verification with strict `aud` enforcement, 5s clock-skew tolerance, prohibition of `requestId` inside assertions, and constant-time service-to-service caller authentication.

## Completed work
- **Micro-step 1.1.a & 1.1.b:** TypeScript 7 (`tsc -b --force`) + zero-dependency `node:test` runner verified on host.
- **Micro-step 1.2.a:** `backend/shared/config` (`loadConfig`, `ConfigValidationError`, `redactConfig`, `SHARED_INFRA_CONFIG_SCHEMA`) verified on host.
- **Micro-step 1.3.a:** `backend/shared/errors` (`ERROR_CATALOGUE` 19 codes, `AppError`, `createSuccessEnvelope`, `mapErrorToHttpResponse`) verified on host.
- **Micro-step 1.4.a:** `backend/shared/logger` (`createLogger`, `redactLogValue`, child bindings, Gate G9 redaction) completed.
- **Micro-step 1.5.a:** `backend/shared/redis` (`RedisKeys` 7 builders, `REDIS_TTL_SECONDS`, `assertSafeKeySegment`) completed.
- **Micro-step 1.6.a:**
  - Created `backend/shared/auth/index.ts`: `generateEd25519KeyPair`, `signUserContextAssertion`, `verifyUserContextAssertion`, `constantTimeTokenEquals`, `verifyServiceCaller`, and `INTERNAL_AUTH_HEADERS`.
  - Re-exported `./auth/index.js` from `backend/shared/index.ts`.
  - Created `backend/shared/tests/auth.test.ts`: 4 unit tests covering Ed25519 assertion round-trip, wrong-`aud` rejection, 5s clock-skew boundary, `requestId` prohibition (§6.4), and constant-time caller credential verification (§6.3).

## Changed files
- `backend/shared/auth/index.ts` — Ed25519 user-context assertion & constant-time service caller auth (§6.3, §6.4)
- `backend/shared/index.ts` — re-exported `./auth/index.js`
- `backend/shared/tests/auth.test.ts` — 4 unit tests for `@kartik/shared/auth` (Contract Test T14 & Phase 1 Exit Gate)
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `1.6.a`

## Verification evidence
- `npm test` (`tsc -b --force && node --test "./dist/tests/*.test.js"`) — PASS — 6 suites, 17 tests passing (`index.test.js`, `config.test.js`, `errors.test.js`, `logger.test.js`, `redis.test.js`, `auth.test.js`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-1.6.a.zip`, run `pnpm --filter @kartik/shared test` (`17/17` tests), and reply **"continue"** for Micro-step `1.7.a` (`backend/shared/contracts` & `backend/shared/validation`).

## Safe resume instruction
Micro-step `1.6.a` is complete. Proceed to **micro-step `1.7.a`**: implement `backend/shared/contracts` and `backend/shared/validation` (request/response envelope contracts, `Idempotency-Key` UUID/ULID validator, cursor pagination encoder/decoder from §5.4, and `AgentName` validator) with unit tests in `backend/shared/tests/contracts.test.ts`.
