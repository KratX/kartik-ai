/**
 * @kartik/auth/repositories — User Identity Repository (`auth.users`)
 * (Blueprint §5.1, ADR 0004 & Architecture Invariants #2, #7, #20).
 *
 * Rules enforced:
 * 1. Idempotently upserts a user record on Google sign-in keyed by `firebase_uid`.
 * 2. Normalizes email addresses to trimmed lowercase.
 * 3. Rejects sign-in for disabled accounts (`status === 'disabled'`) with `403 FORBIDDEN`
 *    (Invariant #20: `403` is used when an action is refused on the caller's own account).
 * 4. All SQL runs inside the `auth` schema with hand-written parameterized queries (ADR 0004).
 */
import { randomUUID } from 'node:crypto';
import { AppError, type DatabasePool } from '@kartik/shared';
import type { AuthUser, UpsertGoogleUserInput, UserStatus } from '../models/index.js';

export interface UserRepository {
  upsertUserFromGoogleIdentity(input: UpsertGoogleUserInput): Promise<AuthUser>;
  findById(userId: string): Promise<AuthUser | null>;
  findByFirebaseUid(firebaseUid: string): Promise<AuthUser | null>;
  setUserStatus(userId: string, status: UserStatus): Promise<AuthUser>;
}

function validateUpsertInput(input: UpsertGoogleUserInput): {
  firebaseUid: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  nowIso: string;
} {
  const firebaseUid = input.firebaseUid?.trim() ?? '';
  if (firebaseUid.length < 3 || firebaseUid.length > 128) {
    throw new AppError('VALIDATION_FAILED', 'firebaseUid must be between 3 and 128 characters', {
      details: { firebaseUid: ['Must be 3..128 chars'] },
    });
  }

  const email = (input.email ?? '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new AppError('VALIDATION_FAILED', 'A valid email address is required for Google sign-in', {
      details: { email: ['Invalid email format'] },
    });
  }

  const rawDisplay = (input.displayName ?? '').trim();
  const displayName = rawDisplay.length > 0 ? rawDisplay.slice(0, 120) : email.split('@')[0]!;

  const avatarUrl =
    input.avatarUrl !== undefined && input.avatarUrl !== null && input.avatarUrl.trim().length > 0
      ? input.avatarUrl.trim()
      : null;

  const nowIso = input.nowIso ?? new Date().toISOString();

  return { firebaseUid, email, displayName, avatarUrl, nowIso };
}

interface UserRow {
  readonly id: string;
  readonly firebase_uid: string;
  readonly email: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly status: UserStatus;
  readonly last_login_at: string | Date;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
}

