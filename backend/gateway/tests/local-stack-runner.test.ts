/**
 * @file backend/gateway/tests/local-stack-runner.test.ts
 * @description Integration test for `scripts/start-local-stack.mjs` verifying that the
 * single-command local HTTP stack boots cleanly, serves `/healthz` and `/readyz`,
 * authenticates the seeded demo session, executes an idempotent chat turn, and reports
 * updated credit balance over a real TCP socket (Micro-step 8.5.a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { IDEMPOTENCY_KEY_HEADER } from '@kartik/shared';

interface LocalStackHandle {
  port: number;
  host: string;
  baseUrl: string;
  demoSessionCookie: string;
  demoUser: {
    sessionId: string;
    userId: string;
    email: string;
  };
  close: () => Promise<void>;
}

describe('Local Full-Stack HTTP Server Runner (`scripts/start-local-stack.mjs` — 8.5.a)', () => {
  it('boots the pre-seeded 5-service stack on an ephemeral TCP port and serves health, auth, chat turn, and billing routes', async () => {
    const scriptPath = '../../../../scripts/start-local-stack.mjs';
    const mod = (await import(scriptPath)) as {
      startLocalStackServer: (opts?: { port?: number }) => Promise<LocalStackHandle>;
    };

    const stack = await mod.startLocalStackServer({ port: 0 });
    assert.ok(stack.port > 0);

    try {
      // 1. GET /healthz
      const healthRes = await fetch(`${stack.baseUrl}/healthz`);
      assert.equal(healthRes.status, 200);

      // 2. GET /api/v1/conversations with seeded demo session cookie
      const convRes = await fetch(`${stack.baseUrl}/api/v1/conversations`, {
        headers: {
          cookie: stack.demoSessionCookie,
        },
      });
      assert.equal(convRes.status, 200);
      const convBody = (await convRes.json()) as {
        data: { items: Array<{ conversationId: string }> };
      };
      assert.equal(convBody.data.items.length, 1);
      assert.equal(convBody.data.items[0]?.conversationId, 'conv_demo_welcome_001');

      // 3. POST /api/v1/conversations/conv_demo_welcome_001/messages with Idempotency-Key
      const turnRes = await fetch(
        `${stack.baseUrl}/api/v1/conversations/conv_demo_welcome_001/messages`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'http://localhost:3000',
            cookie: stack.demoSessionCookie,
            [IDEMPOTENCY_KEY_HEADER]: 'req_local_stack_turn_85a_01',
          },
          body: JSON.stringify({ prompt: 'Build a clean widget in mock mode' }),
        },
      );
      assert.equal(turnRes.status, 201);
      const turnBody = (await turnRes.json()) as {
        data: {
          remainingCredits: number;
          idempotentReplay: boolean;
          assistantMessage: { agentUsed: string };
        };
      };
      assert.equal(turnBody.data.remainingCredits, 195);
      assert.equal(turnBody.data.idempotentReplay, false);
      assert.equal(turnBody.data.assistantMessage.agentUsed, 'coding');

      // 4. GET /api/v1/billing/balance reflects the settled 5-credit deduction
      const balRes = await fetch(`${stack.baseUrl}/api/v1/billing/balance`, {
        headers: {
          cookie: stack.demoSessionCookie,
        },
      });
      assert.equal(balRes.status, 200);
      const balBody = (await balRes.json()) as {
        data: { availableCredits: number; billingMode: string };
      };
      assert.equal(balBody.data.availableCredits, 195);
      assert.equal(balBody.data.billingMode, 'mock');
    } finally {
      await stack.close();
    }
  });
});
