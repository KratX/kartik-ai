# Kartik.ai Test Evidence Log

Chronological record of test commands and real execution results across micro-steps.

| Date (UTC) | Phase / Step | Environment | Suite / Command | Result | Summary / Notes | Executed By |
|---|---|---|---|---|---|---|
| 2026-11-09 | Phase 0 (0.1–0.6) | Linux / Node v22.23.2 | `node scripts/check-toolchain.mjs` | **PASS** | Validated repo baseline, ADRs, OpenAPI & workflows | AI + Owner |
| 2026-11-11 | Phase 1 (1.1.a–1.9.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/shared`) | **PASS** | `9` suites, `29` tests passing (`0` failures) — Phase 1 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 2 (2.1.a–2.4.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/auth`) | **PASS** | `13` suites, `45` tests passing (`16/16` in `@kartik/auth`) — Phase 2 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 3 (3.1.a–3.3.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/gateway`) | **PASS** | `16` suites, `57` tests passing (`12/12` in `@kartik/gateway`) — Phase 3 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 4 (4.1.a–4.4.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/billing`) | **PASS** | `20` suites, `73` tests passing (`16/16` in `@kartik/billing`) — Phase 4 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 5 (5.1.a–5.4.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/agent`) | **PASS** | `24` suites, `89` tests passing (`16/16` in `@kartik/agent`) — Phase 5 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 6 (6.1.a–6.3.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/chat`) | **PASS** | `27` suites, `101` tests passing (`12/12` in `@kartik/chat`) — Phase 6 Exit Gate passed | AI + Owner |
| 2026-11-12 | Phase 7 (7.1.a–7.3.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/frontend`) | **PASS** | `30` suites, `113` tests passing (`12/12` in `@kartik/frontend`) — Phase 7 Exit Gate passed | AI + Owner |
| 2026-11-12 | Phase 8 / `8.1.a` | Linux / Node v22.23.2 | `pnpm test` (`@kartik/agent` Specialist Evaluation Suite) | **PASS** | `31` suites, `117` tests passing (`4/4` in `agent-evaluation-suite.test.ts`) | AI + Owner |
| 2026-11-12 | Phase 8 / `8.2.a` | Linux / Node v22.23.2 | `pnpm test` (Full E2E Pipeline & Phase 8 Final Exit Gate) | **PASS** | `32` suites, `121` tests passing (`4/4` in `e2e-readiness.test.ts`) | AI + Owner |
| 2026-11-12 | Phase 8 / `8.3.a` | Linux / Node v22.23.2 | `pnpm test` (Operational CLI Scripts `check-env`, `migrate`, `seed-dev-data`) | **PASS** | `33` suites, `124` tests passing (`3/3` in `operational-scripts.test.ts`) | AI + Owner |
| 2026-11-12 | Phase 8 / `8.4.a` | Linux / Node v22.23.2 | `pnpm test` (Live `node:http` Server Adapter & Graceful Shutdown + `README.md`) | **PASS** | `34` suites, `126` tests passing (`2/2` in `http-server.test.ts` over real TCP sockets) | AI + Owner |
| 2026-11-12 | Phase 8 / `8.5.a` | Linux / Node v22.23.2 | `pnpm test` (`scripts/start-local-stack.mjs` + Infra & Docs Finalization) | **PASS** | `35` suites, `127` tests passing (`1/1` in `local-stack-runner.test.ts`, zero repo placeholders remaining) | AI + Owner |
| 2026-11-12 | Phase 8 / `8.6.a` | Linux / Node v22.23.2 | `pnpm test` (`@kartik/frontend` Interactive Multi-Agent Demo Harness) | **PASS** | `36` suites, `130` tests passing (`3/3` in `interactive-demo-harness.test.ts`) | AI |
| 2026-11-12 | Phase 9 / `9.1.a` | Linux / Node v22.23.2 | `pnpm test` (Phase 10 PDF 1.4 & OpenXML `.pptx` Generators & 7-Agent Contract) | **PASS** | `37` suites, `135` tests passing (`5/5` in `pdf-ppt-generators.test.ts`) | AI |
| 2026-11-13 | Phase 9 / `9.2.a` | Linux / Node v22.23.2 | `pnpm test` (Live Gemini Providers, Real PDF Binary Loader, Coding Intent Classifier & Per-Agent Rate Limiter) | **PASS** | `38` suites, `139` tests passing (`4/4` in `live-providers-and-limits.test.ts`) | AI + Owner |
| 2026-11-13 | Phase 9 / `9.3.a` | Linux / Node v22.23.2 | `pnpm test` (Full-Stack Server, `/files/upload` & `/artifacts/:id/content` Binary Routes) | **PASS** | `39` suites, `141` tests passing (`2/2` in `artifact-content-and-upload-routes.test.ts`) | AI + Owner |
| 2026-11-13 | Phase 9 / `9.4.a` | Linux / Node v22.23.2 | `pnpm test` (Phase 15 Frontend Part 1 — SlideDeckPreview & MarkdownRenderer Tokenizers + Chat/Layout UI) | **PASS** | `40` suites, `143` tests passing (`2/2` in `slide-deck-and-markdown.test.ts`) | AI + Owner |
| 2026-11-13 | Phase 9 / `9.5.a` | Linux / Node v22.23.2 | `pnpm test` (Phase 15 Frontend Part 2 — 7 Agent Selector Pills, Multi-File Sandbox Assembler & 3-Pane Workspace UI) | **PASS** | `41` suites, `145` tests passing (`2/2` in `multi-agent-workspace-ui.test.ts`) | AI + Owner |
| 2026-11-13 | Phase 9 / `9.6.a` | Linux / Node v22.23.2 | `pnpm test` (Phase 16 & 18 Multi-Stage `pnpm` Dockerfiles & AWS Profile P/S Infrastructure Contracts) | **PASS** | `42` suites, `147` tests passing (`2/2` in `docker-and-aws-infra.test.ts`) — All Phases Complete | AI |
| 2026-11-24 | Production Step 1 & Fix `#36` | Linux / Node v22 + Live Cloud Providers | Live E2E Smoke Test (Gemini, Cloudflare FLUX.1, Qdrant RAG, Upstash Redis, Razorpay Test Mode) | **PASS** | Verified Gemini Chat, 393 KB FLUX PNG, Qdrant PDF RAG (`VELOCITY-9472`), Gemini Search (6 citations), Razorpay Test Order, and `0` browser console errors | AI + Owner |
| 2026-11-24 | Production Step 2 / Fix `#37` | Linux / Neon PostgreSQL (`neondb`) | Live Neon Private Object Storage Verification (`OBJECT_STORAGE_MODE=neon`) | **PASS** | Verified `private_objects` binary persistence, cold-start hydration, HMAC-signed downloads, and cross-tenant `404` isolation | AI + Owner |
| 2026-11-25 | Production Step 3 / Fixes `#38`–`#40` | Render Docker (`kartik-ai-app.onrender.com`) | Live Render Deployment + Headless Chromium Verification | **PASS** | `/healthz` `200`, `6/6` API bootstrap `200`, `0` console errors, `/__downloads` disabled (`404`), `/robots.txt` & `/sitemap.xml` live | AI + Owner |
| 2026-11-25 | Fix `#41` | Firebase `kartik-ai-app` + Render | Firebase Admin SDK `cert` (`listUsers`, `verifyIdToken`) & Identity Toolkit Web API Key Check + Full Test Suite | **PASS** | `kartik-ai-app` Admin + Web SDK live-verified; `245/245` unit tests + `13/13` multi-user isolation tests passing | AI + Owner |
| 2026-11-25 | Fixes `#42`–`#43` | Render (`kartik-ai-app.onrender.com`) + GitHub (`KratX/kartik-ai`) | `npm test` + `seo.test.ts` + `npm run lint` + Live Chromium & Security Audit | **PASS** | `267/267` automated tests passing (`245` core + `13` isolation + `9` SEO), `188` TS files `0` lint violations, `1280×640` bespoke OG banner, all favicons `200`, Soft-404 `404`, `0` secrets leaked in 537 GitHub files | AI + Owner |




