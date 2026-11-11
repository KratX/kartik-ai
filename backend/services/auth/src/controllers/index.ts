/**
 * @file backend/services/auth/src/controllers/index.ts
 * @description HTTP controller handlers for @kartik/auth (Blueprint §2.1, §5.4, §5.5, §7.2, ADR 0002).
 *
 * Endpoints handled:
 * - `POST /auth/google` — Verifies Firebase ID token, upserts user in `auth.users`,
 *   creates opaque Redis session (`sess:{sessionId}`), and sets `HttpOnly` cookie.
 * - `GET /auth/me` — Introspects session cookie, refreshes sliding 7-day TTL, and returns current user.
 * - `POST /auth/logout` — Immediately deletes Redis session key (`DEL sess:{sessionId}`) and clears cookie.
 * - `POST /internal/sessions/introspect` — Private Gateway-only endpoint resolving an opaque
 *   session ID into verified user identity claims (`userId`, `email`, `displayName`).
 * - `GET /healthz` & `GET /readyz` — Liveness and dependency readiness probes.
 */

import {
  AppError,
  createSuccessEnvelope,
  getSingleHeader,
  type MiddlewareRequest,
  type MiddlewareResponse,
} from '@kartik/shared';
import type { AuthServiceConfig } from '../config/index.js';
import type { AuthUser, UserStatus } from '../models/index.js';
import type { UserRepository } from '../repositories/index.js';
import {
  extractSessionIdFromCookieHeader,
  serializeClearSessionCookie,
  serializeSessionCookie,
  type FirebaseTokenVerifier,
  type SessionService,
} from '../services/index.js';

export interface AuthHttpRequest extends MiddlewareRequest {
  readonly body?: unknown;
}

export interface PublicAuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly status: UserStatus;
  readonly createdAt: string;
  readonly lastLoginAt: string;
}

/**
 * Projects an internal `AuthUser` record into a browser-safe DTO
 * (omitting internal `firebaseUid` provider identifiers).
 */
export function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
  };
}

export interface AuthControllerDependencies {
  readonly config: AuthServiceConfig;
  readonly firebaseVerifier: FirebaseTokenVerifier;
  readonly userRepository: UserRepository;
  readonly sessionService: SessionService;
  readonly checkReadiness?: () => Promise<boolean>;
}

export class AuthController {
  private readonly config: AuthServiceConfig;
  private readonly firebaseVerifier: FirebaseTokenVerifier;
  private readonly userRepository: UserRepository;
  private readonly sessionService: SessionService;
  private readonly checkReadiness?: () => Promise<boolean>;

  constructor(deps: AuthControllerDependencies) {
    this.config = deps.config;
    this.firebaseVerifier = deps.firebaseVerifier;
    this.userRepository = deps.userRepository;
    this.sessionService = deps.sessionService;
    this.checkReadiness = deps.checkReadiness;
  }

