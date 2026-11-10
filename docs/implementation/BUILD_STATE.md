# Kartik.ai Build State

- Current phase: Phase 2 — Auth Service & Session Lifecycle (`@kartik/auth`)
- Current blueprint item: 2.1 — Auth service config, `auth.users` migration & user repository (`backend/services/auth`)
- Current micro-step: 2.1.a — wire `@kartik/auth` composite build/test scripts, implement `backend/services/auth/src/config`, `backend/services/auth/src/models` (`0001_auth_users.sql`), and `backend/services/auth/src/repositories` (`UserRepository`, `PostgresUserRepository`, `InMemoryUserRepository`) with unit tests in `backend/services/auth/tests/user-repository.test.ts`
- Status: verification pending on owner's host
- Last completed micro-step: 2.1.a — implemented `@kartik/auth` config, `0001_auth_users.sql` migration, and `UserRepository` (`4/4` Auth unit tests passing; `33/33` total workspace tests passing across 10 suites)
- Next micro-step: 2.2.a — implement the Firebase ID-token verification adapter (`FirebaseTokenVerifier`, deterministic `MockFirebaseTokenVerifier`, and live Firebase verification contract in `backend/services/auth/src/services/firebase-verifier.ts`) + unit tests
- Current branch: `main`
- Last known commit: `1.9.a` (Phase 1 Exit Gate complete)

## Current objective
Begin Phase 2 (`@kartik/auth`) by decomposing the Auth service into 4 micro-steps (`2.1.a`–`2.4.a`) and implementing micro-step `2.1.a`: Auth environment validation (`loadAuthConfig`), numbered migration `0001_auth_users.sql`, and the `UserRepository` (`PostgresUserRepository` + `InMemoryUserRepository`).

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS):** `config`, `errors`, `logger`, `redis`, `auth`, `contracts`, `validation`, `database`, `storage`, `middleware`.
- **Phase 2 / Micro-step 2.1.a:**
  - Wired `tsc -b --force` and `node --test "./dist/tests/*.test.js"` in `backend/services/auth/package.json` and `backend/services/auth/tsconfig.json`.
  - Created `backend/services/auth/src/config/index.ts` (`AUTH_CONFIG_SCHEMA`, `loadAuthConfig`).
  - Created `backend/services/auth/src/models/index.ts` (`AuthUser`, `AUTH_MIGRATION_0001` for `auth.users`).
  - Created `backend/services/auth/src/repositories/index.ts` (`UserRepository`, `PostgresUserRepository`, `InMemoryUserRepository`).
  - Created `backend/services/auth/src/index.ts` and `backend/services/auth/tests/user-repository.test.ts` (`4/4` tests passing).

## Changed files
- `backend/services/auth/package.json` — wired `build`, `typecheck`, `lint`, and `test` scripts
- `backend/services/auth/tsconfig.json` — composite TypeScript build with reference to `../../shared`
- `backend/services/auth/src/config/index.ts` — Auth service config validator (`loadAuthConfig`)
- `backend/services/auth/src/models/index.ts` — `AuthUser` & migration `0001_auth_users.sql`
- `backend/services/auth/src/repositories/index.ts` — `PostgresUserRepository` & `InMemoryUserRepository`
- `backend/services/auth/src/index.ts` — package barrel
- `backend/services/auth/tests/user-repository.test.ts` — 4 unit tests for `@kartik/auth`
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `2.1.a`

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 10 suites, 33 tests passing (29 in `@kartik/shared` + 4 in `@kartik/auth`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-2.1.a.zip`, run `pnpm --filter @kartik/auth test` (`4/4` tests), and reply **"continue"** for Micro-step `2.2.a` (`FirebaseTokenVerifier`).

## Safe resume instruction
Micro-step `2.1.a` is complete. Proceed to **micro-step `2.2.a`**: implement `backend/services/auth/src/services/firebase-verifier.ts` (`FirebaseTokenVerifier` interface, deterministic `MockFirebaseTokenVerifier`, and Google sign-in token claims validation) with unit tests in `backend/services/auth/tests/firebase-verifier.test.ts`.
