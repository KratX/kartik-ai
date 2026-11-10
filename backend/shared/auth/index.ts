/**
 * @kartik/shared/auth — Ed25519 User-Context Assertion & Constant-Time Service Auth
 * (Blueprint §6.3, §6.4, Architecture Invariants #1, #14, #15, Contract Test T14 & Phase 1 Exit Gate).
 *
 * Architectural rules enforced here:
 * 1. The Gateway introspects the browser's opaque session cookie with Auth once, then
 *    mints a short-lived (default 60s) Ed25519-signed user-context assertion (`x-user-context`).
 * 2. Downstream services (Chat, Agent, Billing) hold ONLY the Ed25519 public key and
 *    verify `iss === "gateway"`, exact `aud` ("chat" | "agent" | "billing"), signature,
 *    `exp`, and `iat` with a strict 5-second clock-skew tolerance.
 * 3. `requestId` is FORBIDDEN inside the user-context assertion (§6.4, Invariant #15):
 *    run identity belongs exclusively to the client's `Idempotency-Key` / `x-request-id` header.
 * 4. Service-to-service caller credentials (`x-service-token`) are compared using
 *    constant-time `crypto.timingSafeEqual` (§6.3).
 */
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  randomUUID,
   createHash,
  sign as cryptoSign,
  timingSafeEqual,
  verify as cryptoVerify,
} from 'node:crypto';
import { AppError } from '../errors/index.js';

export const USER_CONTEXT_ISSUER = 'gateway' as const;

export const USER_CONTEXT_AUDIENCES = ['chat', 'agent', 'billing', 'kartik-internal'] as const;
export type UserContextAudience = (typeof USER_CONTEXT_AUDIENCES)[number];

export const SERVICE_CALLERS = ['gateway', 'auth', 'chat', 'agent', 'billing'] as const;
export type ServiceCallerName = (typeof SERVICE_CALLERS)[number];

export const DEFAULT_ASSERTION_TTL_SECONDS = 60 as const;
export const MAX_ASSERTION_TTL_SECONDS = 300 as const;
export const MAX_CLOCK_SKEW_SECONDS = 5 as const;

/**
 * Canonical internal HTTP headers used between Gateway and internal services (§6.3 & §6.4).
 */
export const INTERNAL_AUTH_HEADERS = Object.freeze({
  SERVICE_CALLER: 'x-service-caller',
  SERVICE_TOKEN: 'x-service-token',
  USER_CONTEXT: 'x-user-context',
  TRACE_ID: 'x-trace-id',
  REQUEST_ID: 'x-request-id',
} as const);

export interface UserContextAssertionHeader {
  readonly alg: 'EdDSA';
  readonly typ: 'kartik-user-context+jwt';
}

export interface UserContextAssertionClaims {
  readonly iss: typeof USER_CONTEXT_ISSUER;
  readonly aud: UserContextAudience;
  readonly sub: string;
  readonly traceId: string;
  readonly sessionId?: string;
  readonly iat: number;
  readonly exp: number;
  readonly jti: string;
}

export interface SignUserContextInput {
  readonly sub: string;
  readonly aud: UserContextAudience;
  readonly traceId: string;
  readonly sessionId?: string;
  readonly ttlSeconds?: number;
  readonly nowSeconds?: number;
  readonly jti?: string;
  /**
   * Blueprint §6.4: `requestId` must NEVER be embedded in the user-context assertion.
   * Typed as `never` so TypeScript rejects it at compile time, and checked at runtime.
   */
  readonly requestId?: never;
}

export interface VerifyUserContextOptions {
  readonly expectedAudience: UserContextAudience | readonly UserContextAudience[];
  readonly nowSeconds?: number;
  readonly clockSkewSeconds?: number;
  readonly maxTtlSeconds?: number;
}

export interface Ed25519KeyPairPem {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
}

/**
 * Generates an Ed25519 keypair in PKCS#8 (private) and SPKI (public) PEM format.
 * Useful for local development bootstrap and deterministic unit tests.
 */
export function generateEd25519KeyPair(): Ed25519KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519', {
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  return Object.freeze({
    privateKeyPem: privateKey,
    publicKeyPem: publicKey,
  });
}

function normalizePemInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes('-----BEGIN ')) {
    return trimmed.replace(/\\n/g, '\n');
  }
  // Support base64-encoded PEM strings stored in single-line env vars
  try {
    const decoded = Buffer.from(trimmed, 'base64').toString('utf8').trim();
    if (decoded.includes('-----BEGIN ')) {
      return decoded;
    }
  } catch {
    // Fall through to validation error
  }
  throw new AppError('INTERNAL_ERROR', 'Invalid Ed25519 key material: expected PEM or base64-encoded PEM');
}

function resolvePrivateKey(key: string | KeyObject): KeyObject {
  if (typeof key !== 'string') {
    return key;
  }
  const pem = normalizePemInput(key);
  const keyObj = createPrivateKey(pem);
  if (keyObj.asymmetricKeyType !== 'ed25519') {
    throw new AppError('INTERNAL_ERROR', `Invalid signing key type: expected ed25519, got ${String(keyObj.asymmetricKeyType)}`);
  }
  return keyObj;
}

function resolvePublicKey(key: string | KeyObject): KeyObject {
  if (typeof key !== 'string') {
    return key;
  }
  const pem = normalizePemInput(key);
  const keyObj = createPublicKey(pem);
  if (keyObj.asymmetricKeyType !== 'ed25519') {
    throw new AppError('INTERNAL_ERROR', `Invalid verification key type: expected ed25519, got ${String(keyObj.asymmetricKeyType)}`);
  }
  return keyObj;
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

function base64UrlDecodeToBuffer(segment: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(segment)) {
    throw new AppError('UNAUTHENTICATED', 'Malformed user-context assertion encoding');
  }
  return Buffer.from(segment, 'base64url');
}

function assertValidAudience(aud: unknown): asserts aud is UserContextAudience {
  if (typeof aud !== 'string' || !(USER_CONTEXT_AUDIENCES as readonly string[]).includes(aud)) {
    throw new AppError('UNAUTHENTICATED', `Invalid user-context audience: ${String(aud)}`);
  }
}

/**
 * Signs a short-lived Ed25519 user-context assertion (Gateway only).
 * Forbids `requestId` inside the assertion per Blueprint §6.4.
 */
export function signUserContextAssertion(
  input: SignUserContextInput,
  privateKeyInput: string | KeyObject,
): string {
  const rawRecord = input as unknown as Record<string, unknown>;
  if ('requestId' in rawRecord && rawRecord.requestId !== undefined) {
    throw new AppError(
      'VALIDATION_FAILED',
      'requestId is forbidden inside user-context assertions (§6.4); forward it via x-request-id',
    );
  }

  if (typeof input.sub !== 'string' || input.sub.trim().length === 0) {
    throw new AppError('VALIDATION_FAILED', 'User-context assertion requires a non-empty sub (userId)');
  }
  if (typeof input.traceId !== 'string' || input.traceId.trim().length === 0) {
    throw new AppError('VALIDATION_FAILED', 'User-context assertion requires a non-empty traceId');
  }
  assertValidAudience(input.aud);

  const ttlSeconds = input.ttlSeconds ?? DEFAULT_ASSERTION_TTL_SECONDS;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0 || ttlSeconds > MAX_ASSERTION_TTL_SECONDS) {
    throw new AppError(
      'VALIDATION_FAILED',
      `User-context assertion ttlSeconds must be an integer between 1 and ${MAX_ASSERTION_TTL_SECONDS}`,
    );
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isInteger(nowSeconds) || nowSeconds <= 0) {
    throw new AppError('VALIDATION_FAILED', 'User-context assertion nowSeconds must be a positive integer');
  }

  const jti = input.jti ?? randomUUID();
  if (typeof jti !== 'string' || jti.trim().length === 0) {
    throw new AppError('VALIDATION_FAILED', 'User-context assertion requires a non-empty jti');
  }

  const header: UserContextAssertionHeader = {
    alg: 'EdDSA',
    typ: 'kartik-user-context+jwt',
  };

  const claims: UserContextAssertionClaims = {
    iss: USER_CONTEXT_ISSUER,
    aud: input.aud,
    sub: input.sub.trim(),
    traceId: input.traceId.trim(),
    ...(input.sessionId !== undefined && input.sessionId.trim().length > 0
      ? { sessionId: input.sessionId.trim() }
      : {}),
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    jti,
  };

  const privateKey = resolvePrivateKey(privateKeyInput);
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = cryptoSign(null, Buffer.from(signingInput, 'utf8'), privateKey);

  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * Verifies an Ed25519 user-context assertion in downstream services (Chat, Agent, Billing).
 * Enforces signature authenticity, `iss === "gateway"`, target `aud`, 5s clock skew,
 * and absence of `requestId` (Contract Test T14 & Phase 1 Exit Gate).
 */
