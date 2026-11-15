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

import net from 'node:net';
import tls from 'node:tls';

export interface RedisClient {
  get(key: string): Promise<string | null>;
  setEx(key: string, value: string, ttlSeconds: number): Promise<void>;
  setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean>;
  del(key: string): Promise<number>;
  delIfEquals(key: string, expectedValue: string): Promise<boolean>;
  incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ readonly count: number; readonly ttlSeconds: number }>;
  hSet(key: string, fields: Record<string, string>): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  hIncrByWithTtl(
    key: string,
    field: string,
    increment: number,
    ttlSeconds: number,
  ): Promise<number>;
  hGet(key: string, field: string): Promise<string | null>;
  expire(key: string, ttlSeconds: number): Promise<boolean>;
  close(): Promise<void>;
}

/**
 * Encodes a command array into the Redis Serialization Protocol (RESP2) wire format.
 */
export function encodeRespCommand(args: readonly string[]): Buffer {
  const parts: Buffer[] = [Buffer.from(`*${args.length}\r\n`, 'utf8')];
  for (const arg of args) {
    const buf = Buffer.from(String(arg), 'utf8');
    parts.push(Buffer.from(`$${buf.byteLength}\r\n`, 'utf8'), buf, Buffer.from('\r\n', 'utf8'));
  }
  return Buffer.concat(parts);
}

export type RespValue = string | number | null | RespValue[];

/**
 * Parses a single RESP2 frame from `buffer` starting at `offset`.
 * Returns `null` if the buffer does not yet contain a complete frame.
 */
export function parseRespFrame(
  buffer: Buffer,
  offset = 0,
): { readonly value: RespValue; readonly nextOffset: number; readonly isError?: boolean } | null {
  if (offset >= buffer.length) {
    return null;
  }
  const prefix = String.fromCharCode(buffer[offset]!);
  const lineEnd = buffer.indexOf('\r\n', offset + 1);
  if (lineEnd === -1) {
    return null;
  }
  const headerPayload = buffer.subarray(offset + 1, lineEnd).toString('utf8');

  if (prefix === '+') {
    return { value: headerPayload, nextOffset: lineEnd + 2 };
  }
  if (prefix === '-') {
    return { value: headerPayload, nextOffset: lineEnd + 2, isError: true };
  }
  if (prefix === ':') {
    return { value: Number.parseInt(headerPayload, 10), nextOffset: lineEnd + 2 };
  }
  if (prefix === '$') {
    const byteLen = Number.parseInt(headerPayload, 10);
    if (byteLen === -1) {
      return { value: null, nextOffset: lineEnd + 2 };
    }
    const bodyStart = lineEnd + 2;
    const bodyEnd = bodyStart + byteLen;
    if (buffer.length < bodyEnd + 2) {
      return null;
    }
    const strVal = buffer.subarray(bodyStart, bodyEnd).toString('utf8');
    return { value: strVal, nextOffset: bodyEnd + 2 };
  }
  if (prefix === '*') {
    const count = Number.parseInt(headerPayload, 10);
    if (count === -1) {
      return { value: null, nextOffset: lineEnd + 2 };
    }
    const items: RespValue[] = [];
    let cursor = lineEnd + 2;
    for (let i = 0; i < count; i += 1) {
      const parsed = parseRespFrame(buffer, cursor);
      if (!parsed) {
        return null;
      }
      if (parsed.isError) {
        return parsed;
      }
      items.push(parsed.value);
      cursor = parsed.nextOffset;
    }
    return { value: items, nextOffset: cursor };
  }
  throw new Error(`Unsupported RESP frame prefix "${prefix}"`);
}

/**
 * Zero-dependency RESP2 TCP/TLS Redis client using `node:net` and `node:tls`.
 * Executes single-roundtrip commands with bounded socket timeouts.
 */
export class RespRedisClient implements RedisClient {
  private readonly host: string;
  private readonly port: number;
  private readonly useTls: boolean;
  private readonly username: string | null;
  private readonly password: string | null;
  private readonly dbIndex: number;
  private readonly timeoutMs: number;

