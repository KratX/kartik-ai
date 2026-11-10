import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runForwardMigrations, type DatabaseClient, type DatabasePool, type DatabaseQueryResult } from '@kartik/shared';
import {
  AUTH_MIGRATIONS,
  InMemoryUserRepository,
  loadAuthConfig,
  PostgresUserRepository,
} from '../src/index.js';

describe('@kartik/auth config, 0001_auth_users migration & UserRepository (2.1.a)', () => {
  it('loads Auth config in mock mode by default and enforces Firebase credentials when AUTH_PROVIDER_MODE=firebase', () => {
    const mockCfg = loadAuthConfig({
      DATABASE_URL: 'postgresql://kartik_auth:secret@localhost:5432/kartik',
      REDIS_URL: 'redis://localhost:6379',
      SERVICE_TO_SERVICE_TOKEN: 'svc_secret_auth_token_1234567890',
    });

    assert.equal(mockCfg.DATABASE_SCHEMA, 'auth');
    assert.equal(mockCfg.AUTH_PROVIDER_MODE, 'mock');
    assert.equal(mockCfg.PORT_AUTH, 8001);
    assert.equal(mockCfg.SESSION_COOKIE_NAME, 'kartik_session');
    assert.equal(mockCfg.SESSION_TTL_SECONDS, 604_800);

    // Production forces COOKIE_SECURE=true
    const prodCfg = loadAuthConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://kartik_auth:secret@localhost:5432/kartik',
      REDIS_URL: 'redis://localhost:6379',
      SERVICE_TO_SERVICE_TOKEN: 'svc_secret_auth_token_1234567890',
      COOKIE_SECURE: 'false',
    });
    assert.equal(prodCfg.COOKIE_SECURE, true);

    // Live firebase mode requires FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
    assert.throws(
      () =>
        loadAuthConfig({
          AUTH_PROVIDER_MODE: 'firebase',
          DATABASE_URL: 'postgresql://kartik_auth:secret@localhost:5432/kartik',
          REDIS_URL: 'redis://localhost:6379',
          SERVICE_TO_SERVICE_TOKEN: 'svc_secret_auth_token_1234567890',
        }),
      /FIREBASE_PROJECT_ID/,
    );
  });

  it('applies AUTH_MIGRATIONS (0001_auth_users.sql) inside the auth schema via runForwardMigrations', async () => {
    const executedSql: string[] = [];
    const client: DatabaseClient = {
      async query<TRow>(sql: string): Promise<DatabaseQueryResult<TRow>> {
        executedSql.push(sql.trim());
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const pool: DatabasePool = {
      async connect() {
        return client;
      },
      async query<TRow>(sql: string) {
        return client.query<TRow>(sql);
      },
      async end() {},
    };

    const applied = await runForwardMigrations(pool, 'auth', AUTH_MIGRATIONS);
    assert.deepEqual(applied, ['0001']);
    assert.ok(executedSql.some((q) => q.includes('CREATE TABLE IF NOT EXISTS auth.users')));
  });

  it('idempotently upserts users by firebaseUid, normalizes emails, and rejects disabled accounts with 403 FORBIDDEN', async () => {
    const repo = new InMemoryUserRepository();

    const created = await repo.upsertUserFromGoogleIdentity({
      firebaseUid: 'fb_google_uid_001',
      email: '  Kartik.Rawat@Example.COM ',
      displayName: 'Kartik Rawat',
      avatarUrl: 'https://example.com/avatar1.png',
      nowIso: '2026-11-10T10:00:00.000Z',
    });

    assert.ok(created.id.startsWith('usr_'));
    assert.equal(created.email, 'kartik.rawat@example.com');
    assert.equal(created.status, 'active');

    // Second sign-in with same firebaseUid preserves user.id and updates lastLoginAt + displayName
    const updated = await repo.upsertUserFromGoogleIdentity({
      firebaseUid: 'fb_google_uid_001',
      email: 'kartik.rawat@example.com',
      displayName: 'Kartik R.',
      avatarUrl: 'https://example.com/avatar2.png',
      nowIso: '2026-11-10T11:00:00.000Z',
    });

    assert.equal(updated.id, created.id);
    assert.equal(updated.displayName, 'Kartik R.');
    assert.equal(updated.createdAt, '2026-11-10T10:00:00.000Z');
    assert.equal(updated.lastLoginAt, '2026-11-10T11:00:00.000Z');

    // Disabling the user causes subsequent sign-in to throw 403 FORBIDDEN (Invariant #20)
    await repo.setUserStatus(created.id, 'disabled');
    await assert.rejects(
      () =>
        repo.upsertUserFromGoogleIdentity({
          firebaseUid: 'fb_google_uid_001',
          email: 'kartik.rawat@example.com',
          displayName: 'Kartik R.',
        }),
      (err: unknown) => (err as { code?: string }).code === 'FORBIDDEN',
    );
  });

  it('executes parameterized SQL against auth.users in PostgresUserRepository', async () => {
    const queries: { sql: string; params: readonly unknown[] | undefined }[] = [];
    const pool: DatabasePool = {
      async connect() {
        throw new Error('not used');
      },
      async query<TRow>(sql: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<TRow>> {
        queries.push({ sql, params });
        return {
          rows: [
            {
              id: String(params?.[0] ?? 'usr_test'),
              firebase_uid: String(params?.[1] ?? 'fb_01'),
              email: String(params?.[2] ?? 'kartik@example.com'),
              display_name: String(params?.[3] ?? 'Kartik'),
              avatar_url: null,
              status: 'active',
              last_login_at: '2026-11-10T12:00:00.000Z',
              created_at: '2026-11-10T12:00:00.000Z',
              updated_at: '2026-11-10T12:00:00.000Z',
            },
          ] as unknown as TRow[],
          rowCount: 1,
        };
      },
      async end() {},
    };

    const pgRepo = new PostgresUserRepository(pool);
    const user = await pgRepo.upsertUserFromGoogleIdentity({
      firebaseUid: 'fb_pg_01',
      email: 'Kartik@Example.com',
      displayName: 'Kartik',
    });

    assert.equal(user.email, 'kartik@example.com');
    assert.equal(queries.length, 1);
    assert.ok(queries[0]!.sql.includes('INSERT INTO auth.users'));
    assert.ok(queries[0]!.sql.includes('ON CONFLICT (firebase_uid) DO UPDATE'));
  });
});
