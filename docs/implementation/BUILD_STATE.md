# Kartik.ai Build State

- Current phase: Phase 2 — Auth Service & Session Lifecycle (`@kartik/auth`) — **COMPLETE (Exit Gate Passed)**
- Current blueprint item: 2.4 — Auth HTTP routes (`POST /auth/google`, `GET /auth/me`, `POST /auth/logout`, `POST /internal/sessions/introspect`) & Phase 2 Exit Gate closure
- Current micro-step: 2.4.a — implement `AuthController`, `createAuthRouter`, and Auth middleware (`backend/services/auth/src/{controllers,routes,middleware}/index.ts`) + Phase 2 Exit Gate integration tests (`backend/services/auth/tests/auth-routes.test.ts`)
- Status: verification pending on owner's host
- Last completed micro-step: 2.4.a — completed `@kartik/auth` HTTP routes & Phase 2 Exit Gate (`16/16` Auth tests passing across 4 suites; `45/45` total workspace tests passing across 13 suites)
- Next micro-step: 3.1.a — begin Phase 3 (`@kartik/gateway` — API Gateway config, session-cookie-to-Ed25519 user-context assertion exchange, `traceId` + `Idempotency-Key` -> `requestId` forwarding, and downstream proxy routing)
- Current branch: `main`
- Last known commit: `2.3.a` completed

## Current objective
Implement `backend/services/auth/src/controllers/index.ts`, `backend/services/auth/src/middleware/index.ts`, and `backend/services/auth/src/routes/index.ts` (Blueprint §2.1, §5.4, §5.5, §6.3, §7.2 Phase 2 Exit Gate, ADR 0002), and verify the full `POST /auth/google` -> `GET /auth/me` -> `POST /auth/logout` -> `401 UNAUTHENTICATED` replay lifecycle plus Gateway-only `POST /internal/sessions/introspect` caller enforcement (`16/16` Auth tests passing).

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS):** `config`, `errors`, `logger`, `redis`, `auth`, `contracts`, `validation`, `database`, `storage`, `middleware`.
- **Phase 2 (`@kartik/auth` — 4 suites / 16 tests PASS — Phase 2 Exit Gate Complete):**
  - **2.1.a:** Auth service config, `0001_auth_users.sql` migration, and `UserRepository` (`4/4` tests).
  - **2.2.a:** Firebase ID-token verification adapter (`MockFirebaseTokenVerifier` & `JwtFirebaseTokenVerifier`, `4/4` tests).
  - **2.3.a:** Opaque Redis session lifecycle (`SessionService`, `RedisHashSessionStore`, `InMemorySessionStore`, `HttpOnly` cookie helpers, `4/4` tests) + CI composite `tsc -b` typecheck fix.
  - **2.4.a:** Auth HTTP controllers, middleware, and router (`POST /auth/google`, `GET /auth/me`, `POST /auth/logout`, `POST /internal/sessions/introspect`, `/healthz`, `/readyz`) + Phase 2 Exit Gate integration tests (`4/4` tests).

## Changed files
- `backend/services/auth/src/middleware/index.ts` — Auth request context, IP rate limiter, and Gateway-only internal guard
- `backend/services/auth/src/controllers/index.ts` — `AuthController` and `toPublicAuthUser` DTO projection
- `backend/services/auth/src/routes/index.ts` — `createAuthRouter` and programmatic test dispatcher
- `backend/services/auth/src/index.ts` — re-exported `controllers`, `middleware`, and `routes`
- `backend/services/auth/tests/auth-routes.test.ts` — 4 integration tests closing the Phase 2 Exit Gate
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `2.4.a` & Phase 2 completion

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 13 suites, 45 tests passing (29 in `@kartik/shared` + 16 in `@kartik/auth`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-2.4.a.zip`, extract into your repo root, run `pnpm --filter @kartik/auth test` (`16/16` tests across 4 suites), and reply **"continue"** to begin **Phase 3 / Micro-step `3.1.a`** (`@kartik/gateway` API Gateway).

## Safe resume instruction
Phase 2 (`@kartik/auth`) is complete. Proceed to **Phase 3 / micro-step `3.1.a`**: wire `backend/gateway` composite build & test scripts, implement Gateway environment configuration (`loadGatewayConfig`), and verify with unit tests.
