# Request flows & service orchestration

Authoritative cross-service request flows for **Kartik.ai** (Blueprint v4.4 §2, §5.4, §9).

## 1. End-to-End Chat Turn (`POST /api/v1/conversations/:id/messages`)

1. **Browser $\rightarrow$ API Gateway**: Client sends `POST /api/v1/conversations/:id/messages` with an opaque `HttpOnly` session cookie (`kartik_session`) and a sticky client-generated `Idempotency-Key` header.
2. **Gateway Authentication & Signing**:
   - Gateway introspects `kartik_session` via Auth (`POST /internal/sessions/introspect` or Redis session cache).
   - Gateway generates a fresh per-attempt `traceId` (`x-trace-id`), preserves the client's `Idempotency-Key` unchanged as `x-request-id` (Invariant #15), and signs a short-lived Ed25519 user context assertion (`x-user-context`, `aud: 'chat'`).
3. **Chat Turn Idempotency & Persistence**:
   - Chat verifies the Ed25519 `x-user-context` signature and checks `chat.agent_runs` for `(userId, requestId)`. If a completed turn exists within the 24h replay window, Chat returns the cached response immediately without re-charging or re-running Agent.
   - Otherwise, Chat persists the user message and creates an `AgentRun` in `running` state.
4. **Credit Reservation (`Chat` $\rightarrow$ `Billing`)**:
   - Chat calls Billing (`POST /internal/credits/reserve`) with `{ userId, requestId, operation }`.
   - Billing computes the reservation cost server-side, locks `billing.credit_accounts` with `SELECT … FOR UPDATE`, moves credits from `available_credits` to `reserved_credits`, and writes a reservation record.
5. **Specialist Execution (`Chat` $\rightarrow$ `Agent`)**:
   - Chat calls Agent (`POST /internal/agent/execute`) with bounded conversation history.
   - Agent runs the LangGraph supervisor router (`chat`, `web_search`, `rag_file`, `coding`, `image_generation`, or `vision`), enforces daily live budget caps (`DailyLiveBudgetGuard`), validates output schemas, persists `agent.executions` + any artifacts, and returns the structured response and measured token usage.
6. **Credit Settlement (`Chat` $\rightarrow$ `Billing`)**:
   - Chat persists the assistant message, then calls Billing (`POST /internal/credits/settle`) to finalize the charge (or `/internal/credits/release` if Agent failed).

## 2. Ordered Deletion Cascade (`DELETE /api/v1/conversations/:id`)

1. **Immediate Soft-Delete**: Chat marks the conversation `deletionState = 'deleting'` so it vanishes from user queries immediately.
2. **Strict Cascade Order (`vectors` $\rightarrow$ `objects` $\rightarrow$ `metadata`, Invariant #18)**:
   - Chat invokes Agent cleanup (`POST /internal/cleanup/conversations/:id`).
   - Agent deletes vectors in Qdrant first, then deletes private objects in MinIO/S3, then marks artifact/file metadata purged.
3. **Final Purge Confirmation**: Once Agent confirms all three stages succeeded, Chat marks the conversation `purged`. Any subsequent access returns `404 NOT_FOUND`.

## 3. Private File Ingestion (`POST /api/v1/files/upload-intent`)

1. **Upload Intent**: Agent validates declared extension, MIME type, and byte ceiling, generates a server-side storage key (never raw user filenames), and returns a short-lived signed upload URL.
2. **Magic-Byte Verification & Indexing**: On completion, Agent inspects magic bytes (`%PDF-`, PNG, JPEG, WEBP, UTF-8), chunks and embeds text in `MOCK_AI=true` deterministic mode (or budgeted live mode), and upserts vectors into Qdrant tagged with `{ userId, fileId }`.
