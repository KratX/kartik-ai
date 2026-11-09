#!/usr/bin/env node
/**
 * Phase 0 placeholder. Later phases replace this with a real validator that
 * reads .env.example, checks every required key is present, and reports missing
 * variables with a readable message before any service starts.
 */
// Pooled URL for the application, direct URL for migrations (ADR 0004).
// The schema is not in the URL — the login role's grant decides that.
const REQUIRED = ['NODE_ENV', 'DATABASE_URL', 'DATABASE_SCHEMA', 'REDIS_URL'];

const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('Environment looks complete (placeholder check).');
