# Kartik.ai Learning Log

One entry per completed micro-step. Written for the owner, not as an AI memory dump.

## Template

### <phase> / <micro-step> — <short name>
- **Date:**
- **Concept learned:**
- **What was implemented:**
- **Important terms and how they apply here:**
- **Problem encountered and why the fix worked:**
- **How to inspect the feature:**
- **What remains unclear or deferred:**

---

### Phase 0 / 0.9.a — Root monorepo manifest, base TypeScript config, 7 workspace manifests, and lockfile stream
- **Date:** 2026-11-09
- **Concept learned:** Why a monorepo workspace declaration (`pnpm-workspace.yaml`) and the per-package `package.json` manifests form a single atomic unit, and how `workspace:*` links internal packages without publishing.
- **What was implemented:** Created root `package.json`, `tsconfig.base.json`, all 7 workspace manifests (`@kartik/shared`, `@kartik/gateway`, `@kartik/auth`, `@kartik/chat`, `@kartik/agent`, `@kartik/billing`, `@kartik/frontend`) with their `tsconfig.json` project references, and the 8-importer two-document `pnpm-lock.yaml`.
- **Important terms and how they apply here:**
  - **`workspace:*` protocol:** Declares that `@kartik/gateway` and the four backend services depend on the local `@kartik/shared` workspace package (`link:../shared` / `link:../../shared` in `pnpm-lock.yaml`), failing loudly if the local package is missing rather than querying the public npm registry.
  - **Two-document `pnpm-lock.yaml`:** Document 1 pins `pnpm@12.18.0`; Document 2 maps all 8 workspace importers (`.` plus the 7 packages).
  - **Topological execution (`pnpm -r`):** pnpm inspects the `workspace:*` graph and automatically runs `@kartik/shared` before `@kartik/gateway` and the four services.
- **Problem encountered and why the fix worked:** Splitting `0.9.a` so that root `package.json` existed before `backend/shared/package.json`, `backend/gateway/package.json`, and `frontend/package.json` left literal paths in `pnpm-workspace.yaml` pointing to directories without manifests (`error: Workspace not found "backend/shared"`), and the AI Studio container supervisor's automatic `bun install` failed on both the missing workspace manifests and the `preinstall` check. Completing the 7 workspace manifests and teaching `preinstall` to clean `bun.lock` when invoked by the `/app/applet` container supervisor resolved the error while keeping strict `pnpm`-only enforcement on developer hosts and CI.
- **How to inspect the feature:** Run `pnpm install --frozen-lockfile`, inspect `importers:` in the second YAML document of `pnpm-lock.yaml`, and run `pnpm typecheck` to watch `backend/shared` execute before the downstream services.
- **What remains unclear or deferred:** `infra/compose/docker-compose.yml` and `scripts/seed-dev-data.mjs` (`0.9.b`), plus ESLint/Prettier/TypeScript tooling in Phase 0's remaining steps.

---

### Phase 0 / 0.9.b — Local Docker Compose v5 stack and migration/seed entrypoints
- **Date:** 2026-11-09
- **Concept learned:** How to define a local multi-datastore stack (PostgreSQL 17, Redis 7.4, MinIO, Qdrant) under Docker Compose v5 rules with explicit readiness healthchecks and loopback-only (`127.0.0.1`) port bindings, and why database migrations require a direct (`DIRECT_DATABASE_URL`) rather than transaction-pooled connection.
- **What was implemented:** Created `infra/compose/docker-compose.yml`, `scripts/migrate.mjs`, `scripts/seed-dev-data.mjs`, and added `"db:migrate"` and `"db:seed"` scripts to root `package.json`.
- **Important terms and how they apply here:**
  - **Container started vs container healthy (`healthcheck`):** Docker considers a container "started" the millisecond its PID 1 process spawns, long before PostgreSQL accepts TCP connections on port 5432. Defining `pg_isready`, `redis-cli ping`, `mc ready local`, and TCP `/dev/tcp/127.0.0.1/6333` probes allows downstream services (and migration scripts) to wait on `service_healthy` rather than racing startup.
  - **Loopback host binding (`127.0.0.1:5432:5432`):** Plain `"5432:5432"` binds `0.0.0.0` on the host machine, exposing your local Postgres and Redis to anyone on the same Wi-Fi/LAN. Prefixing `127.0.0.1:` restricts host access strictly to your own machine while containers inside the `kartik` network still talk by service name (`postgres:5432`).
  - **Direct vs pooled database URL (`DIRECT_DATABASE_URL` vs `DATABASE_URL`):** Application services use a transaction-mode connection pooler (`DATABASE_URL`), whereas schema migrations require session-level features (`DIRECT_DATABASE_URL`, ADR 0004).
