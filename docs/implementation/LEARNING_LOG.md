# Kartik.ai Learning Log

---

## Entry 25 — Phase 7 / Step 7.1 (Micro-step 7.1.a): Frontend Gateway API Client, Client-Owned `Idempotency-Key` & Workspace Store

### 1. Concept learned
- **Single Entry Point & Cookie Security (`Blueprint §9 Invariants #1, #14 & ADR 0002`):**
  - The browser never talks directly to Auth (`4001`), Chat (`4002`), Agent (`4003`), or Billing (`4004`), and is strictly forbidden from calling `/internal/*`.
  - Every request passes through `KartikGatewayClient` to `/api/v1/*` with `credentials: 'include'` so the browser attaches the `HttpOnly` session cookie automatically while client-side JavaScript never sees or stores raw session tokens.
- **Client-Owned `Idempotency-Key` & Recovery Policies (`Blueprint §5.4, §5.5 & Invariant #15`):**
  - The server never generates or rewrites `requestId`; the browser client mints `Idempotency-Key` (`req_<uuid>`) before sending any mutating request.
  - When a turn fails with `503 BILLING_UNAVAILABLE` (`recoveryAction: 'retry_same_key'`), `WorkspaceStore` retains `pendingTurnKey` so retrying the turn sends the **exact same `Idempotency-Key`**. When a turn fails with `502 ARTIFACT_INVALID` or `504 PROVIDER_TIMEOUT` (`recoveryAction: 'retry_new_key'`), the previous reservation was already released on the server, so `pendingTurnKey` is cleared and the next attempt mints a fresh key.

### 2. What was implemented
- `frontend/package.json` & `frontend/tsconfig.json`
- `frontend/src/types/index.ts` (Frontend domain & envelope contracts)
- `frontend/src/lib/api-client.ts` (`KartikGatewayClient`, `ERROR_RECOVERY_POLICY`, `generateClientIdempotencyKey`)
- `frontend/src/store/index.ts` (`WorkspaceStore`)
- `frontend/tests/frontend-api-client.test.ts` (4 unit tests)

### 3. How to inspect the feature
- Run `pnpm test` and inspect `@kartik/frontend Gateway API Client, Idempotency-Key & WorkspaceStore (7.1.a)` (`28` suites, `105` tests passing).

---

## Entry 24 — Phase 6 / Step 6.3 (Micro-step 6.3.a): Chat HTTP Routes, Ed25519 `aud="chat"` Verification & Phase 6 Exit Gate Closure

### 1. Concept learned
- **Audience-Scoped Ed25519 Assertions Across Services (`Blueprint §6.4`):**
  - Even inside the private backend network, an `x-user-context` assertion minted by the Gateway for `/api/v1/files` (`aud: 'agent'`) or `/api/v1/billing/balance` (`aud: 'billing'`) is rejected with `401 UNAUTHENTICATED` if replayed against `/api/v1/conversations` on the Chat Service (`requireChatUserContext` enforces `expectedAudience: 'chat'`).
- **Idempotent Turn Status Codes (`201 Created` vs `200 OK` Replay):**
  - When `POST /conversations/:id/messages` executes a fresh turn, it returns `201 Created`. When a network retry arrives within 24 hours with the same `Idempotency-Key` (`requestId`) and matching payload fingerprint, `ChatOrchestratorService` returns the cached turn (`idempotentReplay: true`) and the router responds with `200 OK` without re-invoking Billing or Agent.

### 2. What was implemented
- `backend/services/chat/src/middleware/index.ts` (`requireChatUserContext`, `enforceChatDemoReadOnly`)
- `backend/services/chat/src/controllers/index.ts` (`ChatController`)
- `backend/services/chat/src/routes/index.ts` (`createChatRouter`)
- `backend/services/chat/tests/chat-routes.test.ts` (4 unit & integration tests closing the Phase 6 Exit Gate)
