# Local Development Runbook

Practical local setup and verification workflow for **Kartik.ai**.

## Prerequisites

- **Node.js `>=22`** (LTS) and **npm** (or `pnpm`)
- **Git 2.39+**
- **Docker** *(optional — only needed if running local PostgreSQL/Redis/Qdrant containers; all 267 automated tests and `npm run dev` run cleanly without Docker using either live cloud providers or mock mode)*

## Option A — Full-Stack App Server on `http://localhost:3000` (Recommended)

```bash
# 1. Install dependencies
npm install --include=dev --legacy-peer-deps

# 2. Create your local .env from template
cp .env.example .env

# 3. Validate environment variables
npm run check:env

# 4. Start the full-stack Express + Vite dev server on http://localhost:3000
npm run dev
```

- **Offline / zero-cost mode:** Keep `AI_PROVIDER_MODE=mock`, `MOCK_AI=true`, `IMAGE_PROVIDER=mock`, and `BILLING_MODE=mock` in `.env`.
- **Live provider mode:** Configure Neon PostgreSQL (`DATABASE_URL`, `OBJECT_STORAGE_MODE=neon`), Upstash Redis (`REDIS_URL`), Qdrant Cloud (`QDRANT_URL`, `QDRANT_API_KEY`), Gemini (`GEMINI_API_KEY`), Cloudflare Workers AI (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `IMAGE_PROVIDER=cloudflare`), Firebase (`kartik-ai-app`), and Razorpay Test Mode (`rzp_test_*`).
- **Windows PowerShell tip:** `dotenv` does not overwrite shell variables already exported in your terminal. If `.env` changes don't appear to take effect, clear stale terminal vars first (e.g., `Remove-Item Env:FIREBASE_PROJECT_ID,Env:REDIS_URL,Env:QDRANT_URL,Env:IMAGE_PROVIDER -ErrorAction SilentlyContinue`).

## Verification & Test Commands

```bash
# Core workspace unit & service suites (49 suites, 245 tests)
npm test

# Multi-user isolation, verified Firebase auth, idempotency, RAG & Razorpay integration tests (13 tests)
npx tsx --test src/server/platform-multi-user-isolation.test.ts

# SEO, canonical origin, robots.txt, sitemap, manifest & JSON-LD tests (9 tests)
npx tsx --test src/server/seo.test.ts

# Full workspace build, TypeScript typecheck & 188-file architectural lint
npm run lint
```

## Option B — 5-Service Local HTTP Stack (`:8000`)

Run the isolated microservice gateway + service adapters locally in-memory without Docker:

```bash
node scripts/start-local-stack.mjs
curl -s http://127.0.0.1:8000/healthz
```

## Option C — Local Docker Compose Dependencies

If you prefer local containerized PostgreSQL, Redis, MinIO/Silo, and Qdrant instead of cloud free tiers:

```bash
sh infra/scripts/local-up.sh
node scripts/check-env.mjs
node scripts/migrate.mjs
node scripts/seed-dev-data.mjs

# Reset volumes (destroys local container data)
docker compose -f infra/compose/docker-compose.yml down -v
```
