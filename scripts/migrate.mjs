#!/usr/bin/env node
/**
 * Database migration entrypoint — Blueprint §4.1 & ADR 0004.
 *
 * Phase 0 stub: validates that DIRECT_DATABASE_URL (or DATABASE_URL for local
 * unpooled Postgres) is set before Phase 1's `backend/shared/database` migration
 * runner is wired in to apply the four schemas (`auth`, `chat`, `agent`, `billing`)
 * and their least-privilege service roles in order.
 */

const directUrl = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;

if (!directUrl) {
  console.error(
    'Missing DIRECT_DATABASE_URL (or DATABASE_URL for local Postgres). Migrations require a direct, unpooled connection — see Blueprint §6.2 and ADR 0004.'
  );
  process.exit(1);
}

console.log(
  'Migration runner stub ready (Phase 0). Phase 1 wires backend/shared/database to apply the auth, chat, agent, and billing schemas.'
);
