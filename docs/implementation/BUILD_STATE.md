# Kartik.ai Build State

- Current phase: Phase 5 — Agent Service (`backend/services/agent`)
- Current step / micro-step: 5.2.a
- Status: complete
- Last completed micro-step: 5.2.a (Router & specialist graph execution for chat/search/coding/rag/vision/image + daily Redis budget counters with graceful mock fallback)
- Next micro-step: 5.3.a (File upload validation with magic bytes & server-generated storage keys, PDF chunking/embedding, and Agent repositories)
- Current branch: main
- Last known commit: Phase 5 micro-step 5.2.a complete

## Current objective
Phase 5 (`@kartik/agent`) implements the Agent Service owning LangGraph specialist execution (`router`, `chat`, `search`, `coding`, `rag`, `vision`, `image`), uploaded-file and artifact metadata, object storage, and `userId`-filtered vector retrieval (Invariants #4, #6, #9, #10, #12, #13, #18, #19). Micro-step `5.2.a` implements the Router node (`routePromptToSpecialist`), the 6-specialist `AgentGraphExecutor`, and `DailyLiveBudgetGuard` (`quota:{userId}:{day}`, 48h TTL) with graceful mock fallback on budget exhaustion.

## Completed work
- Phase 0: Repository & Toolchain Baseline (Complete)
- Phase 1: Shared Foundation (`backend/shared` — Complete, 9/9 test suites, 29/29 tests passing)
- Phase 2: Auth Service (`backend/services/auth` — Complete, 4/4 Auth suites, 16/16 Auth tests passing, 45/45 cumulative)
- Phase 3: API Gateway (`backend/gateway` — Complete, 3/3 Gateway suites, 12/12 Gateway tests passing, 57/57 cumulative)
- Phase 4: Billing Service (`backend/services/billing` — Complete, 4/4 Billing suites, 16/16 Billing tests passing, 73/73 cumulative)
- Phase 5: Agent Service (`backend/services/agent`):
  - `5.1.a`: Agent config (`MOCK_AI=true` default), `0001_agent_core.sql` migration, provider interfaces, deterministic mock providers, and `userId`-isolated `InMemoryVectorStore` (`4/4` tests passing).
  - `5.2.a`: Implemented `DailyLiveBudgetGuard` (`src/services/budget-guard.ts`) using `RedisKeys.dailyQuota` (`quota:{userId}:{day}`) with graceful mock fallback on exhaustion (§12), `routePromptToSpecialist` and `AgentGraphExecutor` (`src/graph/index.ts`) covering all 6 specialists (`chat`, `search`, `coding`, `rag`, `vision`, `image`), and `tests/agent-graph.test.ts` (`4/4` tests passing, `8/8` Agent tests total).

## Changed files (Micro-step 5.2.a)
- `backend/services/agent/src/services/mock-providers.ts` (updated)
- `backend/services/agent/src/services/budget-guard.ts` (created)
- `backend/services/agent/src/graph/index.ts` (created)
- `backend/services/agent/src/index.ts` (updated)
- `backend/services/agent/tests/agent-graph.test.ts` (created)
- `docs/implementation/BUILD_STATE.md` (updated)
- `docs/implementation/TEST_EVIDENCE.md` (updated)
- `docs/implementation/LEARNING_LOG.md` (updated)
- `docs/implementation/PHASE_CHECKLIST.md` (updated)

## Verification evidence
- `pnpm test` (`node --test --test-reporter=spec "backend/**/dist/tests/*.test.js"`) — **PASS** (`22` suites, `81` tests passing: `29` in `@kartik/shared` + `16` in `@kartik/auth` + `12` in `@kartik/gateway` + `16` in `@kartik/billing` + `8` in `@kartik/agent`, `0` failures)

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None.

## Safe resume instruction
Wait for owner review of **Micro-step `5.2.a`**. On `"continue"` / `"go"`, proceed to **Phase 5 — Agent Service (`backend/services/agent`), Micro-step `5.3.a`** (File upload magic-byte validation, server-generated storage keys, PDF chunking/embedding ingestion, and `AgentRepository` for files, artifacts, and cascade deletion).
