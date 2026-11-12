# Kartik.ai Learning Log

---

## Entry 31 — Phase 8 / Step 8.4 (Micro-step 8.4.a): Live `node:http` Server Adapter (`createManagedHttpServer`), Raw-Body Stream Buffering & Graceful Shutdown

### 1. Concept learned
- **Why Raw Stream Buffering Before `JSON.parse` Is Mandatory for Webhooks (`Blueprint §11`):**
  - If an HTTP server parses JSON first and re-serializes it with `JSON.stringify(body)` to verify a webhook signature, any key reordering or whitespace difference changes the HMAC-SHA256 digest and breaks legitimate Razorpay webhooks.
  - `createManagedHttpServer` reads the incoming Node stream once into a `Buffer` (enforcing `maxBodyBytes`), preserves the exact `rawBodyString`, and passes both `rawBody` and parsed `body` into `router.execute()`.
- **Graceful Shutdown (`Blueprint §8.3`):**
  - Calling `managed.close()` immediately marks `isShuttingDown = true` (rejecting new arrivals with `503`), waits for `server.close()` to drain in-flight requests, and invokes `onShutdown()` to close PostgreSQL pools and Redis connections cleanly.

### 2. What was implemented
- `backend/gateway/src/server/index.ts` (`createManagedHttpServer`)
- `backend/gateway/src/index.ts` (exported `createManagedHttpServer`)
- `backend/gateway/tests/http-server.test.ts` (2 live TCP socket tests)
- `README.md` (updated status from Phase 0 to All Phases 0–8 Complete)

### 3. How to inspect the feature
- Run `pnpm test` (`34` suites, `126` tests passing).
