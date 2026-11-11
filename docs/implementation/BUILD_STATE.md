# Kartik.ai Build State

- Current phase: Phase 4 — Billing Service (`@kartik/billing`)
- Current blueprint item: 4.2 — Transactional `reserve` / `settle` / `release` credit state machine (`CreditReservationService`), 30-day money idempotency (`idem:{userId}:{requestId}`), payload fingerprint conflict detection (`409 IDEMPOTENCY_CONFLICT`), and 10-way concurrent no-overdraw proof (Invariant #17)
- Current micro-step: 4.2.a — implement `CreditReservationService` (`backend/services/billing/src/services/credit-service.ts`) + unit & concurrency tests (`backend/services/billing/tests/credit-service.test.ts`)
- Status: verification pending on owner's host
- Last completed micro-step: 4.2.a — implemented `CreditReservationService` and verified 10-way concurrent reservation no-overdraw proof (`8/8` Billing tests passing across 2 suites; `65/65` total workspace tests passing across 18 suites)
- Next micro-step: 4.3.a — implement `PaymentProvider` (`MockPaymentProvider` + live Razorpay adapter) and `PaymentOrderService` (`backend/services/billing/src/services/payment-service.ts`) enforcing server-side integer paise order creation, checkout HMAC-SHA256 (`order_id|payment_id`) verification, and raw-body webhook HMAC-SHA256 verification with replay/duplicate protection (§11)
- Current branch: `main`
- Last known commit: `4.1.a` completed

## Current objective
Implement `backend/services/billing/src/services/credit-service.ts` (Blueprint §5.2, §5.4, §5.6, §9 Invariants #5, #6, #15, #16, #17, #20 & §11): transactional `reserveCredits`, `settleCredits`, and `releaseCredits` inside `SELECT ... FOR UPDATE`, 30-day money idempotency (`idem:{userId}:{requestId}`), SHA-256 payload fingerprint conflict rejection (`409 IDEMPOTENCY_CONFLICT`), and 10-way concurrent reservation no-overdraw proof against a 100-credit balance.

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS — Exit Gate Complete).**
- **Phase 2 (`@kartik/auth` — 4 suites / 16 tests PASS — Exit Gate Complete).**
- **Phase 3 (`@kartik/gateway` — 3 suites / 12 tests PASS — Exit Gate Complete).**
- **Phase 4 (`@kartik/billing` — in progress):**
  - **4.1.a:** Billing config (`loadBillingConfig`), integer paise plan catalogue (`DEFAULT_BILLING_PLANS`), `0001_billing_core.sql` migration, and `SELECT ... FOR UPDATE` repository (`4/4` tests).
  - **4.2.a:** Transactional `reserve` / `settle` / `release` credit state machine (`CreditReservationService`), 30-day money idempotency (`idem:{userId}:{requestId}`), payload fingerprint conflict rejection (`409 IDEMPOTENCY_CONFLICT`), and 10-way concurrent reservation no-overdraw proof (`4/4` tests).

## Changed files
- `backend/services/billing/src/services/credit-service.ts` — `CreditReservationService`, `OPERATION_CREDIT_COSTS`, `InMemoryMoneyIdempotencyStore`
- `backend/services/billing/src/services/index.ts` & `backend/services/billing/src/index.ts` — barrel exports
- `backend/services/billing/tests/credit-service.test.ts` — 4 unit & concurrency tests
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `4.2.a`

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 18 suites, 65 tests passing (29 in `@kartik/shared` + 16 in `@kartik/auth` + 12 in `@kartik/gateway` + 8 in `@kartik/billing`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-4.2.a.zip`, extract into your repo root, run `pnpm --filter @kartik/billing test` (`8/8` tests across 2 suites), and reply **"go"** (or **"continue"**) to proceed to **Micro-step `4.3.a`** (Razorpay mock/live payment provider, checkout HMAC `order_id|payment_id` verification & raw-body webhook HMAC verification).

## Safe resume instruction
Proceed to **Phase 4 / micro-step `4.3.a`**: implement `backend/services/billing/src/services/payment-service.ts` and `backend/services/billing/src/webhooks/index.ts` (`MockPaymentProvider` + Razorpay adapter, checkout signature verification over `order_id|payment_id`, raw-body webhook signature verification, and duplicate/replay protection).
