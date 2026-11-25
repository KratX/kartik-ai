# Architecture Overview

**Live Production URL:** [https://kartik-ai-app.onrender.com/](https://kartik-ai-app.onrender.com/)

Kartik.ai is structured as a modular TypeScript monorepo with clean domain boundaries (`@kartik/shared`, `@kartik/auth`, `@kartik/gateway`, `@kartik/chat`, `@kartik/agent`, `@kartik/billing`, `@kartik/frontend`) plus a unified production runtime (`server.ts`) that serves both the prebuilt React 19 SPA and the `/api/v1/*` API surface in a single Render Docker container.

## Logical Services & Workspace Ownership

| Service / Workspace | Port (Multi-Service Mode) | Owns | Must Not |
|---|---|---|---|
| **Gateway (`@kartik/gateway`)** | `8000` | Routing, CORS, trace IDs, `Idempotency-Key` preservation, rate limiting, `/internal/*` blocking | Contain domain business logic |
| **Auth (`@kartik/auth`)** | `8001` | Firebase Google ID token verification (`kartik-ai-app`), `HttpOnly` sessions, signed user context | Touch credits or payments |
| **Chat (`@kartik/chat`)** | `8002` | Conversations, messages, streaming turns, deletion coordination, billing reservation orchestration | Write Agent artifacts or mutate credit balances directly |
| **Agent (`@kartik/agent`)** | `8003` | Unified Smart Router + 7 specialists (Code, PDF, Slides, Search, RAG, Vision, Image), native `.pdf`/`.pptx` builders, Qdrant RAG, Cloudflare FLUX.1 | Reserve or settle credits; call Chat |
| **Billing (`@kartik/billing`)** | `8004` | Server-side plan catalog, credit accounts, two-phase `Reserve -> Settle/Release` ledger, Razorpay order & raw-body webhook HMAC verification | Trust caller-supplied prices or balances |
| **Frontend (`@kartik/frontend`)** | `5173` (dev) | Obsidian 3-pane workspace, lazy-loaded Code/PDF/Slides/Image studios, opaque-origin sandbox preview, Command Palette (`⌘K`), Billing drawer | Bypass `/api/v1/*` or embed secrets |

## Production Single-Container Runtime (`server.ts` on Render)

In production (`NODE_ENV=production` or hosted on Render), `server.ts` runs on port `3000` inside the multi-stage Node 22 `Dockerfile`:

```text
Browser / Googlebot
   │
   ▼
Express Server (server.ts, port 3000)
   ├── Static & SEO Layer (src/server/seo.ts)
   │     ├── /dist/* (prebuilt Vite React 19 SPA + hashed immutable /assets)
   │     ├── /robots.txt, /sitemap.xml, /site.webmanifest
   │     ├── /favicon.ico, /favicon.svg, /icon-192.png, /icon-512.png, /og-image.jpg
   │     └── Dynamic canonical URL + Google Search Console meta injection & true 404 for missing static assets
   │
   └── API Surface (/api/v1/*, X-Robots-Tag: noindex, nofollow)
         ├── Auth Middleware (src/middleware/auth.ts + src/lib/firebase-admin.ts)
         │     └── Firebase Admin SDK cert verification + HttpOnly session / isolated guest cookies
         ├── Platform Runtime (src/server/platform-api-runtime.ts)
         │     ├── Gemini (gemini-3.1-flash-lite, Search Grounding, gemini-embedding-2)
         │     ├── Cloudflare Workers AI (@cf/black-forest-labs/flux-1-schnell)
         │     ├── Qdrant Cloud (private per-user & per-conversation PDF RAG vectors)
         │     ├── Upstash Redis (TLS cache & resilient budget guard)
         │     └── Razorpay Test Mode (orders, HMAC-SHA256 verification, raw-body webhooks)
         └── Persistence & Object Storage (src/db/platform-repository.ts)
               └── Neon PostgreSQL (Drizzle ORM: users, conversations, messages, artifacts, ledger, private_objects)
```

## Request Flow (One Idempotent Chat Turn)

```text
Browser (sticky client Idempotency-Key + session cookie or Firebase Bearer token)
  → Express / Gateway (verify identity, assign traceId, check payload SHA-256 fingerprint)
  → Billing Reserve (hold specialist credit cost before provider call)
  → Agent Specialist Execution (Gemini / Search Grounding / Qdrant RAG / FLUX.1 / PDF / PPTX)
  → Persistence (save message, artifacts, and private binaries to Neon PostgreSQL)
  → Billing Settle (commit exact credits) OR Release (automatic refund on provider error)
  → Browser (typed SSE stream + rendered artifact studio)
```

## Non-Negotiable Invariants

1. **Zero caller-supplied trust:** UID, email, prices, and balances are never trusted from the client body.
2. **Strict tenant isolation:** Every conversation, uploaded file, Qdrant chunk, private Neon object, and billing record filters by authenticated owner UID (`404` on foreign access).
3. **Idempotent runs:** Retrying the same `Idempotency-Key` replays the original result instead of duplicating messages or double-charging; mismatched payloads return `409 Conflict`.
4. **Private signed binaries:** Uploaded images/PDFs and generated artifacts are stored privately in Neon `private_objects` and served only via ownership-checked or HMAC-signed endpoints.
5. **Opaque-origin code sandbox:** Generated apps render strictly inside `iframe sandbox="allow-scripts"` (never `allow-same-origin`) and never execute on the backend host.
6. **Crawl & production hygiene:** `/__downloads/*` is disabled on Render, `/api/*` emits `X-Robots-Tag: noindex, nofollow`, and missing static asset paths return `404` instead of Soft-404 HTML.

## Related Docs

- OpenAPI 3.1 contract: [`docs/api/openapi.yaml`](../api/openapi.yaml)
- Deployment runbook: [`docs/runbooks/deployment.md`](../runbooks/deployment.md)
- Cost & quota model: [`docs/COST.md`](../COST.md)
- Architecture Decision Records: [`docs/decisions/`](../decisions/)
