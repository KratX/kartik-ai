import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sign as cryptoSign, createPrivateKey } from 'node:crypto';
import {
  constantTimeTokenEquals,
  generateEd25519KeyPair,
  signUserContextAssertion,
  USER_CONTEXT_ISSUER,
  verifyServiceCaller,
  verifyUserContextAssertion,
} from '../index.js';

describe('@kartik/shared/auth Ed25519 assertion & service caller auth (1.6.a / T14)', () => {
  const primaryKeys = generateEd25519KeyPair();
  const rogueKeys = generateEd25519KeyPair();
  const fixedNow = 1_794_300_000;

  it('signs and verifies a valid Ed25519 user-context assertion round-trip (Phase 1 Exit Gate)', () => {
    const token = signUserContextAssertion(
      {
        sub: 'usr_kartik_01',
        aud: 'chat',
        traceId: 'trc_abc123',
        sessionId: 'sess_opaque_999',
        nowSeconds: fixedNow,
        ttlSeconds: 60,
        jti: 'jti-fixed-001',
      },
      primaryKeys.privateKeyPem,
    );

    // Also test base64-encoded PEM public key resolution
    const base64PublicKey = Buffer.from(primaryKeys.publicKeyPem, 'utf8').toString('base64');

    const claims = verifyUserContextAssertion(token, base64PublicKey, {
      expectedAudience: 'chat',
      nowSeconds: fixedNow + 30,
    });

    assert.equal(claims.iss, USER_CONTEXT_ISSUER);
    assert.equal(claims.aud, 'chat');
    assert.equal(claims.sub, 'usr_kartik_01');
    assert.equal(claims.traceId, 'trc_abc123');
    assert.equal(claims.sessionId, 'sess_opaque_999');
    assert.equal(claims.iat, fixedNow);
    assert.equal(claims.exp, fixedNow + 60);
    assert.equal(claims.jti, 'jti-fixed-001');
  });

  it('rejects wrong audience (aud), wrong signature, tampered claims, and expired/future timestamps (T14 & Phase 1 Exit Gate)', () => {
    const chatToken = signUserContextAssertion(
      {
        sub: 'usr_kartik_01',
        aud: 'chat',
        traceId: 'trc_abc123',
        nowSeconds: fixedNow,
        ttlSeconds: 60,
      },
      primaryKeys.privateKeyPem,
    );

    // 1. Wrong audience: token minted for "chat" presented to "billing"
    assert.throws(
      () =>
        verifyUserContextAssertion(chatToken, primaryKeys.publicKeyPem, {
          expectedAudience: 'billing',
          nowSeconds: fixedNow + 10,
        }),
      /audience mismatch/,
    );

    // 2. Wrong public key (rogue keypair)
    assert.throws(
      () =>
        verifyUserContextAssertion(chatToken, rogueKeys.publicKeyPem, {
          expectedAudience: 'chat',
          nowSeconds: fixedNow + 10,
        }),
      /Invalid user-context assertion signature/,
    );

    // 3. Within 5s clock skew passes (exp + 5s), but exp + 6s fails
    const atSkewEdge = verifyUserContextAssertion(chatToken, primaryKeys.publicKeyPem, {
      expectedAudience: 'chat',
      nowSeconds: fixedNow + 60 + 5,
    });
    assert.equal(atSkewEdge.sub, 'usr_kartik_01');

    assert.throws(
      () =>
        verifyUserContextAssertion(chatToken, primaryKeys.publicKeyPem, {
          expectedAudience: 'chat',
          nowSeconds: fixedNow + 60 + 6,
        }),
      /expired/,
    );

    // 4. Future iat beyond 5s clock skew fails
    assert.throws(
      () =>
        verifyUserContextAssertion(chatToken, primaryKeys.publicKeyPem, {
          expectedAudience: 'chat',
          nowSeconds: fixedNow - 6,
        }),
      /future beyond clock-skew tolerance/,
    );
  });

  it('forbids requestId inside user-context assertions at both sign and verify time (§6.4, Invariant #15)', () => {
    // 1. Sign-time rejection if caller smuggles requestId
    assert.throws(
      () =>
        signUserContextAssertion(
          {
            sub: 'usr_kartik_01',
            aud: 'agent',
            traceId: 'trc_abc123',
            // @ts-expect-error requestId is forbidden in SignUserContextInput
            requestId: 'req_should_never_be_in_jwt',
          },
          primaryKeys.privateKeyPem,
        ),
      /requestId is forbidden inside user-context assertions/,
    );

    // 2. Verify-time rejection even if a custom-signed Ed25519 token embeds requestId
    const headerB64 = Buffer.from(
      JSON.stringify({ alg: 'EdDSA', typ: 'kartik-user-context+jwt' }),
      'utf8',
    ).toString('base64url');
    const smuggledClaimsB64 = Buffer.from(
      JSON.stringify({
        iss: 'gateway',
        aud: 'agent',
        sub: 'usr_kartik_01',
        traceId: 'trc_abc123',
        requestId: 'req_smuggled_123',
        iat: fixedNow,
        exp: fixedNow + 60,
        jti: 'jti-smuggled',
      }),
      'utf8',
    ).toString('base64url');
    const signingInput = `${headerB64}.${smuggledClaimsB64}`;
    const sigB64 = cryptoSign(
      null,
      Buffer.from(signingInput, 'utf8'),
      createPrivateKey(primaryKeys.privateKeyPem),
    ).toString('base64url');

    assert.throws(
      () =>
        verifyUserContextAssertion(`${signingInput}.${sigB64}`, primaryKeys.publicKeyPem, {
          expectedAudience: 'agent',
          nowSeconds: fixedNow + 5,
        }),
      /must not contain requestId/,
    );
  });

  it('verifies service-to-service caller credentials in constant time and enforces allowedCallers (§6.3)', () => {
    const tokenDirectory = {
      gateway: 'svc_secret_gateway_token_99887766',
      chat: 'svc_secret_chat_token_11223344',
    } as const;

    assert.equal(
      constantTimeTokenEquals('svc_secret_gateway_token_99887766', 'svc_secret_gateway_token_99887766'),
      true,
    );
    assert.equal(
      constantTimeTokenEquals('svc_secret_gateway_token_99887766', 'svc_secret_gateway_token_DIFFERENT'),
      false,
    );
    assert.equal(constantTimeTokenEquals('', 'svc_secret_gateway_token_99887766'), false);

    // Valid caller in allowedCallers
    const verified = verifyServiceCaller({
      callerHeader: 'chat',
      tokenHeader: 'svc_secret_chat_token_11223344',
      expectedTokenOrDirectory: tokenDirectory,
      allowedCallers: ['chat'],
    });
    assert.equal(verified.caller, 'chat');

    // Valid token for "gateway", but endpoint only allows ["chat"] -> 403 FORBIDDEN
    assert.throws(
      () =>
        verifyServiceCaller({
          callerHeader: 'gateway',
          tokenHeader: 'svc_secret_gateway_token_99887766',
          expectedTokenOrDirectory: tokenDirectory,
          allowedCallers: ['chat'],
        }),
      (err: unknown) => (err as { code?: string }).code === 'FORBIDDEN',
    );

    // Wrong token -> 401 UNAUTHENTICATED
    assert.throws(
      () =>
        verifyServiceCaller({
          callerHeader: 'chat',
          tokenHeader: 'wrong_token_value',
          expectedTokenOrDirectory: tokenDirectory,
          allowedCallers: ['chat'],
        }),
      (err: unknown) => (err as { code?: string }).code === 'UNAUTHENTICATED',
    );
  });
});
