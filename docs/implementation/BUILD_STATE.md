# Kartik.ai Build State

- Current phase: Phase 0 — Repository foundation
- Current blueprint item: 0.9 — workspace wiring
- Current micro-step: 0.9.a — add the root `package.json`, `tsconfig.base.json` and per-package manifests
- Status: in progress
- Last completed micro-step: 0.8 — scaffold, records, ADRs 0000–0003, `docs/api/openapi.yaml`, three workflows
- Next micro-step: create the root `package.json` (engines, `packageManager: pnpm@12.18.0`, scripts — including `"toolchain": "node scripts/check-toolchain.mjs"`), then prove `pnpm install --frozen-lockfile` and `pnpm typecheck` run against the empty monorepo
- Current branch: not initialised
- Last known commit: not committed

## Current objective

Turn the scaffolded tree into a buildable monorepo without adding application code: workspaces, a shared TypeScript base, lint and format config, and a CI workflow that fails on a broken test.

## Completed work

- Repository skeleton created from Blueprint Section 4.1: 125 directories, every directory in the target tree present.
- Records created: `BUILD_STATE.md`, `LEARNING_LOG.md`, `PHASE_CHECKLIST.md`, `TEST_EVIDENCE.md`.
- ADRs 0000–0003 written (baseline, monorepo, session strategy, free-tier deployment).
- `docs/api/openapi.yaml` valid: 22 paths, 25 operations.
- `docs/COST.md`, `docs/PORTFOLIO.md`, four runbooks, three GitHub workflows, `.env.example`, `.nvmrc`.
- Blueprint rebuilt as **v3.0** (9 November 2026). It supersedes v1, v2, v2.1, v2.2 and v2.3, and the build instructions are now generated from it by `scripts/sync_instructions.py`.

## Changed files

- whole tree — initial skeleton and records

## Verification evidence

- `openapi.yaml` — PASS — parses with a YAML loader, 22 paths, 25 operations, every response description is a string.
- `scripts/check-toolchain.mjs` — ADDED — checks Node, pnpm, Docker Engine, Compose and Git against Blueprint §4.7; no dependencies, no network; exits non-zero on a real mismatch. NOT YET RUN ON THE OWNER'S MACHINE — run it and record the table here.
- `scripts/check-env.mjs` — FIXED — still required `MONGODB_URI`; now requires `DATABASE_URL`, `DATABASE_SCHEMA`, `REDIS_URL`.
- tree check — PASS — no directory from Blueprint §4.1 is missing.
- toolchain inspection — PASS — host facts reported by the owner on 9 November 2026, recorded in Blueprint §4.7 and ADR 0000:
  - Windows NT 10.0.19045.0 (Windows 10 Pro 22H2), PowerShell 5.1.19041.6456
  - Node **v26.13.0** — the target version itself; `engines: ^24.0.0 || ^26.0.0` also admits 24 for contributors
  - pnpm **12.18.0** — matches the `packageManager` pin exactly
  - Docker engine **29.9.3**, Compose **v5.7.0** — daemon reachable from the Windows CLI
  - git **2.39.0.windows.2**
- Docker engine reachability — PASS — `docker info --format '{{.ServerVersion}}'` returned **29.9.3**. Desktop is installed and started; RAM and firmware virtualisation are settled by the daemon answering.
- `git status` — NOT RUN — the tree is not a repository yet (Phase 0.8 deliberately does not `git init`).

## Decisions settled by Blueprint v3.0

- Language: **TypeScript throughout** (was open in v2.3).
- Node: **26** is the target (Active LTS since 28 October 2026); 24 stays a documented fallback until the frontend toolchain confirms 26.
- Package manager: **pnpm 12.18.0** (Blueprint v4.2 §4.6), pinned in `packageManager` and in every Dockerfile, one `pnpm-lock.yaml`. `pnpm-workspace.yaml` holds `allowBuilds`, `minimumReleaseAge`, `frozenLockfile` and `strictPeerDependencies`; `.npmrc` holds only the npm-compatible keys `save-exact` and `engine-strict`. ADR 0001 records the decision.
- No toolchain divergence as of the second inspection: Node 26.13.0, pnpm 12.18.0, Engine 29.9.3, Compose v5.7.0, Git 2.39.0. Every row in Blueprint §4.7 matches. **Keep it that way** — re-run the inspection whenever `pnpm -v` or `node -v` changes, because the `packageManager` pin does not switch itself (`manage-package-manager-versions` is off by default).
- Frontend state: **TanStack Query** for server data and **Zustand** for client truth. Redux Toolkit is rejected (Blueprint v4.0 §15.2). Anything that looks like a third store is an ADR.
- Primary datastore: **PostgreSQL** — one database `kartik`, four schemas `auth`/`chat`/`agent`/`billing`, one login role per service. MongoDB is not used. Recorded in **ADR 0004**; the previous unrecorded assumption is superseded.
- Data access: `pg` + hand-written SQL in repositories, numbered `.sql` migrations. No ORM (ADR 0004).

## Open issues / blockers

- Node 26 support in the frontend toolchain is unconfirmed; verify during 0.9 and record the result. The host runs **24.18.0**, so 0.9 executes on 24 and 26 is proven in CI only.
- Engine **29** raised the minimum client API to **1.44** and made the **containerd image store** the default. Both are already satisfied here; neither changes a file in this repo. Multi-platform (ARM64) manifests now work natively, which is what Phase 16 needs.
- Compose **v5.7.0** removed the internal BuildKit builder (builds delegate to Docker Bake) and rejects `secrets.*.driver` / `configs.*.driver`. Both constrain `infra/compose/docker-compose.yml`, written in 0.9.
- The compose file needs **no replica-set initiation** now that the datastore is Postgres — that whole class of host-vs-service-name problem is gone. What replaces it: the migration runner must apply the four schemas in order before any service starts, so `depends_on` needs a healthcheck condition, not just a container start.
- `infra/compose/docker-compose.yml` and `scripts/seed-dev-data.mjs` are listed in Blueprint §4.1 but do not exist yet; both are part of micro-step 0.9. The compose file brings up **Postgres**, Redis, MinIO and Qdrant — Mongo is no longer part of the stack.
- `backend/shared/database` must provide a pool with `idleTimeoutMillis` (Neon CU-hour trap, ADR 0004), a transaction helper and the migration runner. Nothing about it exists yet.
- The lockfile was generated by pnpm 12.18.0; any machine or image running a different major must be corrected before it is trusted (pnpm 12 writes a two-document YAML stream).
- ARM64 image builds are untested until Phase 16; note the risk now, do not act on it yet.

## Decisions requiring owner approval

- None at this micro-step.

## Safe resume instruction

Continue only with micro-step 0.9.a. Do not add application source, dependencies or Phase 1 shared libraries until the workspace wiring is verified and reviewed.
