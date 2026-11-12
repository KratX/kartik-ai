# Kartik.ai Build State

- Current phase: Phase 7 — Frontend Application (`frontend`)
- Current step / micro-step: 7.3.a
- Status: complete
- Last completed micro-step: 7.3.a (Full Kartik.ai Workspace Shell Controller, Billing Checkout & Top-Up Flow, Client Upload Boundary Validator, and Phase 7 Exit Gate closure)
- Next micro-step: 8.1.a (Cross-Service End-to-End Pipeline `Gateway -> Auth -> Chat -> Billing -> Agent` & Specialist Evaluation Suite)
- Current branch: main
- Last known commit: Phase 7 micro-step 7.3.a complete (Phase 7 Exit Gate closed)

## Current objective
Phase 7 (`@kartik/frontend`) is now **100% COMPLETE**. Micro-step `7.3.a` implements `BillingCheckoutController` (sending `planId` only so integer paise are computed server-side by Billing, §11), `validateClientUploadCandidate` & `sanitizeUploadFilename` (enforcing client-side extension, MIME, and byte-ceiling checks before Gateway upload, §11), and `KartikWorkspaceShellController` (coordinating Google auth bootstrap, conversation switching, retry-safe message submission reusing the sticky `Idempotency-Key`, grounded citation formatting, isolated code preview generation, and top-up order verification). All `12/12` `@kartik/frontend` tests (`113/113` cumulative across `30` suites) pass.

## Completed work
- Phase 0: Repository & Toolchain Baseline (Complete)
- Phase 1: Shared Foundation (`backend/shared` — Complete, 9/9 test suites, 29/29 tests passing)
- Phase 2: Auth Service (`backend/services/auth` — Complete, 4/4 Auth suites, 16/16 Auth tests passing, 45/45 cumulative)
- Phase 3: API Gateway (`backend/gateway` — Complete, 3/3 Gateway suites, 12/12 Gateway tests passing, 57/57 cumulative)
- Phase 4: Billing Service (`backend/services/billing` — Complete, 4/4 Billing suites, 16/16 Billing tests passing, 73/73 cumulative)
- Phase 5: Agent Service (`backend/services/agent` — Complete, 4/4 Agent suites, 16/16 Agent tests passing, 89/89 cumulative)
- Phase 6: Chat Service (`backend/services/chat` — Complete, 3/3 Chat suites, 12/12 Chat tests passing, 101/101 cumulative)
- Phase 7: Frontend Application (`frontend` — Complete, 3/3 Frontend suites, 12/12 Frontend tests passing, 113/113 cumulative):
  - `7.1.a`: `KartikGatewayClient`, `ERROR_RECOVERY_POLICY`, and `WorkspaceStore` (`4/4` tests).
  - `7.2.a`: `buildSandboxedPreviewDocument`, `validateFrontendArtifactBundle`, `formatGroundedCitations`, and `sanitizeExternalCitationUrl` (`4/4` tests).
  - `7.3.a`: `BillingCheckoutController`, `validateClientUploadCandidate`, `KartikWorkspaceShellController`, and `frontend/tests/frontend-workspace-shell.test.ts` (`4/4` tests — **Phase 7 Exit Gate closed**).

## Changed files (Micro-step 7.3.a)
- `frontend/src/types/index.ts` (modified)
- `frontend/src/lib/api-client.ts` (modified)
- `frontend/src/features/billing/index.ts` (created)
- `frontend/src/features/uploads/index.ts` (created)
- `frontend/src/app/workspace-shell.ts` (created)
- `frontend/src/index.ts` (modified)
- `frontend/tests/frontend-workspace-shell.test.ts` (created)
- `docs/implementation/BUILD_STATE.md` (updated)
- `docs/implementation/TEST_EVIDENCE.md` (updated)
- `docs/implementation/LEARNING_LOG.md` (updated)
- `docs/implementation/PHASE_CHECKLIST.md` (updated)

## Verification evidence
- `pnpm test` (`node --test --test-reporter=spec "backend/**/dist/tests/*.test.js"`) — **PASS** (`30` suites, `113` tests passing: `29` in `@kartik/shared` + `16` in `@kartik/auth` + `12` in `@kartik/gateway` + `16` in `@kartik/billing` + `16` in `@kartik/agent` + `12` in `@kartik/chat` + `12` in `@kartik/frontend`, `0` failures)

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None.

## Safe resume instruction
Wait for owner review of **Micro-step `7.3.a`** (Phase 7 Exit Gate). On `"continue"` / `"go"`, proceed to **Phase 8 — End-to-End Integration, Evaluation & Hardening, Micro-step `8.1.a`** (Cross-Service E2E Pipeline & Specialist Evaluation Suite).