  constructor(redisUrl: string, options: { readonly timeoutMs?: number } = {}) {
    const cleanUrl = redisUrl.trim().replace(/^["']|["']$/g, '');
    const parsed = new URL(cleanUrl);
    this.useTls = parsed.protocol === 'rediss:';
    this.host = parsed.hostname || '127.0.0.1';
    this.port = parsed.port ? Number.parseInt(parsed.port, 10) : 6379;
    this.username = parsed.username ? decodeURIComponent(parsed.username) : null;
    this.password = parsed.password ? decodeURIComponent(parsed.password) : null;
    const pathDb = parsed.pathname.replace(/^\/+/, '');
    this.dbIndex = pathDb ? Number.parseInt(pathDb, 10) || 0 : 0;
    this.timeoutMs = options.timeoutMs ?? 4_000;
  }

  public async sendPipeline(userCommands: readonly (readonly string[])[]): Promise<RespValue[]> {
    const commandsToRun: (readonly string[])[] = [];
    let prefixCount = 0;
    if (this.password) {
      if (this.username) {
        commandsToRun.push(['AUTH', this.username, this.password]);
      } else {
        commandsToRun.push(['AUTH', this.password]);
      }
      prefixCount += 1;
    }
    if (this.dbIndex > 0) {
      commandsToRun.push(['SELECT', String(this.dbIndex)]);
      prefixCount += 1;
    }
    for (const cmd of userCommands) {
      commandsToRun.push(cmd);
    }

    const payload = Buffer.concat(commandsToRun.map((cmd) => encodeRespCommand(cmd)));
    const expectedReplies = commandsToRun.length;

    return new Promise<RespValue[]>((resolve, reject) => {
      let settled = false;
      let recvBuffer = Buffer.alloc(0);

      const socket = this.useTls
        ? tls.connect({
            host: this.host,
            port: this.port,
            servername: this.host,
            rejectUnauthorized: false,
          })
        : net.createConnection({ host: this.host, port: this.port });

      const finish = (err: Error | null, results?: RespValue[]) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (err) {
          reject(err);
        } else {
          resolve(results ?? []);
        }
      };

      socket.setTimeout(this.timeoutMs, () => {
        finish(new Error(`Redis socket timeout after ${this.timeoutMs}ms`));
      });

      socket.on('error', (err) => {
        finish(err);
      });

      socket.on(this.useTls ? 'secureConnect' : 'connect', () => {
        socket.write(payload);
      });

      socket.on('data', (chunk: Buffer) => {
        recvBuffer = Buffer.concat([recvBuffer, chunk]);
        try {
          let offset = 0;
          const allReplies: RespValue[] = [];
          for (let i = 0; i < expectedReplies; i += 1) {
            const frame = parseRespFrame(recvBuffer, offset);
            if (!frame) {
              return;
            }
            if (frame.isError) {
              finish(new Error(`Redis error: ${String(frame.value)}`));
              return;
            }
            allReplies.push(frame.value);
            offset = frame.nextOffset;
          }
          finish(null, allReplies.slice(prefixCount));
        } catch (err) {
          finish(err instanceof Error ? err : new Error(String(err)));
        }
      });
    });
  }

  public async sendCommand(args: readonly string[]): Promise<RespValue> {
    const replies = await this.sendPipeline([args]);
    return replies[0] ?? null;
  }

  public async get(key: string): Promise<string | null> {
    const val = await this.sendCommand(['GET', key]);
    return typeof val === 'string' ? val : null;
  }

  public async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    await this.sendCommand(['SET', key, value, 'EX', String(cleanTtl)]);
  }

  public async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    const res = await this.sendCommand(['SET', key, value, 'NX', 'EX', String(cleanTtl)]);
    return res === 'OK';
  }

  public async del(key: string): Promise<number> {
    const res = await this.sendCommand(['DEL', key]);
    return typeof res === 'number' ? res : 0;
  }

  public async delIfEquals(key: string, expectedValue: string): Promise<boolean> {
    const current = await this.get(key);
    if (current !== expectedValue) {
      return false;
    }
    const deleted = await this.del(key);
    return deleted > 0;
  }

  public async incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ readonly count: number; readonly ttlSeconds: number }> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    const [countVal] = await this.sendPipeline([
      ['INCR', key],
      ['EXPIRE', key, String(cleanTtl), 'NX'],
    ]);
    const count = typeof countVal === 'number' ? countVal : Number(countVal) || 1;
    return { count, ttlSeconds: cleanTtl };
  }

  public async hSet(key: string, fields: Record<string, string>): Promise<number> {
    const entries = Object.entries(fields);
    if (entries.length === 0) {
      return 0;
    }
    const cmd: string[] = ['HSET', key];
    for (const [k, v] of entries) {
      cmd.push(k, v);
    }
    const res = await this.sendCommand(cmd);
    return typeof res === 'number' ? res : entries.length;
  }

  public async hGetAll(key: string): Promise<Record<string, string>> {
    const res = await this.sendCommand(['HGETALL', key]);
    const out: Record<string, string> = {};
    if (Array.isArray(res)) {
      for (let i = 0; i + 1 < res.length; i += 2) {
        const k = res[i];
        const v = res[i + 1];
        if (typeof k === 'string' && typeof v === 'string') {
          out[k] = v;
        }
      }
    }
    return out;
  }

  public async hIncrByWithTtl(
    key: string,
    field: string,
    increment: number,
    ttlSeconds: number,
  ): Promise<number> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    const [res] = await this.sendPipeline([
      ['HINCRBY', key, field, String(increment)],
      ['EXPIRE', key, String(cleanTtl)],
    ]);
    return typeof res === 'number' ? res : Number(res) || increment;
  }

  public async hGet(key: string, field: string): Promise<string | null> {
    const res = await this.sendCommand(['HGET', key, field]);
    return typeof res === 'string' ? res : null;
  }

  public async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    const res = await this.sendCommand(['EXPIRE', key, String(cleanTtl)]);
    return res === 1 || res === '1';
  }

  public async close(): Promise<void> {
    // Connections are per-command short-lived or pooled on demand
  }
}

