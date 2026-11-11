# Kartik.ai Build State

- Current phase: Phase 3 — API Gateway (`@kartik/gateway`)
- Current blueprint item: 3.1 — Gateway config, composite build/test wiring, Ed25519 signing key validation & upstream service directory (`backend/gateway/src/config/index.ts`)
- Current micro-step: 3.1.a — wire `backend/gateway/package.json` & `tsconfig.json` (`tsc -b`), implement `loadGatewayConfig`, `parseCorsAllowedOrigins`, and `resolveUpstreamServiceUrl` (`backend/gateway/src/config/index.ts`), and verify with `backend/gateway/tests/gateway-config.test.ts`
- Status: verification pending on owner's host
- Last completed micro-step: 3.1.a — implemented `@kartik/gateway` config & upstream service directory (`4/4` Gateway tests passing; `49/49` total workspace tests passing across 14 suites)
- Next micro-step: 3.2.a — implement the Gateway session-introspection client (`POST /internal/sessions/introspect` on Auth), audience-scoped Ed25519 `x-user-context` assertion minting (`aud: 'chat' | 'agent' | 'billing'`), cookie stripping, and upstream proxy client (`backend/gateway/src/middleware/index.ts` & `backend/gateway/src/proxy/index.ts`) + unit tests
- Current branch: `main`
- Last known commit: `2.4.a` (Phase 2 complete)

## Current objective
Implement `backend/gateway/src/config/index.ts` (Blueprint §2.1, §6.1–§6.4, §11, §12 & Invariant #1): fail-fast Gateway startup configuration validating the Ed25519 `USER_CONTEXT_SIGNING_KEY` (PEM or base64), rejecting wildcard `*` in `CORS_ALLOWED_ORIGINS` when `HttpOnly` cookies are active, and resolving upstream base URLs for `auth`, `chat`, `agent`, and `billing`.

## Completed work
- **Phase 0:** Monorepo baseline, ADRs 0000–0005, Compose v5 stack (4/4 healthy on host), CI workflow.
- **Phase 1 (`@kartik/shared` — 9 suites / 29 tests PASS):** `config`, `errors`, `logger`, `redis`, `auth`, `contracts`, `validation`, `database`, `storage`, `middleware`.
- **Phase 2 (`@kartik/auth` — 4 suites / 16 tests PASS — Exit Gate Complete):** `config`, `models`, `repositories`, `firebase-verifier`, `session-service`, `middleware`, `controllers`, `routes`.
- **Phase 3 / Micro-step 3.1.a (`@kartik/gateway`):**
  - Wired `backend/gateway/package.json` and `backend/gateway/tsconfig.json` with composite `tsc -b` build, typecheck, lint, and `node:test`.
  - Created `backend/gateway/src/config/index.ts` (`GATEWAY_CONFIG_SCHEMA`, `loadGatewayConfig`, `parseCorsAllowedOrigins`, `resolveUpstreamServiceUrl`) and `backend/gateway/src/index.ts`.
  - Created `backend/gateway/tests/gateway-config.test.ts` (`4/4` tests passing).

## Changed files
- `backend/gateway/package.json` — wired `build`, `typecheck`, `lint` (`tsc -b`), and `test` (`tsc -b --force && node --test "./dist/tests/*.test.js"`)
- `backend/gateway/tsconfig.json` — composite project reference to `../shared` and `tests/**/*.ts` inclusion
- `backend/gateway/src/config/index.ts` — Gateway config validator, Ed25519 key check, CORS allowlist parser, and service directory
- `backend/gateway/src/index.ts` — package barrel export
- `backend/gateway/tests/gateway-config.test.ts` — 4 unit tests for Gateway config
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md,PHASE_CHECKLIST.md}` — updated records for `3.1.a`

## Verification evidence
- `npm test` (`tsc -b` + `node --test`) — PASS — 14 suites, 49 tests passing (29 in `@kartik/shared` + 16 in `@kartik/auth` + 4 in `@kartik/gateway`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-3.1.a.zip`, extract into your repo root, run `pnpm --filter @kartik/gateway test` (`4/4` tests), and reply **"continue"** for Micro-step `3.2.a` (Session cookie introspection client, Ed25519 `x-user-context` assertion minting, cookie stripping, and upstream proxy adapter).

## Safe resume instruction
Micro-step `3.1.a` is complete. Proceed to **micro-step `3.2.a`**: implement `backend/gateway/src/middleware/index.ts` and `backend/gateway/src/proxy/index.ts` with unit tests in `backend/gateway/tests/gateway-proxy.test.ts`.
