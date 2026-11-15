import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import {
  encodeRespCommand,
  FileSystemObjectStorage,
  InMemoryRedisClient,
  parseRespFrame,
  RedisKeys,
  RedisRateLimitStore,
  ResilientRedisClient,
  S3CompatibleObjectStorage,
} from '@kartik/shared';
import {
  AgentSlidingWindowRateLimiter,
  chunkIdToQdrantPointUuid,
  DailyLiveBudgetGuard,
  PersistentDiskVectorStore,
  QdrantHttpVectorStore,
  RedisAgentRateLimitStore,
  RedisDailyBudgetStore,
  ResilientQdrantVectorStore,
} from '../src/index.js';

describe('Concrete Production Persistence Adapters (PostgreSQL / Redis / S3 ObjectStorage / Qdrant)', () => {
  it('encodes and parses Redis RESP2 wire frames and executes RedisRateLimitStore + RedisDailyBudgetStore + RedisAgentRateLimitStore', async () => {
    const encoded = encodeRespCommand(['SET', 'kartik:key', 'hello', 'EX', '60']);
    assert.equal(
      encoded.toString('utf8'),
      '*5\r\n$3\r\nSET\r\n$10\r\nkartik:key\r\n$5\r\nhello\r\n$2\r\nEX\r\n$2\r\n60\r\n',
    );

    const parsedSimple = parseRespFrame(Buffer.from('+OK\r\n', 'utf8'));
    assert.ok(parsedSimple);
    assert.equal(parsedSimple.value, 'OK');

    const parsedInt = parseRespFrame(Buffer.from(':42\r\n', 'utf8'));
    assert.ok(parsedInt);
    assert.equal(parsedInt.value, 42);

    const parsedBulk = parseRespFrame(Buffer.from('$6\r\nkartik\r\n', 'utf8'));
    assert.ok(parsedBulk);
    assert.equal(parsedBulk.value, 'kartik');

    const redis = new ResilientRedisClient('redis://127.0.0.1:63999');
    const rateStore = new RedisRateLimitStore(redis);
    const keySpec = RedisKeys.userRateLimit('chat', 'usr_01', 'w1', 60);
    const c1 = await rateStore.incrementAndGet(keySpec);
    const c2 = await rateStore.incrementAndGet(keySpec);
    assert.equal(c1.count, 1);
    assert.equal(c2.count, 2);

    const inMemRedis = new InMemoryRedisClient();
    const budgetGuard = new DailyLiveBudgetGuard({
      store: new RedisDailyBudgetStore(inMemRedis),
      dailyLimit: 2,
      mockAiDefault: false,
    });
    const b1 = await budgetGuard.checkAndConsumeLiveCall({
      userId: 'usr_01',
      providerField: 'gemini_calls',
    });
    const b2 = await budgetGuard.checkAndConsumeLiveCall({
      userId: 'usr_01',
      providerField: 'gemini_calls',
    });
    const b3 = await budgetGuard.checkAndConsumeLiveCall({
      userId: 'usr_01',
      providerField: 'gemini_calls',
    });
    assert.equal(b1.allowLive, true);
    assert.equal(b2.allowLive, true);
    assert.equal(b3.allowLive, false);
    assert.equal(b3.degradedToMock, true);

    const agentLimiter = new AgentSlidingWindowRateLimiter({
      store: new RedisAgentRateLimitStore(inMemRedis),
      windowSeconds: 60,
    });
    const rlDecision = await agentLimiter.checkAgentLimit({
      userId: 'usr_persistence_01',
      agent: 'chat',
      nowMs: 1_700_000_000_000,
    });
    assert.equal(rlDecision.allowed, true);
    assert.equal(rlDecision.remaining, 19);
  });

  it('persists objects to FileSystemObjectStorage and signs AWS SigV4 URLs in S3CompatibleObjectStorage with strict ownership enforcement', async () => {
    const tmpRoot = path.join(
      os.tmpdir(),
      `kartik-fs-storage-test-${process.pid}-${Date.now()}`,
    );
    const fsStorage = new FileSystemObjectStorage({
      rootDir: tmpRoot,
      signingSecret: 'test-signing-secret-1234567890',
    });

    const payload = new TextEncoder().encode('%PDF-1.4 durable object test');
    const key = 'uploads/usr_alice/conv_01/2026-11-14/file_01.pdf';
    await fsStorage.putPrivateObject({
      key,
      ownerUserId: 'usr_alice',
      mimeType: 'application/pdf',
      body: payload,
      sha256: 'deadbeef',
    });

    const fetched = await fsStorage.getPrivateObject(key, 'usr_alice');
    assert.equal(new TextDecoder().decode(fetched.body), '%PDF-1.4 durable object test');

    await assert.rejects(
      () => fsStorage.getPrivateObject(key, 'usr_mallory'),
      /Requested object was not found/,
    );

    const signed = await fsStorage.createSignedDownloadUrl({
      key,
      requesterUserId: 'usr_alice',
      ttlSeconds: 300,
    });
    assert.ok(signed.signedUrl.includes('X-Amz-Signature='));

    // Also verify S3CompatibleObjectStorage AWS SigV4 presigning + PUT/GET/DELETE via injected fetch
    const s3PutCalls: string[] = [];
    const s3Storage = new S3CompatibleObjectStorage({
      endpoint: 'https://s3.ap-south-1.amazonaws.com',
      region: 'ap-south-1',
      bucket: 'kartik-artifacts-prod',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      fetchImpl: async (inputUrl, init) => {
        const urlStr = String(inputUrl);
        if (init?.method === 'PUT') {
          s3PutCalls.push(urlStr);
          return new Response('', { status: 200 });
        }
        if (init?.method === 'GET') {
          return new Response(payload, {
            status: 200,
            headers: {
              'content-type': 'application/pdf',
              'x-amz-meta-owner-user-id': 'usr_alice',
              'x-amz-meta-sha256': 'deadbeef',
            },
          });
        }
        return new Response('', { status: 204 });
      },
    });

    await s3Storage.putPrivateObject({
      key,
      ownerUserId: 'usr_alice',
      mimeType: 'application/pdf',
      body: payload,
      sha256: 'deadbeef',
    });
    assert.equal(s3PutCalls.length, 1);

    const s3Presigned = await s3Storage.createSignedDownloadUrl({
      key,
      requesterUserId: 'usr_alice',
      ttlSeconds: 300,
    });
    assert.ok(s3Presigned.signedUrl.includes('X-Amz-Algorithm=AWS4-HMAC-SHA256'));
    assert.ok(s3Presigned.signedUrl.includes('X-Amz-Signature='));
  });

  it('enforces Invariant #9 userId + fileIds tenant filtering in QdrantHttpVectorStore, PersistentDiskVectorStore, and ResilientQdrantVectorStore', async () => {
    const capturedBodies: Array<Record<string, unknown>> = [];
    const qdrantStore = new QdrantHttpVectorStore({
      baseUrl: 'http://127.0.0.1:6333',
      collectionName: 'kartik_test_chunks',
      fetchImpl: async (inputUrl, init) => {
        const urlStr = String(inputUrl);
        if (init?.method === 'GET' && urlStr.endsWith('/collections/kartik_test_chunks')) {
          return new Response(JSON.stringify({ result: { status: 'green' } }), {
            status: 200,
          });
        }
        if (init?.body && typeof init.body === 'string') {
          capturedBodies.push(JSON.parse(init.body) as Record<string, unknown>);
        }
        if (urlStr.includes('/points/search')) {
          return new Response(
            JSON.stringify({
              result: [
                {
                  id: chunkIdToQdrantPointUuid('chk_01'),
                  score: 0.94,
                  payload: {
                    chunkId: 'chk_01',
                    fileId: 'file_01',
                    userId: 'usr_alice',
                    documentTitle: 'Architecture.pdf',
                    pageNumber: 2,
                    textContent: 'Cloud SQL and Qdrant persistence invariants.',
                  },
                },
                {
                  id: chunkIdToQdrantPointUuid('chk_foreign'),
                  score: 0.99,
                  payload: {
                    chunkId: 'chk_foreign',
                    fileId: 'file_99',
                    userId: 'usr_mallory',
                    documentTitle: 'Foreign.pdf',
                    pageNumber: 1,
                    textContent: 'Should be filtered out by defense-in-depth.',
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ result: { status: 'acknowledged' } }), {
          status: 200,
        });
      },
    });

    await qdrantStore.upsertChunks([
      {
        chunkId: 'chk_01',
        fileId: 'file_01',
        userId: 'usr_alice',
        documentTitle: 'Architecture.pdf',
        pageNumber: 2,
        chunkIndex: 0,
        textContent: 'Cloud SQL and Qdrant persistence invariants.',
        embeddingVector: [0.5, 0.5, 0.5, 0.5],
        createdAt: new Date().toISOString(),
      },
    ]);

    const hits = await qdrantStore.searchChunks({
      userId: 'usr_alice',
      queryVector: [0.5, 0.5, 0.5, 0.5],
      fileIds: ['file_01'],
      topK: 5,
    });
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.userId, 'usr_alice');
    assert.equal(hits[0]?.chunkId, 'chk_01');

    // Verify persistent disk fallback in ResilientQdrantVectorStore
    const tmpVectorFile = path.join(
      os.tmpdir(),
      `kartik-vectors-test-${process.pid}-${Date.now()}.json`,
    );
    const resilientVectors = new ResilientQdrantVectorStore({
      qdrantUrl: 'http://127.0.0.1:63998',
      storageFilePath: tmpVectorFile,
    });
    await resilientVectors.upsertChunks([
      {
        chunkId: 'chk_disk_01',
        fileId: 'file_disk_01',
        userId: 'usr_alice',
        documentTitle: 'Spec.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        textContent: 'Persistent disk fallback vector chunk.',
        embeddingVector: [1, 0, 0, 0],
        createdAt: new Date().toISOString(),
      },
    ]);

    const reloadedDiskStore = new PersistentDiskVectorStore({
      storageFilePath: tmpVectorFile,
    });
    const diskHits = await reloadedDiskStore.searchChunks({
      userId: 'usr_alice',
      queryVector: [1, 0, 0, 0],
    });
    assert.equal(diskHits.length, 1);
    assert.equal(diskHits[0]?.chunkId, 'chk_disk_01');

    const malloryHits = await reloadedDiskStore.searchChunks({
      userId: 'usr_mallory',
      queryVector: [1, 0, 0, 0],
    });
    assert.equal(malloryHits.length, 0);
  });
});
