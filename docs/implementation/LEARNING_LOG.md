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
- **What remains unclear or deferred:** Implementing `backend/shared/config` (`1.2.a`) next.

---

### Phase 1 / 1.2.a — Fail-fast environment config validator & secret redactor (`@kartik/shared/config`)
- **Date:** 2026-11-10
- **Concept learned:** Why configuration is validated once at boot (`loadConfig`) rather than lazily when a route is first hit, and why startup validation errors must name the offending environment variable while strictly omitting its value so malformed secrets never leak into container stdout or crash logs.
- **What was implemented:** Created `backend/shared/config/index.ts` (`loadConfig`, `ConfigValidationError`, `redactConfig`, `isSecretKeyName`, `SHARED_INFRA_CONFIG_SCHEMA`), re-exported it from `backend/shared/index.ts`, and added `backend/shared/tests/config.test.ts`.
- **Important terms and how they apply here:**
  - **Fail-fast boot validation:** Every service passes its `ConfigSchema` to `loadConfig()` before binding a port. If `REDIS_URL` is missing or `GATEWAY_CALLER_CREDENTIAL` is shorter than 32 bytes, the process exits immediately with a `ConfigValidationError` listing all invalid keys at once.
  - **Value-free error reporting (Phase 1 Exit Gate):** `ConfigValidationError` records the variable name (`GATEWAY_CALLER_CREDENTIAL`) and the rule that failed (`must be at least 32 bytes`), never echoing the raw string passed in `process.env`.
  - **Embedded URL credential redaction:** `DATABASE_URL` and `REDIS_URL` embed passwords inside the URI (`postgresql://user:pass@host/db`). `redactConfig()` parses the URL and replaces `u.password` with `REDACTED` while keeping the host and database name visible for debugging.
- **Problem encountered and why the fix worked:** Multi-line PEM keys (`FIREBASE_PRIVATE_KEY`) stored in `.env` files often contain literal `\n` sequences; `loadConfig()` automatically unescapes `\n` on `*PRIVATE_KEY` fields while keeping strict trimming on all other strings.
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (or `npm test`) and inspect `backend/shared/tests/config.test.ts`.
- **What remains unclear or deferred:** Implementing `backend/shared/errors` (`1.3.a`) next.

---

### Phase 1 / 1.3.a — Normative error catalogue, single response envelope, and safe HTTP error mapper (`@kartik/shared/errors`)
- **Date:** 2026-11-10
- **Concept learned:** Why a distributed system needs one closed set of machine-readable error codes (`ERROR_CATALOGUE`), one response envelope shape (`{ requestId?, traceId, data, meta: { nextCursor }, error }`), and an anti-enumeration rule (`404 NOT_FOUND` for both non-existent and foreign-owned resources, reserving `403 FORBIDDEN` strictly for policy refusals on resources the caller does own).
- **What was implemented:** Created `backend/shared/errors/index.ts` (`ERROR_CATALOGUE`, `AppError`, `isAppError`, `createSuccessEnvelope`, `mapErrorToHttpResponse`), re-exported it from `backend/shared/index.ts`, and added `backend/shared/tests/errors.test.ts`.
- **Important terms and how they apply here:**
  - **Anti-enumeration (`404` vs `403`):** Returning `403` when User B requests User A's `conversationId` confirms to an attacker that the UUID exists. Returning `404 NOT_FOUND` makes a foreign resource indistinguishable from a missing one.
  - **Error boundary sanitization (`mapErrorToHttpResponse`):** Only explicit `AppError` instances expose their `.code` and `.message` to the caller. Any unexpected runtime `Error` (e.g. a `pg` connection failure or upstream SDK exception) is converted to `500 INTERNAL_ERROR` with a safe message and the request's `traceId`.
  - **`Retry-After` header contract:** When `RATE_LIMITED` (`429`) is thrown with `retryAfterSeconds`, `mapErrorToHttpResponse` automatically populates the HTTP `Retry-After` header.
- **Problem encountered and why the fix worked:** Earlier when extracting `.zip` archives on Windows, extracted files retained archive timestamps older than the local `tsconfig.tsbuildinfo`, causing `tsc -b` to skip compiling new test files. Switching `"build"` and `"test"` in `backend/shared/package.json` to `tsc -b --force` guarantees deterministic compilation across zip extractions.
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (`8/8` passing tests across 3 suites) and inspect `backend/shared/tests/errors.test.ts`.
- **What remains unclear or deferred:** Implementing `backend/shared/logger` (`1.4.a`) next.

---

