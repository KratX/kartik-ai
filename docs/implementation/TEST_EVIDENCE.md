# Kartik.ai Test Evidence

Chronological record of test commands and their real results. Never invent a result; mark unrun commands as NOT RUN.

| Date | Environment | Commit | Suite / command | Result | Notes |
|---|---|---|---|---|---|
| 2026-11-09 | Windows 10 (`win32 x64`), PowerShell 5.1 | uncommitted | `node scripts/check-toolchain.mjs` | PASS | Ran by owner: Node 26.13.0, pnpm 12.18.0, Docker Engine 29.9.3, Compose 5.7.0, Git 2.39.0 all `ok`. |
| 2026-11-09 | AI Studio Linux (`linux x64`) | uncommitted | `npm run preinstall` | PASS | Ran by AI: exited code 1 (`This repository uses pnpm only — see Blueprint §4.6.`). |
| 2026-11-09 | AI Studio Linux (`linux x64`) | uncommitted | `pnpm install --frozen-lockfile --config.engine-strict=false` | PASS | Ran by AI: `Scope: all 8 workspace projects`, `Lockfile is up to date, resolution step is skipped`. |
| 2026-11-09 | AI Studio Linux (`linux x64`) | uncommitted | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` | PASS | Ran by AI: topological execution across all 7 workspace packages (`Scope: 7 of 8 workspace projects`). |
| 2026-11-09 | Windows 10 (`win32 x64`), VS Code PowerShell | uncommitted | `pnpm install --frozen-lockfile` & `pnpm typecheck` | PASS | Confirmed by owner on host machine. |
| 2026-11-09 | AI Studio Linux (`linux x64`) | uncommitted | `pnpm db:migrate` (missing env vs valid env) & `pnpm db:seed` | PASS | Ran by AI: exits 1 without `DIRECT_DATABASE_URL`, exits 0 when set; Compose v5 structure verified. |
| 2026-11-09 | Windows 10 (`win32 x64`), VS Code PowerShell | uncommitted | `docker compose --env-file infra/compose/.env.compose.example -f infra/compose/docker-compose.yml up -d` & `ps` | PASS | Ran by owner: `kartik-minio-1` (`pgsty/silo`), `kartik-postgres-1` (`postgres:17-alpine`), `kartik-qdrant-1` (`qdrant/qdrant:v1.20.0`), and `kartik-redis-1` (`redis:7.4-alpine`) all `Up (healthy)` on `127.0.0.1`. |
| 2026-11-09 | AI Studio Linux (`linux x64`) | uncommitted | `.prettierrc.json` & `.github/workflows/ci.yml` validation | PASS | Ran by AI: JSON and CI workflow steps (`single-lockfile`, `pnpm/action-setup@v4`, Node 26/24 matrix, `pnpm toolchain`, `pnpm install --frozen-lockfile`, `typecheck`, `lint`, `test`, `build`) verified. |
| 2026-11-09 | Windows 10 (`win32 x64`), VS Code PowerShell | uncommitted | `pnpm install --frozen-lockfile` (`0.9.c` closure) | PASS | Ran by owner: `Scope: all 8 workspace projects`, `Lockfile is up to date, resolution step is skipped`, `Done in 51ms using pnpm v12.18.0`. |
| 2026-11-09 | AI Studio Linux (`linux x64`) | uncommitted | `pnpm install --frozen-lockfile --config.engine-strict=false && pnpm typecheck && pnpm build` (`1.1.a`) | PASS | Ran by AI: `typescript@7.0.2` and `@types/node@26.6.6` passed `minimumReleaseAge` policy (23 entries), `tsc --noEmit` and `tsc -b` compiled `backend/shared/index.ts` -> `dist/index.{js,d.ts,js.map,d.ts.map}` + `tsconfig.tsbuildinfo`. |
| 2026-11-10 | AI Studio Linux (`linux x64`) | `dd34e0a` | `tsc -b backend/shared/tsconfig.json && node --test backend/shared/dist/tests/*.test.js` (`1.1.b`) | PASS | Ran by AI: compiled `backend/shared/tests/index.test.ts` to `dist/tests/index.test.js` and passed 1/1 `node:test` assertion with zero external test dependencies installed (ADR 0005). |
| 2026-11-10 | AI Studio Linux (`linux x64`) | `e816fa7` | `tsc -b backend/shared/tsconfig.json && node --test backend/shared/dist/tests/*.test.js` (`1.2.a`) | PASS | Ran by AI: `config.test.js` (3/3) and `index.test.js` (1/1) passed; verified `ConfigValidationError` names offending keys (`DATABASE_URL`, `DATABASE_SCHEMA`, `REDIS_URL`, `GATEWAY_CALLER_CREDENTIAL`) and never prints raw secret values (Phase 1 Exit Gate). |
| 2026-11-10 | Windows 10 (`win32 x64`), PowerShell | `1.2.a` | `pnpm --filter @kartik/shared test` (`tsc -b --force && node --test "./dist/tests/*.test.js"`) | PASS | Confirmed by owner on host after adding `--force` to prevent stale `.tsbuildinfo` skipping extracted `.zip` files. |
| 2026-11-10 | AI Studio Linux (`linux x64`) | `1.3.a` | `tsc -b --force && node --test "./dist/tests/*.test.js"` (`1.3.a`) | PASS | Ran by AI: 3 suites, 8/8 tests passing (`index.test.js`, `config.test.js`, `errors.test.js`); verified all 19 error codes, `Retry-After` header, and raw DB error redaction. |
| 2026-11-10 | Windows 10 (`win32 x64`), PowerShell | `1.3.a` | `pnpm --filter @kartik/shared test` | PASS | Confirmed by owner on host: 3 suites, 8/8 tests passing in 80.17ms. |
| 2026-11-10 | AI Studio Linux (`linux x64`) | `1.4.a` | `tsc -b --force && node --test "./dist/tests/*.test.js"` (`1.4.a`) | PASS | Ran by AI: 4 suites, 10/10 tests passing (`logger.test.js` verified `.child({ traceId, requestId })` correlation and Gate G9 redaction of cookies, Bearer tokens, signed URLs, and Razorpay secrets). |
| 2026-11-10 | AI Studio Linux (`linux x64`) | `1.5.a` | `tsc -b --force && node --test "./dist/tests/*.test.js"` (`1.5.a`) | PASS | Ran by AI: 5 suites, 13/13 tests passing (`redis.test.js` verified all 7 Redis key builders from §5.2, 24h/30d idempotency TTL split, IPv6 normalization, and PII/JWT rejection). |
| 2026-11-10 | AI Studio Linux (`linux x64`) | `1.6.a` | `tsc -b --force && node --test "./dist/tests/*.test.js"` (`1.6.a`) | PASS | Ran by AI: 6 suites, 17/17 tests passing (`auth.test.js` verified Ed25519 assertion round-trip, wrong-`aud` rejection, 5s clock-skew tolerance, `requestId` prohibition per §6.4, and constant-time caller verification per §6.3). |
| 2026-11-10 | AI Studio Linux (`linux x64`) | `1.7.a` | `tsc -b --force && node --test "./dist/tests/*.test.js"` (`1.7.a`) | PASS | Ran by AI: 7 suites, 21/21 tests passing (`contracts.test.js` verified `AgentName`, deterministic payload fingerprinting, `Idempotency-Key` validation, scoped HMAC pagination cursors, and artifact path traversal rejection). |

**Rules**
- One row per run, in order.
- `Result` is `PASS`, `FAIL`, `PARTIAL` or `NOT RUN` — nothing else.
- Never paste secrets, tokens, cookies or personal data into this file.
- Record who ran it (AI or owner) in the notes.