- **Problem encountered and why the fix worked:**
  1. Running `docker compose up -d` failed with `pull access denied for minio/minio, repository does not exist or may require 'docker login'` (which also interrupted the parallel pulls of `postgres` and `redis`). Probing Docker Hub and Quay.io APIs confirmed that MinIO removed its public `minio/minio` namespace from Docker Hub and locked `quay.io/minio/minio` behind authentication (`401`). Switching the `minio` service image to `pgsty/silo:RELEASE.2026-11-09T00-00-00Z` (the community-maintained MinIO fork that preserves `MINIO_ROOT_*`, `:9000`/`:9001`, `/minio/health/live`, and the S3 wire protocol, and bundles static `/usr/bin/curl`) resolved the pull error without changing a single env var or port.
  2. Official `qdrant/qdrant` images do not reliably include `curl` or `wget` for HTTP healthchecks; using bash's built-in `/dev/tcp/127.0.0.1/6333` socket check avoids external binary dependencies inside the container.
- **How to inspect the feature:** Run `docker compose --env-file infra/compose/.env.compose.example -f infra/compose/docker-compose.yml config` (or `up -d` followed by `docker compose -f infra/compose/docker-compose.yml ps`) in VS Code terminal.
- **What remains unclear or deferred:** Finalizing Phase 0 formatting rules (`.prettierrc.json`) and CI workflow (`.github/workflows/ci.yml`) in `0.9.c`.

---

### Phase 0 / 0.9.c — Formatting rules, CI pipeline wiring, and Phase 0 exit gate closure
- **Date:** 2026-11-09
- **Concept learned:** How a GitHub Actions CI pipeline enforces the exact same invariants as the developer workstation (single lockfile, pinned `pnpm@12.18.0` via `pnpm/action-setup@v4`, Node 26 primary + Node 24 fallback matrix, and `pnpm toolchain` preflight) before running workspace scripts.
- **What was implemented:** Created `.prettierrc.json` (aligned with `.editorconfig`), replaced the placeholder `.github/workflows/ci.yml` with the real Phase 0 verification workflow, and updated `PHASE_CHECKLIST.md`, `BUILD_STATE.md`, and `TEST_EVIDENCE.md` with the owner's `4/4 healthy` Docker Compose evidence.
- **Important terms and how they apply here:**
  - **`pnpm/action-setup@v4` with `packageManager`:** Instead of hardcoding a pnpm version in YAML that can drift from `package.json`, `pnpm/action-setup@v4` reads `"packageManager": "pnpm@12.18.0"` directly from `package.json`.
  - **`fail-fast: false` matrix (`[26, 24]`):** If Node 24 has a subtle difference from Node 26, `fail-fast: false` lets both matrix legs finish so you see the full comparison in one CI run rather than cancelling the second job mid-flight.
  - **Single-lockfile CI gate:** `test ! -f package-lock.json && test ! -f yarn.lock && test ! -f bun.lock && test ! -f bun.lockb` fails the build immediately if a contributor commits a competing lockfile.
