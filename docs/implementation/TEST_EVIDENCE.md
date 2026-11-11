# Kartik.ai Test Evidence Log

Chronological record of test commands and real execution results across micro-steps.

| Date (UTC) | Phase / Step | Environment | Suite / Command | Result | Summary / Notes | Executed By |
|---|---|---|---|---|---|---|
| 2026-11-09 | Phase 0 (0.1–0.6) | Linux / Node v22.23.2 | `node scripts/check-toolchain.mjs` | **PASS** | Validated repo baseline, ADRs, OpenAPI & workflows | AI + Owner |
| 2026-11-11 | Phase 1 (1.1.a–1.9.a) | Linux / Node v22.23.2 | `npm test` (`@kartik/shared`) | **PASS** | `9` suites, `29` tests passing (`0` failures) — Phase 1 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 2 (2.1.a–2.4.a) | Linux / Node v22.23.2 | `npm test` (`@kartik/shared` + `@kartik/auth`) | **PASS** | `13` suites, `45` tests passing (`16/16` in `@kartik/auth`) — Phase 2 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 3 (3.1.a–3.3.a) | Linux / Node v22.23.2 | `npm test` (`@kartik/shared` + `@kartik/auth` + `@kartik/gateway`) | **PASS** | `16` suites, `57` tests passing (`12/12` in `@kartik/gateway`) — Phase 3 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 4 (4.1.a–4.4.a) | Linux / Node v22.23.2 | `pnpm test` (`@kartik/billing`) | **PASS** | `20` suites, `73` tests passing (`16/16` in `@kartik/billing`) — Phase 4 Exit Gate passed | AI + Owner |
| 2026-11-11 | Phase 5 / `5.1.a` | Linux / Node v22.23.2 | `pnpm test` (`@kartik/agent` foundation) | **PASS** | `21` suites, `77` tests passing (`4/4` in `agent-foundation.test.ts`) | AI + Owner |
| 2026-11-11 | Phase 5 / `5.2.a` | Linux / Node v22.23.2 | `pnpm test` (`@kartik/agent` graph & budget guard) | **PASS** | `22` suites, `81` tests passing (`4/4` in `agent-graph.test.ts`) | AI + Owner |
| 2026-11-11 | Phase 5 / `5.3.a` | Linux / Node v22.23.2 | `pnpm test` (`@kartik/agent` ingestion & cascade purge) | **PASS** | `23` suites, `85` tests passing (`4/4` in `agent-ingestion-purge.test.ts` covering magic bytes, server storage keys, PDF chunking, `404` anti-enumeration signed URLs, and `vectors -> objects -> metadata` purge order) | AI |
