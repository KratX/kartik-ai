# Kartik.ai Learning Log

---

## Entry 19 — Phase 5 / Step 5.2 (Micro-step 5.2.a): Router, Specialist Graph Execution & Daily Redis Budget Guard

### 1. Concept learned
- **LangChain vs LangGraph & Deterministic Specialist Routing (Blueprint §5, §10):**
  - **LangChain vs LangGraph:** *LangChain* provides linear prompt-to-model chains and provider wrappers, whereas *LangGraph* models agent execution as a stateful directed graph (`Router -> Specialist Node -> Validation/Persistence -> Output`).
  - **Untrusted Model Output Validation (Invariant #12):** When the `coding` specialist returns a JSON code bundle, `AgentGraphExecutor` never trusts the raw JSON. It parses it and runs `validateArtifactManifest` (`@kartik/shared/validation`) to reject path traversal (`../`), absolute paths, null bytes, hidden files, or disallowed extensions with `422 ARTIFACT_INVALID` before writing anything to storage.
  - **Graceful Budget Degradation (§12):** `DailyLiveBudgetGuard` tracks daily live calls in Redis under `quota:{userId}:{day}` and `quota:global_live:{day}` (48h TTL). When the daily cap is reached, it degrades smoothly to deterministic mock mode with a clear notice rather than failing hard.

### 2. What was implemented
- `backend/services/agent/src/services/budget-guard.ts` (`DailyLiveBudgetGuard`, `InMemoryDailyBudgetStore`)
- `backend/services/agent/src/graph/index.ts` (`routePromptToSpecialist`, `AgentGraphExecutor`)
- `backend/services/agent/tests/agent-graph.test.ts` (4 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect the `@kartik/agent Router, Specialist Graph & Daily Redis Budget Guard (5.2.a)` suite.
