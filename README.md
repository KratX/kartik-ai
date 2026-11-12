# Kartik.ai

A multi-agent AI workspace: Google sign-in, persistent conversations, a LangGraph-style router that dispatches to six specialist capabilities (`chat`, `search`, `coding`, `rag`, `vision`, `image`), sandboxed code artifacts (`iframe sandbox="allow-scripts"`), document-grounded RAG citations, and an integer-paise credit ledger with idempotent `SELECT ... FOR UPDATE` reservations.

Five backend services (`gateway`, `auth`, `chat`, `agent`, `billing`), a shared foundation (`@kartik/shared`), and a typed frontend workspace (`@kartik/frontend`), built and verified in controlled micro-steps.

## Status

**All Phases Complete (Phase 0 through Phase 8 — v4.4).**
- **Test Suites:** `34` suites, `126/126` passing tests (`0` failures).
- **Architecture Invariants:** `20/20` verified across unit, integration, evaluation, and end-to-end suites.
- **Live Progress & Evidence:** [`docs/implementation/BUILD_STATE.md`](docs/implementation/BUILD_STATE.md) · [`docs/implementation/TEST_EVIDENCE.md`](docs/implementation/TEST_EVIDENCE.md) · [`docs/implementation/PHASE_CHECKLIST.md`](docs/implementation/PHASE_CHECKLIST.md).

## Stack

| Layer | Choice |
|---|---|
| Language & Toolchain | TypeScript 7 (`strict`), Node.js `>=24`, `pnpm@12.18.0` (single lockfile) |
| Frontend (`@kartik/frontend`) | Typed Gateway Client (`/api/v1/*`), WorkspaceStore, `sandbox="allow-scripts"` Preview Engine, Citation Sanitizer |
| Backend Services | `@kartik/gateway`, `@kartik/auth`, `@kartik/chat`, `@kartik/agent`, `@kartik/billing`, `@kartik/shared` |
| Data & Storage | PostgreSQL 17 (4 isolated schemas, ADR 0004), Redis 7.4, Qdrant, MinIO/Silo locally / Cloudflare R2 |
| AI & Evaluation | Deterministic Mock Mode by default (`MOCK_AI=true`), Daily Redis Budget Guard, 8-case Specialist Evaluation Suite |
| Auth & Identity | Firebase Google sign-in $\rightarrow$ opaque Redis session (`HttpOnly` cookie) $\rightarrow$ `aud`-scoped Ed25519 `x-user-context` assertions |
| Payments & Ledger | Razorpay **test mode only**, integer paise accounting, `SELECT ... FOR UPDATE` reservations, 30-day money idempotency |

## Workspaces & Services

| Workspace | Path | Port | Owns | Test Suites |
|---|---|---|---|---|
| `@kartik/shared` | `backend/shared` | — | Config validator, 19-code error catalogue, redaction logger, Redis keys, Ed25519 assertions, DB/R2 adapters, middleware | `9` suites (`29` tests) |
| `@kartik/auth` | `backend/services/auth` | `8001` | Identity, Google ID token verification, 7-day Redis sessions, `/internal/sessions/introspect` | `4` suites (`16` tests) |
| `@kartik/gateway` | `backend/gateway` | `8000` | Public `/api/v1/*` front door, `/internal/*` `404` blocking, `Idempotency-Key` preservation, E2E & `node:http` server adapter | `6` suites (`21` tests) |
| `@kartik/billing` | `backend/services/billing` | `8004` | Plans, credit accounts, `SELECT ... FOR UPDATE` reservations, ledger, Razorpay checkout & raw-body webhook HMAC verification | `4` suites (`16` tests) |
| `@kartik/agent` | `backend/services/agent` | `8003` | Router & 6 specialists, daily Redis budget guard, magic-byte file uploads, `userId`-filtered RAG, 8-case evaluation suite | `5` suites (`20` tests) |
| `@kartik/chat` | `backend/services/chat` | `8002` | Conversations, messages, `Reserve -> Execute -> Settle/Release` orchestrator, `execution_unknown` recovery, cascade purge | `3` suites (`12` tests) |
| `@kartik/frontend` | `frontend` | `5173` | Gateway client, sticky `Idempotency-Key` store, isolated code sandbox (`sandbox="allow-scripts"`), `planId`-only checkout | `3` suites (`12` tests) |

## Quickstart

```bash
# 1. Verify toolchain (Node, pnpm, Docker, Git)
pnpm toolchain

# 2. Install dependencies (frozen lockfile)
pnpm install --frozen-lockfile

# 3. Typecheck, build, and run all 34 test suites (126 tests)
pnpm typecheck
pnpm test

# 4. (Optional) Start local PostgreSQL 17, Redis 7.4, Silo/MinIO & Qdrant via Docker Compose
docker compose --env-file infra/compose/.env.compose.example -f infra/compose/docker-compose.yml up -d
cp .env.example .env
pnpm check:env
pnpm db:migrate
pnpm db:seed
```

## Cost & Free-Tier Posture

Designed to stay within available free allowances, subject to current eligibility and usage (`MOCK_AI=true`, `IMAGE_PROVIDER=mock`, `BILLING_MODE=mock` by default, bounded daily Redis live-call budgets, and `DEMO_READ_ONLY` kill switch). Full model: [`docs/COST.md`](docs/COST.md).

## Documentation

| Document | What it is |
|---|---|
| [`docs/architecture/overview.md`](docs/architecture/overview.md) | Services, ownership, request flow, non-negotiables |
| [`docs/api/openapi.yaml`](docs/api/openapi.yaml) | Public OpenAPI 3.1 contract |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records (`0000`–`0004`) |
| [`docs/implementation/`](docs/implementation/) | `BUILD_STATE.md`, `LEARNING_LOG.md`, `TEST_EVIDENCE.md`, `PHASE_CHECKLIST.md` |
| [`docs/COST.md`](docs/COST.md) | Free-tier inventory and quota policy |
| [`docs/PORTFOLIO.md`](docs/PORTFOLIO.md) | Engineering decisions worth explaining |
| [`docs/runbooks/`](docs/runbooks/) | Local development, deployment, rollback, teardown |
