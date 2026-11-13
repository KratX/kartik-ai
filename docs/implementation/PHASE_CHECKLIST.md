# Kartik.ai Phase Checklist

Track every phase and every exit gate from `kartik_ai_blueprint.md` (Section 7). A checkbox is ticked only when real verification evidence exists in `docs/implementation/TEST_EVIDENCE.md`.

## Phase 0 — Repository, Toolchain & Blueprint Baseline
- [x] `0.1` Inspect environment, verify Node/pnpm engines, and record baseline
- [x] `0.2` Monorepo workspace layout (`pnpm-workspace.yaml`, 125 directories)
- [x] `0.3` Architecture Decision Records (`0000` through `0004`)
- [x] `0.4` OpenAPI 3.1 contract (`docs/api/openapi.yaml`) and error code alignment
- [x] `0.5` CI workflows and instruction sync check (`scripts/sync_instructions.py --check`)
- [x] `0.6` Phase 0 Exit Gate verified

## Phase 1 — Shared Foundation (`backend/shared`)
- [x] `1.1.a` Wire `@kartik/shared` package manifest (`package.json`) and TypeScript build config (`tsconfig.json`)
- [x] `1.1.b` Create minimal barrel export (`backend/shared/index.ts`) and smoke test (`backend/shared/tests/index.test.ts`)
- [x] `1.2.a` Config validator & secret redactor (`backend/shared/config`)
- [x] `1.3.a` Error classes, 19-code catalogue & HTTP error-envelope mapper (`backend/shared/errors`)
- [x] `1.4.a` Structured JSON logger with `traceId`/`requestId` & redaction (`backend/shared/logger`)
- [x] `1.5.a` Redis key builders & TTL contract helpers (`backend/shared/redis`)
- [x] `1.6.a` Service-to-service caller auth & Ed25519 `x-user-context` signer/verifier (`backend/shared/auth`)
- [x] `1.7.a` Cross-service DTO contracts & boundary validators (`backend/shared/contracts`, `backend/shared/validation`)
- [x] `1.8.a` PostgreSQL pool/migration runner & R2/MinIO storage adapter (`backend/shared/database`, `backend/shared/storage`)
- [x] `1.9.a` Shared middleware pipeline (`traceId`, `requestId`, rate limiter, `DEMO_READ_ONLY`) & Phase 1 Exit Gate closure

### Phase 1 Exit Gate
- [x] Missing required env var fails startup with a clear message naming the variable and never prints secret values.
- [x] Tampered, expired, or wrong-audience (`aud`) `x-user-context` signature is rejected (`T14`).
- [x] Redis key helper unit tests verify every key pattern and TTL against Section 5.2.
- [x] Logger redaction test proves `Cookie`, `Authorization`, API keys, signed URLs, and Razorpay secrets never appear in log output (`Gate G9`).

## Phase 2 — Auth Service (`backend/services/auth`)
- [x] `2.1.a` Auth config, `0001_auth_users.sql` migration & `UserRepository` (`backend/services/auth`)
- [x] `2.2.a` Firebase ID token verifier adapter (`MockFirebaseTokenVerifier` + `JwtFirebaseTokenVerifier`)
- [x] `2.3.a` Opaque Redis session store (`sess:{sessionId}`, 7d TTL) & `HttpOnly` cookie helpers (ADR 0002)
- [x] `2.4.a` Auth routes (`POST /auth/google`, `POST /auth/logout`, `GET /auth/me`, `POST /internal/sessions/introspect`) & Phase 2 Exit Gate

### Phase 2 Exit Gate
- [x] Mock Google login creates `auth.users` row, creates `sess:{sessionId}` in Redis with 7-day TTL, and returns `HttpOnly` cookie.
- [x] `GET /auth/me` returns authenticated user profile from session.
- [x] `POST /auth/logout` deletes Redis session key and clears cookie; subsequent `GET /auth/me` returns `401 UNAUTHENTICATED`.
- [x] `POST /internal/sessions/introspect` rejects requests without valid Gateway service token (`401`/`403`).

