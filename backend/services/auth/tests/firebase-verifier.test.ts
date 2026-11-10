import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import {
  createFirebaseTokenVerifier,
  JwtFirebaseTokenVerifier,
  MockFirebaseTokenVerifier,
} from '../src/index.js';

function signTestFirebaseJwt(
  claims: Record<string, unknown>,
  privateKeyPem: string,
  kid = 'google-key-id-01',
): string {
  const headerB64 = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }), 'utf8').toString(
    'base64url',
  );
  const claimsB64 = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signingInput = `${headerB64}.${claimsB64}`;
  const sigB64 = cryptoSign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), privateKeyPem).toString(
    'base64url',
  );
  return `${signingInput}.${sigB64}`;
}

describe('@kartik/auth FirebaseTokenVerifier — Mock & RS256 JWT (2.2.a)', () => {
  const rsaPrimary = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const rsaRogue = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const fixedNow = 1_794_300_000;

  it('verifies deterministic mock tokens and rejects expired, unverified, or unknown tokens in MockFirebaseTokenVerifier (Invariant #19)', async () => {
    const verifier = new MockFirebaseTokenVerifier();

    const identity = await verifier.verifyIdToken('mock-google-token:kartik');
    assert.equal(identity.firebaseUid, 'fb_kartik_01');
    assert.equal(identity.email, 'kartik@kartik.ai');
    assert.equal(identity.emailVerified, true);
    assert.equal(identity.displayName, 'Kartik Rawat');

    for (const badToken of [
      '',
      '   ',
      'mock-google-token:unknown',
      'mock-google-token:expired',
      'mock-google-token:unverified',
    ]) {
      await assert.rejects(
        () => verifier.verifyIdToken(badToken),
        (err: unknown) => (err as { code?: string }).code === 'UNAUTHENTICATED',
      );
    }
  });

  it('cryptographically verifies a valid RS256 Firebase ID token in JwtFirebaseTokenVerifier (§11)', async () => {
    const verifier = new JwtFirebaseTokenVerifier({
      projectId: 'kartik-prod',
      resolvePublicKey: async (kid) => (kid === 'google-key-id-01' ? rsaPrimary.publicKey : undefined),
      nowSeconds: () => fixedNow + 20,
    });

    const token = signTestFirebaseJwt(
      {
        iss: 'https://securetoken.google.com/kartik-prod',
        aud: 'kartik-prod',
        sub: 'fb_live_user_007',
        email: '  Kartik@Kartik.AI ',
        email_verified: true,
        name: 'Kartik Live',
        picture: 'https://example.com/pic.png',
        iat: fixedNow,
        exp: fixedNow + 3600,
      },
      rsaPrimary.privateKey,
    );

    const verified = await verifier.verifyIdToken(token);
    assert.equal(verified.firebaseUid, 'fb_live_user_007');
    assert.equal(verified.email, 'kartik@kartik.ai');
    assert.equal(verified.emailVerified, true);
    assert.equal(verified.displayName, 'Kartik Live');
    assert.equal(verified.avatarUrl, 'https://example.com/pic.png');
  });

  it('rejects wrong projectId (aud), wrong issuer, rogue RSA signature, unverified email, or expired RS256 token', async () => {
    const verifier = new JwtFirebaseTokenVerifier({
      projectId: 'kartik-prod',
      resolvePublicKey: async (kid) => (kid === 'google-key-id-01' ? rsaPrimary.publicKey : undefined),
      nowSeconds: () => fixedNow + 20,
    });

    const baseClaims = {
      iss: 'https://securetoken.google.com/kartik-prod',
      aud: 'kartik-prod',
      sub: 'fb_live_user_007',
      email: 'kartik@kartik.ai',
      email_verified: true,
      iat: fixedNow,
      exp: fixedNow + 3600,
    };

    // 1. Rogue RSA signing key
    const rogueToken = signTestFirebaseJwt(baseClaims, rsaRogue.privateKey);
    await assert.rejects(
      () => verifier.verifyIdToken(rogueToken),
      /Invalid Firebase ID token cryptographic signature/,
    );

    // 2. Wrong audience (projectId)
    const wrongAudToken = signTestFirebaseJwt({ ...baseClaims, aud: 'other-firebase-project' }, rsaPrimary.privateKey);
    await assert.rejects(
      () => verifier.verifyIdToken(wrongAudToken),
      /audience \(projectId\) mismatch/,
    );

    // 3. Unverified email
    const unverifiedToken = signTestFirebaseJwt({ ...baseClaims, email_verified: false }, rsaPrimary.privateKey);
    await assert.rejects(
      () => verifier.verifyIdToken(unverifiedToken),
      /email address is not verified/,
    );

    // 4. Expired token beyond 5s clock skew
    const expiredToken = signTestFirebaseJwt(
      { ...baseClaims, iat: fixedNow - 4000, exp: fixedNow - 10 },
      rsaPrimary.privateKey,
    );
    await assert.rejects(
      () => verifier.verifyIdToken(expiredToken),
      /expired/,
    );
  });

  it('selects MockFirebaseTokenVerifier vs JwtFirebaseTokenVerifier via createFirebaseTokenVerifier factory', async () => {
    const mockVerifier = createFirebaseTokenVerifier({
      AUTH_PROVIDER_MODE: 'mock',
      FIREBASE_PROJECT_ID: 'kartik-mock',
    });
    const res = await mockVerifier.verifyIdToken('mock-google-token:alice');
    assert.equal(res.firebaseUid, 'fb_alice_02');
  });
});
