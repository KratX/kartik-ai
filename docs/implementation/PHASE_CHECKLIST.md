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
- [ ] `5.4.a` Agent HTTP routes (`/files`, `/artifacts`, `/internal/agent/execute`, `/internal/agent/purge`) & Phase 5 Exit Gate

## Phase 6 — Chat Service (`backend/services/chat`)
- [ ] Pending Phase 5 completion

## Phase 7 — Frontend Application (`frontend`)
- [ ] Pending Phase 6 completion

## Phase 8 — End-to-End Integration, Evaluation & Hardening
- [ ] Pending Phase 7 completion
