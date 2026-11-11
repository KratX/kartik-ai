/**
 * @file backend/services/auth/tests/session-service.test.ts
 * @description Focused unit tests for @kartik/auth Redis session lifecycle,
 * sliding 7-day TTL, immediate logout revocation, and HttpOnly cookie helpers (2.3.a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AppError, REDIS_TTL_SECONDS } from '@kartik/shared';
import {
  extractSessionIdFromCookieHeader,
  generateOpaqueSessionId,
  InMemorySessionStore,
  RedisHashSessionStore,
  serializeClearSessionCookie,
  serializeSessionCookie,
  SessionService,
  type RedisHashClientLike,
} from '../src/index.js';

describe('@kartik/auth opaque Redis session service & HttpOnly cookies (2.3.a)', () => {
  it('creates a 256-bit opaque session under sess:{sessionId} with a 7-day TTL (ADR 0002 & §5.2)', async () => {
    const startMs = Date.parse('2026-11-11T10:00:00.000Z');
    const store = new InMemorySessionStore(() => startMs);
    const service = new SessionService({
      store,
      nowFn: () => startMs,
    });

    const session = await service.createSession({
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'kartik@example.com',
      displayName: 'Kartik Rawat',
      avatarUrl: 'https://example.com/avatar.png',
    });

    assert.equal(session.sessionId.length, 43);
    assert.match(session.sessionId, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(session.userId, '550e8400-e29b-41d4-a716-446655440000');
    assert.equal(session.createdAt, '2026-11-11T10:00:00.000Z');
    assert.equal(
      session.expiresAt,
      new Date(startMs + REDIS_TTL_SECONDS.SESSION_SLIDING * 1000).toISOString(),
    );

    const activeKeys = store.listActiveKeys();
    assert.deepEqual(activeKeys, [`sess:${session.sessionId}`]);
  });

  it('refreshes the sliding 7-day TTL on introspectSession and rejects expired sessions with 401 UNAUTHENTICATED', async () => {
    let currentMs = Date.parse('2026-11-11T10:00:00.000Z');
    const store = new InMemorySessionStore(() => currentMs);
    const service = new SessionService({
      store,
      nowFn: () => currentMs,
    });

    const created = await service.createSession({
      id: '550e8400-e29b-41d4-a716-446655440001',
      email: 'alice@example.com',
      displayName: 'Alice',
      avatarUrl: null,
    });

    // Advance clock by 2 days: session is still valid and sliding refresh extends expiresAt by 7 days from now.
    currentMs += 2 * 24 * 60 * 60 * 1000;
    const refreshed = await service.introspectSession(created.sessionId);
    assert.equal(refreshed.lastSeenAt, new Date(currentMs).toISOString());
    assert.equal(
      refreshed.expiresAt,
      new Date(currentMs + REDIS_TTL_SECONDS.SESSION_SLIDING * 1000).toISOString(),
    );

    // Advance clock by 7 days + 1 second without activity: session must expire and throw 401 UNAUTHENTICATED.
    currentMs += REDIS_TTL_SECONDS.SESSION_SLIDING * 1000 + 1000;
    await assert.rejects(
      () => service.introspectSession(created.sessionId),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'UNAUTHENTICATED');
        assert.equal(err.httpStatus, 401);
        return true;
      },
    );
  });

  it('revokes sessions immediately on logout and persists fields via RedisHashSessionStore (ADR 0002)', async () => {
    const hashBacking = new Map<string, { fields: Record<string, string>; ttl: number }>();
    const fakeRedisClient: RedisHashClientLike = {
      async hGetAll(key: string) {
        return hashBacking.get(key)?.fields ?? {};
      },
      async hSet(key: string, fields: Record<string, string>) {
        const existing = hashBacking.get(key);
        hashBacking.set(key, { fields: { ...fields }, ttl: existing?.ttl ?? -1 });
        return Object.keys(fields).length;
      },
      async expire(key: string, ttlSeconds: number) {
        const existing = hashBacking.get(key);
        if (!existing) return 0;
        existing.ttl = ttlSeconds;
        return 1;
      },
      async del(key: string) {
        return hashBacking.delete(key) ? 1 : 0;
      },
    };

    const redisStore = new RedisHashSessionStore(fakeRedisClient);
    const service = new SessionService({ store: redisStore });

    const created = await service.createSession({
      id: '550e8400-e29b-41d4-a716-446655440002',
      email: 'bob@example.com',
      displayName: 'Bob',
      avatarUrl: null,
    });

    const redisEntry = hashBacking.get(`sess:${created.sessionId}`);
    assert.ok(redisEntry);
    assert.equal(redisEntry.ttl, REDIS_TTL_SECONDS.SESSION_SLIDING);
    assert.equal(redisEntry.fields.userId, '550e8400-e29b-41d4-a716-446655440002');

    // Immediate revocation deletes the Redis key and causes subsequent introspection to fail with 401 UNAUTHENTICATED
    const revoked = await service.revokeSession(created.sessionId);
    assert.equal(revoked, true);
    assert.equal(hashBacking.has(`sess:${created.sessionId}`), false);

    await assert.rejects(
      () => service.introspectSession(created.sessionId),
      (err: unknown) => err instanceof AppError && err.code === 'UNAUTHENTICATED',
    );
  });

  it('serializes HttpOnly session & clear cookies and extracts sessionId from Cookie headers (§11)', () => {
    const sessionId = generateOpaqueSessionId();
    const cookieConfig = {
      SESSION_COOKIE_NAME: 'kartik_session',
      COOKIE_SECURE: true,
      COOKIE_SAME_SITE: 'lax' as const,
      SESSION_TTL_SECONDS: 604800,
    };

    const setCookieHeader = serializeSessionCookie(sessionId, cookieConfig);
    assert.equal(
      setCookieHeader,
      `kartik_session=${sessionId}; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax; Secure`,
    );

    const clearCookieHeader = serializeClearSessionCookie(cookieConfig);
    assert.match(
      clearCookieHeader,
      /^kartik_session=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=\/; HttpOnly; SameSite=Lax; Secure$/,
    );

    const parsed = extractSessionIdFromCookieHeader(
      `theme=dark; kartik_session=${sessionId}; locale=en-IN`,
      'kartik_session',
    );
    assert.equal(parsed, sessionId);
    assert.equal(extractSessionIdFromCookieHeader(undefined, 'kartik_session'), null);
  });
});
