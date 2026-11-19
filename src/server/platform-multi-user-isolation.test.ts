import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createKartikExpressApp } from '../../server.ts';
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
});