## Phase 3 — API Gateway (`backend/gateway`)
- [x] `3.1.a` Gateway config, Ed25519 signing key validation & upstream service directory (`backend/gateway`)
- [x] `3.2.a` Session introspection client, Ed25519 `x-user-context` minting, cookie stripping & CORS/CSRF protection
- [x] `3.3.a` Public route table (`/api/v1/*`), `/internal/*` `404` blocking, `Idempotency-Key` forwarding & Phase 3 Exit Gate

### Phase 3 Exit Gate
- [x] Authenticated browser request has cookie verified via Auth, receives a fresh `traceId`, preserves client `Idempotency-Key` unchanged as `x-request-id`, and forwards an `aud`-scoped Ed25519 `x-user-context` assertion with raw cookies stripped.
- [x] Any external request to `/internal/*` or `/api/v1/internal/*` returns `404 NOT_FOUND` at the Gateway edge (Invariant #14).
- [x] Upstream service outage returns `503 BILLING_UNAVAILABLE` (for Billing) or `503 PROVIDER_UNAVAILABLE` (for Auth/Chat/Agent) in the standard error envelope.

## Phase 4 — Billing Service (`backend/services/billing`)
- [x] `4.1.a` Billing config, integer paise models, `0001_billing_core.sql` migration & `SELECT ... FOR UPDATE` transactional repository
- [x] `4.2.a` Credit reservation service (`reserve`, `settle`, `release`), 30-day Redis money idempotency (`idem:{userId}:{requestId}`), and 10-way concurrent no-overdraw proof
- [x] `4.3.a` Razorpay order creation (server-side integer paise), checkout signature verification (`order_id|payment_id`), and raw-body webhook verification
- [x] `4.4.a` Billing public & internal HTTP routes (`/billing/*`, `/webhooks/razorpay`, `/internal/billing/*`) & Phase 4 Exit Gate

### Phase 4 Exit Gate
- [x] Every credit mutation runs inside a single PostgreSQL transaction locking `billing.credit_accounts` with `SELECT ... FOR UPDATE` (Invariant #17).
- [x] 10-way concurrent 30-credit reservation test against 100 initial credits proves exactly 3 succeed (90 reserved, 10 available) and 7 fail with `402 QUOTA_EXHAUSTED` (zero negative balance).
- [x] Duplicate `requestId` replays return cached results; mutated payloads with the same `requestId` fail with `409 IDEMPOTENCY_CONFLICT`.
- [x] Razorpay checkout (`order_id|payment_id` with key secret) and webhook (`rawBody` with webhook secret) verify distinct signatures and never double-credit on delayed or replayed webhooks.

## Phase 5 — Agent Service (`backend/services/agent`)
- [x] `5.1.a` Agent config (`MOCK_AI=true` default), `0001_agent_core.sql` migration, provider interfaces & `userId`-filtered `InMemoryVectorStore`
- [x] `5.2.a` Router & specialist graph execution (`chat`, `search`, `coding`, `rag`, `vision`, `image`) + daily Redis budget counters with graceful mock fallback
- [x] `5.3.a` File upload validation (magic bytes, server keys), PDF chunking/embedding, `userId`+`fileId` RAG retrieval, and coding artifact manifest validation
- [x] `5.4.a` Agent HTTP routes (`/files`, `/artifacts`, `/internal/agent/execute`, `/internal/agent/purge`) & Phase 5 Exit Gate

### Phase 5 Exit Gate
- [x] `MOCK_AI=true` and `IMAGE_PROVIDER=mock` are the defaults; live calls are gated by daily Redis budget counters (`quota:{userId}:{day}`) that degrade gracefully to mock mode on exhaustion (§12, Invariant #19).
- [x] Vector retrieval in RAG is strictly filtered by authenticated `userId` and `fileIds` before similarity scoring so another user's chunks are never returned (Invariant #9).
- [x] Untrusted coding model JSON output is validated via `validateArtifactManifest`, rejecting path traversal (`..`), absolute paths, null bytes, or disallowed extensions with `502 ARTIFACT_INVALID` (Invariant #12).
- [x] Uploaded files validate magic-byte signatures, use server-generated storage keys, return `404 NOT_FOUND` on foreign lookups, and cascade deletion in strict `vectors -> objects -> metadata` order (Invariants #10, #18, #20).

## Phase 6 — Chat Service (`backend/services/chat`)
- [x] `6.1.a` Chat config, `0001_chat_core.sql` migration (`conversations`, `messages`, `agent_runs`) & `ChatRepository` with keyset cursor pagination
- [x] `6.2.a` Chat Run Orchestrator (`Reserve -> Execute -> Settle/Release`), 24h chat idempotency (`idem:{userId}:{requestId}`), `execution_unknown` recovery & conversation deletion coordinator (`lock:cleanup:{conversationId}`)
- [x] `6.3.a` Chat HTTP routes (`/conversations`, `/conversations/:id/messages`, `DELETE /conversations/:id`) & Phase 6 Exit Gate

### Phase 6 Exit Gate
- [x] Sending a message reserves credits in Billing, executes the specialist turn in Agent, persists user + assistant messages in `chat.messages`, settles actual credits in Billing, and caches the turn under `idem:{userId}:{requestId}` (24h TTL).
- [x] Replaying the same `Idempotency-Key` returns the cached turn (`200 OK`) without re-charging; reusing the same `Idempotency-Key` with a mutated payload fails with `409 IDEMPOTENCY_CONFLICT`.
- [x] Confirmed Agent failure releases the credit reservation immediately; ambiguous timeout (`EXECUTION_UNKNOWN`) transitions the run to `execution_unknown` and reconciles under `lock:settle:{reservationId}`.
- [x] `DELETE /conversations/:id` acquires `lock:cleanup:{conversationId}`, purges `vectors -> objects -> metadata` via Agent, and marks the conversation `purged` only upon Agent confirmation; subsequent lookups or foreign user lookups return `404 NOT_FOUND`.

## Phase 7 — Frontend Application (`frontend`)
- [x] `7.1.a` Frontend workspace setup, `KartikGatewayClient` (`/api/v1/*`, client-owned `Idempotency-Key`, 19-code error recovery policy) & `WorkspaceStore`
- [x] `7.2.a` Sandboxed Code Artifact Preview Engine (`iframe sandbox="allow-scripts"`, CSP & path guards) & Grounded Citation / RAG Source Renderer
- [x] `7.3.a` Full Kartik.ai Workspace Shell (Auth, Conversation Sidebar, Specialist Selector, Credit Balance & Razorpay Top-Up Flow) & Phase 7 Exit Gate

### Phase 7 Exit Gate
- [x] All browser requests talk exclusively to the API Gateway (`/api/v1/*`) with `credentials: 'include'`, and any `/internal/*` path is rejected client-side before network dispatch (Invariants #1 & #14).
- [x] Every mutating chat, billing, and upload request carries a client-generated `Idempotency-Key` that is reused across transient `503` retries and cleared only after durable completion or terminal rejection (Invariant #15).
- [x] Generated coding artifacts render exclusively inside an isolated `iframe sandbox="allow-scripts"` (never `allow-same-origin`) with CSP `connect-src 'none'`, and untrusted RAG/search citations are HTML-escaped and scheme-validated (`http:`/`https:` only) before rendering (Invariants #11 & #12).
- [x] Billing top-up orders send `planId` only (never client-computed prices or credits), and `409 EXECUTION_UNKNOWN` places the workspace shell into a non-retrying reconciliation state (§10 & §11).

## Phase 8 — End-to-End Integration, Evaluation & Hardening
- [x] `8.1.a` Specialist Evaluation Suite (`SPECIALIST_EVALUATION_DATASET` across all 6 specialists, prompt-injection data sanitizer & multi-tenant safety benchmark)
- [x] `8.2.a` Full Cross-Service E2E Pipeline (`Frontend -> Gateway -> Auth -> Chat -> Billing -> Agent`), Free-Tier / Docker Compose Readiness Validator & Phase 8 Final Exit Gate

### Phase 8 Final Exit Gate
- [x] Cross-service E2E flow (`POST /api/v1/auth/google` -> `POST /api/v1/conversations` -> `POST /api/v1/conversations/:id/messages` with idempotent replay -> `GET /api/v1/billing/balance` -> `DELETE /api/v1/conversations/:id` cascade purge) passes end-to-end.
- [x] Specialist Evaluation Suite (`SPECIALIST_EVALUATION_DATASET`) passes 100% (`8/8` cases across `chat`, `search`, `coding`, `rag`, `vision`, `image`) on routing, structure, grounding, and artifact safety (§10).
- [x] Free-tier portfolio readiness validator (`verifyPortfolioFreeTierReadiness`) enforces `MOCK_AI=true`, `IMAGE_PROVIDER=mock`, `BILLING_MODE=mock` defaults, blocks `rzp_live_*` keys, and requires bounded daily live call budgets (§11 & §12).
- [x] All 20 Architecture Invariants (`ARCHITECTURE_INVARIANTS_REGISTRY`) are verified across `32` test suites (`121/121` passing tests, `0` failures).

## Phase 9 — Multi-Agent Platform Completion (Blueprint v4.3 Phases 6–18 & Tutorial Alignment)
- [x] `9.1.a` Canonical 7-Agent Contract (`chat`, `search`, `coding`, `pdf`, `ppt`, `image`, `vision`), Pricing Table, and Standards-Compliant Binary `%PDF-1.4` & OpenXML `.pptx` Generators
- [x] `9.2.a` Live Server-Side `@google/genai` Providers (`LiveGemini*Provider`), 2-Stage Coding Intent Classifier, Real Binary PDF RAG Loader & Per-Agent Sliding-Window Rate Limiter
- [x] `9.3.a` Full-Stack Express + Vite Server (`server.ts` on Port 3000) Mounting `/api/v1/*`, Binary File Upload (`/files/upload`) & Raw Artifact Streaming (`/artifacts/:id/raw`)
- [x] `9.4.a` Phase 15 Frontend Part 1 — Multi-Agent `Sidebar.tsx`, `Nav.tsx`, `ChatArea.tsx`, `MessageBubble.tsx`, `MarkdownRenderer.tsx`, 16:9 `SlideDeckPreview.tsx` & Image Lightbox Modal
- [x] `9.5.a` Phase 15 Frontend Part 2 — `ChatInput.tsx` (7 Agent Pills, Paperclip Upload, Web Speech Mic), `ArtifactPanel.tsx` Live Sandbox, `BillingDrawer.tsx` (Starter `₹199` / Pro `₹499` + Razorpay Checkout), `AuthModal.tsx` & 3-Pane `src/App.tsx`
- [x] `9.6.a` Phase 16 & 18 Infrastructure — Root-Context Multi-Stage `pnpm` `Dockerfile`s (`gateway`, `auth`, `chat`, `agent`, `billing`, `frontend`) & `infra/aws/{ec2-compose,ecs-advanced,iam}` Contracts

### Phase 9 Final Exit Gate
- [x] All 7 user-facing specialist capabilities (`chat`, `search`, `coding`, `pdf`, `ppt`, `image`, `vision`) + automatic `.pdf` RAG vector indexing execute end-to-end over `/api/v1/*`.
- [x] Real `%PDF-1.4` binary reports and OpenXML `PK\x03\x04` `.pptx` slide decks (plus inline 16:9 interactive slide deck preview) download cleanly with verified ownership (`404` on foreign IDs).
- [x] Multi-file coding bundles (`index.html`, `styles.css`, `app.js`) render inside `<iframe sandbox="allow-scripts">` with `</script>` breakout escaping.
- [x] All 6 multi-stage root-context `pnpm@12.18.0` `Dockerfile`s and Profile P / Profile S AWS deployment templates pass automated contract verification (`42` suites, `147` tests passing, `0` failures).
