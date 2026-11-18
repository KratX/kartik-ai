import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createKartikExpressApp } from '../../server.ts';
import {
  assertRootRuntimeDemoOrLocalOnly,
  KartikPlatformRuntime,
} from './platform-api-runtime.ts';
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
});
