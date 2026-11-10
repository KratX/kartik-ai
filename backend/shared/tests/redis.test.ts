import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RedisKeys, REDIS_TTL_SECONDS } from '../redis/index.js';

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
});
