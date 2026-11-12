# Rollback runbook

Operational rollback procedure for **Kartik.ai** (Blueprint v4.4 §8.5 & §16).

## Principle

A rollback that has never been rehearsed is not a rollback. Every deployment records the previous known-good Git SHA in `docs/implementation/BUILD_STATE.md` so recovery is deterministic.

## Application Rollback Procedure

1. Identify the last known-good commit SHA or immutable image tag recorded in `docs/implementation/BUILD_STATE.md`.
2. If an immediate traffic freeze is needed while investigating, set `DEMO_READ_ONLY=true` on the API Gateway — all mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`) immediately return `403 FORBIDDEN` while read-only browsing and health probes stay up (Blueprint §12).
3. Checkout or redeploy the last known-good tag and run `pnpm install --frozen-lockfile && pnpm build`.
4. Verify `/healthz` and `/readyz` across all five services (`gateway`, `auth`, `chat`, `agent`, `billing`).
5. Smoke test: sign in, send an idempotent mock chat message (`Idempotency-Key`), and verify credit balance.
6. Record the rollback timestamp, commit SHA, and root cause in `docs/implementation/BUILD_STATE.md` and `docs/implementation/TEST_EVIDENCE.md`.

## If the Failure is in the Database

Re-deploying application code will not undo a destructive schema change:
1. Enable `DEMO_READ_ONLY=true` at the Gateway edge to halt writes immediately.
2. Restore from the last verified `pg_dump --format=custom` backup into a clean target database.
3. Run `node scripts/migrate.mjs` in dry-run mode to verify schema alignment (`auth`, `chat`, `agent`, `billing`) before switching traffic back.