/**
 * Deterministic TTL-enforcing in-memory `RedisClient` implementation.
 */
export class InMemoryRedisClient implements RedisClient {
  private readonly strings = new Map<string, { value: string; expiresAtMs: number }>();
  private readonly hashes = new Map<
    string,
    { fields: Map<string, string>; expiresAtMs: number }
  >();
  private readonly nowFn: () => number;

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  private getActiveString(key: string): { value: string; expiresAtMs: number } | null {
    const entry = this.strings.get(key);
    if (!entry) return null;
    if (this.nowFn() >= entry.expiresAtMs) {
      this.strings.delete(key);
      return null;
    }
    return entry;
  }

  private getActiveHash(
    key: string,
  ): { fields: Map<string, string>; expiresAtMs: number } | null {
    const entry = this.hashes.get(key);
    if (!entry) return null;
    if (this.nowFn() >= entry.expiresAtMs) {
      this.hashes.delete(key);
      return null;
    }
    return entry;
  }

  public async get(key: string): Promise<string | null> {
    return this.getActiveString(key)?.value ?? null;
  }

  public async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    this.strings.set(key, {
      value,
      expiresAtMs: this.nowFn() + cleanTtl * 1000,
    });
  }

  public async setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    if (this.getActiveString(key)) {
      return false;
    }
    this.strings.set(key, {
      value,
      expiresAtMs: this.nowFn() + cleanTtl * 1000,
    });
    return true;
  }

  public async del(key: string): Promise<number> {
    const s = this.strings.delete(key);
    const h = this.hashes.delete(key);
    return s || h ? 1 : 0;
  }

  public async delIfEquals(key: string, expectedValue: string): Promise<boolean> {
    const active = this.getActiveString(key);
    if (!active || active.value !== expectedValue) {
      return false;
    }
    this.strings.delete(key);
    return true;
  }

  public async incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ readonly count: number; readonly ttlSeconds: number }> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    const active = this.getActiveString(key);
    if (!active) {
      this.strings.set(key, {
        value: '1',
        expiresAtMs: this.nowFn() + cleanTtl * 1000,
      });
      return { count: 1, ttlSeconds: cleanTtl };
    }
    const nextCount = (Number.parseInt(active.value, 10) || 0) + 1;
    active.value = String(nextCount);
    const remainingTtl = Math.max(1, Math.ceil((active.expiresAtMs - this.nowFn()) / 1000));
    return { count: nextCount, ttlSeconds: remainingTtl };
  }

  public async hSet(key: string, fields: Record<string, string>): Promise<number> {
    let active = this.getActiveHash(key);
    if (!active) {
      active = {
        fields: new Map<string, string>(),
        expiresAtMs: this.nowFn() + REDIS_TTL_SECONDS.SESSION_SLIDING * 1000,
      };
      this.hashes.set(key, active);
    }
    let added = 0;
    for (const [k, v] of Object.entries(fields)) {
      if (!active.fields.has(k)) added += 1;
      active.fields.set(k, v);
    }
    return added;
  }

  public async hGetAll(key: string): Promise<Record<string, string>> {
    const active = this.getActiveHash(key);
    if (!active) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of active.fields.entries()) {
      out[k] = v;
    }
    return out;
  }

  public async hIncrByWithTtl(
    key: string,
    field: string,
    increment: number,
    ttlSeconds: number,
  ): Promise<number> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    let active = this.getActiveHash(key);
    if (!active) {
      active = {
        fields: new Map<string, string>(),
        expiresAtMs: this.nowFn() + cleanTtl * 1000,
      };
      this.hashes.set(key, active);
    }
    const prev = Number.parseInt(active.fields.get(field) ?? '0', 10) || 0;
    const next = prev + increment;
    active.fields.set(field, String(next));
    return next;
  }

  public async hGet(key: string, field: string): Promise<string | null> {
    const active = this.getActiveHash(key);
    return active?.fields.get(field) ?? null;
  }

  public async expire(key: string, ttlSeconds: number): Promise<boolean> {
    const cleanTtl = assertPositiveTtl(ttlSeconds);
    const activeHash = this.getActiveHash(key);
    if (activeHash) {
      activeHash.expiresAtMs = this.nowFn() + cleanTtl * 1000;
      return true;
    }
    const activeStr = this.getActiveString(key);
    if (activeStr) {
      activeStr.expiresAtMs = this.nowFn() + cleanTtl * 1000;
      return true;
    }
    return false;
  }

  public async close(): Promise<void> {}
}

