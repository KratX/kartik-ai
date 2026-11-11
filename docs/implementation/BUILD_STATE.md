# Kartik.ai Build State

- Current phase: Phase 4 — Billing Service (`@kartik/billing`)
- Current blueprint item: 4.1 — Billing service configuration (`BILLING_MODE=mock` default), integer paise plan catalogue, `0001_billing_core.sql` forward-only migration, and `SELECT ... FOR UPDATE` row-locking repository (Invariant #17)
- Current micro-step: 4.1.a — wire `backend/services/billing/{package.json,tsconfig.json}` (`tsc -b`), implement `loadBillingConfig`, `0001_billing_core.sql` + integer paise models, and `PostgresBillingRepository` / `InMemoryBillingRepository` (`backend/services/billing/src/repositories/index.ts`) + unit tests (`backend/services/billing/tests/billing-repository.test.ts`)
- Status: verification pending on owner's host
- Last completed micro-step: 4.1.a — implemented `@kartik/billing` config, integer paise models, `0001_billing_core.sql`, and `SELECT ... FOR UPDATE` repository (`4/4` Billing tests passing; `61/61` total workspace tests passing across 17 suites)
- Next micro-step: 4.2.a — implement the transactional `reserve` / `settle` / `release` credit state machine (`CreditReservationService`), Redis 30-day money idempotency (`idem:{userId}:{requestId}`) + payload fingerprint conflict check (`409 IDEMPOTENCY_CONFLICT`), and the concurrent no-overdraw proof test (10 parallel reservations against 100 credits -> exact non-negative balance)
- Current branch: `main`
- Last known commit: `3.3.a` completed

## Current objective
Implement `backend/services/billing/src/{config,models,repositories}/index.ts` (Blueprint §5.1, §6, §9 Invariants #5, #6, #7, #15, #17, #19 & §11): wire composite `tsc -b` build/typecheck/test scripts, validate Billing environment variables (`BILLING_MODE=mock` default, Ed25519 `USER_CONTEXT_PUBLIC_KEY` boot verification, live Razorpay secrets), define integer paise pricing (`DEFAULT_BILLING_PLANS`) and `0001_billing_core.sql` (`CHECK (available_credits >= 0 AND reserved_credits >= 0)`), and implement `PostgresBillingRepository` / `InMemoryBillingRepository` enforcing `SELECT ... FOR UPDATE` row-level locking on `billing.credit_accounts`.

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS — Exit Gate Complete).**
- **Phase 2 (`@kartik/auth` — 4 suites / 16 tests PASS — Exit Gate Complete).**
- **Phase 3 (`@kartik/gateway` — 3 suites / 12 tests PASS — Exit Gate Complete).**
- **Phase 4 (`@kartik/billing` — in progress):**
  - **4.1.a:** Billing config (`loadBillingConfig`), integer paise plan catalogue (`DEFAULT_BILLING_PLANS`), `0001_billing_core.sql` migration, and `SELECT ... FOR UPDATE` repository (`PostgresBillingRepository` + `InMemoryBillingRepository`) (`4/4` tests).

## Changed files
- `backend/services/billing/package.json` & `backend/services/billing/tsconfig.json` — composite `tsc -b` build, typecheck, and `node:test` scripts
- `backend/services/billing/src/config/index.ts` — `loadBillingConfig`
- `backend/services/billing/src/models/index.ts` — `DEFAULT_BILLING_PLANS` (integer paise), `BILLING_INITIAL_MIGRATION` (`0001_billing_core.sql`), domain interfaces
- `backend/services/billing/src/repositories/index.ts` — `PostgresBillingRepository` and `InMemoryBillingRepository` with `SELECT ... FOR UPDATE` row locking
- `backend/services/billing/src/index.ts` — barrel exports
- `backend/services/billing/tests/billing-repository.test.ts` — 4 unit tests
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `4.1.a`

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 17 suites, 61 tests passing (29 in `@kartik/shared` + 16 in `@kartik/auth` + 12 in `@kartik/gateway` + 4 in `@kartik/billing`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-4.1.a.zip`, extract into your repo root, run `pnpm --filter @kartik/billing test` (`4/4` tests), and reply **"go"** (or **"continue"**) to proceed to **Micro-step `4.2.a`** (`CreditReservationService` transactional `reserve`/`settle`/`release` state machine & concurrent no-overdraw proof).

## Safe resume instruction
Proceed to **Phase 4 / micro-step `4.2.a`**: implement `backend/services/billing/src/services/credit-service.ts` (`CreditReservationService`: transactional `reserve`, `settle`, `release`, Redis 30-day `idem:{userId}:{requestId}` deduplication + `409 IDEMPOTENCY_CONFLICT` fingerprint check, and 10-way concurrent reservation no-overdraw proof test).
