# Kartik.ai Learning Log

---

## Entry 27 — Phase 7 / Step 7.3 (Micro-step 7.3.a): Workspace Shell Controller, `planId`-Only Billing Checkout, Upload Boundary Guards & Phase 7 Exit Gate

### 1. Concept learned
- **Why the Browser Sends `planId` Only — Never an Authoritative Price or Credit Amount (`Blueprint §11`):**
  - `BillingCheckoutController.startTopUpOrder(planId)` sends `{ planId }` to `POST /api/v1/billing/orders` alongside a fresh client-owned `Idempotency-Key`.
  - Even though `FRONTEND_PLAN_CATALOGUE_DISPLAY` formats integer paise into `"₹199.00"` or `"₹499.00"` for the UI, the browser never transmits `amountPaise` or `credits` to the backend. Billing looks up the authoritative integer paise price on the server and signs/verifies the Razorpay checkout payload (`order_id|payment_id`).
- **Retry-Safe Workspace Turn Orchestration (`Blueprint §5.4, §10 & Invariant #15`):**
  - `KartikWorkspaceShellController.sendMessage(prompt)` checks `store.getOrCreatePendingDraft(conversationId, prompt, selectedAgent, attachmentFileIds)`.
  - If a transient `503 PROVIDER_UNAVAILABLE` interrupts the first turn, the pending draft stays in `WorkspaceStore` with its original `requestId`. When the user clicks retry, the exact same `Idempotency-Key` is transmitted to the Gateway so Chat can replay or settle without double-charging.
  - If `409 EXECUTION_UNKNOWN` is returned, the workspace shell transitions to `'reconciling'` (`canAutoRetryWithSameKey: false`) and blocks blind retries while backend settlement reconciliation finishes.

### 2. What was implemented
- `frontend/src/types/index.ts` & `frontend/src/lib/api-client.ts` (added `createPaymentOrder`, `verifyPaymentCheckout`, `uploadFile`)
- `frontend/src/features/billing/index.ts` (`BillingCheckoutController`, `formatPaiseToInrLabel`, `FRONTEND_PLAN_CATALOGUE_DISPLAY`)
- `frontend/src/features/uploads/index.ts` (`validateClientUploadCandidate`, `sanitizeUploadFilename`)
- `frontend/src/app/workspace-shell.ts` (`KartikWorkspaceShellController`)
- `frontend/tests/frontend-workspace-shell.test.ts` (4 unit tests closing the **Phase 7 Exit Gate**)

### 3. How to inspect the feature
- Run `pnpm test` and inspect `@kartik/frontend Workspace Shell, Billing Top-Up & Phase 7 Exit Gate (7.3.a)` (`30` suites, `113` tests passing).

---

## Entry 26 — Phase 7 / Step 7.2 (Micro-step 7.2.a): Isolated Browser Code Sandbox (`sandbox="allow-scripts"`) & Grounded Citation Sanitizer

### 1. Concept learned
- **Why `sandbox="allow-scripts"` Must Never Include `allow-same-origin` (`Blueprint §9 Invariant #11 & §11`):**
  - When an `<iframe>` renders untrusted model-generated code via `srcdoc` with `sandbox="allow-scripts"` (and **without** `allow-same-origin`), the browser places the iframe inside a unique, opaque origin (`null`).
