# Kartik.ai Build State

- Current phase: Phase 2 — Auth Service & Session Lifecycle (`@kartik/auth`)
- Current blueprint item: 2.2 — Firebase ID-token verification adapter (`backend/services/auth/src/services/firebase-verifier.ts`)
- Current micro-step: 2.2.a — implement `FirebaseTokenVerifier`, `MockFirebaseTokenVerifier`, `JwtFirebaseTokenVerifier`, and `createFirebaseTokenVerifier` in `backend/services/auth/src/services/firebase-verifier.ts` with unit tests in `backend/services/auth/tests/firebase-verifier.test.ts`
- Status: verification pending on owner's host
- Last completed micro-step: 2.2.a — implemented `MockFirebaseTokenVerifier` and `JwtFirebaseTokenVerifier` (`8/8` Auth unit tests passing across 2 suites; `37/37` total workspace tests passing across 11 suites)
- Next micro-step: 2.3.a — implement the opaque Redis session manager (`SessionService` + `InMemorySessionStore` / Redis hash adapter using `RedisKeys.session(sessionId)`, 256-bit CSPRNG session IDs, 7-day sliding TTL, and immediate revocation on logout per ADR 0002) + unit tests
- Current branch: `main`
- Last known commit: `2.1.a` completed

## Current objective
Implement `backend/services/auth/src/services/firebase-verifier.ts` (Blueprint §6.2, §11, ADR 0002 & Invariant #19): provider-abstracted Firebase ID-token verification with deterministic mock fixtures (`AUTH_PROVIDER_MODE=mock`) and cryptographic RS256 JWT verification (`AUTH_PROVIDER_MODE=firebase`).

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS):** `config`, `errors`, `logger`, `redis`, `auth`, `contracts`, `validation`, `database`, `storage`, `middleware`.
- **Phase 2 / Micro-step 2.1.a:** Auth service config, `0001_auth_users.sql` migration, and `UserRepository` (`4/4` tests).
- **Phase 2 / Micro-step 2.2.a:**
  - Created `backend/services/auth/src/services/firebase-verifier.ts` (`MockFirebaseTokenVerifier`, `JwtFirebaseTokenVerifier`, `createGooglePublicKeyResolver`, `createFirebaseTokenVerifier`).
  - Created `backend/services/auth/src/services/index.ts` and re-exported from `backend/services/auth/src/index.ts`.
  - Created `backend/services/auth/tests/firebase-verifier.test.ts` (`4/4` tests passing).

## Changed files
- `backend/services/auth/src/services/firebase-verifier.ts` — Mock & RS256 Firebase ID-token verifiers
- `backend/services/auth/src/services/index.ts` — services barrel
- `backend/services/auth/src/index.ts` — re-exported `./services/index.js`
- `backend/services/auth/tests/firebase-verifier.test.ts` — 4 unit tests for `FirebaseTokenVerifier`
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `2.2.a`

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 11 suites, 37 tests passing (29 in `@kartik/shared` + 8 in `@kartik/auth`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-2.2.a.zip`, run `pnpm --filter @kartik/auth test` (`8/8` tests across 2 suites), and reply **"continue"** for Micro-step `2.3.a` (Opaque Redis Session Service).

## Safe resume instruction
Micro-step `2.2.a` is complete. Proceed to **micro-step `2.3.a`**: implement `backend/services/auth/src/services/session-service.ts` (opaque 256-bit session ID generation, `RedisKeys.session(sessionId)` hash storage, 7-day sliding TTL refresh, and immediate logout revocation per ADR 0002) with unit tests in `backend/services/auth/tests/session-service.test.ts`.
