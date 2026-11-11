/**
 * @file backend/services/auth/src/services/session-service.ts
 * @description Opaque Redis-backed session lifecycle and HttpOnly cookie helpers
 * for @kartik/auth (Blueprint §5.2, §11, ADR 0002).
 *
 * Security & architectural invariants enforced:
 * - Sessions use 256-bit CSPRNG opaque IDs (`randomBytes(32).toString('base64url')`),
 *   never self-contained JWTs in browser cookies (ADR 0002).
 * - Redis keys strictly use `RedisKeys.session(sessionId)` (`sess:{sessionId}`)
 *   with a 7-day sliding TTL (`REDIS_TTL_SECONDS.SESSION_SLIDING = 604800`s) (§5.2).
 * - Logout deletes the Redis key immediately so subsequent introspection fails
 *   with 401 `UNAUTHENTICATED`.
 * - Cookie serialization always sets `HttpOnly`, `Path=/`, configured `SameSite`,
 *   and `Secure` in non-local environments (§11).
 */

import { randomBytes } from 'node:crypto';
import {
  AppError,
  REDIS_TTL_SECONDS,
  RedisKeys,
} from '@kartik/shared';
import type { AuthServiceConfig } from '../config/index.js';
import type { AuthUser } from '../models/index.js';

export interface SessionRecord {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export type SessionUserInput = Pick<
  AuthUser,
  'id' | 'email' | 'displayName' | 'avatarUrl'
>;

export interface SessionStore {
  get(redisKey: string): Promise<SessionRecord | null>;
  set(redisKey: string, record: SessionRecord, ttlSeconds: number): Promise<void>;
  del(redisKey: string): Promise<boolean>;
}

/**
 * Minimal Redis client contract for production Redis hash storage.
 * Compatible with `redis` (node-redis) and `ioredis` adapters without
 * coupling business logic to a single library.
 */
export interface RedisHashClientLike {
  hGetAll(key: string): Promise<Record<string, string>>;
  hSet(key: string, fields: Record<string, string>): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<boolean | number>;
  del(key: string): Promise<number>;
}

/**
 * Production Redis hash adapter storing each session at `sess:{sessionId}`
 * with a bounded TTL (`EXPIRE`).
 */
export class RedisHashSessionStore implements SessionStore {
  private readonly redis: RedisHashClientLike;

  constructor(redis: RedisHashClientLike) {
    this.redis = redis;
  }

  async get(redisKey: string): Promise<SessionRecord | null> {
    const raw = await this.redis.hGetAll(redisKey);
    if (!raw || Object.keys(raw).length === 0 || !raw.sessionId || !raw.userId) {
      return null;
    }
    return {
      sessionId: raw.sessionId,
      userId: raw.userId,
      email: raw.email ?? '',
      displayName: raw.displayName ?? '',
      avatarUrl: raw.avatarUrl && raw.avatarUrl.length > 0 ? raw.avatarUrl : null,
      createdAt: raw.createdAt ?? '',
      lastSeenAt: raw.lastSeenAt ?? '',
      expiresAt: raw.expiresAt ?? '',
    };
  }

  async set(redisKey: string, record: SessionRecord, ttlSeconds: number): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new AppError('INTERNAL_ERROR', 'Session TTL must be a positive integer.');
    }
    await this.redis.hSet(redisKey, {
      sessionId: record.sessionId,
      userId: record.userId,
      email: record.email,
      displayName: record.displayName,
      avatarUrl: record.avatarUrl ?? '',
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      expiresAt: record.expiresAt,
    });
    await this.redis.expire(redisKey, ttlSeconds);
  }

  async del(redisKey: string): Promise<boolean> {
    const deleted = await this.redis.del(redisKey);
    return deleted > 0;
  }
}

interface InMemorySessionEntry {
  record: SessionRecord;
  expiresAtMs: number;
}

/**
 * Deterministic in-memory session store for unit tests and local mock mode.
 * Enforces key TTL expiration using an injectable clock (`nowFn`).
 */
export class InMemorySessionStore implements SessionStore {
  private readonly entries = new Map<string, InMemorySessionEntry>();
  private readonly nowFn: () => number;

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  async get(redisKey: string): Promise<SessionRecord | null> {
    const entry = this.entries.get(redisKey);
    if (!entry) {
      return null;
    }
    if (this.nowFn() >= entry.expiresAtMs) {
      this.entries.delete(redisKey);
      return null;
    }
    return { ...entry.record };
  }

  async set(redisKey: string, record: SessionRecord, ttlSeconds: number): Promise<void> {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new AppError('INTERNAL_ERROR', 'Session TTL must be a positive integer.');
    }
    this.entries.set(redisKey, {
      record: { ...record },
      expiresAtMs: this.nowFn() + ttlSeconds * 1000,
    });
  }

  async del(redisKey: string): Promise<boolean> {
    return this.entries.delete(redisKey);
  }

  /**
   * Test inspection helper returning all active Redis keys in the store.
   */
  listActiveKeys(): string[] {
    const now = this.nowFn();
    const active: string[] = [];
    for (const [key, entry] of this.entries.entries()) {
      if (now < entry.expiresAtMs) {
        active.push(key);
      } else {
        this.entries.delete(key);
      }
    }
    return active;
  }
}

/**
 * Generates a 256-bit (32-byte) cryptographically random URL-safe session ID
 * (43 base64url characters, no colons or whitespace).
 */
export function generateOpaqueSessionId(): string {
  return randomBytes(32).toString('base64url');
}

const OPAQUE_SESSION_ID_REGEX = /^[A-Za-z0-9_-]{32,128}$/;

