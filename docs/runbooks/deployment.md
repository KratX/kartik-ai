# Deployment Runbook

Kartik.ai supports two deployment paths:
1. **Primary Production Path (Live):** Render Free Web Service via multi-stage Node 22 `Dockerfile` (`https://kartik-ai-app.onrender.com/`).
2. **Self-Hosted Multi-Service Path (Profile P):** Single ARM64 VM running 5 separate backend containers + Nginx via Docker Compose.

---

## Pre-Deployment Verification Gate

Run these checks locally before pushing to `main`:

```bash
npm run check:env
npm test
npx tsx --test src/server/platform-multi-user-isolation.test.ts
npx tsx --test src/server/seo.test.ts
npm run lint
```

---

## Path A — Live Production Deployment on Render (Docker)

### 1. Service Configuration
- **Repository:** `https://github.com/KratX/kartik-ai` (branch `main`, auto-deploy enabled)
- **Runtime:** Docker (`Dockerfile` in repo root; blueprint also defined in `render.yaml`)
- **Health Check Path:** `/healthz`
- **Container Port:** `3000` (`Dockerfile` installs with `--include=dev --legacy-peer-deps`, builds Vite + workspaces, and starts `npx tsx server.ts`)

### 2. Required Render Environment Variables
Enter all secrets strictly in **Render Dashboard → Environment** (never commit `.env` or wrap values in outer quotes):

- **Core Runtime & SEO:** `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `ALLOW_ROOT_DEMO_RUNTIME=true`, `PUBLIC_APP_URL=https://kartik-ai-app.onrender.com`, `CORS_ALLOWED_ORIGINS=https://kartik-ai-app.onrender.com`, `GOOGLE_SITE_VERIFICATION=<token>`
- **Cookies & Signing:** `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=lax`, `OBJECT_STORAGE_MODE=neon`, `OBJECT_STORAGE_SIGNING_SECRET=<64-hex>`, `SESSION_SIGNING_SECRET=<64-hex>`
- **Datastores:** `DATABASE_URL` (and service `*_DATABASE_URL` / `DIRECT_DATABASE_URL` pointing to Neon PostgreSQL), `REDIS_URL` (Upstash `rediss://`), `QDRANT_URL`, `QDRANT_API_KEY`, `QDRANT_COLLECTION=kartik_rag_chunks`
- **AI Providers:** `AI_PROVIDER_MODE=live`, `MOCK_AI=false`, `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.1-flash-lite`, `EMBEDDING_MODEL_ID=gemini-embedding-2`, `IMAGE_PROVIDER=cloudflare`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_IMAGE_MODEL=@cf/black-forest-labs/flux-1-schnell`
- **Firebase Auth (`kartik-ai-app`):** `AUTH_PROVIDER_MODE=firebase`, `FIREBASE_PROJECT_ID=kartik-ai-app`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (single-line `\n`-escaped PEM), and matching `VITE_FIREBASE_*` keys
- **Billing (Test Mode):** `BILLING_MODE=razorpay_test`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`

### 3. Firebase & Google Search Console Setup
1. **Firebase Console (`kartik-ai-app`) → Authentication → Sign-in method:** Enable **Google** and set Public-facing name to `Kartik.ai`.
2. **Firebase Console → Authentication → Settings → Authorized domains:** Add `kartik-ai-app.onrender.com` (keep `localhost` for local dev).
3. **Google Search Console:** Add URL-prefix property `https://kartik-ai-app.onrender.com/`, verify using the HTML tag (`GOOGLE_SITE_VERIFICATION` env var), and submit `sitemap.xml`.

### 4. Post-Deploy Smoke Checks

```bash
curl -sS https://kartik-ai-app.onrender.com/healthz
curl -sS https://kartik-ai-app.onrender.com/api/v1/auth/firebase-config
curl -sSI https://kartik-ai-app.onrender.com/robots.txt
curl -sSI https://kartik-ai-app.onrender.com/sitemap.xml
curl -sSI https://kartik-ai-app.onrender.com/favicon.ico
curl -sSI https://kartik-ai-app.onrender.com/nonexistent-check.png   # must return 404
curl -sSI https://kartik-ai-app.onrender.com/__downloads/file?path=server.ts  # must return 404
```

### 5. Known Render Operational Traps (Already Hardened)
- **Peer dependency conflict (`esbuild` vs `vite`):** Solved via `Dockerfile` `--legacy-peer-deps` and aligned `esbuild@^0.28.0`.
- **Vite host block (`Blocked request`):** Solved by forcing `server.ts` to serve prebuilt `dist/` whenever `RENDER` or `RENDER_EXTERNAL_URL` is set, plus `server.allowedHosts: true` in `vite.config.ts`.
- **Firebase `"Invalid or expired Firebase ID token"`:** Always keep `FIREBASE_PROJECT_ID` (backend Admin SDK) and `VITE_FIREBASE_PROJECT_ID` (frontend Web SDK) identical (`kartik-ai-app`).
- **Quoted `DATABASE_URL`:** Do not leave literal `"` quotes inside Render's Environment Value boxes.
- **Free-tier cold starts:** Render sleeps after 15 minutes of inactivity; an optional free uptime ping to `/healthz` every 14 minutes keeps responses warm.

---

## Path B — Self-Hosted Profile P (ARM64 VM + Docker Compose + Nginx)

For deploying all 5 isolated backend containers (`gateway`, `auth`, `chat`, `agent`, `billing`) behind Nginx on a single ARM64 VM:

1. Provision an Ubuntu LTS ARM64 VM (2 OCPU / 12 GB RAM) with only ports `22` (admin IP), `80`, and `443` open.
2. Install Docker Engine + Docker Compose and clone the repository.
3. Configure `.env` (`chmod 600`), run `node scripts/check-env.mjs` and `node scripts/migrate.mjs`.
4. Start the stack using `infra/aws/ec2-compose/docker-compose.prod.yml` and mount `infra/nginx/default.conf` so `/` serves the SPA and `/api/*`, `/healthz`, `/readyz` proxy exclusively to `gateway:8000`.
5. Configure nightly `pg_dump --format=custom` backups and rehearse rollback via [`docs/runbooks/rollback.md`](rollback.md).
