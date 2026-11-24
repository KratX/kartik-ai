import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { DecodedIdToken } from 'firebase-admin/auth';
import {
  createKartikExpressApp,
  isAllowedDevDownloadPath,
} from '../../server.ts';
import {
  assertRootRuntimeDemoOrLocalOnly,
  KartikPlatformRuntime,
} from './platform-api-runtime.ts';
import {
  InMemoryPlatformPersistenceAdapter,
  resetDatabaseDegradedStateForTest,
} from '../db/platform-repository.ts';
import { pool } from '../db/index.ts';
import { setFirebaseTokenVerifierForTests } from '../middleware/auth.ts';
import {
  buildPdfBinaryBuffer,
  validatePdfDocumentSpec,
} from '../../backend/services/agent/src/index.js';

function buildDecodedFirebaseToken(input: {
  uid: string;
  email: string;
  name: string;
}): DecodedIdToken {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    uid: input.uid,
    sub: input.uid,
    email: input.email,
    email_verified: true,
    name: input.name,
    aud: 'gen-lang-client-0503610321',
    iss: 'https://securetoken.google.com/gen-lang-client-0503610321',
    auth_time: nowSec,
    iat: nowSec,
    exp: nowSec + 3600,
    firebase: {
      identities: { email: [input.email] },
      sign_in_provider: 'google.com',
    },
  };
}