export function verifyUserContextAssertion(
  token: string,
  publicKeyInput: string | KeyObject,
  options: VerifyUserContextOptions,
): UserContextAssertionClaims {
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new AppError('UNAUTHENTICATED', 'Missing user-context assertion');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AppError('UNAUTHENTICATED', 'Malformed user-context assertion format');
  }

  const [encodedHeader, encodedClaims, encodedSignature] = parts as [string, string, string];
  const publicKey = resolvePublicKey(publicKeyInput);

  const signingInputBuffer = Buffer.from(`${encodedHeader}.${encodedClaims}`, 'utf8');
  const signatureBuffer = base64UrlDecodeToBuffer(encodedSignature);

  const isSignatureValid = cryptoVerify(null, signingInputBuffer, publicKey, signatureBuffer);
  if (!isSignatureValid) {
    throw new AppError('UNAUTHENTICATED', 'Invalid user-context assertion signature');
  }

  let headerParsed: unknown;
  let claimsParsed: unknown;
  try {
    headerParsed = JSON.parse(base64UrlDecodeToBuffer(encodedHeader).toString('utf8'));
    claimsParsed = JSON.parse(base64UrlDecodeToBuffer(encodedClaims).toString('utf8'));
  } catch {
    throw new AppError('UNAUTHENTICATED', 'Invalid JSON inside user-context assertion');
  }

  if (
    typeof headerParsed !== 'object' ||
    headerParsed === null ||
    (headerParsed as Record<string, unknown>).alg !== 'EdDSA' ||
    (headerParsed as Record<string, unknown>).typ !== 'kartik-user-context+jwt'
  ) {
    throw new AppError('UNAUTHENTICATED', 'Unsupported user-context assertion header');
  }

  if (typeof claimsParsed !== 'object' || claimsParsed === null || Array.isArray(claimsParsed)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid user-context assertion claims payload');
  }

  const rawClaims = claimsParsed as Record<string, unknown>;

  if ('requestId' in rawClaims) {
    throw new AppError(
      'UNAUTHENTICATED',
      'User-context assertion must not contain requestId (§6.4)',
    );
  }

  if (rawClaims.iss !== USER_CONTEXT_ISSUER) {
    throw new AppError('UNAUTHENTICATED', `Invalid user-context issuer: expected ${USER_CONTEXT_ISSUER}`);
  }

  assertValidAudience(rawClaims.aud);
  const allowedAudiences = Array.isArray(options.expectedAudience)
    ? options.expectedAudience
    : [options.expectedAudience];

  if (!allowedAudiences.includes(rawClaims.aud)) {
    throw new AppError(
      'UNAUTHENTICATED',
      `User-context audience mismatch: token aud "${rawClaims.aud}" not in [${allowedAudiences.join(', ')}]`,
    );
  }

  if (typeof rawClaims.sub !== 'string' || rawClaims.sub.trim().length === 0) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion missing valid sub');
  }
  if (typeof rawClaims.traceId !== 'string' || rawClaims.traceId.trim().length === 0) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion missing valid traceId');
  }
  if (typeof rawClaims.jti !== 'string' || rawClaims.jti.trim().length === 0) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion missing valid jti');
  }
  if (
    rawClaims.sessionId !== undefined &&
    (typeof rawClaims.sessionId !== 'string' || rawClaims.sessionId.trim().length === 0)
  ) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion contains invalid sessionId');
  }

  const iat = rawClaims.iat;
  const exp = rawClaims.exp;
  if (typeof iat !== 'number' || !Number.isInteger(iat) || typeof exp !== 'number' || !Number.isInteger(exp)) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion iat and exp must be integer timestamps');
  }

  const maxTtlSeconds = options.maxTtlSeconds ?? MAX_ASSERTION_TTL_SECONDS;
  if (exp <= iat || exp - iat > maxTtlSeconds) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion lifetime is invalid or exceeds maximum TTL');
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const clockSkewSeconds = options.clockSkewSeconds ?? MAX_CLOCK_SKEW_SECONDS;

  if (iat > nowSeconds + clockSkewSeconds) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion iat is in the future beyond clock-skew tolerance');
  }
  if (nowSeconds > exp + clockSkewSeconds) {
    throw new AppError('UNAUTHENTICATED', 'User-context assertion has expired');
  }

  return Object.freeze({
    iss: USER_CONTEXT_ISSUER,
    aud: rawClaims.aud,
    sub: rawClaims.sub,
    traceId: rawClaims.traceId,
    ...(typeof rawClaims.sessionId === 'string' ? { sessionId: rawClaims.sessionId } : {}),
    iat,
    exp,
    jti: rawClaims.jti,
  });
}

