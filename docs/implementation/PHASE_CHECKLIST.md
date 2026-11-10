# Kartik.ai Phase Checklist

Tick an item only when evidence exists in `TEST_EVIDENCE.md` or `BUILD_STATE.md`.

## Phase 0 — Project setup, scope and safety baseline
- [x] 0.1 Environment inspected and recorded (`node scripts/check-toolchain.mjs` PASS on `win32 x64`)
- [x] 0.2 `BUILD_STATE.md` and `0000-project-baseline.md` created
- [ ] 0.3 Repository created, default branch set (`git init -b main` pending on owner's host)
- [x] 0.4 README with goal, stack, planned agents
- [x] 0.5 `.gitignore` covering `node_modules`, `.env*`, builds, logs, local data, and non-pnpm lockfiles
- [x] 0.6 `.editorconfig` and formatting rules (`.prettierrc.json`)
- [x] 0.7 Node LTS chosen (`26` target, `24` fallback), pinned in `.nvmrc` and `package.json`, used in `.github/workflows/ci.yml`
- [x] 0.8 `docs/architecture/overview.md` matches Section 2
- [x] 0.9 Decision records 0001–0004 created + workspace manifests (`0.9.a`), Compose v5 stack (`0.9.b` — 4/4 healthy), and CI (`0.9.c`)
- [x] 0.10 `.env.example` and `infra/compose/.env.compose.example` files with placeholders only
- [ ] 0.11 Secret scanning and branch protection enabled on GitHub remote (pending remote push)
- [x] 0.12 Cloud-cost checklist created (`docs/COST.md`); no cloud resources provisioned

**Phase 0 exit gate:** `pnpm install --frozen-lockfile && pnpm typecheck && pnpm lint && pnpm test` passes on a clean clone, `pnpm-lock.yaml` is the only lockfile, `npm` is rejected by `preinstall`, Compose starts all four dependencies (`postgres`, `redis`, `minio`, `qdrant`) and all four report `healthy`.

## Phase 1 — Shared libraries (`@kartik/shared`)
- [x] 1.1 Toolchain & test runner (`typescript`, `node:test`) wired in `@kartik/shared` and `tsc -b --force` verified (`1.1.a`, `1.1.b`)
- [x] 1.2 `shared/config` — fail-fast env parser printing variable names only (never values) (`1.2.a`)
- [x] 1.3 `shared/errors` — `AppError`, stable error-code union (§5.5), Express error mapper (`1.3.a`)
- [x] 1.4 `shared/logger` — structured JSON logger with `traceId`, `requestId`, and secret redaction (`1.4.a`)
- [x] 1.5 `shared/contracts` & `shared/validation` — request/response contracts, payload fingerprint, `Idempotency-Key`, cursor pagination & artifact manifest validation (`1.7.a`)
- [x] 1.6 `shared/redis` — Redis key builders (§5.2) with TTL enforcement (`1.5.a`)
- [x] 1.7 `shared/database` — Postgres pool (`idleTimeoutMillis: 10_000`), transaction helper, and migration runner (§5.1) (`1.8.a`)
- [x] 1.8 `shared/auth` — Ed25519 user-context assertion sign/verify (§6.4) + constant-time caller credential check (§6.3) (`1.6.a`)
- [ ] 1.9 `shared/middleware` & `shared/storage` — request context, validation, rate-limit factory, object storage interface

**Phase 1 exit gate:** Unit tests for the error mapper, the assertion round-trip, a wrong-`aud` rejection, and the Redis key builder pass; a deliberately invalid env configuration fails startup naming the offending variable without printing its value.