### Phase 1 / 1.4.a — Structured JSON logger & recursive secret redaction (`@kartik/shared/logger`)
- **Date:** 2026-11-10
- **Concept learned:** How structured JSON logs with `.child({ traceId, requestId })` bindings let you grep a single request across Gateway, Auth, Chat, Agent, and Billing, and how recursive field + value redaction enforces Readiness Gate G9 (Log Hygiene) even when a developer accidentally passes raw request headers or provider objects into a log call.
- **What was implemented:** Created `backend/shared/logger/index.ts` (`createLogger`, `redactLogValue`), re-exported it from `backend/shared/index.ts`, and added `backend/shared/tests/logger.test.ts`.
- **Important terms and how they apply here:**
  - **Child logger bindings (`logger.child({ traceId, requestId })`):** Created once per incoming HTTP request in middleware so every downstream log line automatically includes `traceId` (correlation) and `requestId` (run identity) without manual repetition.
  - **Two-layer redaction (Key name + Value pattern):** `redactLogValue` masks any property matching `/(secret|credential|private_key|api_key|password|token|cookie|set-cookie|authorization|x-internal-token|x-razorpay-signature|signedurl|signed_url)/i` AND scans string values for inline `Bearer ...`, `kartik_session=...`, `gsk_...`, `sk-or-...`, `tvly-...`, and `rzp_...` patterns.
  - **Circular reference guard (`WeakSet`):** Prevents `JSON.stringify` from throwing `TypeError: Converting circular structure to JSON` if an object with circular references is logged.
- **Problem encountered and why the fix worked:** None — pure TypeScript implementation compiled and passed on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (`10/10` passing tests across 4 suites) and inspect `backend/shared/tests/logger.test.ts`.
- **What remains unclear or deferred:** Implementing `backend/shared/redis` key builders (`1.5.a`) next.

---

### Phase 1 / 1.5.a — Scoped Redis key builders & TTL contract (`@kartik/shared/redis`)
- **Date:** 2026-11-10
- **Concept learned:** Why Redis keys must never be built by ad-hoc string concatenation inside controllers, why every key must carry an explicit TTL (so Redis memory on the free tier never leaks unbounded), and why chat idempotency keys (`24h`) have a different retention window than money idempotency keys (`30d`).
- **What was implemented:** Created `backend/shared/redis/index.ts` (`RedisKeys`, `REDIS_TTL_SECONDS`, `assertSafeKeySegment`), re-exported it from `backend/shared/index.ts`, and added `backend/shared/tests/redis.test.ts`.
- **Important terms and how they apply here:**
  - **Idempotency retention split (`24h` vs `30d` — §5.4):** A retried chat turn happens within minutes or hours (`86_400s`), whereas a delayed payment webhook or settlement reconciliation can arrive days later (`2_592_000s`).
  - **Key delimiter injection & PII guard (`assertSafeKeySegment`):** Rejects `@` (emails), `:` (delimiter injection that could hop across key namespaces), whitespace, and raw `eyJ...`/`Bearer` tokens.
  - **IPv6 colon normalization (`ipRateLimit`):** Converts `2001:db8::1` to `2001_db8__1` before building `rl:ip:{ip}:{window}` so `:` always separates logical key segments.
- **Problem encountered and why the fix worked:** IPv6 addresses naturally contain colons (`:`), which would fail the colon-delimiter guard unless normalized first inside `RedisKeys.ipRateLimit`. Normalizing `:` to `_` on IP inputs preserves unambiguous 4-part key structure (`rl:ip:2001_db8__1:w1`).
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (`13/13` passing tests across 5 suites) and inspect `backend/shared/tests/redis.test.ts`.
- **What remains unclear or deferred:** Implementing `backend/shared/auth` (`1.6.a` — Ed25519 user-context assertions and constant-time caller credentials) next.

---

