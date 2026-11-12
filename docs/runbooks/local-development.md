# Local development runbook

Authoritative local development workflow for **Kartik.ai** (Blueprint v4.4 §4.6, §4.7, §8.5).

## Prerequisites

- **Node 26** (see `.nvmrc`; Active LTS since 28 October 2026). Node 24 is admitted by `engines` as an advisory fallback.
- **pnpm 12.18.0** pinned in `package.json#packageManager`. Run `pnpm -v` to confirm.
- **Docker Engine 29+** and **Docker Compose v5+** (required only when running external containers; all 35 automated test suites and `scripts/start-local-stack.mjs` run zero-cost in-memory without Docker).
- **Git 2.39+**.

Run `pnpm toolchain` first — it verifies your local toolchain against Blueprint §4.7 and prints a status table.

## Option A — Instant In-Memory Local Stack (Zero External Dependencies)

You can build, verify all 35 test suites, and run the complete 5-service HTTP stack on `:8000` with zero Docker containers or API keys:

```bash
pnpm install --frozen-lockfile
pnpm test
node scripts/start-local-stack.mjs
```

Once started, test the live endpoints:

```bash
curl -s http://127.0.0.1:8000/healthz
curl -s -H "Cookie: kartik_session=sess_demo_local_001" http://127.0.0.1:8000/api/v1/conversations
curl -s -H "Cookie: kartik_session=sess_demo_local_001" http://127.0.0.1:8000/api/v1/billing/balance
```

## Option B — Full Docker Compose Dependency Stack

1. Copy `.env.example` → `.env` and review the local defaults (`MOCK_AI=true`, `IMAGE_PROVIDER=mock`, `BILLING_MODE=mock`).
2. Start PostgreSQL 17, Redis 7.4, `pgsty/silo` (MinIO-compatible S3), and Qdrant v1.20:
   ```bash
   sh infra/scripts/local-up.sh
   ```
3. Inspect running containers and schemas:
   - `docker compose -f infra/compose/docker-compose.yml ps`
   - `node scripts/check-env.mjs`
   - `node scripts/migrate.mjs`
   - `node scripts/seed-dev-data.mjs`

## Reset

Removing volumes destroys local container data. Do it deliberately:

```bash
docker compose -f infra/compose/docker-compose.yml down -v
```

## Provider mode

`MOCK_AI=true`, `IMAGE_PROVIDER=mock`, and `BILLING_MODE=mock` are the defaults. Never set live credentials for routine development — live calls consume daily budget counters (`DAILY_LIVE_CALL_BUDGET`).
