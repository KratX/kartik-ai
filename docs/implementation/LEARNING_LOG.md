# Kartik.ai Learning Log

---

## Entry 29 — Phase 8 / Step 8.2 (Micro-step 8.2.a): Cross-Service E2E Pipeline, Free-Tier Portfolio Readiness & Phase 8 Final Exit Gate

### 1. Concept learned
- **Free-Tier Portfolio Safety Posture (`Blueprint §11 & §12`):**
  - A publicly reachable portfolio deployment with real API keys or live payment credentials is an immediate abuse and billing target.
  - `verifyPortfolioFreeTierReadiness` enforces at startup:
    1. `MOCK_AI=true`, `IMAGE_PROVIDER=mock`, and `BILLING_MODE=mock` by default.
    2. Live Razorpay keys (`rzp_live_*`) are strictly rejected (`Blueprint §11: "Never enable live payments on a publicly reachable deployment."`).
    3. Opting into live AI providers (`MOCK_AI=false`) requires a bounded positive integer `DAILY_LIVE_CALL_BUDGET` (`1..500`) in Redis so daily exhaustion degrades gracefully to mock mode rather than incurring unexpected charges.
- **Liveness (`/healthz`) vs. Cluster Readiness (`/readyz`) (`Blueprint §5`):**
  - Liveness (`/healthz`) checks whether the Gateway process itself is running.
  - Readiness (`/readyz` via `CrossServiceHealthAggregator`) probes `/readyz` across `auth`, `chat`, `agent`, and `billing` to confirm the cluster can actually serve requests before routing traffic.

### 2. What was implemented
- `backend/gateway/src/readiness/index.ts` (`ARCHITECTURE_INVARIANTS_REGISTRY`, `verifyPortfolioFreeTierReadiness`, `CrossServiceHealthAggregator`)
- `backend/gateway/src/index.ts` (exported readiness symbols)
- `backend/gateway/tests/e2e-readiness.test.ts` (4 tests closing the **Phase 8 Final Exit Gate**)

### 3. How to inspect the feature
- Run `pnpm test` and inspect `@kartik/gateway Cross-Service E2E Pipeline, Free-Tier Readiness & Phase 8 Final Exit Gate (8.2.a)` (`32` suites, `121` tests passing).

---

## Entry 28 — Phase 8 / Step 8.1 (Micro-step 8.1.a): Specialist Evaluation Suite (`SPECIALIST_EVALUATION_DATASET`) & Prompt-Injection Data Sanitization

### 1. Concept learned
- **Evaluating Structure, Routing, Grounding, and Safety — Never Brittle Exact Strings (`Blueprint §10`):**
  - `SpecialistEvaluationRunner` evaluates routing, structure, citations, and artifact manifest safety across `SPECIALIST_EVALUATION_DATASET` (8 prompts covering `chat`, `search`, `coding`, `rag`, `vision`, `image`).