### Phase 1 / 1.6.a — Ed25519 user-context assertion & constant-time service caller auth (`@kartik/shared/auth`)
- **Date:** 2026-11-10
- **Concept learned:** Why the API Gateway signs a short-lived asymmetric Ed25519 user-context assertion (`x-user-context`) after introspecting the browser's opaque session cookie so downstream services (`chat`, `agent`, `billing`) can verify the caller's `userId` (`sub`) and target service (`aud`) using only the public key, why `requestId` is strictly forbidden inside that assertion, and why service-to-service tokens (`x-service-token`) must be compared in constant time.
- **What was implemented:** Created `backend/shared/auth/index.ts` (`generateEd25519KeyPair`, `signUserContextAssertion`, `verifyUserContextAssertion`, `constantTimeTokenEquals`, `verifyServiceCaller`, `INTERNAL_AUTH_HEADERS`), re-exported it from `backend/shared/index.ts`, and added `backend/shared/tests/auth.test.ts` (Contract Test T14 & Phase 1 Exit Gate).
- **Important terms and how they apply here:**
  - **Asymmetric signing (`Ed25519` / `EdDSA`):** Only the Gateway holds `USER_CONTEXT_SIGNING_KEY` (private key). Chat, Agent, and Billing hold only `USER_CONTEXT_VERIFY_KEY` (public key). Even if a downstream service is compromised, it cannot mint fake user assertions for other services.
  - **Audience binding (`aud: "chat" | "agent" | "billing"`):** Prevents confused-deputy replay where an assertion issued for `chat` is forwarded to `billing` to trigger a direct mutation.
  - **Run identity vs assertion identity (`requestId` forbidden in assertion — §6.4):** The user-context assertion proves *who* the user is (`sub`) on *which trace hop* (`traceId`). `requestId` is the client's `Idempotency-Key` forwarded in `x-request-id`; forbidding `requestId` inside the JWT prevents accidental divergence between header and token.
  - **Constant-time token comparison (`timingSafeEqual` on SHA-256 digests):** Hashing both `provided` and `expected` tokens with SHA-256 before `timingSafeEqual` (and checking length equality) ensures an attacker cannot measure nanosecond differences to guess token length or characters one byte at a time.
- **Problem encountered and why the fix worked:** Multi-line PEM keys in environment files may be passed either with escaped `\n` sequences or base64-encoded into a single string. `normalizePemInput()` supports both raw PEM, `\n`-escaped PEM, and base64-encoded PEM transparently.
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (`17/17` passing tests across 6 suites) and inspect `backend/shared/tests/auth.test.ts`.
- **What remains unclear or deferred:** Implementing `backend/shared/contracts` and `backend/shared/validation` (`1.7.a`) next.

---

