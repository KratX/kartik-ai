# Cost and Quota Model

**Last Verified:** 25 November 2026 (live production deployment at [https://kartik-ai-app.onrender.com/](https://kartik-ai-app.onrender.com/)).
**Note:** Always re-verify free-tier limits in each provider console — allowances can change without notice.

## Headline

| Metric | Value |
|---|---|
| Recurring monthly infrastructure cost | **₹0 / $0** |
| Optional spend | Custom domain (~₹800/year, optional) |
| Binding constraint | **Provider quotas & free-tier sleep timers**, not monthly hosting bills |
| Billing safety | Razorpay **Test Mode only** (`rzp_test_*`); `rzp_live_*` is rejected in demo mode |

## Active Production Free-Tier Stack (`kartik-ai-app.onrender.com`)

| Layer | Active Provider | Free-Tier Posture | Main Caveat & Mitigation |
|---|---|---|---|
| **App Compute & TLS** | **Render Free Web Service** (Node 22 multi-stage Docker) | 512 MB RAM, 750 hrs/mo, automatic HTTPS | Sleeps after 15 min idle; `/healthz` ready for optional UptimeRobot keep-alive |
| **Database + Private Object Storage** | **Neon PostgreSQL Free** (`ap-southeast-1`) | 0.5 GB storage, scale-to-zero compute | Stores users, conversations, messages, ledger, **and** private file binaries (`private_objects` via `OBJECT_STORAGE_MODE=neon`) — eliminates needing S3/R2 |
| **Cache & Rate / Budget Guard** | **Upstash Redis Free** (`rediss://` TLS) | 500K commands/mo | Wrapped by `ResilientRedisClient` with circuit-breaker cooldown & automatic in-memory fallback |
| **Vector Search (PDF RAG)** | **Qdrant Cloud Free** | 1 GB cluster (`kartik_rag_chunks`) | Strict per-user & per-conversation payload filters; idle clusters wake/re-provision easily |
| **Text, Router, Search & Embeddings** | **Google Gemini** (`gemini-3.1-flash-lite`, Search Grounding, `gemini-embedding-2`) | Free tier RPM/RPD | Guarded by `DAILY_LIVE_CALL_BUDGET`, `DAILY_PROVIDER_BUDGET_*`, and clean refund-on-error |
| **Image Generation** | **Cloudflare Workers AI Free** (`@cf/black-forest-labs/flux-1-schnell`) | 10,000 Neurons/day | Generates live 16:9 PNGs; refunds reserved 10 credits automatically on provider error |
| **Authentication** | **Firebase Authentication Spark (Free)** (`kartik-ai-app`) | Generous MAU allowance | Service-account Admin SDK (`cert`) verification + isolated guest workspaces |
| **Payments** | **Razorpay Test Mode** | Free & unlimited simulated orders | Server-priced `planId`-only checkout + strict HMAC-SHA256 verification |

*(Alternative self-hosted topologies — Oracle Always Free ARM VM + Docker Compose + Nginx, and the bounded AWS ECS Fargate exercise — remain documented in [ADR 0003](decisions/0003-free-tier-deployment.md) and [`docs/architecture/aws-sprint/`](architecture/aws-sprint/README.md).)*

## Quota & Abuse Guardrails

1. **Bounded Daily Provider Budgets:** `DAILY_LIVE_CALL_BUDGET`, `DAILY_PROVIDER_BUDGET_CHAT`, `DAILY_PROVIDER_BUDGET_EMBEDDING`, and `DAILY_PROVIDER_BUDGET_SEARCH` cap runaway spend/quota consumption.
2. **Input & Upload Caps:** `MAX_INPUT_CHARS=8000`, `MAX_PROMPT_CHARS=16000`, `MAX_OUTPUT_TOKENS=8192`, `MAX_ATTACHMENTS=5`, `MAX_UPLOAD_BYTES=10485760` (10 MB), and `MAX_PDF_PAGES=25`.
3. **Kill Switch & Offline Mode:** Set `DEMO_READ_ONLY=true` to freeze mutations or `AI_PROVIDER_MODE=mock` / `MOCK_AI=true` to run zero-cost offline tests.
4. **Two-Phase Credit Accounting:** Every user starts with 250 starter credits; failed upstream calls release reserved credits cleanly rather than stranding balances.
5. **Secret Hygiene:** Live credentials live strictly in Render Environment variables (never committed to Git or baked into Docker images).

## Operational Review Cadence

- Check **Neon** compute/storage, **Upstash** command count, **Qdrant Cloud** cluster status, **Cloudflare Workers AI** daily neurons, and **Gemini** quota weekly.
- Monitor **Google Search Console** (`https://kartik-ai-app.onrender.com/`) for sitemap crawl status and zero Soft-404s.
