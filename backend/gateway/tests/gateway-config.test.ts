/**
 * @file backend/gateway/tests/gateway-config.test.ts
 * @description Unit tests for @kartik/gateway configuration, Ed25519 signing key validation,
 * CORS origin allowlist parsing, and upstream service directory (3.1.a).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigValidationError,
  generateEd25519KeyPair,
} from '@kartik/shared';
import {
  loadGatewayConfig,
  parseCorsAllowedOrigins,
  resolveUpstreamServiceUrl,
} from '../src/index.js';

describe('@kartik/gateway config, Ed25519 key validation & service directory (3.1.a)', () => {
  const { privateKeyPem } = generateEd25519KeyPair();

  it('loads valid Gateway config, validates Ed25519 private key, and normalizes service URLs (§6.1–§6.4)', () => {
    const config = loadGatewayConfig({
      NODE_ENV: 'test',
      REDIS_URL: 'redis://127.0.0.1:6379',
      SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-token-at-least-16-chars',
      USER_CONTEXT_SIGNING_KEY: privateKeyPem,
      AUTH_SERVICE_URL: 'http://auth:8001///',
      CHAT_SERVICE_URL: 'http://chat:8002/',
      AGENT_SERVICE_URL: 'http://agent:8003',
      BILLING_SERVICE_URL: 'http://billing:8004/',
      CORS_ALLOWED_ORIGINS: 'https://app.kartik.ai, http://localhost:5173/',
    });

    assert.equal(config.PORT_GATEWAY, 8000);
    assert.equal(config.SESSION_COOKIE_NAME, 'kartik_session');
    assert.equal(config.DEMO_READ_ONLY, false);
    assert.deepEqual(config.allowedOrigins, [
      'https://app.kartik.ai',
      'http://localhost:5173',
    ]);
    assert.equal(resolveUpstreamServiceUrl(config, 'auth'), 'http://auth:8001');
    assert.equal(resolveUpstreamServiceUrl(config, 'chat'), 'http://chat:8002');
    assert.equal(resolveUpstreamServiceUrl(config, 'agent'), 'http://agent:8003');
    assert.equal(resolveUpstreamServiceUrl(config, 'billing'), 'http://billing:8004');
  });

  it('fails startup when USER_CONTEXT_SIGNING_KEY is invalid without leaking raw key material (§6.4 & Gate G9)', () => {
    const fakeSecretKey = 'not-a-valid-ed25519-pem-key-secret-value-1234567890';

    assert.throws(
      () =>
        loadGatewayConfig({
          REDIS_URL: 'redis://127.0.0.1:6379',
          SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-token-at-least-16-chars',
          USER_CONTEXT_SIGNING_KEY: fakeSecretKey,
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigValidationError);
        assert.ok(err.invalidVariables.includes('USER_CONTEXT_SIGNING_KEY'));
        assert.equal(
          err.message.includes(fakeSecretKey),
          false,
          'Error message must never leak raw secret values',
        );
        return true;
      },
    );
  });

  it('rejects wildcard "*" or malformed origins in CORS_ALLOWED_ORIGINS when credentialed cookies are used (§11)', () => {
    assert.throws(
      () => parseCorsAllowedOrigins('*'),
      (err: unknown) =>
        err instanceof ConfigValidationError &&
        err.invalidVariables.includes('CORS_ALLOWED_ORIGINS'),
    );

    assert.throws(
      () => parseCorsAllowedOrigins('ftp://invalid-protocol.example.com'),
      (err: unknown) =>
        err instanceof ConfigValidationError &&
        err.invalidVariables.includes('CORS_ALLOWED_ORIGINS'),
    );
  });

  it('accepts base64-encoded Ed25519 private keys in USER_CONTEXT_SIGNING_KEY for cloud env injection', () => {
    const base64Key = Buffer.from(privateKeyPem, 'utf8').toString('base64');
    const config = loadGatewayConfig({
      REDIS_URL: 'redis://127.0.0.1:6379',
      SERVICE_TO_SERVICE_TOKEN: 's2s-gateway-token-at-least-16-chars',
      USER_CONTEXT_SIGNING_KEY: base64Key,
    });

    assert.equal(config.PORT_GATEWAY, 8000);
  });
});
