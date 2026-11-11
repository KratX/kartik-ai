# Kartik.ai Learning Log

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
