#!/usr/bin/env sh
# Kartik.ai Local Dependency Stack Bootstrapper — Blueprint §4.1, §4.7, §7.2 (Micro-step 8.5.a).
# Starts PostgreSQL 17, Redis 7.4, pgsty/silo (MinIO S3), and Qdrant v1.20 via Docker Compose v5,
# waits for container readiness, and runs schema migrations + deterministic dev seeding.

set -eu

COMPOSE_FILE="infra/compose/docker-compose.yml"
ENV_FILE="infra/compose/.env.compose.example"

echo "==> [Kartik.ai] Checking Docker Compose availability..."
docker compose version >/dev/null 2>&1 || {
  echo "ERROR: 'docker compose' plugin is required (Docker Compose v5+)." >&2
  exit 1
}

echo "==> [Kartik.ai] Starting local dependency stack ($COMPOSE_FILE)..."
docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --wait

echo "==> [Kartik.ai] Applying dry-run / schema verification and dev seed manifest..."
node scripts/migrate.mjs
node scripts/seed-dev-data.mjs

echo "==> [Kartik.ai] Local dependency stack is healthy and ready."
echo "    To start the local HTTP API Gateway stack on :8000, run:"
echo "      node scripts/start-local-stack.mjs"
