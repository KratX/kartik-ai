/**
 * @kartik/auth/services/firebase-verifier — Firebase Google ID-Token Verification Adapter
 * (Blueprint §6.1, §6.2, §11, ADR 0002, ADR 0005 & Architecture Invariants #2, #19).
 *
 * Architectural rules enforced here:
 * 1. `AUTH_PROVIDER_MODE=mock` (default) uses `MockFirebaseTokenVerifier` with deterministic
 *    named and structured fixtures so local dev and CI run offline with zero quota (Invariant #19).
 * 2. `AUTH_PROVIDER_MODE=firebase` uses `JwtFirebaseTokenVerifier` to cryptographically verify
 *    RS256 signatures (`node:crypto`) and enforce Firebase ID-token claims:
 *    - `iss === "https://securetoken.google.com/<FIREBASE_PROJECT_ID>"`
 *    - `aud === "<FIREBASE_PROJECT_ID>"`
 *    - `sub` is a non-empty string (becomes `firebaseUid`)
 *    - `email` is present and `email_verified === true`
 *    - `iat` and `exp` are valid within a 5-second clock-skew tolerance.
 * 3. Any invalid, expired, wrong-audience, or unverified-email token throws
 *    `AppError('UNAUTHENTICATED', ...)` (401). Never logs raw ID tokens (Gate G9).
 */
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { AppError } from '@kartik/shared';
import type { AuthServiceConfig } from '../config/index.js';

export interface VerifiedGoogleIdentity {
  readonly firebaseUid: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly displayName: string;
  readonly avatarUrl: string | null;
}

export interface FirebaseTokenVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity>;
}

export interface MockFixtureIdentity {
  readonly firebaseUid: string;
  readonly email: string;
  readonly emailVerified?: boolean;
  readonly displayName: string;
  readonly avatarUrl?: string | null;
  readonly expired?: boolean;
}

const DEFAULT_MOCK_FIXTURES: Readonly<Record<string, MockFixtureIdentity>> = Object.freeze({
  'mock-google-token:kartik': {
    firebaseUid: 'fb_kartik_01',
    email: 'kartik@kartik.ai',
    emailVerified: true,
    displayName: 'Kartik Rawat',
    avatarUrl: 'https://assets.kartik.ai/avatars/kartik.png',
  },
  'mock-google-token:alice': {
    firebaseUid: 'fb_alice_02',
    email: 'alice@example.com',
    emailVerified: true,
    displayName: 'Alice Researcher',
    avatarUrl: null,
  },
  'mock-google-token:unverified': {
    firebaseUid: 'fb_unverified_03',
    email: 'unverified@example.com',
    emailVerified: false,
    displayName: 'Unverified User',
    avatarUrl: null,
  },
  'mock-google-token:expired': {
    firebaseUid: 'fb_expired_04',
    email: 'expired@example.com',
    emailVerified: true,
    displayName: 'Expired User',
    avatarUrl: null,
    expired: true,
  },
});

/**
 * Deterministic mock Firebase ID-token verifier for local development and automated tests.
 */
export class MockFirebaseTokenVerifier implements FirebaseTokenVerifier {
  private readonly fixtures: Readonly<Record<string, MockFixtureIdentity>>;

  constructor(customFixtures?: Readonly<Record<string, MockFixtureIdentity>>) {
    this.fixtures = Object.freeze({
      ...DEFAULT_MOCK_FIXTURES,
      ...(customFixtures ?? {}),
    });
  }

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (typeof idToken !== 'string' || idToken.trim().length === 0) {
      throw new AppError('UNAUTHENTICATED', 'Missing Firebase ID token');
    }

    const token = idToken.trim();
    const fixture = this.fixtures[token];

    if (!fixture) {
      throw new AppError('UNAUTHENTICATED', 'Invalid or unrecognized mock Firebase ID token');
    }

    if (fixture.expired) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token has expired');
    }

    if (fixture.emailVerified === false) {
      throw new AppError('UNAUTHENTICATED', 'Google account email address is not verified');
    }

    const email = fixture.email.trim().toLowerCase();
    if (!email.includes('@')) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token is missing a valid email claim');
    }

    return Object.freeze({
      firebaseUid: fixture.firebaseUid.trim(),
      email,
      emailVerified: true,
      displayName: fixture.displayName.trim() || email.split('@')[0]!,
      avatarUrl: fixture.avatarUrl ?? null,
    });
  }
}

export type PublicKeyResolver = (kid: string) => Promise<string | KeyObject | undefined>;

export interface JwtFirebaseVerifierOptions {
  readonly projectId: string;
  readonly resolvePublicKey: PublicKeyResolver;
  readonly nowSeconds?: () => number;
  readonly clockSkewSeconds?: number;
}

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

/**
 * Default Google public-certificate resolver with in-memory caching for `AUTH_PROVIDER_MODE=firebase`.
 */
export function createGooglePublicKeyResolver(): PublicKeyResolver {
  let cachedKeys: Record<string, string> = {};
  let cacheExpiresAtMs = 0;

  return async (kid: string): Promise<string | undefined> => {
    const now = Date.now();
    if (now < cacheExpiresAtMs && cachedKeys[kid]) {
      return cachedKeys[kid];
    }

    const response = await fetch(GOOGLE_CERTS_URL);
    if (!response.ok) {
      throw new AppError('PROVIDER_UNAVAILABLE', 'Unable to fetch Google public signing certificates');
    }

    const certs = (await response.json()) as Record<string, string>;
    cachedKeys = certs;
    cacheExpiresAtMs = now + 60 * 60 * 1000; // 1 hour cache
    return cachedKeys[kid];
  };
}

