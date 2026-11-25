import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {
  RedisKeys,
  REDIS_TTL_SECONDS,
  resolveRedisTlsOptions,
  formatRedisConnectionError,
  parseRespFrame,
  RespRedisClient,
  ResilientRedisClient,
} from '../redis/index.js';

describe('@kartik/shared/redis key contract & TTL builders (1.5.a)', () => {
  it('builds all 7 normative Redis keys with exact patterns, value types, and TTLs (§5.2)', () => {
    const sess = RedisKeys.session('opaque_sess_id_123');
    assert.deepEqual(sess, {
      key: 'sess:opaque_sess_id_123',
      type: 'hash',
      ttlSeconds: 604800,
    });

    const rlUser = RedisKeys.userRateLimit('coding', 'usr_kartik_01', '202611101645', 60);
    assert.deepEqual(rlUser, {
      key: 'rl:coding:usr_kartik_01:202611101645',
      type: 'counter',
      ttlSeconds: 60,
    });

    const rlIp = RedisKeys.ipRateLimit('203.0.113.42', '202611101645');
    assert.deepEqual(rlIp, {
      key: 'rl:ip:203.0.113.42:202611101645',
      type: 'counter',
      ttlSeconds: 60,
    });

    const idemChat = RedisKeys.idempotency('usr_kartik_01', '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11', 'chat');
    assert.equal(idemChat.key, 'idem:usr_kartik_01:9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11');
    assert.equal(idemChat.type, 'string');
    assert.equal(idemChat.ttlSeconds, REDIS_TTL_SECONDS.IDEMPOTENCY_CHAT); // 24h (86,400s)

    const idemMoney = RedisKeys.idempotency('usr_kartik_01', '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11', 'money');
    assert.equal(idemMoney.ttlSeconds, REDIS_TTL_SECONDS.IDEMPOTENCY_MONEY); // 30d (2,592,000s)

    const cleanup = RedisKeys.cleanupLock('conv_uuid_1');
    assert.deepEqual(cleanup, {
      key: 'lock:cleanup:conv_uuid_1',
      type: 'string',
      ttlSeconds: 600,
    });

    const settle = RedisKeys.settleLock('res_uuid_2');
    assert.deepEqual(settle, {
      key: 'lock:settle:res_uuid_2',
      type: 'string',
      ttlSeconds: 300,
    });

    const quota = RedisKeys.dailyQuota('usr_kartik_01', '2026-11-10');
    assert.deepEqual(quota, {
      key: 'quota:usr_kartik_01:2026-11-10',
      type: 'hash',
      ttlSeconds: 172800,
    });
  });

  it('normalizes IPv6 colons in ipRateLimit so key delimiters stay unambiguous', () => {
    const ipv6Key = RedisKeys.ipRateLimit('2001:db8::1', 'w1');
    assert.equal(ipv6Key.key, 'rl:ip:2001_db8__1:w1');
  });

  it('rejects emails, raw JWTs, colons, whitespace, or non-positive TTLs (Phase 1 Exit Gate)', () => {
    assert.throws(() => RedisKeys.session('kartik@example.com'), /email address/);
    assert.throws(() => RedisKeys.session('eyJhbGciOiJFZERTQSJ9.payload.sig'), /raw JWT/);
    assert.throws(() => RedisKeys.userRateLimit('chat', 'usr:injected', 'w1'), /colons or whitespace/);
    assert.throws(() => RedisKeys.session('valid_id', 0), /positive integer/);
  });

  it('Fix #13: verifies Redis TLS certificates by default and refuses REDIS_TLS_INSECURE=true in production', () => {
    const prodDefault = resolveRedisTlsOptions('cache.internal.kartik.ai', {
      NODE_ENV: 'production',
    });
    assert.deepEqual(prodDefault, {
      host: 'cache.internal.kartik.ai',
      servername: 'cache.internal.kartik.ai',
      rejectUnauthorized: true,
    });

    // Even if REDIS_TLS_INSECURE=true is set in production, TLS verification remains enforced
    const prodInsecureIgnored = resolveRedisTlsOptions('cache.internal.kartik.ai', {
      NODE_ENV: 'production',
      REDIS_TLS_INSECURE: 'true',
    });
    assert.equal(prodInsecureIgnored.rejectUnauthorized, true);

    // Local/dev environments may explicitly opt out for self-signed dev proxies
    const devInsecure = resolveRedisTlsOptions('127.0.0.1', {
      NODE_ENV: 'development',
      REDIS_TLS_INSECURE: 'true',
    });
    assert.deepEqual(devInsecure, {
      host: '127.0.0.1',
      servername: '127.0.0.1',
      rejectUnauthorized: false,
    });
  });

  it('Fix #34: reuses a single authenticated TCP socket across commands, runs atomic EVAL for delIfEquals, and reconnects after idle drops', async () => {
    let connectionCount = 0;
    let authCount = 0;
    let evalCount = 0;
    const kv = new Map<string, string>();
    const activeSockets = new Set<net.Socket>();

    const server = net.createServer((sock) => {
      connectionCount += 1;
      activeSockets.add(sock);
      let buf = Buffer.alloc(0);

      sock.on('close', () => activeSockets.delete(sock));
      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length > 0) {
          const parsed = parseRespFrame(buf, 0);
          if (!parsed) break;
          buf = buf.subarray(parsed.nextOffset);
          const args = Array.isArray(parsed.value) ? parsed.value.map(String) : [];
          const cmd = (args[0] ?? '').toUpperCase();

          if (cmd === 'AUTH') {
            authCount += 1;
            sock.write('+OK\r\n');
          } else if (cmd === 'PING') {
            sock.write('+PONG\r\n');
          } else if (cmd === 'SET') {
            const key = args[1] ?? '';
            const val = args[2] ?? '';
            kv.set(key, val);
            sock.write('+OK\r\n');
          } else if (cmd === 'GET') {
            const val = kv.get(args[1] ?? '');
            if (val === undefined) {
              sock.write('$-1\r\n');
            } else {
              const byteLen = Buffer.byteLength(val, 'utf8');
              sock.write(`$${byteLen}\r\n${val}\r\n`);
            }
          } else if (cmd === 'EVAL') {
            evalCount += 1;
            const key = args[3] ?? '';
            const expected = args[4] ?? '';
            if (kv.get(key) === expected) {
              kv.delete(key);
              sock.write(':1\r\n');
            } else {
              sock.write(':0\r\n');
            }
          } else {
            sock.write('+OK\r\n');
          }
        }
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const client = new RespRedisClient(`redis://default:test_pass_123@127.0.0.1:${port}`, {
      timeoutMs: 2_000,
    });

    try {
      assert.equal(await client.ping(), 'PONG');
      await client.setEx('lock:test:1', 'ownerA', 60);
      assert.equal(await client.get('lock:test:1'), 'ownerA');
      assert.equal(await client.delIfEquals('lock:test:1', 'ownerB'), false);
      assert.equal(await client.delIfEquals('lock:test:1', 'ownerA'), true);
      assert.equal(await client.get('lock:test:1'), null);

      // All 6 commands shared ONE authenticated connection!
      assert.equal(connectionCount, 1);
      assert.equal(authCount, 1);
      assert.equal(evalCount, 2);

      // Simulate Upstash closing the idle socket -> next command transparently reconnects!
      for (const s of activeSockets) {
        s.destroy();
      }
      await new Promise((r) => setTimeout(r, 25));
      assert.equal(await client.ping(), 'PONG');
      assert.equal(connectionCount, 2);
      assert.equal(authCount, 2);
    } finally {
      await client.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Fix #34: ResilientRedisClient backs off for retryCooldownMs on outage and auto-recovers', async () => {
    let nowMs = 500_000;
    const resilient = new ResilientRedisClient('redis://127.0.0.1:63997', {
      timeoutMs: 200,
      retryCooldownMs: 30_000,
      nowFn: () => nowMs,
    });

    // First call hits unreachable port -> degrades into in-memory fallback
    await resilient.setEx('k:1', 'v1', 60);
    assert.equal(await resilient.get('k:1'), 'v1');

    // Subsequent calls during cooldown are instant (<15ms) via in-memory fallback
    const t0 = Date.now();
    await resilient.setEx('k:2', 'v2', 60);
    assert.equal(await resilient.get('k:2'), 'v2');
    assert.ok(Date.now() - t0 < 50);

    const health = await resilient.checkPrimaryHealth();
    assert.equal(health.ok, false);
    assert.ok(health.error && health.error.length > 0);
    await resilient.close();
  });

  it('Fix #36: formatRedisConnectionError unwraps Node AggregateError with empty message cleanly', () => {
    const inner1 = Object.assign(new Error('connect ECONNREFUSED ::1:6379'), {
      code: 'ECONNREFUSED',
    });
    const inner2 = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:6379'), {
      code: 'ECONNREFUSED',
    });
    const agg = new AggregateError([inner1, inner2], '');
    const formatted = formatRedisConnectionError(agg);
    assert.ok(formatted.includes('ECONNREFUSED'));
    assert.ok(formatted.includes('127.0.0.1:6379'));
  });
});
