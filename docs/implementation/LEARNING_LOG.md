# Kartik.ai Learning Log

---

## Entry 32 — Phase 8 / Step 8.5 (Micro-step 8.5.a): Local Full-Stack HTTP Runner (`scripts/start-local-stack.mjs`), Profile P Nginx Edge Config & Runbook Completion

### 1. Concept learned
- **Single-Command Zero-Cost Local Stack (`scripts/start-local-stack.mjs`):**
  - By combining `createGatewayRouter`, `InMemoryUpstreamHttpClient`, and `createManagedHttpServer`, developers can boot the entire 5-service API surface (`Gateway`, `Auth`, `Chat`, `Agent`, `Billing`) on `http://127.0.0.1:8000` with a pre-seeded session cookie (`kartik_session=sess_demo_local_001`) and 200 starter credits — allowing immediate `curl` or browser testing without cloud keys or running containers.
- **Single-Origin Reverse Proxy (`infra/nginx/default.conf`, Blueprint §2.1 & Invariant #1):**
  - Serving the React SPA at `/` and proxying `/api/*` to `http://gateway:8000` on the same origin ensures `HttpOnly; SameSite=Lax` session cookies work naturally without third-party cookie restrictions, while internal services (`auth`, `chat`, `agent`, `billing`) stay unreachable from the public internet.

### 2. What was implemented
- `scripts/start-local-stack.mjs` (`startLocalStackServer` programmatic + CLI entrypoint)
- `backend/gateway/tests/local-stack-runner.test.ts` (TCP integration test over ephemeral port)
- `infra/scripts/local-up.sh` & `infra/nginx/default.conf` (upgraded from Phase 0 placeholders)
- `.github/workflows/deploy-demo-vm.yml`, `docs/runbooks/*`, and `docs/architecture/*` (completed all remaining Phase 0 placeholder files)

### 3. How to inspect the feature
- Run `pnpm test` (`35` suites, `127` tests passing).
- Run `node scripts/start-local-stack.mjs` to start the local HTTP server on `:8000`.
