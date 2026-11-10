/**
 * @kartik/auth/models — Auth Domain Entity (`AuthUser`) & Forward-Only SQL Migration `0001`
 * (Blueprint §5.1, ADR 0004 & Architecture Invariant #2).
 *
 * Architecture Invariant #2:
 * "Auth owns identity and application sessions; it owns no credits or payments."
 */
import type { SqlMigrationFile } from '@kartik/shared';

export const USER_STATUSES = ['active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface AuthUser {
  readonly id: string;
  readonly firebaseUid: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly status: UserStatus;
  readonly lastLoginAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface UpsertGoogleUserInput {
  readonly firebaseUid: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl?: string | null;
  readonly nowIso?: string;
}

/**
 * Migration `0001_auth_users.sql` — creates the `auth.users` table and indexes
 * inside the isolated `auth` schema (Blueprint §5.1 & ADR 0004).
 */
export const AUTH_MIGRATION_0001: SqlMigrationFile = Object.freeze({
  version: '0001',
  filename: '0001_auth_users.sql',
  sql: `
CREATE TABLE IF NOT EXISTS auth.users (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_users_firebase_uid ON auth.users (firebase_uid);
CREATE INDEX IF NOT EXISTS idx_auth_users_email ON auth.users (email);
`.trim(),
});

export const AUTH_MIGRATIONS: readonly SqlMigrationFile[] = Object.freeze([
  AUTH_MIGRATION_0001,
]);