### Phase 1 / 1.7.a — Domain contracts, deterministic payload fingerprinting, and boundary validation (`@kartik/shared/contracts` & `@kartik/shared/validation`)
- **Date:** 2026-11-10
- **Concept learned:** How idempotent APIs distinguish a genuine network retry (`200` replay) from an accidental key reuse with a different payload (`409 IDEMPOTENCY_CONFLICT`) using canonical JSON SHA-256 fingerprinting, why keyset pagination cursors must be cryptographically bound to `scope` and `userId`, and how untrusted LLM coding output is validated against path traversal before storage.
- **What was implemented:** Created `backend/shared/contracts/index.ts` and `backend/shared/validation/index.ts`, re-exported both from `backend/shared/index.ts`, and added `backend/shared/tests/contracts.test.ts`.
- **Important terms and how they apply here:**
  - **Canonical JSON fingerprinting (`computePayloadFingerprint`):** Sorts object keys recursively before hashing with SHA-256 so semantically identical JSON bodies always hash to the exact same 64-character hex digest.
  - **Scoped HMAC pagination cursor (`encodePaginationCursor` / `decodePaginationCursor`):** Encodes `{ scope, userId, createdAt, id }` plus an HMAC-SHA256 tag so a cursor from Conversation A cannot be replayed against Conversation B or tampered with by a client.
  - **Untrusted model output boundary (`validateArtifactManifest`):** Enforces relative paths, rejects `..`, `/`, `\`, `\0`, hidden dot-files, and non-allowlisted file extensions (`ARTIFACT_INVALID`).
- **Problem encountered and why the fix worked:** None — compiled and passed on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (`21/21` passing tests across 7 suites) and inspect `backend/shared/tests/contracts.test.ts`.
- **What remains unclear or deferred:** Implementing `backend/shared/database` and `backend/shared/storage` (`1.8.a`) next.

---

### Phase 1 / 1.8.a — PostgreSQL pool/migration contract & private object storage (`@kartik/shared/database` & `@kartik/shared/storage`)
- **Date:** 2026-11-10
- **Concept learned:** Why Neon's free-tier compute allowance (100 CU-hours/month) requires `idleTimeoutMillis: 10_000` (10s) on every PostgreSQL pool so idle connections close and compute scales to zero, why database migrations must use `DIRECT_DATABASE_URL` (rejecting `-pooler` endpoints) and verify SHA-256 checksums of already-applied `.sql` files, and why file uploads must verify actual magic bytes (`%PDF-`, PNG/JPEG/WebP headers) rather than trusting browser-supplied extensions or MIME types.
- **What was implemented:** Created `backend/shared/database/index.ts` and `backend/shared/storage/index.ts`, re-exported both from `backend/shared/index.ts`, and added `backend/shared/tests/database-storage.test.ts`.
- **Important terms and how they apply here:**
  - **Scale-to-zero idle timeout (`idleTimeoutMillis: 10_000` — ADR 0004):** Keeping an idle connection open 24/7 consumes ~730 hours/month, exhausting Neon's 100 CU-hour free allowance in 4 days. Releasing idle connections after 10 seconds lets Neon suspend compute automatically.
  - **Forward-only migration checksums (`runForwardMigrations`):** Computes the SHA-256 hash of each numbered `.sql` file and compares it against `<schema>.schema_migrations`. If a developer edits an already-applied migration instead of creating a new numbered file, the runner aborts with `409 CONFLICT`.
  - **Magic-byte signature verification (`validateUploadFile`):** Checks the first bytes of the file buffer (`0x25 0x50 0x44 0x46 0x2d` for `%PDF-`) so an executable renamed to `invoice.pdf` is rejected at the boundary with `415 UNSUPPORTED_FILE_TYPE`.
- **Problem encountered and why the fix worked:** None — compiled and passed on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (`25/25` passing tests across 8 suites) and inspect `backend/shared/tests/database-storage.test.ts`.
- **What remains unclear or deferred:** Implementing `backend/shared/middleware` (`1.9.a`) and closing the Phase 1 Exit Gate next.

---

### Phase 1 / 1.9.a — Middleware pipeline & Phase 1 Exit Gate closure (`@kartik/shared/middleware`)
- **Date:** 2026-11-10
- **Concept learned:** How request middleware enforces architectural invariants before controller code ever runs: the Gateway mints a fresh `traceId` (`trc_<uuid>`) while forwarding the client's `Idempotency-Key` unchanged as `requestId`, `DEMO_READ_ONLY` blocks mutating verbs with `403` during public portfolio spikes, and rate limiters fail closed (`503 LIMITER_UNAVAILABLE`) when protecting paid/quota-bound endpoints.
- **What was implemented:** Created `backend/shared/middleware/index.ts` (`createRequestContextMiddleware`, `createDemoReadOnlyMiddleware`, `createRateLimitMiddleware`, `InMemoryRateLimitStore`, `createInternalAuthMiddleware`, `createErrorBoundaryMiddleware`), re-exported it from `backend/shared/index.ts`, and added `backend/shared/tests/middleware.test.ts`.
- **Important terms and how they apply here:**
  - **Run identity vs trace identity (`requestId` vs `traceId` — Invariant #15):** `traceId` correlates logs for a single HTTP attempt (regenerated per hop/retry at the Gateway); `requestId` is the client's `Idempotency-Key` identifying the logical business operation across retries so a retry never double-charges or duplicates a message.
  - **Fail-closed vs fail-open rate limiting (`503 LIMITER_UNAVAILABLE`):** If Redis is unreachable on an AI/billing endpoint (`failOpen: false`), the middleware returns `503 LIMITER_UNAVAILABLE` rather than allowing unlimited unthrottled provider calls.
  - **`DEMO_READ_ONLY` kill switch (§12):** A single boolean flag that allows `GET`/`HEAD`/`OPTIONS` browsing of seeded conversations while rejecting `POST`/`PUT`/`PATCH`/`DELETE` with `403 DEMO_READ_ONLY`.
- **Problem encountered and why the fix worked:** None — compiled and passed on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/shared test` (`29/29` passing tests across 9 suites) and inspect `backend/shared/tests/middleware.test.ts`.
- **What remains unclear or deferred:** Phase 1 is complete; Phase 2 (`@kartik/auth` service & session lifecycle) begins next.

---

