# Kartik.ai Learning Log

---

## Entry 33 — Phase 8 / Step 8.6 (Micro-step 8.6.a): Interactive Multi-Agent Demo Harness (`@kartik/frontend/app/interactive-demo-harness`) & Live Workbench

### 1. Concept learned
- **Pluggable `HttpTransport` Enables Zero-Backend Interactive Portfolio Demos (`Blueprint §12`):**
  - Because `KartikGatewayClient` (`@kartik/frontend/lib/api-client`) accepts an injected `HttpTransport`, `createInteractiveDemoHarness()` can simulate the entire API Gateway (`/api/v1/*`) in browser memory while still exercising the real `KartikWorkspaceShellController`, `WorkspaceStore`, `BillingCheckoutController`, `validateClientUploadCandidate`, `formatGroundedCitations`, and `buildSandboxedPreviewDocument` code paths.
  - This allows portfolio reviewers to test specialist routing (`coding`, `rag`, `search`, `chat`, `vision`, `image`), `Idempotency-Key` 0-charge replay (Invariant #15), `DEMO_READ_ONLY` freeze toggling (§12), and opaque-origin `<iframe sandbox="allow-scripts">` execution directly in the browser with zero cloud cost.

### 2. What was implemented
- `frontend/src/app/interactive-demo-harness.ts` (`createInteractiveDemoHarness`, `inferSpecialistFromPrompt`, `buildDemoCodingArtifactBundle`)
- `frontend/src/index.ts` (re-exported `interactive-demo-harness`)
- `frontend/tests/interactive-demo-harness.test.ts` (`3/3` tests covering specialist turns, 0-charge idempotent replay, and `DEMO_READ_ONLY` enforcement)
- `src/App.tsx` (upgraded preview UI to the interactive Kartik.ai Multi-Agent Workbench)

### 3. How to inspect the feature
- Run `pnpm test` (`36` suites, `130` tests passing).
- Interact with the live Workbench in the preview window (send specialist prompts, click **Replay Last Idempotency-Key**, toggle **DEMO_READ_ONLY**, or click **Simulate Token Counter (+1)** inside the sandboxed iframe).
