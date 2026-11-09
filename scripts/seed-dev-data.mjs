#!/usr/bin/env node
/**
 * Local development seed script — Blueprint §4.1 & §5.1.
 *
 * Phase 0 stub: once Phase 1's `backend/shared/database` migration runner is
 * active, this script idempotently seeds the local `billing.pricing_versions`,
 * `billing.plans` (`free` plan), and demo fixtures for local development.
 */

const dbUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

if (!dbUrl) {
  console.error(
    'Missing DIRECT_DATABASE_URL or DATABASE_URL. Start the local stack (`docker compose -f infra/compose/docker-compose.yml up -d`) and configure `.env` first.'
  );
  process.exit(1);
}

console.log(
  'Seed script stub ready (Phase 0). Phase 1+ wires idempotent local seed data for billing plans and demo fixtures.'
);
