# Kartik.ai Build State

- Current phase: Phase 3 — API Gateway (`@kartik/gateway`) — **COMPLETE (Exit Gate Passed)**
- Current blueprint item: 3.3 — Gateway public route table, `/internal/*` path blocking (`404 NOT_FOUND`), `traceId` generation + `Idempotency-Key` -> `x-request-id` forwarding, raw body webhook passthrough, and Phase 3 Exit Gate closure
- Current micro-step: 3.3.a — implement `resolvePublicGatewayRoute` and `createGatewayRouter` (`backend/gateway/src/routes/index.ts`) + Phase 3 Exit Gate integration tests (`backend/gateway/tests/gateway-routes.test.ts`)
- Status: verification pending on owner's host
- Last completed micro-step: 3.3.a — completed `@kartik/gateway` public route table & Phase 3 Exit Gate (`12/12` Gateway tests passing across 3 suites; `57/57` total workspace tests passing across 16 suites)
- Next micro-step: 4.1.a — begin Phase 4 (`@kartik/billing` — Billing service config, `0001_billing_core.sql` forward-only schema migration for plans, credit accounts, reservations, ledger entries, and payments, plus `SELECT ... FOR UPDATE` row-locking repository per Invariant #17)
- Current branch: `main`
- Last known commit: `3.2.a` completed

## Current objective
Implement `backend/gateway/src/routes/index.ts` (Blueprint §2.1, §5.4, §5.5, §6.3, §6.4, §7.2 Phase 3 Exit Gate, §11, §12, ADR 0002 & Invariants #1, #14, #15, #20): map public `/api/v1/*` routes to `auth`, `chat`, `agent`, and `billing`, block any `/internal/*` path with `404 NOT_FOUND`, generate fresh `traceId` while preserving client `Idempotency-Key` unchanged as `x-request-id`, preserve raw body on `/api/v1/webhooks/razorpay`, and verify the Phase 3 Exit Gate (`12/12` Gateway tests passing).

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS):** `config`, `errors`, `logger`, `redis`, `auth`, `contracts`, `validation`, `database`, `storage`, `middleware`.
- **Phase 2 (`@kartik/auth` — 4 suites / 16 tests PASS — Exit Gate Complete):** `config`, `models`, `repositories`, `firebase-verifier`, `session-service`, `middleware`, `controllers`, `routes`.
- **Phase 3 (`@kartik/gateway` — 3 suites / 12 tests PASS — Exit Gate Complete):**
  - **3.1.a:** Gateway config, Ed25519 signing key boot validation, CORS allowlist parser, and upstream service directory (`4/4` tests).
  - **3.2.a:** Session cookie introspection client, audience-scoped Ed25519 `x-user-context` assertion minting, cookie stripping, and CORS/CSRF middleware (`4/4` tests).
  - **3.3.a:** Public route table (`resolvePublicGatewayRoute`, `createGatewayRouter`), `/internal/*` `404` blocking, fresh `traceId` + unchanged `Idempotency-Key` -> `x-request-id` forwarding, raw body webhook passthrough, and Phase 3 Exit Gate integration tests (`4/4` tests).

## Changed files
- `backend/gateway/src/routes/index.ts` — `resolvePublicGatewayRoute` and `createGatewayRouter`
- `backend/gateway/src/index.ts` — re-exported `./routes/index.js`
- `backend/gateway/tests/gateway-routes.test.ts` — 4 integration tests closing the Phase 3 Exit Gate
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `3.3.a` & Phase 3 completion

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 16 suites, 57 tests passing (29 in `@kartik/shared` + 16 in `@kartik/auth` + 12 in `@kartik/gateway`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-3.3.a.zip`, extract into your repo root, run `pnpm --filter @kartik/gateway test` (`12/12` tests across 3 suites), and reply **"continue"** to begin **Phase 4 / Micro-step `4.1.a`** (`@kartik/billing` Credit & Payment Ledger Service).

## Safe resume instruction
Phase 3 (`@kartik/gateway`) is complete. Proceed to **Phase 4 / micro-step `4.1.a`**: wire `backend/services/billing` composite build & test scripts (`tsc -b`), implement Billing config (`loadBillingConfig`), and define the `0001_billing_core.sql` migration & domain models (`credit_accounts`, `credit_reservations`, `credit_ledger_entries`, `payment_orders`).
