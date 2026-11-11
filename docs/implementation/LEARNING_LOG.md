# Kartik.ai Learning Log

---

## Entry 24 — Phase 6 / Step 6.3 (Micro-step 6.3.a): Chat HTTP Routes, Ed25519 `aud="chat"` Verification & Phase 6 Exit Gate Closure

### 1. Concept learned
- **Audience-Scoped Ed25519 Assertions Across Services (`Blueprint §6.4`):**
  - Even inside the private backend network, an `x-user-context` assertion minted by the Gateway for `/api/v1/files` (`aud: 'agent'`) or `/api/v1/billing/balance` (`aud: 'billing'`) is rejected with `401 UNAUTHENTICATED` if replayed against `/api/v1/conversations` on the Chat Service (`requireChatUserContext` enforces `expectedAudience: 'chat'`).
- **Idempotent Turn Status Codes (`201 Created` vs `200 OK` Replay):**
  - When `POST /conversations/:id/messages` executes a fresh turn, it returns `201 Created`. When a network retry arrives within 24 hours with the same `Idempotency-Key` (`requestId`) and matching payload fingerprint, `ChatOrchestratorService` returns the cached turn (`idempotentReplay: true`) and the router responds with `200 OK` without re-invoking Billing or Agent.
- **Read-Only Kill Switch (`DEMO_READ_ONLY`, `Blueprint §12`):**
  - When `DEMO_READ_ONLY=true`, `GET /conversations` and `GET /conversations/:id/messages` continue serving seeded conversations normally (`200 OK`), while mutating routes (`POST`, `DELETE`) return `403 DEMO_READ_ONLY`.

### 2. What was implemented
- `backend/services/chat/src/middleware/index.ts` (`requireChatUserContext`, `enforceChatDemoReadOnly`)
- `backend/services/chat/src/controllers/index.ts` (`ChatController`)
- `backend/services/chat/src/routes/index.ts` (`createChatRouter`)
- `backend/services/chat/tests/chat-routes.test.ts` (4 unit & integration tests closing the Phase 6 Exit Gate)

### 3. How to inspect the feature
- Run `pnpm test` and inspect `@kartik/chat HTTP routes & Phase 6 Exit Gate closure (6.3.a)` (`27` suites, `101` tests passing).

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
