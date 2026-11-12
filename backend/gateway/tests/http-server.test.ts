/**
 * @file backend/gateway/tests/http-server.test.ts
 * @description Live TCP socket tests for `createManagedHttpServer` (`node:http` adapter,
 * raw-body webhook preservation, payload size guard, and graceful shutdown — Micro-step 8.4.a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSuccessEnvelope,
  generateEd25519KeyPair,
} from '@kartik/shared';
import {
  createGatewayRouter,
  createManagedHttpServer,
  InMemoryUpstreamHttpClient,
  loadGatewayConfig,
} from '../src/index.js';

describe('@kartik/gateway Live node:http Server Adapter & Graceful Shutdown (8.4.a)', () => {
  it('binds to an ephemeral TCP port, serves /healthz and /api/v1/webhooks/razorpay with exact rawBody over real HTTP, and shuts down cleanly (§8.3 & §11)', async () => {
    const { privateKeyPem } = generateEd25519KeyPair();
    const config = loadGatewayConfig({
      NODE_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-http-server-token-84a',
      USER_CONTEXT_SIGNING_KEY: privateKeyPem,
      CORS_ALLOWED_ORIGINS: 'https://app.kartik.ai',
      DEMO_READ_ONLY: 'false',
    });

    let capturedRawWebhookBody = '';
    const upstream = new InMemoryUpstreamHttpClient();
    upstream.registerHandler('billing', 'POST', '/webhooks/razorpay', (req) => {
      capturedRawWebhookBody = String(req.rawBody ?? '');
      return {
        statusCode: 200,
        headers: {},
        body: createSuccessEnvelope('trc_http_wh', { verified: true }),
      };
    });

    const router = createGatewayRouter({
      config,
      upstreamClient: upstream,
    });

    let shutdownCleanedUp = false;
    const managed = createManagedHttpServer({
      serviceName: 'gateway',
      router,
      maxBodyBytes: 1024,
      onShutdown: async () => {
        shutdownCleanedUp = true;
      },
    });

    const { port } = await managed.listen(0, '127.0.0.1');
    assert.ok(port > 0);
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Real HTTP GET /healthz
      const healthRes = await fetch(`${baseUrl}/healthz`);
      assert.equal(healthRes.status, 200);
      const healthJson = (await healthRes.json()) as {
        data: { status: string; service: string };
      };
      assert.equal(healthJson.data.status, 'ok');
      assert.equal(healthJson.data.service, 'gateway');

      // 2. Real HTTP POST /api/v1/webhooks/razorpay preserves exact rawBody whitespace
      const exactRawPayload = '{"event": "payment.captured",  "amount": 39900}';
      const whRes = await fetch(`${baseUrl}/api/v1/webhooks/razorpay`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-razorpay-signature': 'sig_84a_real_http',
        },
        body: exactRawPayload,
      });
      assert.equal(whRes.status, 200);
      assert.equal(capturedRawWebhookBody, exactRawPayload);

      // 3. Oversized payload (>1024 bytes) is rejected with 400 VALIDATION_FAILED
      const oversizedRes = await fetch(`${baseUrl}/api/v1/webhooks/razorpay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(2048) }),
      });
      assert.equal(oversizedRes.status, 400);
      const oversizedJson = (await oversizedRes.json()) as {
        error: { code: string };
      };
      assert.equal(oversizedJson.error.code, 'VALIDATION_FAILED');
    } finally {
      await managed.close();
    }

    assert.equal(shutdownCleanedUp, true);
    // Calling close() a second time is idempotent
    await managed.close();
  });

  it('rejects malformed JSON bodies over HTTP with 400 VALIDATION_FAILED without crashing the server (§8.3)', async () => {
    const { privateKeyPem } = generateEd25519KeyPair();
    const config = loadGatewayConfig({
      NODE_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-http-server-token-84a',
      USER_CONTEXT_SIGNING_KEY: privateKeyPem,
      CORS_ALLOWED_ORIGINS: 'https://app.kartik.ai',
    });

    const router = createGatewayRouter({
      config,
      upstreamClient: new InMemoryUpstreamHttpClient(),
    });

    const managed = createManagedHttpServer({
      serviceName: 'gateway',
      router,
    });

    const { port } = await managed.listen(0, '127.0.0.1');
    try {
      const badJsonRes = await fetch(`http://127.0.0.1:${port}/api/v1/auth/google`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{bad_json_missing_quotes',
      });
      assert.equal(badJsonRes.status, 400);
      const body = (await badJsonRes.json()) as { error: { code: string } };
      assert.equal(body.error.code, 'VALIDATION_FAILED');
    } finally {
      await managed.close();
    }
  });
});
