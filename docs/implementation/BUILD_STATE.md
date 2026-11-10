# Kartik.ai Build State

- Current phase: Phase 1 — Shared libraries (`@kartik/shared`)
- Current blueprint item: 1.1 — TypeScript compiler & test runner wiring in `@kartik/shared`
- Current micro-step: 1.1.b — wire zero-dependency `node:test` + `node:assert/strict` unit test runner in `@kartik/shared` (replacing `vitest` per ADR 0005)
- Status: verification pending on owner's host
- Last completed micro-step: 1.1.b — wired `"test": "tsc -b && node --test ./dist/tests/*.test.js"` in `backend/shared/package.json`, added `"tests/**/*.ts"` to `backend/shared/tsconfig.json`, and created `backend/shared/tests/index.test.ts`
- Next micro-step: 1.2.a — implement `backend/shared/errors` (`AppError`, the 19-code error union from Blueprint §5.5, and standard response envelope helpers)
- Current branch: `main` (synced with `https://github.com/KratX/kartik-ai` commit `dd34e0a`)
- Last known commit: `dd34e0a813cfc604b60afde5c8afadc71909de36`

## Current objective
Wire the unit test runner in `@kartik/shared` (Micro-step `1.1.b`) using Node's built-in `node:test` and `node:assert/strict` against `tsc -b` output so zero external test packages (`vitest`) need to be installed and zero dependency/lockfile conflicts can occur.

## Completed work
- Synced repository state with `https://github.com/KratX/kartik-ai` (`dd34e0a`).
- Preserved `1.1.a` (`backend/shared/index.ts` exporting `SHARED_PACKAGE_NAME` and `SHARED_PACKAGE_VERSION`).
- **Micro-step 1.1.b:**
  - Updated `backend/shared/package.json`: replaced placeholder `"test": "node -e \"process.exit(0)\""` with `"test": "tsc -b && node --test ./dist/tests/*.test.js"`.
  - Updated `backend/shared/tsconfig.json`: added `"tests/**/*.ts"` to `"include"` so `tsc -b` compiles tests with full `NodeNext` type checking into `dist/tests/*.test.js`.
  - Created `backend/shared/tests/index.test.ts`: verifies `SHARED_PACKAGE_NAME` and `SHARED_PACKAGE_VERSION` using `node:test` and `node:assert/strict`.
  - Recorded **ADR 0005** (`docs/decisions/0005-cloud-sandbox-dependency-strategy.md`) explaining why built-in `node:test` replaces `vitest`.

## Changed files
- `backend/shared/package.json` — wired `"test": "tsc -b && node --test ./dist/tests/*.test.js"`
- `backend/shared/tsconfig.json` — added `"tests/**/*.ts"` to `include`
- `backend/shared/tests/index.test.ts` — first unit test in `@kartik/shared`
- `docs/decisions/0005-cloud-sandbox-dependency-strategy.md` — recorded zero-conflict `node:test` decision
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md}` — updated records for `1.1.b`

## Verification evidence
- `npm test` (`tsc -b backend/shared/tsconfig.json && node --test backend/shared/dist/tests/*.test.js`) — PASS — 1 suite, 1 test passing (`@kartik/shared barrel baseline (1.1.b)`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None. Zero new packages were added to `package.json` or `pnpm-lock.yaml`, completely avoiding the `vitest` install crash.

## Decisions requiring owner approval
- None blocking; once you review `1.1.b` (and optionally run `pnpm --filter @kartik/shared test` on your Windows 10 host), reply **"continue"** to proceed to `1.2.a`.

## Safe resume instruction
Micro-step `1.1.b` is complete. Proceed to **micro-step `1.2.a`**: implement `backend/shared/errors` (`AppError` and the 19 normative error codes from Blueprint §5.5) with its unit test in `backend/shared/tests/`.
