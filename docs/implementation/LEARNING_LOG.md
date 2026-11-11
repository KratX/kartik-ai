# Kartik.ai Learning Log

---

## Entry 23 — Phase 6 / Step 6.2 (Micro-step 6.2.a): Chat Run Orchestrator (`Reserve -> Execute -> Settle / Release`), Ambiguous Timeout Reconciliation & Cascade Deletion

### 1. Concept learned
- **Why Chat Coordinates Billing Around Agent (Invariant #6):**
  - Agent is a stateless specialist graph executor; it never calculates, reserves, settles, or mutates credits.
  - Chat owns the user turn lifecycle (`chat.agent_runs`):
    1. **Reserve** credits via Billing before invoking Agent.
    2. **Execute** the turn on Agent (`POST /internal/agent/execute`).
    3. **Settle** the reservation after user and assistant messages are durably saved in `chat.messages`.
    4. **Release** the reservation immediately when Agent fails with a confirmed error (`ARTIFACT_INVALID`, `VALIDATION_FAILED`, etc.).
- **Ambiguous Timeout vs Confirmed Failure (`execution_unknown`, Blueprint §10 & §11):**
  - When an upstream call fails with `EXECUTION_UNKNOWN` (e.g. a network timeout after the request left the socket), the provider might have actually completed the billable generation.
  - Blindly releasing the reservation or retrying the provider call risks either giving away paid quota or double-charging the user.
  - Instead, `ChatOrchestratorService` transitions the run to `state: 'execution_unknown'`, blocks blind retries with `409 IDEMPOTENCY_CONFLICT`, and exposes `reconcileUnknownRun()` guarded by `lock:settle:{reservationId}` (5-minute TTL).
- **Cascade Deletion Coordinator (`lock:cleanup:{conversationId}`, Invariants #3 & #18):**
  - Deleting a conversation acquires `lock:cleanup:{conversationId}` (10-minute TTL), transitions the conversation `active -> requested -> purging`, instructs Agent to purge `vectors -> objects -> metadata`, and marks the conversation `purged` **only** after Agent confirms `confirmed === true` in exact `['vectors', 'objects', 'metadata']` order.

### 2. What was implemented
- `backend/services/chat/src/services/index.ts` (`ChatOrchestratorService`, `InMemoryChatIdempotencyStore`, `InMemoryChatLockStore`)
- `backend/services/chat/src/index.ts` (updated exports)
- `backend/services/chat/tests/chat-orchestrator.test.ts` (4 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect the `@kartik/chat ChatOrchestratorService reserve/execute/settle & cascade purge (6.2.a)` suite.

---

## Entry 22 — Phase 6 / Step 6.1 (Micro-step 6.1.a): Chat Config, `0001_chat_core.sql` Schema & Keyset Cursor Pagination

### 1. Concept learned
- **Keyset Cursor Pagination vs Offset Pagination & Scope-Bound Cursors (Blueprint §5.4):**
  - **Why Keyset (`(createdAt, id)`) instead of `OFFSET`:** In SQL, `OFFSET 1000 LIMIT 30` forces PostgreSQL to scan and discard 1,000 rows on every request, and if a new message is inserted while the user scrolls, rows shift and duplicate across pages. Keyset pagination (`WHERE (created_at, id) < ($1, $2)`) jumps directly to the B-Tree index position in $O(\log N)$ time with zero row drift.
  - **Scope & Owner Binding (`encodePaginationCursor` / `parsePaginationQuery`):** Every pagination cursor is HMAC-signed and embeds `{ scope, userId, createdAt, id }`. If User B tries to replay User A's cursor, or replays a `conversations:list` cursor on `messages:conv_1`, `parsePaginationQuery` rejects it with `400 VALIDATION_FAILED`.
- **Durable Run Record (`chat.agent_runs`, Invariants #3, #6, #15):**
  - Chat owns `chat.agent_runs` keyed by the client's `requestId` (`Idempotency-Key`) with states `'pending' | 'reserved' | 'executing' | 'completed' | 'execution_unknown' | 'failed' | 'released'` so interrupted turns can be reconciled without double-charging.

### 2. What was implemented
- `backend/services/chat/src/config/index.ts` (`loadChatConfig`)
- `backend/services/chat/src/models/index.ts` (`CHAT_INITIAL_MIGRATION` `0001_chat_core.sql` + domain models)
- `backend/services/chat/src/repositories/index.ts` (`InMemoryChatRepository`, `PostgresChatRepository`)
- `backend/services/chat/tests/chat-repository.test.ts` (4 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect the `@kartik/chat config, 0001_chat_core migration & ChatRepository cursor pagination (6.1.a)` suite.
