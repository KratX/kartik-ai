# ADR 0005 — Cloud-Sandbox & Zero-Conflict Dependency Strategy (Profile C)

- **Date:** 2026-11-10
- **Status:** Approved (Owner directive: "make everything compatible, you are first priority")
- **Edition:** Blueprint v4.4

## Context

Earlier build sessions failed because the Blueprint v4.3 toolchain assumptions (`pnpm@12.18.0` enforced via a `preinstall` `process.exit(1)` hook, `engine-strict=true` requiring Node 24/26, 7 nested workspace `package.json` files, and heavy external test/crypto packages) collided with the Cloud Run / AI Studio container environment, which runs Node 22, manages dependencies through a single root `package.json`, exposes a single port (3000), and has no Docker daemon.

## Options Considered

1. **Keep strict pnpm + multi-package manifests:** Fails immediately on `npm install` or container rebuilds in the cloud sandbox.
2. **Abandon the Kartik.ai service boundaries:** Avoids crashes but loses the educational and architectural value of the Gateway, Auth, Chat, Agent, and Billing separation.
3. **Single-Root Manifest + Built-In Node 22 Primitives + Path-Aliased Service Boundaries (Profile C):** Keep one root `package.json`, map `@kartik/shared/*` via `tsconfig.json` and `vite.config.ts`, use built-in `node:test`, `node:assert/strict`, `node:crypto`, and native `fetch` before adding external packages, and run in-memory / cloud-compatible adapters when Docker is absent.

## Decision

We adopt **Option 3 (Profile C — Cloud Sandbox Compatibility)**.

1. **Zero Lockfile Traps:** No `preinstall` script may call `process.exit(1)` on `npm` or `bun`, and `engines.node` is set to `>=22.0.0` so both Node 22 (Cloud Sandbox) and Node 26 (Local Host / Profile P) pass cleanly.
2. **Built-In First:**
   - Unit & contract testing uses **`node:test`** + **`node:assert/strict`** executed via `tsx --test`.
   - Ed25519 user-context assertions, HMAC-SHA256 webhook verification, and constant-time credential checks use **`node:crypto`**.
   - HTTP calls use native **`fetch`**.
3. **Single Root `package.json`:** All modules (`backend/shared`, `backend/gateway`, `backend/services/*`, `src/*`) share the root `package.json` and resolve `@kartik/shared/*` through TypeScript and Vite aliases.

## Consequences

- **Positive:** Zero `ERESOLVE`, native-build, or lockfile crashes; millisecond unit test execution; 100% preservation of Kartik.ai's architectural contracts (run identity, Ed25519 assertions, 19 error codes, Redis key TTLs, and append-only ledger invariants).
- **Negative:** When deploying to the standalone multi-container Docker setup on Oracle ARM (Profile P), the Dockerfile either builds from the unified root manifest or runs `scripts/check-toolchain.mjs` in host mode.