function mapRowToAuthUser(row: UserRow): AuthUser {
  const toIso = (val: string | Date): string =>
    val instanceof Date ? val.toISOString() : new Date(val).toISOString();

  return Object.freeze({
    id: row.id,
    firebaseUid: row.firebase_uid,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
    status: row.status,
    lastLoginAt: toIso(row.last_login_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  });
}

/**
 * PostgreSQL implementation of `UserRepository` targeting `auth.users` (ADR 0004).
 */
export class PostgresUserRepository implements UserRepository {
  private readonly pool: DatabasePool;

  constructor(pool: DatabasePool) {
    this.pool = pool;
  }

  async upsertUserFromGoogleIdentity(input: UpsertGoogleUserInput): Promise<AuthUser> {
    const clean = validateUpsertInput(input);
    const candidateId = `usr_${randomUUID()}`;

    const result = await this.pool.query<UserRow>(
      `INSERT INTO auth.users (
         id, firebase_uid, email, display_name, avatar_url, status, last_login_at, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, 'active', $6, $6, $6)
       ON CONFLICT (firebase_uid) DO UPDATE SET
         email = EXCLUDED.email,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         last_login_at = EXCLUDED.last_login_at,
         updated_at = EXCLUDED.updated_at
       RETURNING id, firebase_uid, email, display_name, avatar_url, status, last_login_at, created_at, updated_at`,
      [
        candidateId,
        clean.firebaseUid,
        clean.email,
        clean.displayName,
        clean.avatarUrl,
        clean.nowIso,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AppError('INTERNAL_ERROR', 'Failed to upsert user record in auth.users');
    }

    const user = mapRowToAuthUser(row);
    if (user.status === 'disabled') {
      throw new AppError('FORBIDDEN', 'User account is disabled');
    }
    return user;
  }

  async findById(userId: string): Promise<AuthUser | null> {
    if (!userId || !userId.trim()) {
      return null;
    }
    const result = await this.pool.query<UserRow>(
      `SELECT id, firebase_uid, email, display_name, avatar_url, status, last_login_at, created_at, updated_at
       FROM auth.users WHERE id = $1 LIMIT 1`,
      [userId.trim()],
    );
    const row = result.rows[0];
    return row ? mapRowToAuthUser(row) : null;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<AuthUser | null> {
    if (!firebaseUid || !firebaseUid.trim()) {
      return null;
    }
    const result = await this.pool.query<UserRow>(
      `SELECT id, firebase_uid, email, display_name, avatar_url, status, last_login_at, created_at, updated_at
       FROM auth.users WHERE firebase_uid = $1 LIMIT 1`,
      [firebaseUid.trim()],
    );
    const row = result.rows[0];
    return row ? mapRowToAuthUser(row) : null;
  }

  async setUserStatus(userId: string, status: UserStatus): Promise<AuthUser> {
    const result = await this.pool.query<UserRow>(
      `UPDATE auth.users
       SET status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING id, firebase_uid, email, display_name, avatar_url, status, last_login_at, created_at, updated_at`,
      [userId.trim(), status],
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
    return mapRowToAuthUser(row);
  }
}

/**
 * Deterministic in-memory `UserRepository` for fast unit/contract testing and mock mode.
 */
export class InMemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, AuthUser>();
  private readonly idByFirebaseUid = new Map<string, string>();
  private readonly idByEmail = new Map<string, string>();

  async upsertUserFromGoogleIdentity(input: UpsertGoogleUserInput): Promise<AuthUser> {
    const clean = validateUpsertInput(input);
    const existingId = this.idByFirebaseUid.get(clean.firebaseUid);

    if (existingId !== undefined) {
      const prev = this.byId.get(existingId)!;
      if (prev.status === 'disabled') {
        throw new AppError('FORBIDDEN', 'User account is disabled');
      }
      if (prev.email !== clean.email) {
        this.idByEmail.delete(prev.email);
        this.idByEmail.set(clean.email, prev.id);
      }
      const updated: AuthUser = Object.freeze({
        ...prev,
        email: clean.email,
        displayName: clean.displayName,
        avatarUrl: clean.avatarUrl,
        lastLoginAt: clean.nowIso,
        updatedAt: clean.nowIso,
      });
      this.byId.set(prev.id, updated);
      return updated;
    }

    const emailConflictId = this.idByEmail.get(clean.email);
    if (emailConflictId !== undefined) {
      throw new AppError('VALIDATION_FAILED', 'Email address is already linked to another identity');
    }

    const newUser: AuthUser = Object.freeze({
      id: `usr_${randomUUID()}`,
      firebaseUid: clean.firebaseUid,
      email: clean.email,
      displayName: clean.displayName,
      avatarUrl: clean.avatarUrl,
      status: 'active',
      lastLoginAt: clean.nowIso,
      createdAt: clean.nowIso,
      updatedAt: clean.nowIso,
    });

    this.byId.set(newUser.id, newUser);
    this.idByFirebaseUid.set(clean.firebaseUid, newUser.id);
    this.idByEmail.set(clean.email, newUser.id);
    return newUser;
  }

  async findById(userId: string): Promise<AuthUser | null> {
    return this.byId.get(userId.trim()) ?? null;
  }

  async findByFirebaseUid(firebaseUid: string): Promise<AuthUser | null> {
    const id = this.idByFirebaseUid.get(firebaseUid.trim());
    return id ? (this.byId.get(id) ?? null) : null;
  }

  async setUserStatus(userId: string, status: UserStatus): Promise<AuthUser> {
    const existing = this.byId.get(userId.trim());
    if (!existing) {
      throw new AppError('NOT_FOUND', 'User not found');
    }
    const updated: AuthUser = Object.freeze({
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
    });
    this.byId.set(existing.id, updated);
    return updated;
  }
}
