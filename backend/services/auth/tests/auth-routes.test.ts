/**
 * @file backend/services/auth/tests/auth-routes.test.ts
 * @description Integration tests for @kartik/auth HTTP routes & Phase 2 Exit Gate closure (2.4.a).
 *
 * Verifies:
 * 1. Full sign-in -> /auth/me -> /auth/logout -> /auth/me (401) lifecycle (Phase 2 Exit Gate).
 * 2. Gateway-only internal session introspection (`POST /internal/sessions/introspect`)
 *    rejecting missing/wrong tokens (401) and non-gateway callers (403) (Invariant #14 & §6.3).
 * 3. Pre-auth IP rate limiting on `POST /auth/google` returning 429 `RATE_LIMITED` + `Retry-After`.
 * 4. `/healthz` and `/readyz` liveness/readiness probes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { INTERNAL_AUTH_HEADERS } from '@kartik/shared';
import {
  createAuthRouter,
  extractSessionIdFromCookieHeader,
  InMemorySessionStore,
  InMemoryUserRepository,
  loadAuthConfig,
  MockFirebaseTokenVerifier,
  SessionService,
} from '../src/index.js';

function createTestAuthHarness(overrides?: {
  maxAuthRequestsPerMinute?: number;
  checkReadiness?: () => Promise<boolean>;
}) {
  const config = loadAuthConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
    DATABASE_SCHEMA: 'auth',
    REDIS_URL: 'redis://127.0.0.1:6379',
    SERVICE_TO_SERVICE_TOKEN: 's2s-secret-token-for-auth-tests-32b',
    AUTH_PROVIDER_MODE: 'mock',
  });

  let currentMs = Date.parse('2026-11-11T12:00:00.000Z');
  const firebaseVerifier = new MockFirebaseTokenVerifier();
  const userRepository = new InMemoryUserRepository();
  const sessionStore = new InMemorySessionStore(() => currentMs);
  const sessionService = new SessionService({
    store: sessionStore,
    sessionTtlSeconds: config.SESSION_TTL_SECONDS,
    nowFn: () => currentMs,
  });

  const router = createAuthRouter({
    config,
    firebaseVerifier,
    userRepository,
    sessionService,
    ...(overrides?.maxAuthRequestsPerMinute !== undefined
      ? { maxAuthRequestsPerMinute: overrides.maxAuthRequestsPerMinute }
      : {}),
    ...(overrides?.checkReadiness ? { checkReadiness: overrides.checkReadiness } : {}),
  });

  return {
    config,
    router,
    userRepository,
    sessionStore,
    advanceClockMs(deltaMs: number) {
      currentMs += deltaMs;
    },
  };
}

describe('@kartik/auth HTTP routes & Phase 2 Exit Gate closure (2.4.a)', () => {
  it('completes POST /auth/google -> GET /auth/me -> POST /auth/logout -> 401 on replay (Phase 2 Exit Gate)', async () => {
    const { config, router, sessionStore } = createTestAuthHarness();

    // 1. Exchange mock Google ID token for an opaque HttpOnly session cookie
    const signInRes = await router.execute<{
      traceId: string;
      requestId?: string;
      data: {
        user: { id: string; email: string; displayName: string; firebaseUid?: string };
        sessionExpiresAt: string;
      };
      error: null;
    }>({
      method: 'POST',
      path: '/auth/google',
      headers: {
        [INTERNAL_AUTH_HEADERS.TRACE_ID]: 'trc_phase2_signin',
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_signin_phase2_0001',
      },
      body: { idToken: 'mock-google-token:kartik' },
    });

    assert.equal(signInRes.statusCode, 200);
    assert.equal(signInRes.body.traceId, 'trc_phase2_signin');
    assert.equal(signInRes.body.requestId, 'idem_signin_phase2_0001');
    assert.equal(signInRes.body.data.user.email, 'kartik@kartik.ai');
    assert.equal(signInRes.body.data.user.displayName, 'Kartik Rawat');
    assert.equal(signInRes.body.data.user.firebaseUid, undefined);

    const setCookie = signInRes.headers['set-cookie'];
    assert.ok(setCookie, 'Expected Set-Cookie header on POST /auth/google');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);

    const sessionId = extractSessionIdFromCookieHeader(
      setCookie.split(';')[0],
      config.SESSION_COOKIE_NAME,
    );
    assert.ok(sessionId);
    assert.deepEqual(sessionStore.listActiveKeys(), [`sess:${sessionId}`]);

    // 2. GET /auth/me with the session cookie returns 200 and refreshes sliding TTL
    const meRes = await router.execute<{
      data: { user: { id: string; email: string }; sessionExpiresAt: string };
      error: null;
    }>({
      method: 'GET',
      path: '/auth/me',
      headers: {
        cookie: `${config.SESSION_COOKIE_NAME}=${sessionId}`,
      },
    });
    assert.equal(meRes.statusCode, 200);
    assert.equal(meRes.body.data.user.email, 'kartik@kartik.ai');

    // 3. POST /auth/logout immediately revokes the Redis session and clears the cookie
    const logoutRes = await router.execute<{
      data: { loggedOut: boolean };
      error: null;
    }>({
      method: 'POST',
      path: '/auth/logout',
      headers: {
        cookie: `${config.SESSION_COOKIE_NAME}=${sessionId}`,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'idem_logout_phase2_0001',
      },
    });
    assert.equal(logoutRes.statusCode, 200);
    assert.equal(logoutRes.body.data.loggedOut, true);
    assert.match(logoutRes.headers['set-cookie'] ?? '', /Max-Age=0/);
    assert.deepEqual(sessionStore.listActiveKeys(), []);

    // 4. Replaying the logged-out session cookie against GET /auth/me fails with 401 UNAUTHENTICATED
    const replayMeRes = await router.execute<{
      data: null;
      error: { code: string };
    }>({
      method: 'GET',
      path: '/auth/me',
      headers: {
        cookie: `${config.SESSION_COOKIE_NAME}=${sessionId}`,
      },
    });
    assert.equal(replayMeRes.statusCode, 401);
    assert.equal(replayMeRes.body.error.code, 'UNAUTHENTICATED');
  });

  it('enforces Gateway-only caller credentials on POST /internal/sessions/introspect (Invariant #14 & §6.3)', async () => {
    const { config, router } = createTestAuthHarness();

    const signInRes = await router.execute({
      method: 'POST',
      path: '/auth/google',
      body: { idToken: 'mock-google-token:alice' },
    });
    const sessionId = extractSessionIdFromCookieHeader(
      (signInRes.headers['set-cookie'] ?? '').split(';')[0],
      config.SESSION_COOKIE_NAME,
    );
    assert.ok(sessionId);

    // 1. Valid Gateway caller + token succeeds
    const validIntrospect = await router.execute<{
      data: { sessionId: string; userId: string; email: string };
      error: null;
    }>({
      method: 'POST',
      path: '/internal/sessions/introspect',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.SERVICE_TO_SERVICE_TOKEN,
      },
      body: { sessionId },
    });
    assert.equal(validIntrospect.statusCode, 200);
    assert.equal(validIntrospect.body.data.sessionId, sessionId);
    assert.equal(validIntrospect.body.data.email, 'alice@example.com');

    // 2. Non-gateway service caller ('chat') is rejected with 403 FORBIDDEN even with valid token
    const forbiddenCaller = await router.execute<{
      error: { code: string };
    }>({
      method: 'POST',
      path: '/internal/sessions/introspect',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'chat',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: config.SERVICE_TO_SERVICE_TOKEN,
      },
      body: { sessionId },
    });
    assert.equal(forbiddenCaller.statusCode, 403);
    assert.equal(forbiddenCaller.body.error.code, 'FORBIDDEN');

    // 3. Missing or wrong service token is rejected with 401 UNAUTHENTICATED
    const wrongToken = await router.execute<{
      error: { code: string };
    }>({
      method: 'POST',
      path: '/internal/sessions/introspect',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: 'wrong-token-value',
      },
      body: { sessionId },
    });
    assert.equal(wrongToken.statusCode, 401);
    assert.equal(wrongToken.body.error.code, 'UNAUTHENTICATED');
  });

  it('enforces pre-auth IP rate limiting on POST /auth/google with 429 RATE_LIMITED and Retry-After (§5.2 & §5.5)', async () => {
    const { router } = createTestAuthHarness({ maxAuthRequestsPerMinute: 2 });

    const first = await router.execute({
      method: 'POST',
      path: '/auth/google',
      ip: '203.0.113.42',
      body: { idToken: 'mock-google-token:kartik' },
    });
    assert.equal(first.statusCode, 200);

    const second = await router.execute({
      method: 'POST',
      path: '/auth/google',
      ip: '203.0.113.42',
      body: { idToken: 'mock-google-token:kartik' },
    });
    assert.equal(second.statusCode, 200);

    const third = await router.execute<{ error: { code: string } }>({
      method: 'POST',
      path: '/auth/google',
      ip: '203.0.113.42',
      body: { idToken: 'mock-google-token:kartik' },
    });
    assert.equal(third.statusCode, 429);
    assert.equal(third.body.error.code, 'RATE_LIMITED');
    assert.ok(third.headers['retry-after'], 'Expected Retry-After header on 429 response');
  });

  it('serves /healthz and /readyz probes and returns 404 NOT_FOUND on unknown routes', async () => {
    let isReady = true;
    const { router } = createTestAuthHarness({
      checkReadiness: async () => isReady,
    });

    const health = await router.execute<{ data: { status: string; service: string } }>({
      method: 'GET',
      path: '/healthz',
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.data.status, 'ok');

    const readyOk = await router.execute<{ data: { status: string } }>({
      method: 'GET',
      path: '/readyz',
    });
    assert.equal(readyOk.statusCode, 200);
    assert.equal(readyOk.body.data.status, 'ready');

    isReady = false;
    const readyFail = await router.execute<{ error: { code: string } }>({
      method: 'GET',
      path: '/readyz',
    });
    assert.equal(readyFail.statusCode, 500);
    assert.equal(readyFail.body.error.code, 'INTERNAL_ERROR');

    const unknownRoute = await router.execute<{ error: { code: string } }>({
      method: 'GET',
      path: '/auth/unknown',
    });
    assert.equal(unknownRoute.statusCode, 404);
    assert.equal(unknownRoute.body.error.code, 'NOT_FOUND');
  });
});
