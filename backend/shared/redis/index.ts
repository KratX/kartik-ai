/**
 * Kartik.ai — Scoped Redis Key Contract & In-Memory/Compatible Store (`@kartik/shared/redis`)
 * Blueprint §5.2, §7.2 (Phase 1 Exit Gate), and §13 (Sprint Step 10).
 *
 * Pure TypeScript, zero external dependencies (ADR 0005).
 * Rules enforced (§5.2):
 * 1. Every key has an explicit TTL in seconds (`ttlSeconds > 0`).
 * 2. Keys are built strictly via `RedisKeys` builders — never ad-hoc string concatenation.
 * 3. No key may contain an email (`@`), a colon (`:`), whitespace, or a raw token/JWT (`eyJ...`).
 * 4. Idempotency retention split (§5.4): 24 hours (`86_400s`) for `chat`, 30 days (`2_592_000s`) for `money`.
 */

export type RateLimitScope =
  | 'auth'
  | 'chat'
  | 'search'
  | 'coding'
  | 'pdf'
  | 'ppt'
  | 'rag'
  | 'image'
  | 'vision'
  | 'billing';

export type IdempotencyScope = 'chat' | 'money';

export type RedisValueType = 'hash' | 'counter' | 'string';

export interface RedisKeySpec {
  key: string;
  type: RedisValueType;
  ttlSeconds: number;
}

export const REDIS_TTL_SECONDS = {
  SESSION_SLIDING: 7 * 24 * 60 * 60,        // 7 days (604,800s)
  IDEMPOTENCY_CHAT: 24 * 60 * 60,           // 24 hours (86,400s)
  IDEMPOTENCY_MONEY: 30 * 24 * 60 * 60,     // 30 days (2,592,000s)
  LOCK_CLEANUP: 10 * 60,                    // 10 minutes (600s)
  LOCK_SETTLE: 5 * 60,                      // 5 minutes (300s)
  QUOTA_DAILY: 48 * 60 * 60,                // 48 hours (172,800s)
  DEFAULT_RATE_LIMIT_WINDOW: 60,            // 1 minute (60s)
} as const;

function assertSafeKeySegment(label: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`Redis key segment "${label}" must not be empty.`);
  }
  if (trimmed.includes('@')) {
    throw new Error(`Redis key segment "${label}" must not contain an email address (@).`);
  }
  if (trimmed.includes(':') || /\s/.test(trimmed)) {
    throw new Error(`Redis key segment "${label}" must not contain colons or whitespace.`);
  }
  if (/^eyJ[A-Za-z0-9_-]+\./.test(trimmed) || trimmed.startsWith('Bearer')) {
    throw new Error(`Redis key segment "${label}" must not contain a raw JWT or Bearer token.`);
  }
  return trimmed;
}

function assertPositiveTtl(ttlSeconds: number): number {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`Redis key TTL must be a positive integer in seconds (got ${String(ttlSeconds)}).`);
  }
  return ttlSeconds;
}

/**
 * Normative Redis key builders matching Blueprint §5.2 table row-for-row.
 */
export const RedisKeys = {
  /**
   * `sess:{sessionId}` — hash, 7 days sliding TTL, written by Auth.
   */
  session(sessionId: string, ttlSeconds: number = REDIS_TTL_SECONDS.SESSION_SLIDING): RedisKeySpec {
    const cleanId = assertSafeKeySegment('sessionId', sessionId);
    return {
      key: `sess:${cleanId}`,
      type: 'hash',
      ttlSeconds: assertPositiveTtl(ttlSeconds),
    };
  },

  /**
   * `rl:{scope}:{userId}:{window}` — counter, window TTL, written by each service.
   */
  userRateLimit(
    scope: RateLimitScope,
    userId: string,
    windowBucket: string,
    windowTtlSeconds: number = REDIS_TTL_SECONDS.DEFAULT_RATE_LIMIT_WINDOW
  ): RedisKeySpec {
    const cleanUser = assertSafeKeySegment('userId', userId);
    const cleanWindow = assertSafeKeySegment('windowBucket', windowBucket);
    return {
      key: `rl:${scope}:${cleanUser}:${cleanWindow}`,
      type: 'counter',
      ttlSeconds: assertPositiveTtl(windowTtlSeconds),
    };
  },

  /**
   * `rl:ip:{ip}:{window}` — counter, window TTL, written by Gateway for pre-auth abuse control.
   * Note: IPv6 colons are normalized to underscores so key delimiter structure remains unambiguous.
   */
  ipRateLimit(
    ipAddress: string,
    windowBucket: string,
    windowTtlSeconds: number = REDIS_TTL_SECONDS.DEFAULT_RATE_LIMIT_WINDOW
  ): RedisKeySpec {
    const normalizedIp = ipAddress.trim().replace(/:/g, '_');
    const cleanIp = assertSafeKeySegment('ipAddress', normalizedIp);
    const cleanWindow = assertSafeKeySegment('windowBucket', windowBucket);
    return {
      key: `rl:ip:${cleanIp}:${cleanWindow}`,
      type: 'counter',
      ttlSeconds: assertPositiveTtl(windowTtlSeconds),
    };
  },

  /**
   * `idem:{userId}:{requestId}` — string, 24 h chat / 30 days money TTL, written by Chat & Billing.
   */
  idempotency(
    userId: string,
    requestId: string,
    scope: IdempotencyScope = 'chat'
  ): RedisKeySpec {
    const cleanUser = assertSafeKeySegment('userId', userId);
    const cleanReq = assertSafeKeySegment('requestId', requestId);
    return {
      key: `idem:${cleanUser}:${cleanReq}`,
      type: 'string',
      ttlSeconds:
        scope === 'money'
          ? REDIS_TTL_SECONDS.IDEMPOTENCY_MONEY
          : REDIS_TTL_SECONDS.IDEMPOTENCY_CHAT,
    };
  },

  /**
   * `lock:cleanup:{conversationId}` — string, 10 min TTL, written by Chat worker.
   */
  cleanupLock(conversationId: string): RedisKeySpec {
    const cleanConv = assertSafeKeySegment('conversationId', conversationId);
    return {
      key: `lock:cleanup:${cleanConv}`,
      type: 'string',
      ttlSeconds: REDIS_TTL_SECONDS.LOCK_CLEANUP,
    };
  },

  /**
   * `lock:settle:{reservationId}` — string, 5 min TTL, written by Chat recovery worker.
   */
  settleLock(reservationId: string): RedisKeySpec {
    const cleanRes = assertSafeKeySegment('reservationId', reservationId);
    return {
      key: `lock:settle:${cleanRes}`,
      type: 'string',
      ttlSeconds: REDIS_TTL_SECONDS.LOCK_SETTLE,
    };
  },

  /**
   * `quota:{userId}:{day}` — hash, 48 h TTL, written by Billing for daily free-tier counters.
   */
  dailyQuota(userId: string, utcDayIso: string): RedisKeySpec {
    const cleanUser = assertSafeKeySegment('userId', userId);
    const cleanDay = assertSafeKeySegment('utcDayIso', utcDayIso);
    return {
      key: `quota:${cleanUser}:${cleanDay}`,
      type: 'hash',
      ttlSeconds: REDIS_TTL_SECONDS.QUOTA_DAILY,
    };
  },
} as const;
