# Kartik.ai Build State

- Current phase: Phase 4 — Billing Service (`@kartik/billing`)
- Current blueprint item: 4.3 — Razorpay order creation (`MockPaymentProvider` default), checkout HMAC-SHA256 verification (`order_id|payment_id`), raw-body webhook HMAC-SHA256 verification, and duplicate/delayed-webhook replay protection (§11)
- Current micro-step: 4.3.a — implement `PaymentOrderService` (`backend/services/billing/src/services/payment-service.ts`) and Razorpay HMAC verifiers (`backend/services/billing/src/webhooks/index.ts`) + unit tests (`backend/services/billing/tests/payment-service.test.ts`)
- Status: verification pending on owner's host
- Last completed micro-step: 4.3.a — implemented `PaymentOrderService` and Razorpay checkout/webhook HMAC verifiers (`12/12` Billing tests passing across 3 suites; `69/69` total workspace tests passing across 19 suites)
- Next micro-step: 4.4.a — implement Billing public (`/billing/balance`, `/billing/ledger`, `/billing/orders`, `/billing/verify`, `/webhooks/razorpay`) & internal (`/internal/credits/reserve`, `/internal/credits/settle`, `/internal/credits/release`) HTTP routes and close the **Phase 4 Exit Gate**
- Current branch: `main`
- Last known commit: `4.2.a` completed

## Current objective
Implement `backend/services/billing/src/webhooks/index.ts` and `backend/services/billing/src/services/payment-service.ts` (Blueprint §9 Invariants #5, #13, #15, #17, #19 & §11): server-calculated integer paise order creation via `MockPaymentProvider`, constant-time checkout HMAC-SHA256 verification over `${order_id}|${payment_id}` using `RAZORPAY_KEY_SECRET`, constant-time webhook HMAC-SHA256 verification over the exact `rawBody` using `RAZORPAY_WEBHOOK_SECRET`, amount-mismatch defense, and idempotent settlement across checkout + delayed/duplicate webhooks.

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS — Exit Gate Complete).**
- **Phase 2 (`@kartik/auth` — 4 suites / 16 tests PASS — Exit Gate Complete).**
- **Phase 3 (`@kartik/gateway` — 3 suites / 12 tests PASS — Exit Gate Complete).**
- **Phase 4 (`@kartik/billing` — in progress):**
  - **4.1.a:** Billing config (`loadBillingConfig`), integer paise plan catalogue (`DEFAULT_BILLING_PLANS`), `0001_billing_core.sql` migration, and `SELECT ... FOR UPDATE` repository (`4/4` tests).
  - **4.2.a:** Transactional `reserve` / `settle` / `release` credit state machine (`CreditReservationService`), 30-day money idempotency (`idem:{userId}:{requestId}`), payload fingerprint conflict rejection (`409 IDEMPOTENCY_CONFLICT`), and 10-way concurrent reservation no-overdraw proof (`4/4` tests).
  - **4.3.a:** `PaymentOrderService`, `MockPaymentProvider`, checkout HMAC (`order_id|payment_id` with `RAZORPAY_KEY_SECRET`), raw-body webhook HMAC (`RAZORPAY_WEBHOOK_SECRET`), amount-mismatch rejection, and delayed-webhook / duplicate replay idempotency (`4/4` tests).

## Changed files
- `backend/services/billing/src/webhooks/index.ts` — `computeRazorpayCheckoutSignature`, `verifyRazorpayCheckoutSignature`, `computeRazorpayWebhookSignature`, `verifyRazorpayWebhookSignature`, `parseAndVerifyRazorpayWebhook`
- `backend/services/billing/src/services/payment-service.ts` — `PaymentProvider`, `MockPaymentProvider`, `PaymentOrderService`
- `backend/services/billing/src/services/index.ts` & `backend/services/billing/src/index.ts` — barrel exports
- `backend/services/billing/tests/payment-service.test.ts` — 4 unit tests
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `4.3.a`

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 19 suites, 69 tests passing (29 in `@kartik/shared` + 16 in `@kartik/auth` + 12 in `@kartik/gateway` + 12 in `@kartik/billing`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-4.3.a.zip`, extract into your repo root, run `pnpm --filter @kartik/billing test` (`12/12` tests across 3 suites), and reply **"go"** (or **"continue"**) to proceed to **Micro-step `4.4.a`** (Billing public & internal HTTP routes and Phase 4 Exit Gate closure).

## Safe resume instruction
Proceed to **Phase 4 / micro-step `4.4.a`**: implement `backend/services/billing/src/{middleware,controllers,routes}/index.ts` exposing public (`/billing/balance`, `/billing/ledger`, `/billing/orders`, `/billing/verify`, `/webhooks/razorpay`) and internal (`/internal/credits/reserve`, `/internal/credits/settle`, `/internal/credits/release`) routes, plus `backend/services/billing/tests/billing-routes.test.ts` to close the Phase 4 Exit Gate.