### Phase 2 / 2.1.a — Auth service config, `0001_auth_users.sql` migration, and `UserRepository` (`@kartik/auth`)
- **Date:** 2026-11-10
- **Concept learned:** How a downstream microservice (`@kartik/auth`) references `@kartik/shared` via TypeScript project references (`references: [{ path: "../../shared" }]`), why Auth owns only user identity and sessions (`auth.users`, Invariant #2) and never touches credits or billing tables, and how `INSERT ... ON CONFLICT (firebase_uid) DO UPDATE` makes Google sign-in idempotent across repeat logins.
- **What was implemented:** Wired `backend/services/auth/package.json` and `tsconfig.json`, created `src/config/index.ts`, `src/models/index.ts` (`AUTH_MIGRATION_0001`), `src/repositories/index.ts` (`PostgresUserRepository` + `InMemoryUserRepository`), `src/index.ts`, and `tests/user-repository.test.ts`.
- **Important terms and how they apply here:**
  - **Idempotent identity upsert (`ON CONFLICT (firebase_uid) DO UPDATE`):** The first time a Google user signs in, a new `usr_<uuid>` row is inserted. On every subsequent sign-in, the same `usr_<uuid>` primary key is preserved while `display_name`, `avatar_url`, and `last_login_at` are refreshed.
  - **Disabled account refusal (`403 FORBIDDEN` — Invariant #20):** Unlike missing/foreign resources which return `404 NOT_FOUND`, a disabled user signing into their own account receives `403 FORBIDDEN` because they own the identity and policy refuses the action.
  - **Cross-field provider validation (`AUTH_PROVIDER_MODE`):** Defaults to `'mock'` so local development and CI run with zero external credentials; when switched to `'firebase'`, `loadAuthConfig` requires `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` at boot.
- **Problem encountered and why the fix worked:** None — compiled across the `@kartik/shared` project reference and passed all 4 unit tests on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/auth test` and inspect `backend/services/auth/tests/user-repository.test.ts`.
- **What remains unclear or deferred:** Implementing the Firebase ID-token verification adapter (`2.2.a`) next.

---

### Phase 2 / 2.2.a — Firebase ID-token verification adapter (`@kartik/auth/services/firebase-verifier`)
- **Date:** 2026-11-10
- **Concept learned:** Why external identity verification belongs behind an interface (`FirebaseTokenVerifier`) with a deterministic mock mode (`MockFirebaseTokenVerifier`, default per Invariant #19) and a cryptographic RS256 verifier (`JwtFirebaseTokenVerifier`) that checks `iss`, `aud` (`FIREBASE_PROJECT_ID`), `email_verified === true`, and `exp` before Auth ever creates a session.
- **What was implemented:** Created `backend/services/auth/src/services/firebase-verifier.ts`, `backend/services/auth/src/services/index.ts`, re-exported from `backend/services/auth/src/index.ts`, and added `backend/services/auth/tests/firebase-verifier.test.ts`.
- **Important terms and how they apply here:**
  - **Key ID (`kid`) rotation:** Google signs Firebase ID tokens with rotating RSA keys published at `securetoken@system.gserviceaccount.com`. `JwtFirebaseTokenVerifier` inspects `header.kid`, resolves the matching public key, and verifies the `RSA-SHA256` signature via `node:crypto`.
  - **Audience (`aud`) & Issuer (`iss`) binding:** A valid Google-signed Firebase token for *another* Firebase project will have a valid RSA signature from Google, so checking `aud === FIREBASE_PROJECT_ID` and `iss === "https://securetoken.google.com/<projectId>"` is what stops cross-project token replay.
  - **`email_verified === true` check:** Prevents account pre-hijacking via unverified email claims.
- **Problem encountered and why the fix worked:** None — compiled and passed all 4 unit tests on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/auth test` (`8/8` passing tests across 2 suites) and inspect `backend/services/auth/tests/firebase-verifier.test.ts`.
- **What remains unclear or deferred:** Implementing the opaque Redis session service (`2.3.a`) next.

---

### Phase 2 / 2.3.a — Opaque Redis session lifecycle, HttpOnly cookies, and CI composite `tsc -b` typecheck fix (`@kartik/auth/services/session-service`)
- **Date:** 2026-11-11
- **Concept learned:** Why Kartik.ai stores browser sessions as opaque 256-bit random tokens in `HttpOnly` cookies backed by Redis hashes (`session:{sessionId}`) with a 7-day sliding TTL instead of stateless browser JWTs (ADR 0002), and why TypeScript composite workspaces (`"composite": true` + `"references"`) must use `tsc -b` rather than `tsc --noEmit` for `pnpm typecheck` in CI.
- **What was implemented:** Created `backend/services/auth/src/services/session-service.ts` (`SessionService`, `InMemorySessionStore`, `RedisHashSessionStore`, `generateOpaqueSessionId`, `serializeSessionCookie`, `serializeClearSessionCookie`, `extractSessionIdFromCookieHeader`), exported it from `src/services/index.ts`, added `backend/services/auth/tests/session-service.test.ts`, and updated `"typecheck"` in `backend/shared/package.json` and `backend/services/auth/package.json` to `tsc -b`.
- **Important terms and how they apply here:**
  - **Opaque session vs stateless JWT (ADR 0002):** A stateless JWT stored in a browser cookie cannot be revoked before its `exp` timestamp without building a server-side blocklist anyway. An opaque 256-bit CSPRNG ID (`randomBytes(32).toString('base64url')`) carries zero PII, is meaningless if intercepted outside Redis, and revokes instantaneously via `DEL session:{sessionId}` on logout.
  - **Sliding 7-day TTL (`REDIS_TTL_SECONDS.SESSION = 604800`s):** Each authenticated session introspection updates `lastSeenAt` and resets the Redis key's TTL (`EXPIRE session:{sessionId} 604800`), keeping active users signed in while expiring inactive sessions after 7 days.
  - **Composite `tsc -b` vs `tsc --noEmit` in CI:** In `.github/workflows/ci.yml`, `pnpm typecheck` runs immediately after `pnpm install --frozen-lockfile`, before `pnpm build`. Because `@kartik/shared` maps `"types": "./dist/index.d.ts"` in `package.json`, running `tsc --noEmit` in `backend/shared` suppressed emitting `dist/index.d.ts`, causing `backend/services/auth` to fail with `TS2307: Cannot find module '@kartik/shared'`. Switching `"typecheck"` to `tsc -b` builds the project reference graph in topological order on clean CI checkouts.
- **Problem encountered and why the fix worked:** GitHub Actions failed on `pnpm typecheck` with `TS2307: Cannot find module '@kartik/shared'` because `backend/shared/dist/` did not exist yet when `tsc --noEmit` ran. Reproducing via `rm -rf backend/shared/dist && npx tsc -p backend/services/auth/tsconfig.json --noEmit` confirmed the root cause, and replacing `tsc --noEmit` with `tsc -b` in `backend/shared/package.json` and `backend/services/auth/package.json` resolved both sequential and standalone workspace typechecks.
- **How to inspect the feature:** Run `pnpm typecheck` and `pnpm --filter @kartik/auth test` (`12/12` passing tests across 3 suites).
- **What remains unclear or deferred:** Implementing the Auth HTTP controllers/routes (`POST /auth/google`, `GET /auth/me`, `POST /auth/logout`, `POST /internal/sessions/introspect`) in `2.4.a` to close Phase 2.

---

### Phase 2 / 2.4.a — Auth HTTP routes, internal Gateway session introspection, and Phase 2 Exit Gate closure (`@kartik/auth/routes`)
- **Date:** 2026-11-11
- **Concept learned:** How public authentication endpoints (`POST /auth/google`, `GET /auth/me`, `POST /auth/logout`) and private service-to-service endpoints (`POST /internal/sessions/introspect`) coexist inside `@kartik/auth` with distinct security boundaries, why `toPublicAuthUser` strips internal `firebaseUid` before returning user profiles to the browser, and how the Gateway validates an opaque session cookie via `/internal/sessions/introspect` before minting downstream Ed25519 user-context assertions.
- **What was implemented:** Created `backend/services/auth/src/middleware/index.ts`, `backend/services/auth/src/controllers/index.ts`, `backend/services/auth/src/routes/index.ts`, updated `backend/services/auth/src/index.ts`, and added `backend/services/auth/tests/auth-routes.test.ts` closing the Phase 2 Exit Gate.
- **Important terms and how they apply here:**
  - **Public vs. Internal route separation (Invariant #14):** Browser requests only reach `/auth/google`, `/auth/me`, and `/auth/logout` via the Gateway. `/internal/sessions/introspect` is never in the Gateway's public route table and still requires `x-service-caller: gateway` + constant-time `x-service-token` verification (`401` on bad token, `403` if called by `chat`, `agent`, or `billing`).
  - **DTO projection (`toPublicAuthUser`):** Internal database columns such as `firebaseUid` are provider implementation details; stripping them at the controller boundary keeps the public contract clean.
  - **Account-status revalidation on introspection:** Even if a Redis session key (`sess:{sessionId}`) has not expired yet, both `GET /auth/me` and `POST /internal/sessions/introspect` verify the user row in `UserRepository`. If an admin disables the user (`status = 'disabled'`), the Redis session is revoked immediately and `403 FORBIDDEN` is returned.
- **Problem encountered and why the fix worked:** None — compiled and passed all 4 integration tests (`16/16` Auth tests, `45/45` total workspace tests) on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/auth test` (`16/16` passing tests across 4 suites) and inspect `backend/services/auth/tests/auth-routes.test.ts`.
- **What remains unclear or deferred:** Phase 2 is complete; Phase 3 (`@kartik/gateway` API Gateway) begins next.

---

### Phase 3 / 3.1.a — API Gateway configuration, Ed25519 signing key boot check, and upstream service directory (`@kartik/gateway/config`)
- **Date:** 2026-11-11
- **Concept learned:** Why the API Gateway validates its asymmetric Ed25519 private key (`USER_CONTEXT_SIGNING_KEY`) at startup before accepting browser traffic, why wildcard `*` in `CORS_ALLOWED_ORIGINS` is forbidden when `HttpOnly` credentialed session cookies are used (§11), and how the Gateway maps logical service targets (`auth`, `chat`, `agent`, `billing`) to internal service URLs (Invariant #1).
- **What was implemented:** Wired `backend/gateway/package.json` and `tsconfig.json` (`tsc -b`), created `backend/gateway/src/config/index.ts` and `backend/gateway/src/index.ts`, and added `backend/gateway/tests/gateway-config.test.ts` (`4/4` tests).
- **Important terms and how they apply here:**
  - **Fail-fast asymmetric key validation (`isValidEd25519PrivateKey`):** Instead of discovering on the first authenticated browser request that `USER_CONTEXT_SIGNING_KEY` is malformed or an RSA key, `loadGatewayConfig` parses the key with `node:crypto` `createPrivateKey` at boot and verifies `asymmetricKeyType === 'ed25519'`, throwing `ConfigValidationError` naming only `USER_CONTEXT_SIGNING_KEY` (never printing the secret).
  - **Credentialed CORS origin allowlist (`parseCorsAllowedOrigins`):** Browsers reject `Access-Control-Allow-Origin: *` when `Access-Control-Allow-Credentials: true` is set, and echoing arbitrary `Origin` headers enables cross-origin session riding. Parsing an explicit allowlist at boot enforces strict origin matching.
- **Problem encountered and why the fix worked:** None — compiled and passed all 4 unit tests (`49/49` workspace tests across 14 suites) on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/gateway test` (`4/4` passing tests) and inspect `backend/gateway/tests/gateway-config.test.ts`.
- **What remains unclear or deferred:** Implementing the Gateway session-cookie introspection client, Ed25519 `x-user-context` assertion minting, cookie stripping, and upstream proxy adapter in `3.2.a`.

---

### Phase 3 / 3.2.a — Gateway session introspection, Ed25519 `x-user-context` assertion minting, cookie stripping, and CORS/CSRF middleware (`@kartik/gateway/proxy` & `@kartik/gateway/middleware`)
- **Date:** 2026-11-11
- **Concept learned:** How the API Gateway bridges two authentication models (ADR 0002): the browser authenticates to the Gateway with an opaque `HttpOnly` session cookie (`kartik_session`), the Gateway introspects that cookie once via `@kartik/auth` (`POST /internal/sessions/introspect`), strips the `Cookie` header, and mints a short-lived (60s) Ed25519 `x-user-context` assertion bound to the exact target service (`aud: 'chat' | 'agent' | 'billing'`).
- **What was implemented:** Created `backend/gateway/src/proxy/index.ts` (`buildDownstreamProxyHeaders`, `FetchUpstreamHttpClient`, `InMemoryUpstreamHttpClient`), created `backend/gateway/src/middleware/index.ts` (`GatewaySessionIntrospector`, `createGatewaySessionMiddleware`, `createGatewayCorsAndCsrfMiddleware`), updated `backend/gateway/src/index.ts`, and added `backend/gateway/tests/gateway-proxy.test.ts` (`4/4` tests).
- **Important terms and how they apply here:**
  - **Header sanitization & cookie stripping (`HOP_BY_HOP_OR_SPOOFABLE_HEADERS`):** If a malicious client sends a forged `x-user-context` or `x-service-token` header from the browser, `buildDownstreamProxyHeaders` strips it before attaching the Gateway's own signed headers. And stripping `cookie` before calling `chat`, `agent`, or `billing` ensures downstream services never handle raw browser session tokens.
  - **Origin-header CSRF protection (`createGatewayCorsAndCsrfMiddleware` — §11):** Even with `SameSite=Lax` cookies, verifying that mutating (`POST`/`PUT`/`PATCH`/`DELETE`) cookie-authenticated requests carry an `Origin` header matching `config.allowedOrigins` provides defense-in-depth against cross-site request forgery.
  - **Upstream error code differentiation (`BILLING_UNAVAILABLE` vs `PROVIDER_UNAVAILABLE` — §5.5):** When `billing` is unreachable, the client action is *"Retry with the same key"*; when another upstream fails, `503 PROVIDER_UNAVAILABLE` is returned.
- **Problem encountered and why the fix worked:** None — compiled and passed all 4 unit tests (`53/53` workspace tests across 15 suites) on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/gateway test` (`8/8` passing tests across 2 suites) and inspect `backend/gateway/tests/gateway-proxy.test.ts`.
- **What remains unclear or deferred:** Implementing the Gateway public route table and closing the Phase 3 Exit Gate in `3.3.a`.

---

### Phase 3 / 3.3.a — Gateway public route table, `/internal/*` blocking, run-identity forwarding, and Phase 3 Exit Gate closure (`@kartik/gateway/routes`)
- **Date:** 2026-11-11
- **Concept learned:** Why the API Gateway resolves the public route table **before** running idempotency or session middleware (so any browser request targeting `/internal/*` or an unknown path immediately receives `404 NOT_FOUND` per Invariants #14 and #20 without touching Redis or Auth), how the Gateway enforces the Run-Identity contract (generating a fresh `traceId` per HTTP attempt while forwarding the client's `Idempotency-Key` unchanged as `x-request-id` per Invariant #15), and why `/api/v1/webhooks/razorpay` must preserve the raw unparsed request body for HMAC-SHA256 verification (§11).
- **What was implemented:** Created `backend/gateway/src/routes/index.ts` (`resolvePublicGatewayRoute`, `createGatewayRouter`), updated `backend/gateway/src/index.ts`, and added `backend/gateway/tests/gateway-routes.test.ts` closing the Phase 3 Exit Gate.
- **Important terms and how they apply here:**
  - **Public-to-Internal route mapping (`resolvePublicGatewayRoute`):** Maps `/api/v1/auth/*` -> `auth`, `/api/v1/conversations*` -> `chat`, `/api/v1/{agents,files,artifacts}*` -> `agent`, and `/api/v1/{billing,webhooks/razorpay}*` -> `billing`, while rejecting any path containing `/internal/` with `404 NOT_FOUND`.
  - **Raw body preservation (`preserveRawBody: true`):** Re-serializing parsed JSON (`JSON.stringify(req.body)`) can alter whitespace or key formatting and break Razorpay's `X-Razorpay-Signature` HMAC over the raw bytes. Forwarding `req.rawBody` untouched preserves byte-for-byte integrity.
- **Problem encountered and why the fix worked:** None — compiled and passed all 4 integration tests (`12/12` Gateway tests, `57/57` total workspace tests across 16 suites) on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/gateway test` (`12/12` passing tests across 3 suites) and inspect `backend/gateway/tests/gateway-routes.test.ts`.
- **What remains unclear or deferred:** Phase 3 is complete; Phase 4 (`@kartik/billing` Credit & Payment Ledger Service) begins next.

---

### Phase 4 / 4.1.a — Billing configuration, integer paise plan catalogue, `0001_billing_core.sql` migration, and `SELECT ... FOR UPDATE` row-locking repository (`@kartik/billing`)
- **Date:** 2026-11-11
- **Concept learned:** Why monetary values in INR must be stored and calculated in integer **paise** (`49900` = ₹499.00) rather than floating-point rupees (§11), why credit balances (`available_credits`, `reserved_credits`) are protected at two layers (PostgreSQL `CHECK (available_credits >= 0)` constraints + `SELECT ... FOR UPDATE` pessimistic row locks inside a single transaction per Invariant #17), and why `BILLING_MODE=mock` is the default so local development and automated tests never hit live payment APIs.
- **What was implemented:** Configured `backend/services/billing/{package.json,tsconfig.json}` (`tsc -b`), created `backend/services/billing/src/config/index.ts` (`loadBillingConfig`), `backend/services/billing/src/models/index.ts` (`DEFAULT_BILLING_PLANS`, `BILLING_INITIAL_MIGRATION`), `backend/services/billing/src/repositories/index.ts` (`PostgresBillingRepository`, `InMemoryBillingRepository`), `backend/services/billing/src/index.ts`, and `backend/services/billing/tests/billing-repository.test.ts` (`4/4` tests).
- **Important terms and how they apply here:**
  - **Integer Paise vs Floating-Point Rupees (§11):** IEEE-754 floats cannot represent `0.1 + 0.2` exactly (`0.30000000000000004`). Storing prices in integer paise (`pricePaise: 49_900` for ₹499.00) guarantees exact arithmetic and matches Razorpay's native smallest-currency-unit API.
  - **`SELECT ... FOR UPDATE` Pessimistic Row Lock (Invariant #17):** Without row locking, two concurrent requests reading `available_credits = 100` at the same millisecond can both pass an application-level `if (balance >= 60)` check and write back `40`, losing a deduction or overdrawing the account. Locking the `billing.credit_accounts` row with `SELECT ... FOR UPDATE` inside `BEGIN ... COMMIT` serializes concurrent transactions for the same user at the database row level.
- **Problem encountered and why the fix worked:** None — compiled cleanly with `tsc -b` and passed all 4 unit tests (`61/61` workspace tests across 17 suites) on the first run.
- **How to inspect the feature:** Run `pnpm --filter @kartik/billing test` (`4/4` passing tests) and inspect `backend/services/billing/tests/billing-repository.test.ts`.
- **What remains unclear or deferred:** Implementing the transactional `reserve` / `settle` / `release` credit state machine and 10-way concurrent no-overdraw proof test in `4.2.a`.