export interface SessionServiceOptions {
  store: SessionStore;
  sessionTtlSeconds?: number;
  nowFn?: () => number;
}

export class SessionService {
  private readonly store: SessionStore;
  private readonly sessionTtlSeconds: number;
  private readonly nowFn: () => number;

  constructor(options: SessionServiceOptions) {
    const ttl = options.sessionTtlSeconds ?? REDIS_TTL_SECONDS.SESSION_SLIDING;
    if (!Number.isInteger(ttl) || ttl <= 0) {
      throw new AppError('INTERNAL_ERROR', 'sessionTtlSeconds must be a positive integer.');
    }
    this.store = options.store;
    this.sessionTtlSeconds = ttl;
    this.nowFn = options.nowFn ?? (() => Date.now());
  }

  /**
   * Creates a new opaque session in Redis for an authenticated user.
   */
  async createSession(user: SessionUserInput): Promise<SessionRecord> {
    if (!user.id || !user.email) {
      throw new AppError('VALIDATION_FAILED', 'Cannot create session without user id and email.', {
        details: { userId: ['REQUIRED'] },
      });
    }

    const sessionId = generateOpaqueSessionId();
    const redisSpec = RedisKeys.session(sessionId, this.sessionTtlSeconds);
    const nowMs = this.nowFn();
    const nowIso = new Date(nowMs).toISOString();
    const expiresIso = new Date(nowMs + redisSpec.ttlSeconds * 1000).toISOString();

    const record: SessionRecord = {
      sessionId,
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt: expiresIso,
    };

    await this.store.set(redisSpec.key, record, redisSpec.ttlSeconds);
    return record;
  }

  /**
   * Introspects an opaque session ID and optionally refreshes its sliding 7-day TTL (ADR 0002).
   * Throws 401 `UNAUTHENTICATED` when missing, malformed, or expired.
   */
  async introspectSession(
    sessionId: string,
    options: { slidingRefresh?: boolean } = {},
  ): Promise<SessionRecord> {
    if (typeof sessionId !== 'string' || !OPAQUE_SESSION_ID_REGEX.test(sessionId)) {
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired session.');
    }

    const redisSpec = RedisKeys.session(sessionId, this.sessionTtlSeconds);
    const existing = await this.store.get(redisSpec.key);
    if (!existing) {
      throw new AppError('UNAUTHENTICATED', 'Session has expired or been revoked.');
    }

    const nowMs = this.nowFn();
    const expiresAtMs = Date.parse(existing.expiresAt);
    if (!Number.isFinite(expiresAtMs) || nowMs >= expiresAtMs) {
      await this.store.del(redisSpec.key);
      throw new AppError('UNAUTHENTICATED', 'Session has expired.');
    }

    const shouldRefresh = options.slidingRefresh ?? true;
    if (!shouldRefresh) {
      return existing;
    }

    const refreshedRecord: SessionRecord = {
      ...existing,
      lastSeenAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + redisSpec.ttlSeconds * 1000).toISOString(),
    };

    await this.store.set(redisSpec.key, refreshedRecord, redisSpec.ttlSeconds);
    return refreshedRecord;
  }

  /**
   * Immediately deletes the session key from Redis so subsequent requests fail closed (ADR 0002).
   */
  async revokeSession(sessionId: string): Promise<boolean> {
    if (typeof sessionId !== 'string' || !OPAQUE_SESSION_ID_REGEX.test(sessionId)) {
      return false;
    }
    const redisSpec = RedisKeys.session(sessionId, this.sessionTtlSeconds);
    return this.store.del(redisSpec.key);
  }
}

export type SessionCookieConfig = Pick<
  AuthServiceConfig,
  | 'SESSION_COOKIE_NAME'
  | 'COOKIE_SECURE'
  | 'COOKIE_SAME_SITE'
  | 'SESSION_TTL_SECONDS'
>;

/**
 * Formats an `HttpOnly` `Set-Cookie` header value for an active session (§11).
 */
export function serializeSessionCookie(
  sessionId: string,
  config: SessionCookieConfig,
): string {
  if (!OPAQUE_SESSION_ID_REGEX.test(sessionId)) {
    throw new AppError('INTERNAL_ERROR', 'Refusing to serialize malformed sessionId into cookie.');
  }
  const sameSiteCapitalized =
    config.COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const parts = [
    `${config.SESSION_COOKIE_NAME}=${sessionId}`,
    `Max-Age=${config.SESSION_TTL_SECONDS}`,
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSiteCapitalized}`,
  ];
  if (config.COOKIE_SECURE) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Formats an `HttpOnly` `Set-Cookie` header that immediately clears the session cookie on logout.
 */
export function serializeClearSessionCookie(config: SessionCookieConfig): string {
  const sameSiteCapitalized =
    config.COOKIE_SAME_SITE === 'strict' ? 'Strict' : 'Lax';
  const parts = [
    `${config.SESSION_COOKIE_NAME}=`,
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Path=/',
    'HttpOnly',
    `SameSite=${sameSiteCapitalized}`,
  ];
  if (config.COOKIE_SECURE) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Extracts the named session cookie from an HTTP `Cookie` request header.
 */
export function extractSessionIdFromCookieHeader(
  cookieHeader: string | undefined,
  cookieName: string,
): string | null {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return null;
  }
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) {
      continue;
    }
    const name = pair.slice(0, eqIdx).trim();
    if (name === cookieName) {
      const value = pair.slice(eqIdx + 1).trim();
      return value.length > 0 ? value : null;
    }
  }
  return null;
}