- **Problem encountered and why the fix worked:** `START-HERE.md` explicitly stipulates that Phase 0 adds no npm dependencies (`typescript`, `vitest`, `zod` arrive in Phase 1). Wiring `.github/workflows/ci.yml` against our zero-dependency Phase 0 workspace scripts (`pnpm toolchain`, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`) makes CI green and functional on day one without violating the Phase 0 no-dependency boundary.
- **How to inspect the feature:** Inspect `.github/workflows/ci.yml`, `.prettierrc.json`, and `docs/implementation/PHASE_CHECKLIST.md`.
- **What remains unclear or deferred:** Phase 1 (`1.1.a`) installs `typescript`, `@types/node`, and `vitest` and replaces the Phase 0 placeholder workspace scripts with `tsc -b` and `vitest run`.

---

### Phase 1 / 1.1.a — TypeScript 7 (`typescript@7.0.2`), `@types/node@26.6.6`, and `@kartik/shared` composite build wiring
- **Date:** 2026-11-09
- **Concept learned:** How TypeScript composite project references (`composite: true` + `tsc -b`) and Node.js ESM `exports` maps (`"types"` before `"default"`) allow downstream services (`@kartik/gateway`, `@kartik/auth`, etc.) to resolve both compile-time `.d.ts` declarations and runtime `.js` files from `@kartik/shared`.
- **What was implemented:** Installed and exact-pinned `typescript@7.0.2` and `@types/node@26.6.6` in root `package.json` and `pnpm-lock.yaml`, created `backend/shared/index.ts`, updated `backend/shared/tsconfig.json`, and wired `"build": "tsc -b"`, `"typecheck": "tsc --noEmit"`, and the `"exports"` field in `backend/shared/package.json`.
- **Important terms and how they apply here:**
  - **`composite: true` & `tsc -b`:** Enables incremental project-reference builds that emit `.d.ts`, `.d.ts.map` (so "Go to Definition" in VS Code jumps to the `.ts` source rather than the `.d.ts` file), and `tsconfig.tsbuildinfo`.
  - **Conditional `exports` key order (`"types"` first):** Under `moduleResolution: "NodeNext"`, TypeScript reads the `exports` map in `package.json` top-to-bottom. Placing `"types"` before `"default"` ensures `tsc` resolves `.d.ts` declarations while Node.js resolves `.js` at runtime.
  - **`minimumReleaseAge: 1440` supply-chain check:** `pnpm install --frozen-lockfile` verified all 23 lockfile entries (`typescript@7.0.2` platform binaries + `@types/node@26.6.6` + `undici-types@8.9.0`) against the 24-hour release age gate in `pnpm-workspace.yaml`.
- **Problem encountered and why the fix worked:** Running `pnpm add -D -w typescript @types/node` initially wrote caret ranges (`^26.6.6`, `^7.0.2`) into `package.json`. Replacing them with exact versions (`"26.6.6"`, `"7.0.2"`) and syncing `pnpm-lock.yaml` aligned the root manifest with `.npmrc`'s `save-exact=true` policy.
- **How to inspect the feature:** Run `pnpm typecheck` and `pnpm build`, then inspect `backend/shared/dist/index.js` and `backend/shared/dist/index.d.ts`.
- **What remains unclear or deferred:** Installing `vitest` and wiring the unit test runner in `1.1.b` (Sprint Step 15).

---

### Phase 1 / 1.1.b — Zero-dependency unit test runner (`node:test` + `tsc -b`) in `@kartik/shared`
- **Date:** 2026-11-10
- **Concept learned:** Why Node's built-in test runner (`node:test` + `node:assert/strict`) paired with TypeScript project references (`tsc -b`) eliminates an entire dependency tree (`vitest`, `vite`, `esbuild` sub-trees) and prevents package-manager lockfile crashes across host and cloud-sandbox environments.
- **What was implemented:** Wired `"test": "tsc -b && node --test ./dist/tests/*.test.js"` in `backend/shared/package.json`, added `"tests/**/*.ts"` to `backend/shared/tsconfig.json`, and created `backend/shared/tests/index.test.ts` testing `SHARED_PACKAGE_NAME` and `SHARED_PACKAGE_VERSION`.
- **Important terms and how they apply here:**
  - **`node:test` & `node:assert/strict`:** Built into Node 22, 24, and 26. Provides `describe`, `it`, `test`, and strict deep equality assertions with TAP/spec reporting and zero npm packages.
  - **Compile-then-test (`tsc -b && node --test ./dist/tests/*.test.js`):** Compiles TypeScript tests under the exact same strict `NodeNext` rules as production code, then executes the emitted `.js` files directly with Node.
- **Problem encountered and why the fix worked:** Earlier sessions crashed during `1.1.b` when attempting to install `vitest` into the workspace inside the AI Studio container. Using `node:test` + `tsc -b` (recorded in ADR 0005) requires zero package installations and works identically under `pnpm test` on Windows 10 (Node 26.13.0) and `npm test` in the Cloud Sandbox (Node 22.23.2).
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (or `pnpm test`) on Windows 10, or `npm test` in the sandbox, and inspect `backend/shared/dist/tests/index.test.js`.
- **What remains unclear or deferred:** Implementing `backend/shared/errors` (`1.2.a`) next.

