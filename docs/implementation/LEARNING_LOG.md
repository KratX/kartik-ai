# Kartik.ai Learning Log

---

## Entry 28 — Phase 8 / Step 8.1 (Micro-step 8.1.a): Specialist Evaluation Suite (`SPECIALIST_EVALUATION_DATASET`) & Prompt-Injection Data Sanitization

### 1. Concept learned
- **Evaluating Structure, Routing, Grounding, and Safety — Never Brittle Exact Strings (`Blueprint §10`):**
  - LLMs are non-deterministic in live mode and deterministic in mock mode, so asserting exact string equality on prose breaks as soon as prompts or models evolve.
  - Instead, `SpecialistEvaluationRunner` evaluates 4 structural invariants across `SPECIALIST_EVALUATION_DATASET` (8 prompts covering `chat`, `search`, `coding`, `rag`, `vision`, `image`):
    1. **Routing accuracy:** Does `AgentGraphExecutor` select the expected specialist (`expectedSpecialist`)?
    2. **Structural validity:** Does the response include a valid `executionId`, preserved `requestId`, non-empty `replyContent`, and positive token accounting?
    3. **Grounding verification:** Do `search` and `rag` responses include non-empty `citations` (`https://` URLs for web search; `p. <N>` page locators for RAG), and does `search` separate `### Cited Source Material` from `### Synthesis`?
    4. **Artifact safety:** Do `coding` and `image` turns persist artifacts whose manifests pass `validateArtifactManifest` (`502 ARTIFACT_INVALID` on `../` path traversal)?
- **Retrieved Content Is Data, Never Instructions (`Blueprint §10`):**
  - `sanitizeUntrustedRetrievedData` strips prompt-injection directives (`IGNORE ALL PREVIOUS INSTRUCTIONS`, `<system>`, `execute shell:`) and wraps untrusted passages in `[DATA_ONLY_BEGIN] ... [DATA_ONLY_END]`.

### 2. What was implemented
- `backend/services/agent/src/eval/index.ts` (`SPECIALIST_EVALUATION_DATASET`, `SpecialistEvaluationRunner`, `sanitizeUntrustedRetrievedData`)
- `backend/services/agent/src/index.ts` (exported evaluation suite symbols)
- `backend/services/agent/tests/agent-evaluation-suite.test.ts` (4 evaluation & safety benchmark tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect `@kartik/agent Specialist Evaluation Suite & Prompt Safety Benchmark (8.1.a)` (`31` suites, `117` tests passing).

---

## Entry 27 — Phase 7 / Step 7.3 (Micro-step 7.3.a): Workspace Shell Controller, `planId`-Only Billing Checkout, Upload Boundary Guards & Phase 7 Exit Gate

### 1. Concept learned
- **Why the Browser Sends `planId` Only — Never an Authoritative Price or Credit Amount (`Blueprint §11`):**
  - `BillingCheckoutController.startTopUpOrder(planId)` sends `{ planId }` to `POST /api/v1/billing/orders` alongside a fresh client-owned `Idempotency-Key`.