  /**
   * `POST /auth/google`
   * Exchanges a Google/Firebase ID token for an opaque Redis-backed `HttpOnly` session cookie.
   */
  async handleGoogleSignIn(req: AuthHttpRequest, res: MiddlewareResponse): Promise<void> {
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const rawIdToken = body.idToken;
    if (typeof rawIdToken !== 'string' || rawIdToken.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Request body must include a non-empty idToken.', {
        details: { idToken: ['Must be a non-empty string'] },
      });
    }

    const verifiedIdentity = await this.firebaseVerifier.verifyIdToken(rawIdToken.trim());

    const user = await this.userRepository.upsertUserFromGoogleIdentity({
      firebaseUid: verifiedIdentity.firebaseUid,
      email: verifiedIdentity.email,
      displayName: verifiedIdentity.displayName,
      avatarUrl: verifiedIdentity.avatarUrl,
    });

    const session = await this.sessionService.createSession(user);
    const setCookieHeader = serializeSessionCookie(session.sessionId, this.config);
    res.setHeader('Set-Cookie', setCookieHeader);

    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const requestId = req.requestContext?.requestId;

    res.status(200).json(
      createSuccessEnvelope(
        traceId,
        {
          user: toPublicAuthUser(user),
          sessionExpiresAt: session.expiresAt,
        },
        requestId ? { requestId } : undefined,
      ),
    );
  }

  /**
   * `GET /auth/me`
   * Introspects the caller's `HttpOnly` session cookie, refreshes its 7-day sliding TTL,
   * and returns the authenticated user profile.
   */
  async handleGetMe(req: AuthHttpRequest, res: MiddlewareResponse): Promise<void> {
    const cookieHeader = getSingleHeader(req.headers, 'cookie');
    const sessionId = extractSessionIdFromCookieHeader(
      cookieHeader,
      this.config.SESSION_COOKIE_NAME,
    );
    if (!sessionId) {
      throw new AppError('UNAUTHENTICATED', 'Missing session cookie.');
    }

    const session = await this.sessionService.introspectSession(sessionId, {
      slidingRefresh: true,
    });

    const user = await this.userRepository.findById(session.userId);
    if (!user) {
      await this.sessionService.revokeSession(sessionId);
      res.setHeader('Set-Cookie', serializeClearSessionCookie(this.config));
      throw new AppError('UNAUTHENTICATED', 'Session user no longer exists.');
    }
    if (user.status === 'disabled') {
      await this.sessionService.revokeSession(sessionId);
      res.setHeader('Set-Cookie', serializeClearSessionCookie(this.config));
      throw new AppError('FORBIDDEN', 'User account is disabled.');
    }

    res.setHeader('Set-Cookie', serializeSessionCookie(session.sessionId, this.config));

    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    res.status(200).json(
      createSuccessEnvelope(traceId, {
        user: toPublicAuthUser(user),
        sessionExpiresAt: session.expiresAt,
      }),
    );
  }

  /**
   * `POST /auth/logout`
   * Immediately deletes `sess:{sessionId}` from Redis and clears the browser cookie (ADR 0002).
   */
  async handleLogout(req: AuthHttpRequest, res: MiddlewareResponse): Promise<void> {
    const cookieHeader = getSingleHeader(req.headers, 'cookie');
    const sessionId = extractSessionIdFromCookieHeader(
      cookieHeader,
      this.config.SESSION_COOKIE_NAME,
    );

    if (sessionId) {
      await this.sessionService.revokeSession(sessionId);
    }

    res.setHeader('Set-Cookie', serializeClearSessionCookie(this.config));

    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const requestId = req.requestContext?.requestId;

    res.status(200).json(
      createSuccessEnvelope(
        traceId,
        {
          loggedOut: true,
        },
        requestId ? { requestId } : undefined,
      ),
    );
  }

  /**
   * `POST /internal/sessions/introspect`
   * Private endpoint called strictly by the API Gateway (`x-service-caller: gateway`)
   * to validate a browser session ID before minting an Ed25519 user-context assertion (ADR 0002).
   */
  async handleInternalSessionIntrospect(
    req: AuthHttpRequest,
    res: MiddlewareResponse,
  ): Promise<void> {
    const body =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body)
        ? (req.body as Record<string, unknown>)
        : {};

    const rawSessionId = body.sessionId;
    if (typeof rawSessionId !== 'string' || rawSessionId.trim().length === 0) {
      throw new AppError('VALIDATION_FAILED', 'Request body must include a non-empty sessionId.', {
        details: { sessionId: ['Must be a non-empty string'] },
      });
    }

    const session = await this.sessionService.introspectSession(rawSessionId.trim(), {
      slidingRefresh: true,
    });

    const user = await this.userRepository.findById(session.userId);
    if (!user) {
      await this.sessionService.revokeSession(session.sessionId);
      throw new AppError('UNAUTHENTICATED', 'Session user does not exist.');
    }
    if (user.status === 'disabled') {
      await this.sessionService.revokeSession(session.sessionId);
      throw new AppError('FORBIDDEN', 'User account is disabled.');
    }

    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const requestId = req.requestContext?.requestId;

    res.status(200).json(
      createSuccessEnvelope(
        traceId,
        {
          sessionId: session.sessionId,
          userId: user.id,
          email: user.email,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          expiresAt: session.expiresAt,
        },
        requestId ? { requestId } : undefined,
      ),
    );
  }

  /**
   * `GET /healthz` — Liveness probe.
   */
  handleHealthz(req: AuthHttpRequest, res: MiddlewareResponse): void {
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    res.status(200).json(
      createSuccessEnvelope(traceId, {
        status: 'ok',
        service: 'auth',
      }),
    );
  }

  /**
   * `GET /readyz` — Readiness probe checking database and Redis connectivity.
   */
  async handleReadyz(req: AuthHttpRequest, res: MiddlewareResponse): Promise<void> {
    const traceId = req.requestContext?.traceId ?? 'trc_unknown';
    const ready = this.checkReadiness ? await this.checkReadiness() : true;
    if (!ready) {
      throw new AppError('INTERNAL_ERROR', 'Auth dependencies (Postgres/Redis) are not ready.');
    }
    res.status(200).json(
      createSuccessEnvelope(traceId, {
        status: 'ready',
        service: 'auth',
      }),
    );
  }
}
