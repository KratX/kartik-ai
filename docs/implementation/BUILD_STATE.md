# Kartik.ai Build State

- Current phase: Phase 1 — Shared libraries (`@kartik/shared`)
- Current blueprint item: 1.5 — Scoped Redis key builders & TTL contract (`backend/shared/redis`)
- Current micro-step: 1.5.a — implement `backend/shared/redis` (`RedisKeys`, `REDIS_TTL_SECONDS`, PII/JWT key guard) and unit tests in `backend/shared/tests/redis.test.ts`
- Status: verification pending on owner's host
- Last completed micro-step: 1.5.a — implemented all 7 normative Redis key builders (`sess:*`, `rl:*`, `rl:ip:*`, `idem:*`, `lock:cleanup:*`, `lock:settle:*`, `quota:*`) in `backend/shared/redis/index.ts`, re-exported from `backend/shared/index.ts`, and verified the Phase 1 Redis key builder exit gate in `backend/shared/tests/redis.test.ts`
- Next micro-step: 1.6.a — implement `backend/shared/auth` (Ed25519 user-context assertion sign/verify with `aud` + 5s clock-skew check and constant-time per-caller credential verification from Blueprint §6.3 & §6.4)
- Current branch: `main`
- Last known commit: `1.4.a` completed

## Current objective
Implement `backend/shared/redis` key builders (Blueprint §5.2 & Phase 1 Exit Gate): all 7 Redis key patterns with explicit TTLs (including the 24h chat vs 30d money idempotency retention split from §5.4) and strict rejection of emails, raw tokens, colons, or whitespace inside key segments.

## Completed work
- **Micro-step 1.1.a & 1.1.b:** TypeScript 7 (`tsc -b --force`) + zero-dependency `node:test` runner verified on host.
- **Micro-step 1.2.a:** `backend/shared/config` (`loadConfig`, `ConfigValidationError`, `redactConfig`, `SHARED_INFRA_CONFIG_SCHEMA`) verified on host.
- **Micro-step 1.3.a:** `backend/shared/errors` (`ERROR_CATALOGUE` 19 codes, `AppError`, `createSuccessEnvelope`, `mapErrorToHttpResponse`) verified on host.
- **Micro-step 1.4.a:** `backend/shared/logger` (`createLogger`, `redactLogValue`, child bindings, Gate G9 redaction) completed.
- **Micro-step 1.5.a:**
  - Created `backend/shared/redis/index.ts`: `RedisKeys` (`session`, `userRateLimit`, `ipRateLimit`, `idempotency`, `cleanupLock`, `settleLock`, `dailyQuota`), `REDIS_TTL_SECONDS`, and `assertSafeKeySegment`.
  - Re-exported `./redis/index.js` from `backend/shared/index.ts`.
  - Created `backend/shared/tests/redis.test.ts`: 3 unit tests covering all 7 key shapes/types/TTLs, IPv6 colon normalization, and rejection of emails/JWTs/injected colons (Phase 1 Exit Gate).

## Changed files
- `backend/shared/redis/index.ts` — 7 normative Redis key builders and TTL constants (§5.2)
- `backend/shared/index.ts` — re-exported `./redis/index.js`
- `backend/shared/tests/redis.test.ts` — 3 unit tests for `@kartik/shared/redis`
- `docs/implementation/{BUILD_STATE.md,TEST_EVIDENCE.md,LEARNING_LOG.md}` — updated records for `1.5.a`

## Verification evidence
- `npm test` (`tsc -b --force && node --test "./dist/tests/*.test.js"`) — PASS — 5 suites, 13 tests passing (`index.test.js`, `config.test.js`, `errors.test.js`, `logger.test.js`, `redis.test.js`).
- `npm run lint` (`tsc --noEmit`) — PASS — 0 TypeScript errors.

## Open issues / blockers
- None.

## Decisions requiring owner approval
- None blocking; download `step-1.5.a.zip`, run `pnpm --filter @kartik/shared test` (`13/13` tests), and reply **"continue"** for Micro-step `1.6.a` (`backend/shared/auth`).

## Safe resume instruction
Micro-step `1.5.a` is complete. Proceed to **micro-step `1.6.a`**: implement `backend/shared/auth` (Ed25519 user-context assertion sign/verify and constant-time per-caller credential comparison from Blueprint §6.3 & §6.4) with Contract Test T14 in `backend/shared/tests/auth.test.ts`.
