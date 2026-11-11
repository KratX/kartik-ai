/**
 * @file backend/gateway/tests/gateway-proxy.test.ts
 * @description Unit tests for @kartik/gateway session introspection, Ed25519 x-user-context
 * assertion minting, cookie stripping, and CORS/CSRF middleware (3.2.a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  createSuccessEnvelope,
  generateEd25519KeyPair,
  INTERNAL_AUTH_HEADERS,
  verifyUserContextAssertion,
} from '@kartik/shared';
import {
  buildDownstreamProxyHeaders,
  createGatewayCorsAndCsrfMiddleware,
  createGatewaySessionMiddleware,
  GatewaySessionIntrospector,
  InMemoryUpstreamHttpClient,
  loadGatewayConfig,
  type GatewayHttpRequest,
  type IntrospectedSessionIdentity,
} from '../src/index.js';

describe('@kartik/gateway session introspection, Ed25519 assertion & proxy headers (3.2.a)', () => {
  const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();

  const config = loadGatewayConfig({
    NODE_ENV: 'test',
    REDIS_URL: 'redis://127.0.0.1:6379',
    SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-token-at-least-16-chars',
    USER_CONTEXT_SIGNING_KEY: privateKeyPem,
    CORS_ALLOWED_ORIGINS: 'https://app.kartik.ai,http://localhost:5173',
  });

  const sampleSession: IntrospectedSessionIdentity = {
    sessionId: 'rX8mQp9vL2kW4nZ7cT1yB6gH3jF5dS0aU9eM4pQ2wK8',
    userId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'kartik@kartik.ai',
    displayName: 'Kartik Rawat',
    avatarUrl: null,
    expiresAt: '2026-11-18T12:00:00.000Z',
  };

  it('introspects session cookies via Auth POST /internal/sessions/introspect with Gateway caller credentials (ADR 0002 & §6.3)', async () => {
    const upstream = new InMemoryUpstreamHttpClient();
    upstream.registerHandler('auth', 'POST', '/internal/sessions/introspect', (req) => {
      assert.equal(req.headers[INTERNAL_AUTH_HEADERS.SERVICE_CALLER], 'gateway');
      assert.equal(
        req.headers[INTERNAL_AUTH_HEADERS.SERVICE_TOKEN],
        config.SERVICE_TO_SERVICE_TOKEN,
      );
      assert.equal(req.headers[INTERNAL_AUTH_HEADERS.TRACE_ID], 'trc_test_32a');

      const body = req.body as { sessionId?: string };
      if (body.sessionId === sampleSession.sessionId) {
        return {
          statusCode: 200,
          headers: {},
          body: createSuccessEnvelope('trc_test_32a', sampleSession),
        };
      }
      return {
        statusCode: 401,
        headers: {},
        body: {
          traceId: 'trc_test_32a',
          data: null,
          meta: { nextCursor: null },
          error: { code: 'UNAUTHENTICATED', message: 'Expired session' },
        },
      };
    });

    const introspector = new GatewaySessionIntrospector({
      config,
      upstreamClient: upstream,
    });
    const sessionMw = createGatewaySessionMiddleware({
      config,
      introspector,
    });

    const validReq: GatewayHttpRequest = {
      method: 'POST',
      path: '/api/v1/conversations',
      headers: {
        cookie: `theme=dark; kartik_session=${sampleSession.sessionId}`,
      },
      requestContext: { traceId: 'trc_test_32a' },
    };

    let mwErr: unknown;
    await sessionMw(
      validReq,
      {
        setHeader() {},
        status() {
          return this;
        },
        json() {},
      },
      (err) => {
        mwErr = err;
      },
    );

    assert.equal(mwErr, undefined);
    assert.deepEqual(validReq.introspectedSession, sampleSession);

    // Invalid cookie fails with 401 UNAUTHENTICATED
    await assert.rejects(
      () => introspector.introspect('unknown_session_id_1234567890', 'trc_test_32a'),
      (err: unknown) => err instanceof AppError && err.code === 'UNAUTHENTICATED',
    );
  });

  it('strips browser cookies & spoofed headers and mints an audience-scoped Ed25519 x-user-context assertion (§6.4 & Invariant #15)', () => {
    const nowSec = 1_762_860_000;

    const downstreamHeaders = buildDownstreamProxyHeaders({
      config,
      target: 'chat',
      traceId: 'trc_hop_001',
      requestId: 'idem_run_identity_0001',
      incomingHeaders: {
        cookie: `kartik_session=${sampleSession.sessionId}`,
        authorization: 'Bearer spoofed-client-jwt',
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: 'spoofed-assertion',
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'spoofed-caller',
        'content-type': 'application/json',
      },
      introspectedSession: sampleSession,
      nowSeconds: nowSec,
    });

    // 1. Browser cookie, authorization, and spoofed internal headers are stripped
    assert.equal(downstreamHeaders.cookie, undefined);
    assert.equal(downstreamHeaders.authorization, undefined);
    assert.equal(downstreamHeaders[INTERNAL_AUTH_HEADERS.SERVICE_CALLER], 'gateway');
    assert.equal(
      downstreamHeaders[INTERNAL_AUTH_HEADERS.SERVICE_TOKEN],
      config.SERVICE_TO_SERVICE_TOKEN,
    );
    assert.equal(downstreamHeaders[INTERNAL_AUTH_HEADERS.TRACE_ID], 'trc_hop_001');
    assert.equal(
      downstreamHeaders[INTERNAL_AUTH_HEADERS.REQUEST_ID],
      'idem_run_identity_0001',
    );

    // 2. Ed25519 assertion verifies for 'chat', forbids requestId inside claims, and rejects wrong audience ('billing')
    const assertion = downstreamHeaders[INTERNAL_AUTH_HEADERS.USER_CONTEXT];
    assert.ok(assertion);

    const claims = verifyUserContextAssertion(assertion, publicKeyPem, {
      expectedAudience: 'chat',
      nowSeconds: nowSec,
    });
    assert.equal(claims.sub, sampleSession.userId);
    assert.equal(claims.aud, 'chat');
    assert.equal(claims.traceId, 'trc_hop_001');
    assert.equal(claims.sessionId, sampleSession.sessionId);
    assert.equal('requestId' in (claims as unknown as Record<string, unknown>), false);

    assert.throws(
      () =>
        verifyUserContextAssertion(assertion, publicKeyPem, {
          expectedAudience: 'billing',
          nowSeconds: nowSec,
        }),
      (err: unknown) => err instanceof AppError && err.code === 'UNAUTHENTICATED',
    );

    // 3. When forwarding to public Auth routes with preserveCookieForAuth=true, cookie is preserved and no x-user-context is minted
    const authHeaders = buildDownstreamProxyHeaders({
      config,
      target: 'auth',
      traceId: 'trc_hop_auth',
      incomingHeaders: {
        cookie: `kartik_session=${sampleSession.sessionId}`,
      },
      preserveCookieForAuth: true,
    });
    assert.equal(authHeaders.cookie, `kartik_session=${sampleSession.sessionId}`);
    assert.equal(authHeaders[INTERNAL_AUTH_HEADERS.USER_CONTEXT], undefined);
  });

  it('enforces explicit CORS origin allowlist and blocks cross-origin CSRF on mutating cookie requests (§11)', async () => {
    const corsCsrfMw = createGatewayCorsAndCsrfMiddleware({
      allowedOrigins: config.allowedOrigins,
    });

    const responseHeaders: Record<string, string> = {};
    const resMock = {
      setHeader(k: string, v: string) {
        responseHeaders[k.toLowerCase()] = v;
      },
      status() {
        return this;
      },
      json() {},
    };

    // 1. Allowed Origin on mutating cookie request succeeds and sets CORS credentials headers
    let errAllowed: unknown;
    await corsCsrfMw(
      {
        method: 'POST',
        path: '/api/v1/conversations',
        headers: {
          origin: 'https://app.kartik.ai',
          cookie: `kartik_session=${sampleSession.sessionId}`,
        },
      },
      resMock,
      (e) => {
        errAllowed = e;
      },
    );
    assert.equal(errAllowed, undefined);
    assert.equal(responseHeaders['access-control-allow-origin'], 'https://app.kartik.ai');
    assert.equal(responseHeaders['access-control-allow-credentials'], 'true');

    // 2. Missing Origin on mutating cookie request is rejected with 403 FORBIDDEN (CSRF protection)
    let errMissingOrigin: unknown;
    await corsCsrfMw(
      {
        method: 'POST',
        path: '/api/v1/conversations',
        headers: {
          cookie: `kartik_session=${sampleSession.sessionId}`,
        },
      },
      resMock,
      (e) => {
        errMissingOrigin = e;
      },
    );
    assert.ok(errMissingOrigin instanceof AppError);
    assert.equal(errMissingOrigin.code, 'FORBIDDEN');

    // 3. Untrusted Origin ('https://evil.example.com') is rejected with 403 FORBIDDEN
    let errEvilOrigin: unknown;
    await corsCsrfMw(
      {
        method: 'GET',
        path: '/api/v1/conversations',
        headers: {
          origin: 'https://evil.example.com',
        },
      },
      resMock,
      (e) => {
        errEvilOrigin = e;
      },
    );
    assert.ok(errEvilOrigin instanceof AppError);
    assert.equal(errEvilOrigin.code, 'FORBIDDEN');
  });

  it('maps unreachable billing upstream to 503 BILLING_UNAVAILABLE and other services to 503 PROVIDER_UNAVAILABLE (§5.5)', async () => {
    const emptyUpstream = new InMemoryUpstreamHttpClient();

    await assert.rejects(
      () =>
        emptyUpstream.forward({
          target: 'billing',
          method: 'POST',
          path: '/billing/orders',
          headers: {},
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'BILLING_UNAVAILABLE' &&
        err.httpStatus === 503,
    );

    await assert.rejects(
      () =>
        emptyUpstream.forward({
          target: 'chat',
          method: 'GET',
          path: '/conversations',
          headers: {},
        }),
      (err: unknown) =>
        err instanceof AppError &&
        err.code === 'PROVIDER_UNAVAILABLE' &&
        err.httpStatus === 503,
    );
  });
});
