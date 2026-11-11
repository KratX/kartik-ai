# Kartik.ai Learning Log

---

## Entry 21 — Phase 5 / Step 5.4 (Micro-step 5.4.a): Agent HTTP Routes & Phase 5 Exit Gate Closure

### 1. Concept learned
- **Two-Boundary HTTP Separation in Agent (`aud="agent"` Public Routes vs Chat-Only Internal Routes, Invariants #6, #10, #14, #18, #20):**
  - **Public File & Artifact Routes (`POST /files`, `GET /files`, `GET /files/:fileId`, `GET /artifacts/:artifactId`):** Forwarded by the API Gateway with an Ed25519 `x-user-context` assertion bound strictly to `aud === "agent"`. If an assertion minted for `chat` or `billing` is replayed against Agent, `requireAgentUserContext` rejects it with `401 UNAUTHENTICATED`. When a user requests a file or artifact owned by someone else, Agent returns `404 NOT_FOUND` (never `403 FORBIDDEN`, Invariant #20).
  - **Internal Execution & Purge Routes (`POST /internal/agent/execute`, `POST /internal/agent/purge`):** Never exposed in the Gateway public route table (Invariant #14) and callable strictly by `@kartik/chat` (`x-service-caller: chat` + `x-service-token`). Chat coordinates credit reservation/settlement with Billing around `/internal/agent/execute`, and coordinates conversation deletion via `/internal/agent/purge`.

### 2. What was implemented
- `backend/services/agent/src/middleware/index.ts` (`requireAgentUserContext`, `requireAgentServiceAuth`)
- `backend/services/agent/src/controllers/index.ts` (`AgentController`)
- `backend/services/agent/src/routes/index.ts` (`createAgentRouter`)
- `backend/services/agent/tests/agent-routes.test.ts` (4 integration tests closing Phase 5 Exit Gate)

### 3. How to inspect the feature
- Run `pnpm test` and inspect the `@kartik/agent HTTP Routes & Phase 5 Exit Gate Closure (5.4.a)` suite.
