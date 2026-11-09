# Local development

Placeholder — completed in Phase 2 when Docker Compose exists.

## Prerequisites

- Node **26** (see `.nvmrc`; Active LTS since 28 October 2026). Node 24 is admitted by `engines` as a fallback but is not the target.
- pnpm **12.18.0** exactly. The pin does not switch itself — run `pnpm -v` and compare.
- Docker Engine **29+** and Compose **v5+** (v5 rejects `secrets.*.driver` / `configs.*.driver`).
- Git **2.39+**.

Run `node scripts/check-toolchain.mjs` first — it checks all five against Blueprint §4.7 and prints a table.

## Planned workflow

1. Copy `.env.example` → `.env` and fill placeholders.
2. `docker compose -f infra/compose/docker-compose.yml up -d` (Phase 2) — PostgreSQL 17, Redis, Qdrant, MinIO. Then run `pnpm db:migrate` to create the four schemas and their roles.
3. Start the app you are working on with its own dev script.
4. Inspect: `docker compose ps`, `psql -h localhost -U kartik kartik -c '\dn'` (lists the four schemas), `redis-cli`, the Qdrant dashboard at :6333/dashboard, the MinIO console at :9001.

## Reset

Removing volumes destroys local data. Do it deliberately:

```bash
docker compose -f infra/compose/compose.yaml down -v
```

## Provider mode

`AI_PROVIDER_MODE=mock` is the default. Never set it to `live` for routine development — it spends quota.
