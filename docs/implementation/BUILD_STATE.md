# Kartik.ai Build State

- Current phase: Phase 4 — Billing Service (`@kartik/billing`) — **COMPLETE (Exit Gate Passed)**
- Current blueprint item: 4.4 — Billing public (`/billing/balance`, `/billing/ledger`, `/billing/orders`, `/billing/verify`, `/webhooks/razorpay`) & internal (`/internal/credits/reserve`, `/internal/credits/settle`, `/internal/credits/release`) HTTP routes, Phase 4 Exit Gate closure, and CI parallel `tsc -b` race fix
- Current micro-step: 4.4.a — implement `BillingController`, `createBillingRouter`, and Billing security middleware + Phase 4 Exit Gate integration tests (`backend/services/billing/tests/billing-routes.test.ts`) + remove `--force` from workspace `package.json` `tsc -b` scripts
- Status: verification pending on owner's host
- Last completed micro-step: 4.4.a — completed `@kartik/billing` HTTP routes & Phase 4 Exit Gate (`16/16` Billing tests passing across 4 suites; `73/73` total workspace tests passing across 20 suites)
- Next micro-step: 5.1.a — begin Phase 5 (`@kartik/agent` — Agent service config with `MOCK_AI=true` default, provider adapter interfaces for `ChatModelProvider`, `CodingModelProvider`, `SearchProvider`, `EmbeddingProvider`, `ImageGenerationProvider`, `VisionProvider`, `VectorStore`, and `0001_agent_core.sql` migration)
- Current branch: `main`
- Last known commit: `4.3.a` completed

## Current objective
Implement `backend/services/billing/src/{middleware,controllers,routes}/index.ts` (Blueprint §5.4, §5.5, §6.3, §6.4, §7.2 Phase 4 Exit Gate, §9 Invariants #5, #6, #14, #15, #17, §11 & §12): wire public Gateway-forwarded routes and Chat-only internal credit reservation routes, fix the parallel `pnpm -r run build` `tsc -b --force` race condition in workspace `package.json` files, and verify the Phase 4 Exit Gate (`16/16` Billing tests passing).

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS — Exit Gate Complete).**
- **Phase 2 (`@kartik/auth` — 4 suites / 16 tests PASS — Exit Gate Complete).**
- **Phase 3 (`@kartik/gateway` — 3 suites / 12 tests PASS — Exit Gate Complete).**
- **Phase 4 (`@kartik/billing` — 4 suites / 16 tests PASS — Exit Gate Complete):**
  - **4.1.a:** Billing config (`loadBillingConfig`), integer paise plan catalogue (`DEFAULT_BILLING_PLANS`), `0001_billing_core.sql` migration, and `SELECT ... FOR UPDATE` repository (`4/4` tests).
  - **4.2.a:** Transactional `reserve` / `settle` / `release` credit state machine (`CreditReservationService`), 30-day money idempotency (`idem:{userId}:{requestId}`), payload fingerprint conflict rejection (`409 IDEMPOTENCY_CONFLICT`), and 10-way concurrent reservation no-overdraw proof (`4/4` tests).
  - **4.3.a:** `PaymentOrderService`, `MockPaymentProvider`, checkout HMAC (`order_id|payment_id` with `RAZORPAY_KEY_SECRET`), raw-body webhook HMAC (`RAZORPAY_WEBHOOK_SECRET`), amount-mismatch rejection, and delayed-webhook / duplicate replay idempotency (`4/4` tests).
  - **4.4.a:** Public & internal Billing HTTP routes (`createBillingRouter`), Chat-only `/internal/credits/*` enforcement (Invariant #6), CI parallel `tsc -b` build fix, and Phase 4 Exit Gate closure (`4/4` tests).

## Changed files
- `backend/{shared,gateway,services/auth,services/billing}/package.json` — replaced `tsc -b --force` with `tsc -b` so parallel `pnpm -r run build` never overwrites `backend/shared/dist/*.d.ts` concurrently
- `backend/services/billing/src/middleware/index.ts` — Gateway user assertion & Chat-only internal caller guards
- `backend/services/billing/src/controllers/index.ts` — `BillingController`
- `backend/services/billing/src/routes/index.ts` — `createBillingRouter`
- `backend/services/billing/src/index.ts` — barrel exports
- `backend/services/billing/tests/billing-routes.test.ts` — 4 integration tests closing the Phase 4 Exit Gate
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `4.4.a` & Phase 4 completion

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 20 suites, 73 tests passing (29 in `@kartik/shared` + 16 in `@kartik/auth` + 12 in `@kartik/gateway` + 16 in `@kartik/billing`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-4.4.a.zip`, extract into your repo root, run `pnpm build && pnpm --filter @kartik/billing test` (`16/16` tests across 4 suites), and reply **"go"** (or **"continue"**) to begin **Phase 5 (`@kartik/agent`) — Micro-step `5.1.a`**.

## Safe resume instruction
Phase 4 (`@kartik/billing`) is complete. Proceed to **Phase 5 / micro-step `5.1.a`**: wire `backend/services/agent` composite build & test scripts (`tsc -b`), implement `loadAgentConfig` (`MOCK_AI=true` and `IMAGE_PROVIDER=mock` defaults), define `0001_agent_core.sql` (`files`, `artifacts`, `document_chunks`), and define the provider adapter interfaces (`ChatModelProvider`, `CodingModelProvider`, `SearchProvider`, `EmbeddingProvider`, `ImageGenerationProvider`, `VisionProvider`, `VectorStore`).
