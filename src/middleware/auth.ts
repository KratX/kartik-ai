import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import crypto from 'node:crypto';
import { AppError, mapErrorToHttpResponse } from '../../backend/shared/errors/index.js';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface VerifiedRequestIdentity {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly emailVerified: boolean;
}

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  authIdentity?: VerifiedRequestIdentity;
  sessionId?: string;
}

export type FirebaseIdTokenVerifierFn = (token: string) => Promise<DecodedIdToken>;
export type SessionIdentityResolverFn = (
  sessionId: string,
) => VerifiedRequestIdentity | null | undefined;

let customTokenVerifier: FirebaseIdTokenVerifierFn | null = null;
let sessionIdentityResolver: SessionIdentityResolverFn | null = null;

/**
 * Allows unit/integration tests to inject a deterministic Firebase ID token verifier
 * while keeping production/runtime verification bound to `adminAuth.verifyIdToken`.
 */
export function setFirebaseTokenVerifierForTests(
  verifier: FirebaseIdTokenVerifierFn | null,
): void {
  customTokenVerifier = verifier;
}

/**
 * Registers the server-side session lookup callback used to resolve `kartik_session`
 * cookies that were issued after a verified Firebase ID token login.
 */
export function registerSessionIdentityResolver(
  resolver: SessionIdentityResolverFn | null,
): void {
  sessionIdentityResolver = resolver;
}

/**
 * Checks whether a bearer token is a well-formed 3-segment RS256 JWT (`header.payload.signature`)
 * issued by Google/Firebase before invoking `firebase-admin` `verifyIdToken`.
 */
export function isFirebaseJwtCandidate(token: string | undefined): token is string {
  if (!token || typeof token !== 'string') {
    return false;
  }
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.startsWith('mock-')) {
    return false;
  }
  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    return false;
  }
  try {
    const header = JSON.parse(
      Buffer.from(parts[0] ?? '', 'base64url').toString('utf8'),
    ) as { alg?: string; kid?: string };
    return (
      header.alg === 'RS256' &&
      typeof header.kid === 'string' &&
      header.kid.length > 0 &&
      header.kid !== 'firebase-service-account'
    );
  } catch {
    return false;
  }
}

function normalizeDecodedIdToken(decoded: DecodedIdToken): VerifiedRequestIdentity {
  const uid = typeof decoded.uid === 'string' ? decoded.uid.trim() : '';
  if (!uid) {
    throw new AppError('UNAUTHENTICATED', 'Verified Firebase token is missing uid');
  }
  const email = typeof decoded.email === 'string' ? decoded.email.trim().toLowerCase() : '';
  if (!email || !email.includes('@')) {
    throw new AppError('UNAUTHENTICATED', 'Verified Firebase token is missing a valid email claim');
  }
  if (decoded.email_verified === false) {
    throw new AppError('UNAUTHENTICATED', 'Firebase account email address is not verified');
  }
  const rawName =
    typeof decoded['name'] === 'string' && decoded['name'].trim().length > 0
      ? decoded['name'].trim()
      : email.split('@')[0] ?? uid;
  const rawPicture =
    typeof decoded.picture === 'string' && decoded.picture.trim().length > 0
      ? decoded.picture.trim()
      : null;

  return Object.freeze({
    uid,
    email,
    displayName: rawName,
    avatarUrl: rawPicture,
    emailVerified: true,
  });
}

/**
 * Cryptographically verifies a Firebase ID token and extracts the authenticated user identity.
 * Never trusts caller-supplied UID/email or unverified JWT payloads.
 */
export async function verifyRequestFirebaseToken(
  rawToken: string | undefined,
): Promise<{ decoded: DecodedIdToken; identity: VerifiedRequestIdentity }> {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.trim().length === 0) {
    throw new AppError('UNAUTHENTICATED', 'Missing Firebase ID token');
  }
  const token = rawToken.trim();

  if (customTokenVerifier) {
    try {
      const decoded = await customTokenVerifier(token);
      return {
        decoded,
        identity: normalizeDecodedIdToken(decoded),
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError('UNAUTHENTICATED', 'Invalid or expired Firebase ID token', {
        cause: err,
      });
    }
  }

  if (!isFirebaseJwtCandidate(token)) {
    throw new AppError('UNAUTHENTICATED', 'Invalid Firebase ID token format');
  }

  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return {
      decoded,
      identity: normalizeDecodedIdToken(decoded),
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError('UNAUTHENTICATED', 'Invalid or expired Firebase ID token', {
      cause: err,
    });
  }
}

export function extractSessionCookieId(req: Request): string | undefined {
  const rawCookie = req.headers.cookie;
  if (!rawCookie || typeof rawCookie !== 'string') {
    return undefined;
  }
  for (const part of rawCookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith('kartik_session=')) {
      const value = decodeURIComponent(trimmed.slice('kartik_session='.length).trim());
      if (value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function sendUnauthenticatedResponse(req: Request, res: Response, err: unknown): void {
  const rawTrace = req.headers['x-trace-id'];
  const traceId =
    typeof rawTrace === 'string' && rawTrace.trim().length > 0
      ? rawTrace.trim()
      : `trc_${crypto.randomBytes(8).toString('hex')}`;
  const rawReqId = req.headers['idempotency-key'];
  const requestId =
    typeof rawReqId === 'string' && rawReqId.trim().length > 0
      ? rawReqId.trim()
      : undefined;

  const appErr =
    err instanceof AppError
      ? err
      : new AppError('UNAUTHENTICATED', 'Unauthorized: Verified Firebase token required');
  const mapped = mapErrorToHttpResponse(appErr, { traceId, requestId });
  for (const [k, v] of Object.entries(mapped.headers)) {
    res.setHeader(k, v);
  }
  res.status(mapped.httpStatus).json({
    ok: false,
    ...mapped.body,
  });
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    try {
      const { decoded, identity } = await verifyRequestFirebaseToken(token);
      req.user = decoded;
      req.authIdentity = identity;
      next();
      return;
    } catch (err) {
      sendUnauthenticatedResponse(req, res, err);
      return;
    }
  }

  const sessionId = extractSessionCookieId(req);
  if (sessionId && sessionIdentityResolver) {
    const sessionIdentity = sessionIdentityResolver(sessionId);
    if (sessionIdentity) {
      req.sessionId = sessionId;
      req.authIdentity = sessionIdentity;
      next();
      return;
    }
  }

  sendUnauthenticatedResponse(
    req,
    res,
    new AppError(
      'UNAUTHENTICATED',
      'Authentication required: provide a verified Firebase Bearer ID token or active session',
    ),
  );
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (customTokenVerifier || isFirebaseJwtCandidate(token)) {
      try {
        const { decoded, identity } = await verifyRequestFirebaseToken(token);
        req.user = decoded;
        req.authIdentity = identity;
        next();
        return;
      } catch {
        // Invalid bearer token leaves req.authIdentity undefined; protected routes reject via requireAuth
      }
    }
  }

  const sessionId = extractSessionCookieId(req);
  if (sessionId) {
    req.sessionId = sessionId;
    if (sessionIdentityResolver) {
      const resolved = sessionIdentityResolver(sessionId);
      if (resolved) {
        req.authIdentity = resolved;
      }
    }
  }

  next();
};