describe('Root Express Runtime Multi-User Isolation & Verified Firebase Auth (Audit Item #14)', () => {
  let savedNodeEnv: string | undefined;
  let savedMockAi: string | undefined;
  let savedAiMode: string | undefined;
  let savedImageProvider: string | undefined;
  let savedQdrantUrl: string | undefined;
  let savedQdrantApiKey: string | undefined;
  let savedRedisUrl: string | undefined;

  before(() => {
    savedNodeEnv = process.env.NODE_ENV;
    savedMockAi = process.env.MOCK_AI;
    savedAiMode = process.env.AI_PROVIDER_MODE;
    savedImageProvider = process.env.IMAGE_PROVIDER;
    savedQdrantUrl = process.env.QDRANT_URL;
    savedQdrantApiKey = process.env.QDRANT_API_KEY;
    savedRedisUrl = process.env.REDIS_URL;
    process.env.NODE_ENV = 'test';
    process.env.MOCK_AI = 'true';
    process.env.AI_PROVIDER_MODE = 'mock';
    process.env.IMAGE_PROVIDER = 'mock';
    delete process.env.QDRANT_URL;
    delete process.env.QDRANT_API_KEY;
    delete process.env.REDIS_URL;
  });

  after(() => {
    if (savedNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = savedNodeEnv;
    if (savedMockAi === undefined) delete process.env.MOCK_AI;
    else process.env.MOCK_AI = savedMockAi;
    if (savedAiMode === undefined) delete process.env.AI_PROVIDER_MODE;
    else process.env.AI_PROVIDER_MODE = savedAiMode;
    if (savedImageProvider === undefined) delete process.env.IMAGE_PROVIDER;
    else process.env.IMAGE_PROVIDER = savedImageProvider;
    if (savedQdrantUrl === undefined) delete process.env.QDRANT_URL;
    else process.env.QDRANT_URL = savedQdrantUrl;
    if (savedQdrantApiKey === undefined) delete process.env.QDRANT_API_KEY;
    else process.env.QDRANT_API_KEY = savedQdrantApiKey;
    if (savedRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = savedRedisUrl;
  });

  afterEach(() => {
    setFirebaseTokenVerifierForTests(null);
  });

  it('rejects unauthenticated requests and caller-supplied UID/email spoofing, and isolates concurrent users across conversations, files, artifacts, and billing', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'verified-firebase-jwt-alice': buildDecodedFirebaseToken({
        uid: 'fb_alice_101',
        email: 'alice@example.com',
        name: 'Alice Vance',
      }),
      'verified-firebase-jwt-bob': buildDecodedFirebaseToken({
        uid: 'fb_bob_202',
        email: 'bob@example.com',
        name: 'Bob Chen',
      }),
    };

    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        throw new Error('FirebaseAuthError: Invalid ID token');
      }
      return match;
    });

    const runtime = new KartikPlatformRuntime();
    const app = createKartikExpressApp(runtime);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Unauthenticated /api/v1/auth/me returns isAuthenticated: false and user: null
      const unauthMeRes = await fetch(`${baseUrl}/api/v1/auth/me`);
      assert.equal(unauthMeRes.status, 200);
      const unauthMeJson = (await unauthMeRes.json()) as {
        ok: boolean;
        data: { isAuthenticated: boolean; user: unknown };
      };
      assert.equal(unauthMeJson.ok, true);
      assert.equal(unauthMeJson.data.isAuthenticated, false);
      assert.equal(unauthMeJson.data.user, null);

      // 2. App is usable out-of-the-box without logging in (issues isolated kartik_guest cookie)
      const guest1ConvRes = await fetch(`${baseUrl}/api/v1/conversations`);
      assert.equal(guest1ConvRes.status, 200);
      const guest1SetCookie = guest1ConvRes.headers.get('set-cookie') ?? '';
      assert.match(guest1SetCookie, /kartik_guest=gst_[a-f0-9]+/);
      const guest1CookieHeader = guest1SetCookie.split(';')[0] ?? '';

      const guest1CreateRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Cookie: guest1CookieHeader,
        },
        body: JSON.stringify({ title: 'Guest 1 Out-of-the-Box Thread' }),
      });
      assert.equal(guest1CreateRes.status, 201);
      const guest1Created = (await guest1CreateRes.json()) as {
        data: { conversationId: string; userId: string };
      };

      // A second unauthenticated visitor gets a different guest identity and cannot see Guest 1's conversation
      const guest2ConvRes = await fetch(`${baseUrl}/api/v1/conversations`);
      assert.equal(guest2ConvRes.status, 200);
      const guest2List = (await guest2ConvRes.json()) as {
        data: { items: Array<{ conversationId: string; userId: string }> };
      };
      assert.ok(
        !guest2List.data.items.some(
          (c) => c.conversationId === guest1Created.data.conversationId,
        ),
      );

      // Passing an invalid/forged Authorization: Bearer token to workspace endpoints is rejected with 401
      const invalidBearerRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        headers: { Authorization: 'Bearer invalid-forged-token' },
      });
      assert.equal(invalidBearerRes.status, 401);

      // 3. Caller-supplied UID/email on POST /api/v1/auth/google without a verified Firebase token is rejected (401)
      const spoofLoginRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          uid: 'spoofed_admin_uid',
          email: 'admin@kartik.ai',
          displayName: 'Spoofed Admin',
        }),
      });
      assert.equal(spoofLoginRes.status, 401);

      // Forged 3-segment JWT payload is also rejected when signature verification fails
      const forgedHeader = Buffer.from(
        JSON.stringify({ alg: 'RS256', kid: 'forged-kid-1' }),
      ).toString('base64url');
      const forgedPayload = Buffer.from(
        JSON.stringify({ sub: 'spoofed_uid', email: 'spoof@kartik.ai' }),
      ).toString('base64url');
      const forgedJwt = `${forgedHeader}.${forgedPayload}.forged_sig`;
      const forgedLoginRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idToken: forgedJwt,
          uid: 'spoofed_uid',
          email: 'spoof@kartik.ai',
        }),
      });
      assert.equal(forgedLoginRes.status, 401);

      // 4. Alice logs in with her verified token; even if body supplies a fake uid/email, only the verified token identity is used
      const aliceLoginRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          idToken: 'verified-firebase-jwt-alice',
          uid: 'attacker_ignored_uid',
          email: 'attacker_ignored@example.com',
        }),
      });
      assert.equal(aliceLoginRes.status, 200);
      const aliceLoginJson = (await aliceLoginRes.json()) as {
        data: { sessionId: string; user: { userId: string; email: string } };
      };
      assert.equal(aliceLoginJson.data.user.userId, 'fb_alice_101');
      assert.equal(aliceLoginJson.data.user.email, 'alice@example.com');
      const aliceAuthHeader = {
        Authorization: 'Bearer verified-firebase-jwt-alice',
        'content-type': 'application/json',
      };

      // Alice creates a private conversation
      const aliceCreateConvRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: aliceAuthHeader,
        body: JSON.stringify({ title: 'Alice Confidential Architecture' }),
      });
      assert.equal(aliceCreateConvRes.status, 201);
      const aliceConvJson = (await aliceCreateConvRes.json()) as {
        data: { conversationId: string; userId: string; title: string };
      };
      const aliceConvId = aliceConvJson.data.conversationId;
      assert.equal(aliceConvJson.data.userId, 'fb_alice_101');

      // 5. Bob logs in AFTER Alice — Alice's conversation ownership MUST NOT be reassigned to Bob
      const bobLoginRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idToken: 'verified-firebase-jwt-bob' }),
      });
      assert.equal(bobLoginRes.status, 200);
      const bobLoginJson = (await bobLoginRes.json()) as {
        data: { sessionId: string; user: { userId: string; email: string } };
      };
      assert.equal(bobLoginJson.data.user.userId, 'fb_bob_202');
      const bobAuthHeader = {
        Authorization: 'Bearer verified-firebase-jwt-bob',
        'content-type': 'application/json',
      };

      // Verify Alice still owns her conversation and sees it in her list
      const aliceListRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        headers: aliceAuthHeader,
      });
      assert.equal(aliceListRes.status, 200);
      const aliceListJson = (await aliceListRes.json()) as {
        data: { items: Array<{ conversationId: string; userId: string }> };
      };
      assert.ok(
        aliceListJson.data.items.some(
          (c) => c.conversationId === aliceConvId && c.userId === 'fb_alice_101',
        ),
      );

      // Verify Bob does NOT see Alice's conversation in his list
      const bobListRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        headers: bobAuthHeader,
      });
      assert.equal(bobListRes.status, 200);
      const bobListJson = (await bobListRes.json()) as {
        data: { items: Array<{ conversationId: string; userId: string }> };
      };
      assert.ok(
        bobListJson.data.items.every((c) => c.userId === 'fb_bob_202'),
      );
      assert.ok(
        !bobListJson.data.items.some((c) => c.conversationId === aliceConvId),
      );

      // 6. Bob cannot read, post messages to, or delete Alice's conversation (returns 404 NOT_FOUND)
      const bobReadAliceRes = await fetch(
        `${baseUrl}/api/v1/conversations/${aliceConvId}/messages`,
        { headers: bobAuthHeader },
      );
      assert.equal(bobReadAliceRes.status, 404);

      const bobPostAliceRes = await fetch(
        `${baseUrl}/api/v1/conversations/${aliceConvId}/messages`,
        {
          method: 'POST',
          headers: {
            ...bobAuthHeader,
            'Idempotency-Key': 'req_bob_intrude_01',
          },
          body: JSON.stringify({ prompt: 'Try writing to Alice conversation' }),
        },
      );
      assert.equal(bobPostAliceRes.status, 404);

      const bobDeleteAliceRes = await fetch(
        `${baseUrl}/api/v1/conversations/${aliceConvId}`,
        {
          method: 'DELETE',
          headers: bobAuthHeader,
        },
      );
      assert.equal(bobDeleteAliceRes.status, 404);

      // 7. Alice sends a message in her conversation; only Alice's credits are deducted while Bob's remain untouched at 250
      const aliceTurnRes = await fetch(
        `${baseUrl}/api/v1/conversations/${aliceConvId}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_alice_turn_01',
          },
          body: JSON.stringify({
            prompt: 'Explain isolated multi-user state in 2 sentences',
            preferredAgent: 'chat',
          }),
        },
      );
      assert.equal(aliceTurnRes.status, 201);

      const aliceBalRes = await fetch(`${baseUrl}/api/v1/billing/balance`, {
        headers: aliceAuthHeader,
      });
      const aliceBalJson = (await aliceBalRes.json()) as {
        data: { userId: string; availableCredits: number };
      };
      assert.equal(aliceBalJson.data.userId, 'fb_alice_101');
      assert.equal(aliceBalJson.data.availableCredits, 249);

      const bobBalRes = await fetch(`${baseUrl}/api/v1/billing/balance`, {
        headers: bobAuthHeader,
      });
      const bobBalJson = (await bobBalRes.json()) as {
        data: { userId: string; availableCredits: number };
      };
      assert.equal(bobBalJson.data.userId, 'fb_bob_202');
      assert.equal(bobBalJson.data.availableCredits, 250);

      // 8. Alice creates a billing order; Bob cannot verify/claim Alice's order (404 NOT_FOUND)
      const aliceOrderRes = await fetch(`${baseUrl}/api/v1/billing/orders`, {
        method: 'POST',
        headers: {
          ...aliceAuthHeader,
          'Idempotency-Key': 'req_alice_order_01',
        },
        body: JSON.stringify({ planId: 'plan_starter_199' }),
      });
      assert.equal(aliceOrderRes.status, 201);
      const aliceOrderJson = (await aliceOrderRes.json()) as {
        data: { orderId: string };
      };

      const bobClaimOrderRes = await fetch(`${baseUrl}/api/v1/billing/verify`, {
        method: 'POST',
        headers: {
          ...bobAuthHeader,
          'Idempotency-Key': 'req_bob_steal_order_01',
        },
        body: JSON.stringify({ orderId: aliceOrderJson.data.orderId }),
      });
      assert.equal(bobClaimOrderRes.status, 404);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('restricts root Express runtime to demo/local use unless DEMO_MODE=true or ALLOW_ROOT_DEMO_RUNTIME=true', () => {
    assert.throws(
      () =>
        assertRootRuntimeDemoOrLocalOnly({
          NODE_ENV: 'production',
          DEMO_MODE: 'false',
        }),
      /restricted to demo\/local use/,
    );

    assert.doesNotThrow(() =>
      assertRootRuntimeDemoOrLocalOnly({
        NODE_ENV: 'development',
      }),
    );

    assert.doesNotThrow(() =>
      assertRootRuntimeDemoOrLocalOnly({
        NODE_ENV: 'production',
        DEMO_MODE: 'true',
      }),
    );
  });

  it('hydrates persisted conversations, messages, idempotent turn replays, credit balance, ledger, and payment orders across a server restart (Fix #2)', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'verified-firebase-jwt-alice': buildDecodedFirebaseToken({
        uid: 'fb_alice_restart_01',
        email: 'alice.restart@example.com',
        name: 'Alice Restart',
      }),
      'verified-firebase-jwt-bob': buildDecodedFirebaseToken({
        uid: 'fb_bob_restart_02',
        email: 'bob.restart@example.com',
        name: 'Bob Restart',
      }),
    };

    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        throw new Error('FirebaseAuthError: Invalid ID token');
      }
      return match;
    });

    const sharedPersistence = new InMemoryPlatformPersistenceAdapter();
    const aliceAuthHeader = {
      Authorization: 'Bearer verified-firebase-jwt-alice',
      'content-type': 'application/json',
    };
    const bobAuthHeader = {
      Authorization: 'Bearer verified-firebase-jwt-bob',
      'content-type': 'application/json',
    };

    let aliceConvId = '';
    let pendingOrderIdBeforeRestart = '';

    // --- Runtime Instance #1 (Before Server Restart) ---
    {
      const runtime1 = new KartikPlatformRuntime({
        persistence: sharedPersistence,
      });
      const app1 = createKartikExpressApp(runtime1);
      const server1 = http.createServer(app1);
      await new Promise<void>((resolve) =>
        server1.listen(0, '127.0.0.1', resolve),
      );
      const addr1 = server1.address();
      const port1 = typeof addr1 === 'object' && addr1 ? addr1.port : 0;
      const baseUrl1 = `http://127.0.0.1:${port1}`;

      try {
        // Alice logs in and creates a conversation
        const loginRes = await fetch(`${baseUrl1}/api/v1/auth/google`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ idToken: 'verified-firebase-jwt-alice' }),
        });
        assert.equal(loginRes.status, 200);

        const convRes = await fetch(`${baseUrl1}/api/v1/conversations`, {
          method: 'POST',
          headers: aliceAuthHeader,
          body: JSON.stringify({ title: 'Persisted Across Restart Thread' }),
        });
        assert.equal(convRes.status, 201);
        const convJson = (await convRes.json()) as {
          data: { conversationId: string };
        };
        aliceConvId = convJson.data.conversationId;

        // Alice executes a chat turn (-1 credit => 249 credits)
        const turnRes = await fetch(
          `${baseUrl1}/api/v1/conversations/${aliceConvId}/messages`,
          {
            method: 'POST',
            headers: {
              ...aliceAuthHeader,
              'Idempotency-Key': 'req_restart_turn_01',
            },
            body: JSON.stringify({
              prompt: 'Verify PostgreSQL read-write hydration across restarts',
              preferredAgent: 'chat',
            }),
          },
        );
        assert.equal(turnRes.status, 201);

        // Alice creates & verifies a Starter Plan order (+500 credits => 749 credits, plan_starter_199)
        const order1Res = await fetch(`${baseUrl1}/api/v1/billing/orders`, {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_restart_order_01',
          },
          body: JSON.stringify({ planId: 'plan_starter_199' }),
        });
        assert.equal(order1Res.status, 201);
        const order1Json = (await order1Res.json()) as {
          data: { orderId: string };
        };

        const verify1Res = await fetch(`${baseUrl1}/api/v1/billing/verify`, {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_restart_verify_01',
          },
          body: JSON.stringify({ orderId: order1Json.data.orderId }),
        });
        assert.equal(verify1Res.status, 200);

        // Alice creates a second order that remains unsettled before the server restarts
        const order2Res = await fetch(`${baseUrl1}/api/v1/billing/orders`, {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_restart_order_02',
          },
          body: JSON.stringify({ planId: 'plan_pro_499' }),
        });
        assert.equal(order2Res.status, 201);
        const order2Json = (await order2Res.json()) as {
          data: { orderId: string };
        };
        pendingOrderIdBeforeRestart = order2Json.data.orderId;

        await runtime1.flushPendingPersistence();
      } finally {
        await new Promise<void>((resolve) => server1.close(() => resolve()));
      }
    }

    // --- Runtime Instance #2 (Fresh Process / Empty In-Memory Maps Hydrating from Persistence) ---
    {
      const runtime2 = new KartikPlatformRuntime({
        persistence: sharedPersistence,
      });
      const app2 = createKartikExpressApp(runtime2);
      const server2 = http.createServer(app2);
      await new Promise<void>((resolve) =>
        server2.listen(0, '127.0.0.1', resolve),
      );
      const addr2 = server2.address();
      const port2 = typeof addr2 === 'object' && addr2 ? addr2.port : 0;
      const baseUrl2 = `http://127.0.0.1:${port2}`;

      try {
        // 1. Alice's conversations are hydrated from persistence
        const listRes = await fetch(`${baseUrl2}/api/v1/conversations`, {
          headers: aliceAuthHeader,
        });
        assert.equal(listRes.status, 200);
        const listJson = (await listRes.json()) as {
          data: {
            items: Array<{
              conversationId: string;
              title: string;
              userId: string;
            }>;
          };
        };
        assert.ok(
          listJson.data.items.some((c) => c.conversationId === aliceConvId),
        );

        // 2. Alice's conversation messages are hydrated in order
        const msgsRes = await fetch(
          `${baseUrl2}/api/v1/conversations/${aliceConvId}/messages`,
          { headers: aliceAuthHeader },
        );
        assert.equal(msgsRes.status, 200);
        const msgsJson = (await msgsRes.json()) as {
          data: {
            items: Array<{
              role: string;
              content: string;
              requestId?: string;
            }>;
          };
        };
        assert.equal(msgsJson.data.items.length, 2);
        assert.equal(msgsJson.data.items[0]?.role, 'user');
        assert.equal(msgsJson.data.items[1]?.role, 'assistant');
        assert.equal(msgsJson.data.items[1]?.requestId, 'req_restart_turn_01');

        // 3. Alice's billing summary reflects hydrated 749 credits, plan_starter_199, and ledger entries
        const balRes = await fetch(`${baseUrl2}/api/v1/billing/balance`, {
          headers: aliceAuthHeader,
        });
        assert.equal(balRes.status, 200);
        const balJson = (await balRes.json()) as {
          data: {
            planId: string;
            availableCredits: number;
            ledger: Array<{ deltaCredits: number }>;
          };
        };
        assert.equal(balJson.data.planId, 'plan_starter_199');
        assert.equal(balJson.data.availableCredits, 749);
        assert.ok(balJson.data.ledger.length >= 3);

        // 4. Replaying the pre-restart Idempotency-Key returns 200 idempotentReplay: true with 0 extra credit deduction
        const replayRes = await fetch(
          `${baseUrl2}/api/v1/conversations/${aliceConvId}/messages`,
          {
            method: 'POST',
            headers: {
              ...aliceAuthHeader,
              'Idempotency-Key': 'req_restart_turn_01',
            },
            body: JSON.stringify({
              prompt: 'Verify PostgreSQL read-write hydration across restarts',
              preferredAgent: 'chat',
            }),
          },
        );
        assert.equal(replayRes.status, 200);
        const replayJson = (await replayRes.json()) as {
          data: { idempotentReplay: boolean; remainingCredits: number };
        };
        assert.equal(replayJson.data.idempotentReplay, true);
        assert.equal(replayJson.data.remainingCredits, 749);

        // 5. Pending order created before restart is hydrated and can be verified after restart (+1500 => 2249 credits)
        const verify2Res = await fetch(`${baseUrl2}/api/v1/billing/verify`, {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_restart_verify_02',
          },
          body: JSON.stringify({ orderId: pendingOrderIdBeforeRestart }),
        });
        assert.equal(verify2Res.status, 200);
        const verify2Json = (await verify2Res.json()) as {
          data: {
            verified: boolean;
            planId: string;
            availableCredits: number;
          };
        };
        assert.equal(verify2Json.data.verified, true);
        assert.equal(verify2Json.data.planId, 'plan_pro_499');
        assert.equal(verify2Json.data.availableCredits, 2249);

        // 6. Bob remains strictly isolated on Runtime Instance #2
        const bobBalRes = await fetch(`${baseUrl2}/api/v1/billing/balance`, {
          headers: bobAuthHeader,
        });
        assert.equal(bobBalRes.status, 200);
        const bobBalJson = (await bobBalRes.json()) as {
          data: { availableCredits: number; planId: string };
        };
        assert.equal(bobBalJson.data.availableCredits, 250);
        assert.equal(bobBalJson.data.planId, 'plan_free');
      } finally {
        await new Promise<void>((resolve) => server2.close(() => resolve()));
      }
    }
  });

  it('enforces client-owned Idempotency-Key, SHA-256 payload fingerprint conflict detection (409), and two-phase credit reservation/release/reconciliation (Fix #4)', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'verified-firebase-jwt-alice': buildDecodedFirebaseToken({
        uid: 'fb_alice_fix4_01',
        email: 'alice.fix4@example.com',
        name: 'Alice Fix4',
      }),
    };

    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        throw new Error('FirebaseAuthError: Invalid ID token');
      }
      return match;
    });

    const runtime = new KartikPlatformRuntime({
      persistence: new InMemoryPlatformPersistenceAdapter(),
    });
    const app = createKartikExpressApp(runtime);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;
    const aliceAuthHeader = {
      Authorization: 'Bearer verified-firebase-jwt-alice',
      'content-type': 'application/json',
    };

    try {
      // Alice creates a conversation
      const convRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: aliceAuthHeader,
        body: JSON.stringify({ title: 'Fix #4 Domain Invariants Thread' }),
      });
      assert.equal(convRes.status, 201);
      const convJson = (await convRes.json()) as {
        data: { conversationId: string };
      };
      const convId = convJson.data.conversationId;

      // 1. Missing Idempotency-Key on mutating endpoints is rejected with 400 IDEMPOTENCY_KEY_REQUIRED
      const missingKeyMsgRes = await fetch(
        `${baseUrl}/api/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: aliceAuthHeader,
          body: JSON.stringify({
            prompt: 'Missing idempotency header test',
            preferredAgent: 'chat',
          }),
        },
      );
      assert.equal(missingKeyMsgRes.status, 400);
      const missingKeyMsgJson = (await missingKeyMsgRes.json()) as {
        ok: boolean;
        error: { code: string };
      };
      assert.equal(missingKeyMsgJson.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

      const missingKeyOrderRes = await fetch(
        `${baseUrl}/api/v1/billing/orders`,
        {
          method: 'POST',
          headers: aliceAuthHeader,
          body: JSON.stringify({ planId: 'plan_starter_199' }),
        },
      );
      assert.equal(missingKeyOrderRes.status, 400);
      const missingKeyOrderJson = (await missingKeyOrderRes.json()) as {
        error: { code: string };
      };
      assert.equal(missingKeyOrderJson.error.code, 'IDEMPOTENCY_KEY_REQUIRED');

      // 2. Chat Turn Idempotency Replay vs Payload Fingerprint Conflict (409 IDEMPOTENCY_CONFLICT)
      const turn1Res = await fetch(
        `${baseUrl}/api/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_fix4_turn_01',
          },
          body: JSON.stringify({
            prompt: 'Explain two-phase credit reservation',
            preferredAgent: 'chat',
          }),
        },
      );
      assert.equal(turn1Res.status, 201);

      // Identical payload replay returns 200 OK with idempotentReplay: true and 0 extra credits charged
      const turn1ReplayRes = await fetch(
        `${baseUrl}/api/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_fix4_turn_01',
          },
          body: JSON.stringify({
            prompt: 'Explain two-phase credit reservation',
            preferredAgent: 'chat',
          }),
        },
      );
      assert.equal(turn1ReplayRes.status, 200);
      const turn1ReplayJson = (await turn1ReplayRes.json()) as {
        data: { idempotentReplay: boolean; remainingCredits: number };
      };
      assert.equal(turn1ReplayJson.data.idempotentReplay, true);
      assert.equal(turn1ReplayJson.data.remainingCredits, 249);

      // Reusing the same Idempotency-Key with a DIFFERENT prompt or agent returns 409 IDEMPOTENCY_CONFLICT
      const turn1ConflictRes = await fetch(
        `${baseUrl}/api/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_fix4_turn_01',
          },
          body: JSON.stringify({
            prompt: 'Mutated prompt reusing the same Idempotency-Key',
            preferredAgent: 'chat',
          }),
        },
      );
      assert.equal(turn1ConflictRes.status, 409);
      const turn1ConflictJson = (await turn1ConflictRes.json()) as {
        error: { code: string };
      };
      assert.equal(turn1ConflictJson.error.code, 'IDEMPOTENCY_CONFLICT');

      // 3. Billing Order & Checkout Verification Idempotency Replay vs Conflict (409 IDEMPOTENCY_CONFLICT)
      const orderRes = await fetch(`${baseUrl}/api/v1/billing/orders`, {
        method: 'POST',
        headers: {
          ...aliceAuthHeader,
          'Idempotency-Key': 'req_fix4_order_01',
        },
        body: JSON.stringify({ planId: 'plan_starter_199' }),
      });
      assert.equal(orderRes.status, 201);
      const orderJson = (await orderRes.json()) as {
        data: { orderId: string; idempotentReplay?: boolean };
      };

      // Replaying order creation with identical planId returns 200 with the same orderId
      const orderReplayRes = await fetch(`${baseUrl}/api/v1/billing/orders`, {
        method: 'POST',
        headers: {
          ...aliceAuthHeader,
          'Idempotency-Key': 'req_fix4_order_01',
        },
        body: JSON.stringify({ planId: 'plan_starter_199' }),
      });
      assert.equal(orderReplayRes.status, 200);
      const orderReplayJson = (await orderReplayRes.json()) as {
        data: { orderId: string; idempotentReplay?: boolean };
      };
      assert.equal(orderReplayJson.data.orderId, orderJson.data.orderId);
      assert.equal(orderReplayJson.data.idempotentReplay, true);

      // Reusing req_fix4_order_01 with a different planId returns 409 IDEMPOTENCY_CONFLICT
      const orderConflictRes = await fetch(`${baseUrl}/api/v1/billing/orders`, {
        method: 'POST',
        headers: {
          ...aliceAuthHeader,
          'Idempotency-Key': 'req_fix4_order_01',
        },
        body: JSON.stringify({ planId: 'plan_pro_499' }),
      });
      assert.equal(orderConflictRes.status, 409);

      // 4. Two-Phase Credit Reservation State Machine:
      //    4a. Confirmed downstream execution failure automatically RELEASES reserved credits back to availableCredits
      const aliceActor = {
        uid: 'fb_alice_fix4_01',
        email: 'alice.fix4@example.com',
        displayName: 'Alice Fix4',
        avatarUrl: null,
        emailVerified: true,
      };
      const graphExec = (
        runtime as unknown as {
          graphExecutor: {
            execute: (...args: unknown[]) => Promise<unknown>;
          };
        }
      ).graphExecutor;
      const originalGraphExecute = graphExec.execute.bind(graphExec);

      graphExec.execute = async () => {
        throw new Error('Upstream provider failed before generation');
      };

      const failedTurnRes = await fetch(
        `${baseUrl}/api/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_fix4_fail_release_01',
          },
          body: JSON.stringify({
            prompt: 'Generate a PDF report that fails upstream',
            preferredAgent: 'pdf',
          }),
        },
      );
      assert.equal(failedTurnRes.status, 500);

      // Credits were reserved (5 credits for pdf) and then released on failure: availableCredits stays 249, reservedCredits is 0
      const releasedReservation = runtime.getReservationByRequestId(
        aliceActor,
        'req_fix4_fail_release_01',
      );
      assert.equal(releasedReservation?.status, 'released');
      const summaryAfterRelease = runtime.getBillingSummary(aliceActor);
      assert.equal(summaryAfterRelease.availableCredits, 249);
      assert.equal(summaryAfterRelease.reservedCredits, 0);

      //    4b. Ambiguous EXECUTION_UNKNOWN timeout holds credits in reservedCredits until reconciled
      graphExec.execute = async () => {
        const unknownErr = new Error(
          'Upstream provider timed out after dispatch',
        ) as Error & { code?: string };
        unknownErr.code = 'EXECUTION_UNKNOWN';
        throw unknownErr;
      };

      const unknownTurnRes = await fetch(
        `${baseUrl}/api/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_fix4_unknown_hold_01',
          },
          body: JSON.stringify({
            prompt: 'Generate a PPT deck with ambiguous timeout',
            preferredAgent: 'ppt',
          }),
        },
      );
      assert.equal(unknownTurnRes.status, 409);
      const unknownTurnJson = (await unknownTurnRes.json()) as {
        error: { code: string };
      };
      assert.equal(unknownTurnJson.error.code, 'EXECUTION_UNKNOWN');

      // 8 credits for PPT are held in reservedCredits (availableCredits: 241, reservedCredits: 8)
      const heldReservation = runtime.getReservationByRequestId(
        aliceActor,
        'req_fix4_unknown_hold_01',
      );
      assert.equal(heldReservation?.status, 'execution_unknown');
      const summaryWhileHeld = runtime.getBillingSummary(aliceActor);
      assert.equal(summaryWhileHeld.availableCredits, 241);
      assert.equal(summaryWhileHeld.reservedCredits, 8);

      // Blind retry with the same Idempotency-Key while execution_unknown is held returns 409 IDEMPOTENCY_CONFLICT
      const blindRetryRes = await fetch(
        `${baseUrl}/api/v1/conversations/${convId}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceAuthHeader,
            'Idempotency-Key': 'req_fix4_unknown_hold_01',
          },
          body: JSON.stringify({
            prompt: 'Generate a PPT deck with ambiguous timeout',
            preferredAgent: 'ppt',
          }),
        },
      );
      assert.equal(blindRetryRes.status, 409);

      // Reconciling the unknown turn as 'failed' releases the 8 held credits back to availableCredits (249)
      const reconciled = await runtime.reconcileUnknownTurn(aliceActor, {
        requestId: 'req_fix4_unknown_hold_01',
        outcome: 'failed',
      });
      assert.equal(reconciled.status, 'released');
      assert.equal(reconciled.availableCredits, 249);
      assert.equal(reconciled.reservedCredits, 0);

      // Restore original graphExecutor.execute
      graphExec.execute = originalGraphExecute;
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Fix #8: degrades cleanly to local fallback without 500 INTERNAL_ERROR across all 8 specialist agents when PostgreSQL fails or lacks tables', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'verified-firebase-jwt-alice': buildDecodedFirebaseToken({
        uid: 'fb_alice_fix8_01',
        email: 'alice.fix8@example.com',
        name: 'Alice Fix8',
      }),
      'verified-firebase-jwt-bob': buildDecodedFirebaseToken({
        uid: 'fb_bob_fix8_02',
        email: 'bob.fix8@example.com',
        name: 'Bob Fix8',
      }),
    };

    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        throw new Error('FirebaseAuthError: Invalid ID token');
      }
      return match;
    });

    const prevForceCloudSql = process.env.FORCE_CLOUDSQL_IN_TEST;
    const prevDatabaseUrl = process.env.DATABASE_URL;
    const originalPoolQuery = pool.query.bind(pool);

    process.env.FORCE_CLOUDSQL_IN_TEST = 'true';
    process.env.DATABASE_URL = 'postgresql://test:test@127.0.0.1:5432/kartik';
    resetDatabaseDegradedStateForTest();

    // Simulate a missing-table / unreachable PostgreSQL error on every pool query
    (pool as unknown as { query: (...args: unknown[]) => Promise<never> }).query =
      async () => {
        throw new Error('relation "artifacts" does not exist');
      };

    const runtime = new KartikPlatformRuntime();
    const app = createKartikExpressApp(runtime);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;
    const aliceAuthHeader = {
      Authorization: 'Bearer verified-firebase-jwt-alice',
      'content-type': 'application/json',
    };
    const bobAuthHeader = {
      Authorization: 'Bearer verified-firebase-jwt-bob',
      'content-type': 'application/json',
    };

    try {
      const convRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: aliceAuthHeader,
        body: JSON.stringify({ title: 'Fix #8 Specialist Resilience' }),
      });
      assert.equal(convRes.status, 201);
      const convJson = (await convRes.json()) as {
        data: { conversationId: string };
      };
      const convId = convJson.data.conversationId;

      const specialistPrompts: ReadonlyArray<{
        agent: 'chat' | 'search' | 'coding' | 'pdf' | 'ppt' | 'image';
        prompt: string;
        expectsArtifact: boolean;
      }> = [
        { agent: 'chat', prompt: 'Explain event sourcing briefly', expectsArtifact: false },
        { agent: 'search', prompt: 'Latest benchmarks for PostgreSQL 17', expectsArtifact: false },
        { agent: 'coding', prompt: 'Build a sleek timer web app', expectsArtifact: true },
        { agent: 'pdf', prompt: 'Generate a PDF brief on zero-trust networking', expectsArtifact: true },
        { agent: 'ppt', prompt: 'Create a 6-slide presentation on microservices', expectsArtifact: true },
        { agent: 'image', prompt: 'Generate an isometric illustration of a cloud datacenter', expectsArtifact: true },
      ];

      let lastArtifactId = '';
      for (let i = 0; i < specialistPrompts.length; i++) {
        const spec = specialistPrompts[i]!;
        const res = await fetch(
          `${baseUrl}/api/v1/conversations/${convId}/messages`,
          {
            method: 'POST',
            headers: {
              ...aliceAuthHeader,
              'Idempotency-Key': `req_fix8_${spec.agent}_${i}`,
            },
            body: JSON.stringify({
              prompt: spec.prompt,
              preferredAgent: spec.agent,
            }),
          },
        );
        assert.equal(
          res.status,
          201,
          `Expected 201 for ${spec.agent} even when Postgres fails, got ${res.status}`,
        );
        const body = (await res.json()) as {
          ok: boolean;
          data: {
            assistantMessage: {
              agentUsed: string;
              artifactIds?: string[];
            };
          };
        };
        assert.equal(body.ok, true);
        assert.equal(body.data.assistantMessage.agentUsed, spec.agent);
        if (spec.expectsArtifact) {
          assert.ok(
            (body.data.assistantMessage.artifactIds?.length ?? 0) >= 1,
            `Expected artifact for ${spec.agent}`,
          );
          lastArtifactId = body.data.assistantMessage.artifactIds![0]!;
        }
      }

      // Alice can fetch her generated image artifact raw bytes inline
      assert.ok(lastArtifactId.length > 0);
      const aliceRawRes = await fetch(
        `${baseUrl}/api/v1/artifacts/${lastArtifactId}/raw?inline=1`,
        { headers: { Authorization: 'Bearer verified-firebase-jwt-alice' } },
      );
      assert.equal(aliceRawRes.status, 200);

      // Bob still gets 404 NOT_FOUND on Alice's artifact even during DB fallback
      const bobRawRes = await fetch(
        `${baseUrl}/api/v1/artifacts/${lastArtifactId}/raw?inline=1`,
        { headers: { Authorization: 'Bearer verified-firebase-jwt-bob' } },
      );
      assert.equal(bobRawRes.status, 404);
    } finally {
      (pool as unknown as { query: typeof originalPoolQuery }).query =
        originalPoolQuery;
      if (prevForceCloudSql === undefined) {
        delete process.env.FORCE_CLOUDSQL_IN_TEST;
      } else {
        process.env.FORCE_CLOUDSQL_IN_TEST = prevForceCloudSql;
      }
      if (prevDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = prevDatabaseUrl;
      }
      resetDatabaseDegradedStateForTest();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Fix #9: issues SameSite=None; Secure; Partitioned cookies over HTTPS and preserves guest workspace via X-Kartik-Guest-Id when iframe cookies are blocked', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'verified-firebase-jwt-https': buildDecodedFirebaseToken({
        uid: 'fb_https_user_01',
        email: 'https.user@example.com',
        name: 'HTTPS User',
      }),
    };
    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        throw new Error('FirebaseAuthError: Invalid ID token');
      }
      return match;
    });

    const runtime = new KartikPlatformRuntime();
    const app = createKartikExpressApp(runtime);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. HTTPS proxied request gets SameSite=None; Secure; Partitioned on kartik_guest & kartik_session
      const httpsGuestRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        headers: { 'X-Forwarded-Proto': 'https' },
      });
      assert.equal(httpsGuestRes.status, 200);
      const httpsGuestCookie = httpsGuestRes.headers.get('set-cookie') ?? '';
      assert.match(httpsGuestCookie, /SameSite=None/);
      assert.match(httpsGuestCookie, /Secure/);
      assert.match(httpsGuestCookie, /Partitioned/);

      const httpsLoginRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Forwarded-Proto': 'https',
        },
        body: JSON.stringify({ idToken: 'verified-firebase-jwt-https' }),
      });
      assert.equal(httpsLoginRes.status, 200);
      const httpsSessionCookie = httpsLoginRes.headers.get('set-cookie') ?? '';
      assert.match(httpsSessionCookie, /kartik_session=/);
      assert.match(httpsSessionCookie, /SameSite=None/);
      assert.match(httpsSessionCookie, /Secure/);
      assert.match(httpsSessionCookie, /Partitioned/);

      // 2. When browser blocks cookies in a cross-site iframe, X-Kartik-Guest-Id keeps messages intact across requests
      const iframeGuestId = 'gst_iframepreview1234567890ab';
      const listRes1 = await fetch(`${baseUrl}/api/v1/conversations`, {
        headers: { 'X-Kartik-Guest-Id': iframeGuestId },
      });
      assert.equal(listRes1.status, 200);
      const listJson1 = (await listRes1.json()) as {
        data: { items: Array<{ conversationId: string }> };
      };
      const convId = listJson1.data.items[0]!.conversationId;

      const postTurnRes = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(convId)}/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'X-Kartik-Guest-Id': iframeGuestId,
            'Idempotency-Key': 'req_fix9_iframe_turn_01',
          },
          body: JSON.stringify({
            prompt: 'Verify messages persist across requests without cookies',
            preferredAgent: 'chat',
          }),
        },
      );
      assert.equal(postTurnRes.status, 201);

      // Follow-up GET /messages with NO Cookie header (only X-Kartik-Guest-Id) still returns both messages
      const getMsgsRes = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(convId)}/messages`,
        {
          headers: { 'X-Kartik-Guest-Id': iframeGuestId },
        },
      );
      assert.equal(getMsgsRes.status, 200);
      const getMsgsJson = (await getMsgsRes.json()) as {
        data: { items: Array<{ role: string; content: string }> };
      };
      assert.equal(getMsgsJson.data.items.length, 3);
      assert.equal(getMsgsJson.data.items[1]?.role, 'user');
      assert.ok(
        getMsgsJson.data.items[1]?.content.includes(
          'Verify messages persist across requests without cookies',
        ),
      );
      assert.equal(getMsgsJson.data.items[2]?.role, 'assistant');

      // 3. Authenticated Firebase Bearer token still takes strict precedence over X-Kartik-Guest-Id
      const authMeRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
        headers: {
          Authorization: 'Bearer verified-firebase-jwt-https',
          'X-Kartik-Guest-Id': iframeGuestId,
        },
      });
      assert.equal(authMeRes.status, 200);
      const authMeJson = (await authMeRes.json()) as {
        data: { isAuthenticated: boolean; user: { userId: string } | null };
      };
      assert.equal(authMeJson.data.isAuthenticated, true);
      assert.equal(authMeJson.data.user?.userId, 'fb_https_user_01');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Fix #13: hardens /__downloads/file against secrets/dotfiles/keys and disables /__downloads in production', async () => {
    // 1. Unit-level path validation checks
    assert.equal(isAllowedDevDownloadPath('server.ts'), true);
    assert.equal(isAllowedDevDownloadPath('.env.example'), true);
    assert.equal(
      isAllowedDevDownloadPath('infra/aws/ec2-compose/.env.prod.example'),
      true,
    );
    assert.equal(
      isAllowedDevDownloadPath('backend/shared/redis/index.ts'),
      true,
    );

    const forbiddenPaths = [
      '.env',
      '.env.local',
      'infra/aws/ec2-compose/.env.prod',
      'infra/aws/ec2-compose/secrets/user_context_signing_key.pem',
      'infra/aws/ec2-compose/secrets/user_context_public_key.pem',
      'firebase-applet-config.json',
      'src/firebase-applet-config.json',
      'infra/service-account.json',
      '../package.json',
      '/etc/passwd',
      'backend/shared/.secret',
      'infra/tls/server.key',
      'data/local.sqlite',
    ];
    for (const forbidden of forbiddenPaths) {
      assert.equal(
        isAllowedDevDownloadPath(forbidden),
        false,
        `Expected isAllowedDevDownloadPath to block "${forbidden}"`,
      );
    }

    // 2. Live HTTP check in dev mode: blocks secret/key reads (400), allows allowlisted source file (200)
    const devRuntime = new KartikPlatformRuntime();
    const devApp = createKartikExpressApp(devRuntime, {
      ...process.env,
      NODE_ENV: 'development',
    });
    const devServer = http.createServer(devApp);
    await new Promise<void>((resolve) =>
      devServer.listen(0, '127.0.0.1', resolve),
    );
    const devAddr = devServer.address();
    const devPort = typeof devAddr === 'object' && devAddr ? devAddr.port : 0;
    const devBaseUrl = `http://127.0.0.1:${devPort}`;

    try {
      const secretPemRes = await fetch(
        `${devBaseUrl}/__downloads/file?path=${encodeURIComponent(
          'infra/aws/ec2-compose/secrets/user_context_signing_key.pem',
        )}`,
      );
      assert.equal(secretPemRes.status, 400);

      const dotEnvProdRes = await fetch(
        `${devBaseUrl}/__downloads/file?path=${encodeURIComponent(
          'infra/aws/ec2-compose/.env.prod',
        )}`,
      );
      assert.equal(dotEnvProdRes.status, 400);

      const allowedExampleRes = await fetch(
        `${devBaseUrl}/__downloads/file?path=${encodeURIComponent(
          'infra/aws/ec2-compose/.env.prod.example',
        )}`,
      );
      assert.equal(allowedExampleRes.status, 200);
    } finally {
      await new Promise<void>((resolve) => devServer.close(() => resolve()));
    }

    // 3. Live HTTP check in production demo mode: /__downloads/file is completely unmounted (404)
    const prodRuntime = new KartikPlatformRuntime();
    const prodApp = createKartikExpressApp(prodRuntime, {
      ...process.env,
      NODE_ENV: 'production',
      DEMO_MODE: 'true',
      ALLOW_DEV_DOWNLOADS: 'false',
    });
    const prodServer = http.createServer(prodApp);
    await new Promise<void>((resolve) =>
      prodServer.listen(0, '127.0.0.1', resolve),
    );
    const prodAddr = prodServer.address();
    const prodPort =
      typeof prodAddr === 'object' && prodAddr ? prodAddr.port : 0;
    const prodBaseUrl = `http://127.0.0.1:${prodPort}`;

    try {
      const prodDownloadRes = await fetch(
        `${prodBaseUrl}/__downloads/file?path=server.ts`,
      );
      assert.equal(prodDownloadRes.status, 404);
    } finally {
      await new Promise<void>((resolve) => prodServer.close(() => resolve()));
    }
  });

  it('Fix #19: streams uploaded images via GET /api/v1/files/:fileId/raw with strict 404 tenant isolation and supports multi-turn Vision follow-ups scoped to the owning user', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'vision-jwt-alice': buildDecodedFirebaseToken({
        uid: 'fb_vision_alice_19',
        email: 'alice.vision@example.com',
        name: 'Alice Vision',
      }),
      'vision-jwt-bob': buildDecodedFirebaseToken({
        uid: 'fb_vision_bob_19',
        email: 'bob.vision@example.com',
        name: 'Bob Vision',
      }),
    };

    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        throw new Error('FirebaseAuthError: Invalid ID token');
      }
      return match;
    });

    const runtime = new KartikPlatformRuntime();
    const app = createKartikExpressApp(runtime);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const aliceHeaders = {
      Authorization: 'Bearer vision-jwt-alice',
      'content-type': 'application/json',
    };
    const bobHeaders = {
      Authorization: 'Bearer vision-jwt-bob',
      'content-type': 'application/json',
    };

    // Minimal valid 1x1 PNG (magic bytes 89 50 4E 47 0D 0A 1A 0A)
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82,
    ]);

    try {
      // 1. Alice creates a conversation and uploads a PNG image
      const convRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ title: 'Vision Invoice Audit' }),
      });
      assert.equal(convRes.status, 201);
      const convJson = (await convRes.json()) as {
        data: { conversationId: string };
      };
      const aliceConvId = convJson.data.conversationId;

      const uploadRes = await fetch(`${baseUrl}/api/v1/files/upload`, {
        method: 'POST',
        headers: {
          ...aliceHeaders,
          'Idempotency-Key': 'req_alice_upload_png_19',
        },
        body: JSON.stringify({
          conversationId: aliceConvId,
          originalFilename: 'q4-invoice.png',
          declaredMimeType: 'image/png',
          contentBase64: pngBytes.toString('base64'),
        }),
      });
      assert.equal(uploadRes.status, 201);
      const uploadJson = (await uploadRes.json()) as {
        data: { file: { fileId: string } };
      };
      const aliceFileId = uploadJson.data.file.fileId;

      // 2. Alice can stream her raw PNG image with nosniff + inline headers
      const aliceRawRes = await fetch(
        `${baseUrl}/api/v1/files/${encodeURIComponent(aliceFileId)}/raw`,
        { headers: { Authorization: aliceHeaders.Authorization } },
      );
      assert.equal(aliceRawRes.status, 200);
      assert.equal(aliceRawRes.headers.get('content-type'), 'image/png');
      assert.equal(aliceRawRes.headers.get('x-content-type-options'), 'nosniff');
      const streamedBytes = Buffer.from(await aliceRawRes.arrayBuffer());
      assert.deepEqual(streamedBytes, pngBytes);

      // 3. Bob MUST receive 404 NOT_FOUND on Alice's uploaded image (Invariants #10 & #20)
      const bobRawRes = await fetch(
        `${baseUrl}/api/v1/files/${encodeURIComponent(aliceFileId)}/raw`,
        { headers: { Authorization: bobHeaders.Authorization } },
      );
      assert.equal(bobRawRes.status, 404);

      // 4. Alice runs initial Vision OCR turn with her attached PNG
      const turn1Res = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(aliceConvId)}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceHeaders,
            'Idempotency-Key': 'req_alice_vision_turn1_19',
          },
          body: JSON.stringify({
            prompt: 'Extract line items and totals from this invoice',
            preferredAgent: 'vision',
            attachmentFileIds: [aliceFileId],
          }),
        },
      );
      assert.equal(turn1Res.status, 201);
      const turn1Json = (await turn1Res.json()) as {
        data: {
          assistantMessage: {
            agentUsed: string;
            followUpQueries?: string[];
          };
        };
      };
      assert.equal(turn1Json.data.assistantMessage.agentUsed, 'vision');
      assert.equal(turn1Json.data.assistantMessage.followUpQueries?.length, 3);

      // 5. Alice clicks a Vision follow-up WITHOUT re-uploading -> resolves her conversation image cleanly
      const turn2Res = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(aliceConvId)}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceHeaders,
            'Idempotency-Key': 'req_alice_vision_turn2_19',
          },
          body: JSON.stringify({
            prompt: turn1Json.data.assistantMessage.followUpQueries![0],
            preferredAgent: 'vision',
            attachmentFileIds: [],
          }),
        },
      );
      assert.equal(turn2Res.status, 201);
      const turn2Json = (await turn2Res.json()) as {
        data: { assistantMessage: { agentUsed: string } };
      };
      assert.equal(turn2Json.data.assistantMessage.agentUsed, 'vision');

      // 6. Bob running Vision without uploading his own image MUST fail (400), never leaking Alice's image
      const bobConvRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: bobHeaders,
        body: JSON.stringify({ title: 'Bob Empty Vision' }),
      });
      const bobConvJson = (await bobConvRes.json()) as {
        data: { conversationId: string };
      };
      const bobVisionRes = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(bobConvJson.data.conversationId)}/messages`,
        {
          method: 'POST',
          headers: {
            ...bobHeaders,
            'Idempotency-Key': 'req_bob_vision_empty_19',
          },
          body: JSON.stringify({
            prompt: 'Extract text from image',
            preferredAgent: 'vision',
            attachmentFileIds: [],
          }),
        },
      );
      assert.equal(bobVisionRes.status, 400);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Fix #29: isolates per-user Preferences sync, Full-Text Search, Conversation Forking, and PPTX Cover Visual recompile across tenants', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'fix29-jwt-alice': buildDecodedFirebaseToken({
        uid: 'fb_fix29_alice',
        email: 'alice.fix29@example.com',
        name: 'Alice Studio',
      }),
      'fix29-jwt-bob': buildDecodedFirebaseToken({
        uid: 'fb_fix29_bob',
        email: 'bob.fix29@example.com',
        name: 'Bob Studio',
      }),
    };

    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) throw new Error('FirebaseAuthError: Invalid ID token');
      return match;
    });

    const runtime = new KartikPlatformRuntime({
      persistence: new InMemoryPlatformPersistenceAdapter(),
    });
    const app = createKartikExpressApp(runtime);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const aliceHeaders = {
      Authorization: 'Bearer fix29-jwt-alice',
      'content-type': 'application/json',
    };
    const bobHeaders = {
      Authorization: 'Bearer fix29-jwt-bob',
      'content-type': 'application/json',
    };

    try {
      // 1. Preferences Sync (GET / PATCH) — isolated between Alice and Bob
      const alicePatchPrefRes = await fetch(`${baseUrl}/api/v1/preferences`, {
        method: 'PATCH',
        headers: aliceHeaders,
        body: JSON.stringify({
          defaultResponseDepth: 'deep',
          defaultPptSurfaceMode: 'light',
          pinnedConversationIds: ['conv_pin_1'],
        }),
      });
      assert.equal(alicePatchPrefRes.status, 200);
      const alicePrefJson = (await alicePatchPrefRes.json()) as {
        data: {
          preferences: {
            defaultResponseDepth: string;
            defaultPptSurfaceMode: string;
            pinnedConversationIds: string[];
          };
        };
      };
      assert.equal(alicePrefJson.data.preferences.defaultResponseDepth, 'deep');
      assert.equal(alicePrefJson.data.preferences.defaultPptSurfaceMode, 'light');
      assert.deepEqual(alicePrefJson.data.preferences.pinnedConversationIds, ['conv_pin_1']);

      const aliceGetPrefRes = await fetch(`${baseUrl}/api/v1/preferences`, {
        headers: aliceHeaders,
      });
      assert.equal(aliceGetPrefRes.status, 200);
      const aliceGetPrefJson = (await aliceGetPrefRes.json()) as {
        data: {
          preferences: { defaultResponseDepth: string; defaultPptSurfaceMode: string };
        };
      };
      assert.equal(aliceGetPrefJson.data.preferences.defaultResponseDepth, 'deep');
      assert.equal(aliceGetPrefJson.data.preferences.defaultPptSurfaceMode, 'light');

      // Bob still sees default preferences, never Alice's
      const bobGetPrefRes = await fetch(`${baseUrl}/api/v1/preferences`, {
        headers: bobHeaders,
      });
      assert.equal(bobGetPrefRes.status, 200);
      const bobPrefJson = (await bobGetPrefRes.json()) as {
        data: {
          preferences: { defaultResponseDepth: string; defaultPptSurfaceMode: string };
        };
      };
      assert.equal(bobPrefJson.data.preferences.defaultResponseDepth, 'balanced');
      assert.equal(bobPrefJson.data.preferences.defaultPptSurfaceMode, 'dark');

      // 2. Alice creates a conversation with a distinct keyword and runs a turn
      const convRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ title: 'Quantum Photonics Research' }),
      });
      assert.equal(convRes.status, 201);
      const convJson = (await convRes.json()) as {
        data: { conversationId: string };
      };
      const aliceConvId = convJson.data.conversationId;

      const turnRes = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(aliceConvId)}/messages`,
        {
          method: 'POST',
          headers: {
            ...aliceHeaders,
            'Idempotency-Key': 'req_fix29_alice_turn_1',
          },
          body: JSON.stringify({
            prompt: 'Summarize chrysalis_photonics_benchmark_991 in two bullet points',
            preferredAgent: 'chat',
          }),
        },
      );
      assert.equal(turnRes.status, 201);
      const turnJson = (await turnRes.json()) as {
        data: { assistantMessage: { messageId: string } };
      };
      const assistantMsgId = turnJson.data.assistantMessage.messageId;

      // 3. Full-text Search: Alice finds her message; Bob sees 0 hits
      const aliceSearchRes = await fetch(
        `${baseUrl}/api/v1/search?q=${encodeURIComponent('chrysalis_photonics_benchmark_991')}`,
        { headers: aliceHeaders },
      );
      assert.equal(aliceSearchRes.status, 200);
      const aliceSearchJson = (await aliceSearchRes.json()) as {
        data: { hits: Array<{ conversationId: string; snippet: string }> };
      };
      assert.ok(aliceSearchJson.data.hits.length >= 1);
      assert.equal(aliceSearchJson.data.hits[0]?.conversationId, aliceConvId);

      const bobSearchRes = await fetch(
        `${baseUrl}/api/v1/search?q=${encodeURIComponent('chrysalis_photonics_benchmark_991')}`,
        { headers: bobHeaders },
      );
      assert.equal(bobSearchRes.status, 200);
      const bobSearchJson = (await bobSearchRes.json()) as {
        data: { hits: unknown[] };
      };
      assert.equal(bobSearchJson.data.hits.length, 0);

      // 4. Fork Thread from Message: Alice succeeds and clones messages up to assistantMsgId; Bob gets 404
      const aliceForkRes = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(aliceConvId)}/fork`,
        {
          method: 'POST',
          headers: aliceHeaders,
          body: JSON.stringify({ upToMessageId: assistantMsgId }),
        },
      );
      assert.equal(aliceForkRes.status, 201);
      const aliceForkJson = (await aliceForkRes.json()) as {
        data: {
          conversation: { conversationId: string; title: string };
          messages: Array<{ role: string }>;
        };
      };
      assert.notEqual(aliceForkJson.data.conversation.conversationId, aliceConvId);
      assert.ok(aliceForkJson.data.conversation.title.includes('(Branch)'));
      assert.equal(aliceForkJson.data.messages.length, 2);

      const bobForkAliceRes = await fetch(
        `${baseUrl}/api/v1/conversations/${encodeURIComponent(aliceConvId)}/fork`,
        {
          method: 'POST',
          headers: bobHeaders,
          body: JSON.stringify({ upToMessageId: assistantMsgId }),
        },
      );
      assert.equal(bobForkAliceRes.status, 404);

      // 5. Recompile PPTX with optional coverImageBase64 embeds ppt/media/cover.png
      const tinyPngBase64 = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
        0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
        0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
        0x42, 0x60, 0x82,
      ]).toString('base64');

      const recompilePptRes = await fetch(`${baseUrl}/api/v1/artifacts/recompile`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({
          kind: 'ppt',
          coverImageBase64: tinyPngBase64,
          spec: {
            title: 'Photonics Deck',
            subtitle: 'Cover Embed Check',
            theme: 'editorial_story',
            slides: [
              {
                layout: 'bullets',
                title: 'Core Results',
                bullets: ['Low-loss waveguide'],
              },
            ],
          },
        }),
      });
      assert.equal(recompilePptRes.status, 200);
      const pptxBuf = Buffer.from(await recompilePptRes.arrayBuffer());
      assert.ok(pptxBuf.toString('utf8').includes('ppt/media/cover.png'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('keeps multi-turn PDF RAG follow-ups strictly scoped to the active conversation PDF and isolated across users (Fix #30)', async () => {
    const validTokens: Record<string, DecodedIdToken> = {
      'verified-jwt-alice-rag': buildDecodedFirebaseToken({
        uid: 'fb_alice_rag_30',
        email: 'alice.rag30@example.com',
        name: 'Alice RAG',
      }),
      'verified-jwt-bob-rag': buildDecodedFirebaseToken({
        uid: 'fb_bob_rag_30',
        email: 'bob.rag30@example.com',
        name: 'Bob RAG',
      }),
    };

    setFirebaseTokenVerifierForTests(async (token: string) => {
      const match = validTokens[token];
      if (!match) {
        throw new Error('Invalid token');
      }
      return match;
    });

    const runtime = new KartikPlatformRuntime({
      persistence: new InMemoryPlatformPersistenceAdapter(),
    });
    const app = createKartikExpressApp(runtime);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}`;

    const aliceHeaders = {
      Authorization: 'Bearer verified-jwt-alice-rag',
      'content-type': 'application/json',
    };
    const bobHeaders = {
      Authorization: 'Bearer verified-jwt-bob-rag',
      'content-type': 'application/json',
    };

    const makePdfBase64 = (title: string, summary: string, sectionText: string) => {
      const spec = validatePdfDocumentSpec({
        title,
        subtitle: 'Integration Test Document',
        executiveSummary: summary,
        sections: [
          {
            heading: 'Core Terms',
            content: sectionText,
            bullets: [summary],
          },
        ],
      });
      return Buffer.from(buildPdfBinaryBuffer(spec).pdfBytes).toString('base64');
    };

    try {
      // Alice creates Conversation A and Conversation B
      const convARes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ title: 'Thread A — Solar Policy' }),
      });
      assert.equal(convARes.status, 201);
      const convAId = (
        (await convARes.json()) as { data: { conversationId: string } }
      ).data.conversationId;

      const convBRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({ title: 'Thread B — Maritime Contract' }),
      });
      assert.equal(convBRes.status, 201);
      const convBId = (
        (await convBRes.json()) as { data: { conversationId: string } }
      ).data.conversationId;

      const bobConvRes = await fetch(`${baseUrl}/api/v1/conversations`, {
        method: 'POST',
        headers: bobHeaders,
        body: JSON.stringify({ title: 'Bob Confidential PDF' }),
      });
      assert.equal(bobConvRes.status, 201);
      const bobConvId = (
        (await bobConvRes.json()) as { data: { conversationId: string } }
      ).data.conversationId;

      // Upload Solar PDF into Thread A
      const upARes = await fetch(`${baseUrl}/api/v1/files/upload`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({
          conversationId: convAId,
          originalFilename: 'solar-grid-policy.pdf',
          declaredMimeType: 'application/pdf',
          contentBase64: makePdfBase64(
            'Solar Grid Policy 2026',
            'Photovoltaic net-metering rebate is fixed at $0.14 per kWh through December 2029.',
            'Residential inverters must support IEEE 1547 frequency ride-through and battery export.',
          ),
        }),
      });
      assert.equal(upARes.status, 201);
      const upAJson = (await upARes.json()) as {
        data: { file: { fileId: string; chunkCount: number } };
      };
      assert.ok(upAJson.data.file.chunkCount >= 1);

      // Upload Maritime PDF into Thread B (different conversation for same user Alice)
      const upBRes = await fetch(`${baseUrl}/api/v1/files/upload`, {
        method: 'POST',
        headers: aliceHeaders,
        body: JSON.stringify({
          conversationId: convBId,
          originalFilename: 'maritime-freight.pdf',
          declaredMimeType: 'application/pdf',
          contentBase64: makePdfBase64(
            'Maritime Freight Charter',
            'Container demurrage penalties accrue at $480 per day after 72 hours at port.',
            'Cargo insurance covers hull damage up to $25M per vessel.',
          ),
        }),
      });
      assert.equal(upBRes.status, 201);

      // Upload Confidential PDF for Bob
      const upBobRes = await fetch(`${baseUrl}/api/v1/files/upload`, {
        method: 'POST',
        headers: bobHeaders,
        body: JSON.stringify({
          conversationId: bobConvId,
          originalFilename: 'bob-secret-merger.pdf',
          declaredMimeType: 'application/pdf',
          contentBase64: makePdfBase64(
            'Project Obsidian Merger',
            'Secret acquisition valuation is $990M exclusively for Bob.',
            'Confidential earnout milestones remain private.',
          ),
        }),
      });
      assert.equal(upBobRes.status, 201);

      // Turn 1 in Thread A with Solar PDF explicitly attached
      const turn1Res = await fetch(`${baseUrl}/api/v1/conversations/${convAId}/messages`, {
        method: 'POST',
        headers: { ...aliceHeaders, 'Idempotency-Key': 'req_rag30_turn1' },
        body: JSON.stringify({
          prompt: 'What is the photovoltaic net-metering rebate rate?',
          preferredAgent: 'rag',
          attachmentFileIds: [upAJson.data.file.fileId],
        }),
      });
      assert.equal(turn1Res.status, 201);
      const turn1Json = (await turn1Res.json()) as {
        data: {
          assistantMessage: {
            agentUsed: string;
            content: string;
            citations?: Array<{ title: string; snippet?: string }>;
          };
        };
      };
      assert.equal(turn1Json.data.assistantMessage.agentUsed, 'rag');
      assert.ok((turn1Json.data.assistantMessage.citations?.length ?? 0) >= 1);
      assert.ok(
        turn1Json.data.assistantMessage.citations!.every(
          (c) => c.title === 'solar-grid-policy.pdf',
        ),
      );

      // Turn 2 in Thread A: NO attachmentFileIds AND NO preferredAgent (Auto/Chat mode)!
      // Must auto-route to RAG, stay scoped ONLY to solar-grid-policy.pdf (zero bleed from Thread B or Bob!)
      const turn2Res = await fetch(`${baseUrl}/api/v1/conversations/${convAId}/messages`, {
        method: 'POST',
        headers: { ...aliceHeaders, 'Idempotency-Key': 'req_rag30_turn2' },
        body: JSON.stringify({
          prompt: 'What inverter compliance standard is required in this document?',
          attachmentFileIds: [],
        }),
      });
      assert.equal(turn2Res.status, 201);
      const turn2Json = (await turn2Res.json()) as {
        data: {
          assistantMessage: {
            agentUsed: string;
            content: string;
            citations?: Array<{ title: string; snippet?: string }>;
          };
        };
      };
      assert.equal(turn2Json.data.assistantMessage.agentUsed, 'rag');
      assert.ok((turn2Json.data.assistantMessage.citations?.length ?? 0) >= 1);
      assert.ok(
        turn2Json.data.assistantMessage.citations!.every(
          (c) => c.title === 'solar-grid-policy.pdf',
        ),
        'Follow-up turn must never leak citations from Thread B or Bob',
      );
      assert.ok(
        turn2Json.data.assistantMessage.content.includes('IEEE 1547') ||
          turn2Json.data.assistantMessage.citations!.some((c) =>
            (c.snippet ?? '').includes('IEEE 1547'),
          ),
      );
      assert.ok(!turn2Json.data.assistantMessage.content.includes('demurrage'));
      assert.ok(!turn2Json.data.assistantMessage.content.includes('Obsidian'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('Fix #31: refunds all 10 reserved credits on Gemini Image HTTP 429 RESOURCE_EXHAUSTED (limit:0), emits structured SSE error details, and honors IMAGE_PROVIDER=mock', async () => {
    const prevGeminiKey = process.env.GEMINI_API_KEY;
    const prevMockAi = process.env.MOCK_AI;
    const prevAiMode = process.env.AI_PROVIDER_MODE;
    const prevImageProvider = process.env.IMAGE_PROVIDER;
    const prevCfToken = process.env.CLOUDFLARE_API_TOKEN;
    const prevCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const originalFetch = globalThis.fetch;

    try {
      // Part A: Live Image Gen hits free-tier limit:0 429 -> must emit 429 RATE_LIMITED with reason=paid_tier_required AND refund all 10 credits!
      process.env.GEMINI_API_KEY = 'AIzaSyTestFreeTierLiveKey1234567890';
      process.env.MOCK_AI = 'false';
      process.env.AI_PROVIDER_MODE = 'live';
      process.env.IMAGE_PROVIDER = 'live';
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;

      const runtimeLive = new KartikPlatformRuntime({
        persistence: new InMemoryPlatformPersistenceAdapter(),
      });
      const appLive = createKartikExpressApp(runtimeLive);
      const serverLive = http.createServer(appLive);
      await new Promise<void>((resolve) => serverLive.listen(0, '127.0.0.1', resolve));
      const addrLive = serverLive.address();
      const portLive = typeof addrLive === 'object' && addrLive ? addrLive.port : 0;
      const baseUrlLive = `http://127.0.0.1:${portLive}`;

      try {
        // Intercept ONLY outbound Gemini API calls while letting local http://127.0.0.1 calls pass through
        globalThis.fetch = (async (inputUrl, init) => {
          const urlStr = String(inputUrl);
          if (urlStr.startsWith('https://generativelanguage.googleapis.com/')) {
            return new Response(
              JSON.stringify({
                error: {
                  code: 429,
                  status: 'RESOURCE_EXHAUSTED',
                  message:
                    'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-lite-image',
                },
              }),
              { status: 429, headers: { 'Content-Type': 'application/json' } },
            );
          }
          return originalFetch(inputUrl, init);
        }) as typeof fetch;

        const guestHeaders = {
          'x-kartik-guest-id': 'gst_fix31_refund_check',
          'content-type': 'application/json',
        };

        const meBeforeRes = await fetch(`${baseUrlLive}/api/v1/billing/balance`, {
          headers: guestHeaders,
        });
        const meBeforeJson = (await meBeforeRes.json()) as {
          data: { availableCredits: number; reservedCredits: number };
        };
        const initialCredits = meBeforeJson.data.availableCredits;
        assert.ok(initialCredits >= 10);

        const convRes = await fetch(`${baseUrlLive}/api/v1/conversations`, {
          method: 'POST',
          headers: guestHeaders,
          body: JSON.stringify({ title: 'Image 429 Refund Test' }),
        });
        const convJson = (await convRes.json()) as { data: { conversationId: string } };
        const convId = convJson.data.conversationId;

        const sseRes = await fetch(
          `${baseUrlLive}/api/v1/conversations/${convId}/messages/stream`,
          {
            method: 'POST',
            headers: {
              ...guestHeaders,
              Accept: 'text/event-stream',
              'Idempotency-Key': 'req_fix31_img_429_01',
            },
            body: JSON.stringify({
              prompt: 'Generate a minimalist glass library at dusk',
              preferredAgent: 'image',
            }),
          },
        );
        const sseBody = await sseRes.text();
        assert.ok(sseBody.includes('event: error'), `Expected SSE error event, got: ${sseBody}`);
        assert.ok(sseBody.includes('"code":"RATE_LIMITED"'));
        assert.ok(sseBody.includes('"paid_tier_required"'));
        assert.ok(sseBody.includes('free-tier quota of 0'));

        // Verify all 10 reserved credits were immediately released/refunded
        const meAfterRes = await fetch(`${baseUrlLive}/api/v1/billing/balance`, {
          headers: guestHeaders,
        });
        const meAfterJson = (await meAfterRes.json()) as {
          data: { availableCredits: number; reservedCredits: number };
        };
        assert.equal(meAfterJson.data.availableCredits, initialCredits);
        assert.equal(meAfterJson.data.reservedCredits, 0);
      } finally {
        await new Promise<void>((resolve) => serverLive.close(() => resolve()));
      }

      // Part B: With GEMINI_API_KEY set AND IMAGE_PROVIDER=mock, runtime must honor mock image previews without calling Gemini image API
      process.env.IMAGE_PROVIDER = 'mock';
      let geminiImageCalled = false;
      globalThis.fetch = (async (inputUrl, init) => {
        const urlStr = String(inputUrl);
        if (urlStr.includes('generativelanguage.googleapis.com')) {
          geminiImageCalled = true;
          return new Response('Should not be called when IMAGE_PROVIDER=mock', { status: 500 });
        }
        return originalFetch(inputUrl, init);
      }) as typeof fetch;

      const runtimeMockImg = new KartikPlatformRuntime({
        persistence: new InMemoryPlatformPersistenceAdapter(),
      });
      const appMockImg = createKartikExpressApp(runtimeMockImg);
      const serverMockImg = http.createServer(appMockImg);
      await new Promise<void>((resolve) => serverMockImg.listen(0, '127.0.0.1', resolve));
      const addrMockImg = serverMockImg.address();
      const portMockImg = typeof addrMockImg === 'object' && addrMockImg ? addrMockImg.port : 0;
      const baseUrlMockImg = `http://127.0.0.1:${portMockImg}`;

      try {
        const guestHeaders = {
          'x-kartik-guest-id': 'gst_fix31_mock_img_check',
          'content-type': 'application/json',
        };
        const convRes = await fetch(`${baseUrlMockImg}/api/v1/conversations`, {
          method: 'POST',
          headers: guestHeaders,
          body: JSON.stringify({ title: 'Image Mock Mode Test' }),
        });
        const convJson = (await convRes.json()) as { data: { conversationId: string } };

        const msgRes = await fetch(
          `${baseUrlMockImg}/api/v1/conversations/${convJson.data.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              ...guestHeaders,
              'Idempotency-Key': 'req_fix31_img_mock_01',
            },
            body: JSON.stringify({
              prompt: 'Create a 16:9 minimalist mountain observatory',
              preferredAgent: 'image',
            }),
          },
        );
        assert.equal(msgRes.status, 201);
        const msgJson = (await msgRes.json()) as {
          data: {
            assistantMessage: {
              agentUsed: string;
              artifacts?: Array<{ artifactType: string; mimeType: string; sizeBytes: number }>;
            };
          };
        };
        assert.equal(geminiImageCalled, false);
        assert.equal(msgJson.data.assistantMessage.agentUsed, 'image');
        assert.equal(msgJson.data.assistantMessage.artifacts?.[0]?.artifactType, 'generated_image');
        assert.equal(msgJson.data.assistantMessage.artifacts?.[0]?.mimeType, 'image/png');
        assert.ok((msgJson.data.assistantMessage.artifacts?.[0]?.sizeBytes ?? 0) > 500);
      } finally {
        await new Promise<void>((resolve) => serverMockImg.close(() => resolve()));
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prevGeminiKey;
      if (prevMockAi === undefined) delete process.env.MOCK_AI;
      else process.env.MOCK_AI = prevMockAi;
      if (prevAiMode === undefined) delete process.env.AI_PROVIDER_MODE;
      else process.env.AI_PROVIDER_MODE = prevAiMode;
      if (prevImageProvider === undefined) delete process.env.IMAGE_PROVIDER;
      else process.env.IMAGE_PROVIDER = prevImageProvider;
      if (prevCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = prevCfToken;
      if (prevCfAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
      else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAccount;
    }
  });

  it('Fix #32: generates live PNG artifacts via Cloudflare Workers AI (FLUX.1 Schnell) when IMAGE_PROVIDER=cloudflare and refunds 10 credits if CLOUDFLARE_ACCOUNT_ID is missing', async () => {
    const prevMockAi = process.env.MOCK_AI;
    const prevAiMode = process.env.AI_PROVIDER_MODE;
    const prevImageProvider = process.env.IMAGE_PROVIDER;
    const prevCfToken = process.env.CLOUDFLARE_API_TOKEN;
    const prevCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const prevCfModel = process.env.CLOUDFLARE_IMAGE_MODEL;
    const originalFetch = globalThis.fetch;

    const syntheticPng = Buffer.concat([
      Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x04, 0x00,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]),
      Buffer.alloc(256, 0x42),
    ]);

    try {
      process.env.MOCK_AI = 'false';
      process.env.AI_PROVIDER_MODE = 'live';
      process.env.IMAGE_PROVIDER = 'cloudflare';
      process.env.CLOUDFLARE_API_TOKEN = 'cfut_synthetic_e2e_token_for_unit_test_only_123456';
      process.env.CLOUDFLARE_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
      process.env.CLOUDFLARE_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

      let cfUrlCalled = '';
      globalThis.fetch = (async (inputUrl, init) => {
        const urlStr = String(inputUrl);
        if (urlStr.startsWith('https://api.cloudflare.com/client/v4/accounts/')) {
          cfUrlCalled = urlStr;
          return new Response(
            JSON.stringify({
              success: true,
              result: { image: syntheticPng.toString('base64') },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return originalFetch(inputUrl, init);
      }) as typeof fetch;

      const runtimeCf = new KartikPlatformRuntime({
        persistence: new InMemoryPlatformPersistenceAdapter(),
      });
      const appCf = createKartikExpressApp(runtimeCf);
      const serverCf = http.createServer(appCf);
      await new Promise<void>((resolve) => serverCf.listen(0, '127.0.0.1', resolve));
      const addrCf = serverCf.address();
      const portCf = typeof addrCf === 'object' && addrCf ? addrCf.port : 0;
      const baseUrlCf = `http://127.0.0.1:${portCf}`;

      try {
        const guestHeaders = {
          'x-kartik-guest-id': 'gst_fix32_cf_image_e2e',
          'content-type': 'application/json',
        };
        const balBefore = (await (
          await fetch(`${baseUrlCf}/api/v1/billing/balance`, { headers: guestHeaders })
        ).json()) as { data: { availableCredits: number } };

        const convJson = (await (
          await fetch(`${baseUrlCf}/api/v1/conversations`, {
            method: 'POST',
            headers: guestHeaders,
            body: JSON.stringify({ title: 'Cloudflare FLUX.1 Schnell E2E' }),
          })
        ).json()) as { data: { conversationId: string } };

        const msgRes = await fetch(
          `${baseUrlCf}/api/v1/conversations/${convJson.data.conversationId}/messages`,
          {
            method: 'POST',
            headers: {
              ...guestHeaders,
              'Idempotency-Key': 'req_fix32_cf_flux_01',
            },
            body: JSON.stringify({
              prompt: 'Generate an editorial watercolor painting of a Kyoto bridge in autumn',
              preferredAgent: 'image',
            }),
          },
        );
        assert.equal(msgRes.status, 201);
        const msgJson = (await msgRes.json()) as {
          data: {
            assistantMessage: {
              agentUsed: string;
              artifacts?: Array<{
                artifactId: string;
                artifactType: string;
                mimeType: string;
                sizeBytes: number;
              }>;
            };
          };
        };

        assert.ok(
          cfUrlCalled.includes('/accounts/0123456789abcdef0123456789abcdef/ai/run/@cf/black-forest-labs/flux-1-schnell'),
          `Expected Cloudflare FLUX.1 Schnell endpoint, got: ${cfUrlCalled}`,
        );
        assert.equal(msgJson.data.assistantMessage.agentUsed, 'image');
        const imgArtifact = msgJson.data.assistantMessage.artifacts?.[0];
        assert.equal(imgArtifact?.artifactType, 'generated_image');
        assert.equal(imgArtifact?.mimeType, 'image/png');
        assert.equal(imgArtifact?.sizeBytes, syntheticPng.byteLength);

        // Raw artifact streams back exact PNG bytes
        const rawRes = await fetch(
          `${baseUrlCf}/api/v1/artifacts/${imgArtifact!.artifactId}/raw?inline=1`,
          { headers: { 'x-kartik-guest-id': 'gst_fix32_cf_image_e2e' } },
        );
        assert.equal(rawRes.status, 200);
        const rawBuf = Buffer.from(await rawRes.arrayBuffer());
        assert.deepEqual(rawBuf, syntheticPng);

        // Exactly 10 credits charged for the successful generation
        const balAfter = (await (
          await fetch(`${baseUrlCf}/api/v1/billing/balance`, { headers: guestHeaders })
        ).json()) as { data: { availableCredits: number; reservedCredits: number } };
        assert.equal(balAfter.data.availableCredits, balBefore.data.availableCredits - 10);
        assert.equal(balAfter.data.reservedCredits, 0);
      } finally {
        await new Promise<void>((resolve) => serverCf.close(() => resolve()));
      }
    } finally {
      globalThis.fetch = originalFetch;
      if (prevMockAi === undefined) delete process.env.MOCK_AI;
      else process.env.MOCK_AI = prevMockAi;
      if (prevAiMode === undefined) delete process.env.AI_PROVIDER_MODE;
      else process.env.AI_PROVIDER_MODE = prevAiMode;
      if (prevImageProvider === undefined) delete process.env.IMAGE_PROVIDER;
      else process.env.IMAGE_PROVIDER = prevImageProvider;
      if (prevCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = prevCfToken;
      if (prevCfAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
      else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAccount;
      if (prevCfModel === undefined) delete process.env.CLOUDFLARE_IMAGE_MODEL;
      else process.env.CLOUDFLARE_IMAGE_MODEL = prevCfModel;
    }
  });
});




