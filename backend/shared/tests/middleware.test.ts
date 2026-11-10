import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createDemoReadOnlyMiddleware,
  createErrorBoundaryMiddleware,
  createInternalAuthMiddleware,
  createRateLimitMiddleware,
  createRequestContextMiddleware,
  generateEd25519KeyPair,
  InMemoryRateLimitStore,
  signUserContextAssertion,
  type MiddlewareRequest,
  type MiddlewareResponse,
} from '../index.js';

function createMockRes(): {
  res: MiddlewareResponse;
  headers: Record<string, string>;
  statusCode: () => number;
  jsonBody: () => unknown;
} {
  const headers: Record<string, string> = {};
  let code = 200;
  let body: unknown = null;

  const res: MiddlewareResponse = {
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    status(c: number) {
      code = c;
      return res;
    },
    json(b: unknown) {
      body = b;
    },
  };

  return { res, headers, statusCode: () => code, jsonBody: () => body };
}

describe('@kartik/shared/middleware pipeline & Phase 1 Exit Gate closure (1.9.a)', () => {
  it('generates fresh traceId on Gateway and preserves client Idempotency-Key unchanged as requestId (§5.4, Invariant #15)', () => {
    const gatewayCtx = createRequestContextMiddleware({
      role: 'gateway',
      idempotencyExemptPaths: ['/api/v1/billing/webhook'],
    });

    const reqOk: MiddlewareRequest = {
      method: 'POST',
      path: '/api/v1/chat/messages',
      headers: {
        'x-trace-id': 'spoofed_browser_trace_id',
        'idempotency-key': '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11',
      },
    };
    const mockResOk = createMockRes();
    let capturedErr: unknown;
    gatewayCtx(reqOk, mockResOk.res, (err) => {
      capturedErr = err;
    });

    assert.equal(capturedErr, undefined);
    assert.ok(reqOk.requestContext?.traceId.startsWith('trc_'));
    assert.notEqual(reqOk.requestContext?.traceId, 'spoofed_browser_trace_id');
    assert.equal(reqOk.requestContext?.requestId, '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11');
    assert.equal(mockResOk.headers['x-request-id'], '9f0c1c1e-6b1f-4d2a-9a25-1c1d5f8d5a11');

    // Missing Idempotency-Key on mutating endpoint -> 400 IDEMPOTENCY_KEY_REQUIRED
    const reqMissingKey: MiddlewareRequest = {
      method: 'POST',
      path: '/api/v1/chat/messages',
      headers: {},
    };
    let missingErr: unknown;
    gatewayCtx(reqMissingKey, createMockRes().res, (err) => {
      missingErr = err;
    });
    assert.equal((missingErr as { code?: string }).code, 'IDEMPOTENCY_KEY_REQUIRED');
  });

  it('enforces DEMO_READ_ONLY kill switch on mutating methods while allowing GET (§12)', () => {
    const demoGuard = createDemoReadOnlyMiddleware({ enabled: true });

    let getErr: unknown = null;
    demoGuard({ method: 'GET', path: '/api/v1/conversations', headers: {} }, createMockRes().res, (err) => {
      getErr = err;
    });
    assert.equal(getErr, undefined);

    let postErr: unknown = null;
    demoGuard({ method: 'POST', path: '/api/v1/chat/messages', headers: {} }, createMockRes().res, (err) => {
      postErr = err;
    });
    assert.equal((postErr as { code?: string }).code, 'DEMO_READ_ONLY');
  });

  it('enforces fixed-window rate limits (429 RATE_LIMITED with Retry-After) and fails closed (503 LIMITER_UNAVAILABLE) on store outage (§5.2 & §5.5)', async () => {
    const store = new InMemoryRateLimitStore();
    const limiter = createRateLimitMiddleware({
      store,
      mode: 'ip',
      maxRequests: 2,
      windowSeconds: 60,
      nowSeconds: () => 1_794_300_010,
    });
    const errorBoundary = createErrorBoundaryMiddleware();

    const makeReq = (): MiddlewareRequest => ({
      method: 'POST',
      ip: '203.0.113.50',
      headers: {},
      requestContext: { traceId: 'trc_rl_test' },
    });

    // Request 1 & 2 pass
    for (let i = 0; i < 2; i++) {
      let err: unknown;
      await limiter(makeReq(), createMockRes().res, (e) => {
        err = e;
      });
      assert.equal(err, undefined);
    }

    // Request 3 exceeds limit -> 429 RATE_LIMITED with Retry-After: 50
    let thirdErr: unknown;
    const thirdRes = createMockRes();
    await limiter(makeReq(), thirdRes.res, (e) => {
      thirdErr = e;
    });
    assert.equal((thirdErr as { code?: string }).code, 'RATE_LIMITED');

    errorBoundary(thirdErr, makeReq(), thirdRes.res);
    assert.equal(thirdRes.statusCode(), 429);
    assert.equal(thirdRes.headers['retry-after'], '50');

    // Outage on store with failOpen=false -> 503 LIMITER_UNAVAILABLE
    const brokenLimiter = createRateLimitMiddleware({
      store: {
        async incrementAndGet() {
          throw new Error('Redis connection refused');
        },
      },
      mode: 'ip',
      maxRequests: 5,
      failOpen: false,
    });
    let outageErr: unknown;
    await brokenLimiter(makeReq(), createMockRes().res, (e) => {
      outageErr = e;
    });
    assert.equal((outageErr as { code?: string }).code, 'LIMITER_UNAVAILABLE');
  });

  it('verifies internal service credentials + Ed25519 user-context assertion in createInternalAuthMiddleware (§6.3 & §6.4)', () => {
    const keys = generateEd25519KeyPair();
    const fixedNow = 1_794_300_000;
    const assertion = signUserContextAssertion(
      {
        sub: 'usr_kartik_01',
        aud: 'chat',
        traceId: 'trc_internal_01',
        nowSeconds: fixedNow,
        ttlSeconds: 60,
      },
      keys.privateKeyPem,
    );

    const internalGuard = createInternalAuthMiddleware({
      expectedTokenOrDirectory: { gateway: 'svc_secret_gateway_token_99887766' },
      allowedCallers: ['gateway'],
      requireUserContext: true,
      userContextPublicKey: keys.publicKeyPem,
      expectedAudience: 'chat',
      nowSeconds: () => fixedNow + 5,
    });

    const req: MiddlewareRequest = {
      method: 'POST',
      headers: {
        'x-service-caller': 'gateway',
        'x-service-token': 'svc_secret_gateway_token_99887766',
        'x-user-context': assertion,
      },
      requestContext: { traceId: 'trc_internal_01' },
    };

    let authErr: unknown;
    internalGuard(req, createMockRes().res, (e) => {
      authErr = e;
    });

    assert.equal(authErr, undefined);
    assert.equal(req.requestContext?.serviceCaller, 'gateway');
    assert.equal(req.requestContext?.userContext?.sub, 'usr_kartik_01');
    assert.equal(req.requestContext?.userContext?.aud, 'chat');
  });
});
