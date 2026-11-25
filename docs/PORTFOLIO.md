# Engineering Decisions Worth Explaining

A concise technical index for reviewers and recruiters evaluating **Kartik.ai**.

- **Live Production App:** [https://kartik-ai-app.onrender.com/](https://kartik-ai-app.onrender.com/)
- **Source Repository:** [https://github.com/KratX/kartik-ai](https://github.com/KratX/kartik-ai)

## What This Project Is

**Kartik.ai** is a full-stack, multi-agent AI workspace built in strict TypeScript across React 19 and Node.js 22. It combines Firebase Google Sign-In, isolated guest/authenticated workspaces, a unified Chat Smart Hub dispatching across **8 specialist capabilities** (Chat, Code Studio, PDF Builder, Slides Studio, Cited Web Search, Private PDF RAG, Multimodal Vision, and FLUX.1 Image Studio), opaque-origin sandboxed code artifacts (`iframe sandbox="allow-scripts"`), native binary `%PDF-1.4` and 16:9 `.pptx` generation, private Neon PostgreSQL object storage, Qdrant Cloud vector RAG, and an integer-paise credit ledger with two-phase idempotent reservations.

## Key Engineering Decisions

1. **Modular Service Boundaries + Single-Container Production Runtime.** Core domains (`gateway`, `auth`, `chat`, `agent`, `billing`, `shared`, `frontend`) are isolated workspaces with strict ownership boundaries and 267 automated tests, while `server.ts` composes the full platform into one Render-friendly Node 22 Docker container (`Dockerfile` + `render.yaml`) to keep recurring infrastructure cost at **₹0**. See [ADR 0001](decisions/0001-monorepo.md) and [architecture/overview.md](architecture/overview.md).
2. **Two-Phase Credit Reservations (`Reserve -> Execute -> Settle/Release`).** Upstream LLM and image calls can fail or time out mid-flight, so credits are reserved before execution, settled only after durable persistence, and automatically refunded on confirmed provider failure (including HTTP 429 quota exhaustion).
3. **Separate `Idempotency-Key` (`requestId`) and `traceId`.** Clients own the sticky `Idempotency-Key` with SHA-256 payload fingerprint conflict detection (`409`) so retries never double-charge or duplicate messages; `traceId` tracks individual HTTP attempts for observability.
4. **Neon PostgreSQL Private Object Storage (`OBJECT_STORAGE_MODE=neon`).** Instead of requiring a separate paid S3 bucket for user-uploaded PDFs, images, and generated artifacts, binaries persist durably inside Neon PostgreSQL (`private_objects`) and stream through ownership-verified, HMAC-signed URLs with strict `404` cross-tenant isolation.
5. **Verified Identity & Zero Cross-Tenant Leakage.** The server never trusts caller-supplied UIDs or unverified JWT payloads. Authenticated requests require a Firebase Admin SDK (`cert`) verified ID token or a server-issued `HttpOnly` session cookie; every conversation, uploaded file, Qdrant vector chunk, and billing record filters strictly by owner UID.
6. **Sandboxed Client Execution & Real Binary Generators.** Generated HTML/CSS/JS/React apps execute strictly inside an opaque-origin `iframe sandbox="allow-scripts"` (never `allow-same-origin`) with `</script>` breakout escaping. PDFs (`%PDF-1.4`) and 16:9 PowerPoint (`.pptx`) decks are compiled into genuine downloadable binaries with live interactive previews.
7. **Production SEO & Crawl Hygiene Built Into the Runtime.** Dynamic `/robots.txt`, `/sitemap.xml`, `/site.webmanifest`, multi-size PNG/ICO/SVG favicons, a bespoke `1280×640` Swiss-editorial OpenGraph banner, policy-compliant Schema.org JSON-LD (`WebApplication`, `WebSite`, `Organization`), `X-Robots-Tag: noindex` on `/api/*`, and true `404` responses on missing static assets (preventing Soft-404s).

## Where to Look First

- [`docs/architecture/overview.md`](architecture/overview.md) — Service map, request flow, and non-negotiables
- [`docs/COST.md`](COST.md) — ₹0 free-tier infrastructure inventory and quota guardrails
- [`docs/runbooks/deployment.md`](runbooks/deployment.md) — Live Render Docker & self-hosted VM deployment guide
- [`docs/implementation/BUILD_STATE.md`](implementation/BUILD_STATE.md) — Current production status and completed fixes
- [`docs/implementation/TEST_EVIDENCE.md`](implementation/TEST_EVIDENCE.md) — Real automated and live verification evidence (267 passing tests)

## Honest Limitations

- **Render Free Tier Cold Starts:** The hosted instance sleeps after 15 minutes of inactivity (~20–45s first wake-up unless kept warm by an external health ping on `/healthz`).
- **Single-Instance Runtime:** Production currently runs as a single Node 22 container (`server.ts`) rather than horizontally autoscaled ECS Fargate services; in-memory session caches hydrate from Neon PostgreSQL on restart.
- **Billing Test Mode:** Public demo billing runs strictly in **Razorpay Test Mode** (`rzp_test_*`) and rejects `rzp_live_*` keys by design so visitors never trigger real charges.
- **Free-Tier Provider Quotas:** Neon compute hours, Upstash Redis command quotas, Qdrant Cloud idle suspension, Gemini free RPM/RPD, and Cloudflare Workers AI daily neuron limits apply; resilient fallbacks and daily budget guardrails protect availability.