/**
 * Production Redis client wrapper that executes commands against `RespRedisClient` (`redis://` / `rediss://`)
 * and falls back cleanly to `InMemoryRedisClient` when running in an environment where no Redis daemon is reachable.
 */
export class ResilientRedisClient implements RedisClient {
  private readonly primary: RespRedisClient;
  private readonly fallback: InMemoryRedisClient;

  constructor(redisUrl: string, options: { readonly timeoutMs?: number } = {}) {
    this.primary = new RespRedisClient(redisUrl, options);
    this.fallback = new InMemoryRedisClient();
  }

  private async runWithFallback<T>(
    primaryOp: () => Promise<T>,
    fallbackOp: () => Promise<T>,
  ): Promise<T> {
    try {
      return await primaryOp();
    } catch {
      return fallbackOp();
    }
  }

  public get(key: string): Promise<string | null> {
    return this.runWithFallback(
      () => this.primary.get(key),
      () => this.fallback.get(key),
    );
  }

  public setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    return this.runWithFallback(
      async () => {
        await this.primary.setEx(key, value, ttlSeconds);
        await this.fallback.setEx(key, value, ttlSeconds);
      },
      () => this.fallback.setEx(key, value, ttlSeconds),
    );
  }

  public setNxEx(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return this.runWithFallback(
      () => this.primary.setNxEx(key, value, ttlSeconds),
      () => this.fallback.setNxEx(key, value, ttlSeconds),
    );
  }

  public del(key: string): Promise<number> {
    return this.runWithFallback(
      async () => {
        const res = await this.primary.del(key);
        await this.fallback.del(key);
        return res;
      },
      () => this.fallback.del(key),
    );
  }

  public delIfEquals(key: string, expectedValue: string): Promise<boolean> {
    return this.runWithFallback(
      () => this.primary.delIfEquals(key, expectedValue),
      () => this.fallback.delIfEquals(key, expectedValue),
    );
  }

  public incrWithTtl(
    key: string,
    ttlSeconds: number,
  ): Promise<{ readonly count: number; readonly ttlSeconds: number }> {
    return this.runWithFallback(
      () => this.primary.incrWithTtl(key, ttlSeconds),
      () => this.fallback.incrWithTtl(key, ttlSeconds),
    );
  }

  public hSet(key: string, fields: Record<string, string>): Promise<number> {
    return this.runWithFallback(
      async () => {
        const count = await this.primary.hSet(key, fields);
        await this.fallback.hSet(key, fields);
        return count;
      },
      () => this.fallback.hSet(key, fields),
    );
  }

  public hGetAll(key: string): Promise<Record<string, string>> {
    return this.runWithFallback(
      () => this.primary.hGetAll(key),
      () => this.fallback.hGetAll(key),
    );
  }

  public hIncrByWithTtl(
    key: string,
    field: string,
    increment: number,
    ttlSeconds: number,
  ): Promise<number> {
    return this.runWithFallback(
      () => this.primary.hIncrByWithTtl(key, field, increment, ttlSeconds),
      () => this.fallback.hIncrByWithTtl(key, field, increment, ttlSeconds),
    );
  }

  public hGet(key: string, field: string): Promise<string | null> {
    return this.runWithFallback(
      () => this.primary.hGet(key, field),
      () => this.fallback.hGet(key, field),
    );
  }

  public expire(key: string, ttlSeconds: number): Promise<boolean> {
    return this.runWithFallback(
      async () => {
        const ok = await this.primary.expire(key, ttlSeconds);
        await this.fallback.expire(key, ttlSeconds);
        return ok;
      },
      () => this.fallback.expire(key, ttlSeconds),
    );
  }

  public async close(): Promise<void> {
    await this.primary.close();
    await this.fallback.close();
  }
}

export function createRedisClientFromUrl(
  redisUrl?: string,
  options?: { readonly forceInMemory?: boolean; readonly timeoutMs?: number },
): RedisClient {
  if (options?.forceInMemory || !redisUrl) {
    return new InMemoryRedisClient();
  }
  return new ResilientRedisClient(redisUrl, { timeoutMs: options?.timeoutMs ?? 2500 });
}