/**
 * Constant-time comparison of two secret strings using SHA-256 digest equality
 * plus explicit byte-length equality so neither length nor prefix leaks via timing (§6.3).
 */
export function constantTimeTokenEquals(provided: string, expected: string): boolean {
  if (typeof provided !== 'string' || typeof expected !== 'string') {
    return false;
  }
  if (provided.length === 0 || expected.length === 0) {
    return false;
  }
  const providedDigest = createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = createHash('sha256').update(expected, 'utf8').digest();
  const digestMatch = timingSafeEqual(providedDigest, expectedDigest);
  return digestMatch && provided.length === expected.length;
}

export interface VerifyServiceCallerInput {
  readonly callerHeader: string | undefined;
  readonly tokenHeader: string | undefined;
  readonly expectedTokenOrDirectory: string | Readonly<Partial<Record<ServiceCallerName, string>>>;
  readonly allowedCallers?: readonly ServiceCallerName[];
}

export interface VerifiedServiceCaller {
  readonly caller: ServiceCallerName;
}

/**
 * Verifies internal service-to-service credentials (`x-service-caller` + `x-service-token`)
 * in constant time and enforces the route's allowed caller list (§6.3, Invariant #14).
 */
export function verifyServiceCaller(input: VerifyServiceCallerInput): VerifiedServiceCaller {
  const { callerHeader, tokenHeader, expectedTokenOrDirectory, allowedCallers } = input;

  if (typeof callerHeader !== 'string' || callerHeader.trim().length === 0) {
    throw new AppError('UNAUTHENTICATED', 'Missing x-service-caller header');
  }
  if (typeof tokenHeader !== 'string' || tokenHeader.trim().length === 0) {
    throw new AppError('UNAUTHENTICATED', 'Missing x-service-token header');
  }

  const caller = callerHeader.trim() as ServiceCallerName;
  if (!(SERVICE_CALLERS as readonly string[]).includes(caller)) {
    throw new AppError('UNAUTHENTICATED', `Unknown service caller: ${caller}`);
  }

  const expectedToken =
    typeof expectedTokenOrDirectory === 'string'
      ? expectedTokenOrDirectory
      : expectedTokenOrDirectory[caller];

  if (typeof expectedToken !== 'string' || expectedToken.length === 0) {
    throw new AppError('UNAUTHENTICATED', `No service credential configured for caller: ${caller}`);
  }

  if (!constantTimeTokenEquals(tokenHeader, expectedToken)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid service-to-service credential');
  }

  if (allowedCallers !== undefined && !allowedCallers.includes(caller)) {
    throw new AppError('FORBIDDEN', `Service caller "${caller}" is not authorized for this endpoint`);
  }

  return Object.freeze({ caller });
}
