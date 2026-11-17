import type { Request, Response, NextFunction } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

/**
 * Checks whether a bearer token is a well-formed 3-segment JWT (`header.payload.signature`)
 * issued by Google/Firebase before invoking `firebase-admin` `verifyIdToken`.
 */
function isFirebaseJwtCandidate(token: string | undefined): token is string {
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

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!isFirebaseJwtCandidate(token)) {
    return res.status(401).json({ error: 'Unauthorized: Invalid token format' });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
};

export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (isFirebaseJwtCandidate(token)) {
      try {
        req.user = await adminAuth.verifyIdToken(token);
      } catch {
        // Non-fatal in optionalAuth; downstream route handler inspects body/session
      }
    }
  }
  next();
};