/**
 * Cryptographic RS256 Firebase ID-token verifier enforcing issuer, audience (`projectId`),
 * expiry, `email_verified`, and RSA-SHA256 signature authenticity using built-in `node:crypto`.
 */
export class JwtFirebaseTokenVerifier implements FirebaseTokenVerifier {
  private readonly projectId: string;
  private readonly expectedIssuer: string;
  private readonly resolvePublicKey: PublicKeyResolver;
  private readonly nowSeconds: () => number;
  private readonly clockSkewSeconds: number;

  constructor(options: JwtFirebaseVerifierOptions) {
    if (!options.projectId || !options.projectId.trim()) {
      throw new AppError('VALIDATION_FAILED', 'JwtFirebaseTokenVerifier requires a non-empty projectId');
    }
    this.projectId = options.projectId.trim();
    this.expectedIssuer = `https://securetoken.google.com/${this.projectId}`;
    this.resolvePublicKey = options.resolvePublicKey;
    this.nowSeconds = options.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    this.clockSkewSeconds = options.clockSkewSeconds ?? 5;
  }

  async verifyIdToken(idToken: string): Promise<VerifiedGoogleIdentity> {
    if (typeof idToken !== 'string' || idToken.trim().length === 0) {
      throw new AppError('UNAUTHENTICATED', 'Missing Firebase ID token');
    }

    const parts = idToken.trim().split('.');
    if (parts.length !== 3) {
      throw new AppError('UNAUTHENTICATED', 'Malformed Firebase ID token format');
    }

    const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
    if (
      !/^[A-Za-z0-9_-]+$/.test(encodedHeader) ||
      !/^[A-Za-z0-9_-]+$/.test(encodedClaims) ||
      !/^[A-Za-z0-9_-]+$/.test(encodedSignature)
    ) {
      throw new AppError('UNAUTHENTICATED', 'Malformed base64url encoding in Firebase ID token');
    }

    let header: Record<string, unknown>;
    let claims: Record<string, unknown>;
    try {
      header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')) as Record<string, unknown>;
      claims = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new AppError('UNAUTHENTICATED', 'Malformed JSON inside Firebase ID token');
    }

    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.trim().length === 0) {
      throw new AppError('UNAUTHENTICATED', 'Unsupported Firebase ID token header algorithm or missing kid');
    }

    const keyMaterial = await this.resolvePublicKey(header.kid);
    if (!keyMaterial) {
      throw new AppError('UNAUTHENTICATED', 'Unknown signing key ID (kid) on Firebase ID token');
    }

    const publicKey = typeof keyMaterial === 'string' ? createPublicKey(keyMaterial) : keyMaterial;
    const signingInput = Buffer.from(`${encodedHeader}.${encodedClaims}`, 'utf8');
    const signature = Buffer.from(encodedSignature, 'base64url');

    const signatureValid = cryptoVerify('RSA-SHA256', signingInput, publicKey, signature);
    if (!signatureValid) {
      throw new AppError('UNAUTHENTICATED', 'Invalid Firebase ID token cryptographic signature');
    }

    if (claims.iss !== this.expectedIssuer) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token issuer mismatch');
    }

    if (claims.aud !== this.projectId) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token audience (projectId) mismatch');
    }

    const sub = typeof claims.sub === 'string' ? claims.sub.trim() : '';
    if (sub.length === 0 || sub.length > 128) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token missing valid sub claim');
    }

    const iat = claims.iat;
    const exp = claims.exp;
    if (typeof iat !== 'number' || !Number.isInteger(iat) || typeof exp !== 'number' || !Number.isInteger(exp)) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token missing integer iat or exp claim');
    }

    const now = this.nowSeconds();
    if (iat > now + this.clockSkewSeconds) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token iat is in the future');
    }
    if (now > exp + this.clockSkewSeconds) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token has expired');
    }

    const email = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new AppError('UNAUTHENTICATED', 'Firebase ID token missing valid email claim');
    }

    if (claims.email_verified !== true) {
      throw new AppError('UNAUTHENTICATED', 'Google account email address is not verified');
    }

    const displayName =
      typeof claims.name === 'string' && claims.name.trim().length > 0
        ? claims.name.trim()
        : email.split('@')[0]!;

    const avatarUrl =
      typeof claims.picture === 'string' && claims.picture.trim().length > 0
        ? claims.picture.trim()
        : null;

    return Object.freeze({
      firebaseUid: sub,
      email,
      emailVerified: true,
      displayName,
      avatarUrl,
    });
  }
}

/**
 * Factory that builds the appropriate `FirebaseTokenVerifier` based on `config.AUTH_PROVIDER_MODE`.
 */
export function createFirebaseTokenVerifier(
  config: Pick<AuthServiceConfig, 'AUTH_PROVIDER_MODE' | 'FIREBASE_PROJECT_ID'>,
  options?: {
    readonly mockFixtures?: Readonly<Record<string, MockFixtureIdentity>>;
    readonly resolvePublicKey?: PublicKeyResolver;
    readonly nowSeconds?: () => number;
  },
): FirebaseTokenVerifier {
  if (config.AUTH_PROVIDER_MODE === 'mock') {
    return new MockFirebaseTokenVerifier(options?.mockFixtures);
  }
  return new JwtFirebaseTokenVerifier({
    projectId: config.FIREBASE_PROJECT_ID,
    resolvePublicKey: options?.resolvePublicKey ?? createGooglePublicKeyResolver(),
    ...(options?.nowSeconds ? { nowSeconds: options.nowSeconds } : {}),
  });
}
