import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  assertDirectMigrationUrl,
  assertValidPostgresConnectionUrl,
  buildDatabasePoolConfig,
  buildObjectStorageKey,
  computeMigrationChecksum,
  createLazyPostgresPool,
  InMemoryObjectStorage,
  PostgresObjectStorage,
  resolvePostgresTlsConfig,
  runForwardMigrations,
  S3CompatibleObjectStorage,
  validatePostgresConnectionUrl,
  validateUploadFile,
  verifyDatabaseConnectivity,
  withTransaction,
  type DatabaseClient,
  type DatabasePool,
  type DatabaseQueryResult,
  type UnderlyingPgPoolLike,
} from '../index.js';

function createMockDatabasePool(initialAppliedMigrations: { version: string; filename: string; checksum: string }[] = []): {
  pool: DatabasePool;
  executedQueries: string[];
  releasedCount: () => number;
} {
  const executedQueries: string[] = [];
  let released = 0;
  const applied = [...initialAppliedMigrations];

  const client: DatabaseClient = {
    async query<TRow>(sql: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<TRow>> {
      executedQueries.push(sql.trim());
      if (sql.includes('SELECT version, filename, checksum')) {
        return { rows: [...applied] as unknown as TRow[], rowCount: applied.length };
      }
      if (sql.startsWith('INSERT INTO') && params && params.length === 3) {
        applied.push({
          version: String(params[0]),
          filename: String(params[1]),
          checksum: String(params[2]),
        });
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      released += 1;
    },
  };

  const pool: DatabasePool = {
    async connect() {
      return client;
    },
    async query<TRow>(sql: string, params?: readonly unknown[]) {
      return client.query<TRow>(sql, params);
    },
    async end() {},
  };

  return { pool, executedQueries, releasedCount: () => released };
}

describe('@kartik/shared/database & @kartik/shared/storage (1.8.a)', () => {
  it('enforces Neon 10s idleTimeoutMillis cap, rejects nonexistent production postgres host, and verifies startup connectivity (ADR 0004)', async () => {
    const cfg = buildDatabasePoolConfig({
      connectionString: 'postgresql://kartik_billing:secret@localhost:5432/kartik',
      schema: 'billing',
    });

    assert.equal(cfg.idleTimeoutMillis, 10_000);
    assert.equal(cfg.options, '-c search_path=billing');
    assert.equal(cfg.max, 10);

    // Rejects nonexistent `postgres` host in production
    const prodComposeDefaultCheck = validatePostgresConnectionUrl(
      'postgresql://kartik_auth:kartik_auth@postgres:5432/kartik',
      { envName: 'DATABASE_URL', nodeEnv: 'production' },
    );
    assert.equal(prodComposeDefaultCheck.valid, false);
    assert.match(prodComposeDefaultCheck.reason ?? '', /nonexistent Compose hostname "postgres"/);

    assert.throws(
      () =>
        assertValidPostgresConnectionUrl(
          'postgresql://kartik_billing:kartik_billing@postgres:5432/kartik',
          { envName: 'BILLING_DATABASE_URL', nodeEnv: 'production' },
        ),
      /nonexistent Compose hostname "postgres"/,
    );

    // Accepts valid Neon PostgreSQL pooled connection URI in production
    const neonCheck = validatePostgresConnectionUrl(
      'postgresql://neondb_owner:secret@ep-rapid-rain-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
      { envName: 'DATABASE_URL', nodeEnv: 'production' },
    );
    assert.equal(neonCheck.valid, true);
    assert.equal(neonCheck.requiresSsl, true);
    assert.equal(neonCheck.isPoolerEndpoint, true);

    // Startup connectivity check executes SELECT 1 AS ok and verifies schema
    const probePool = createMockDatabasePool();
    const connectivity = await verifyDatabaseConnectivity(probePool.pool, 'auth');
    assert.equal(connectivity.connected, true);
    assert.equal(connectivity.schema, 'auth');
    assert.ok(probePool.executedQueries.includes('SELECT 1 AS ok'));

    // Reject idleTimeoutMillis > 15_000ms (protects Neon 100 CU-hour/month budget)
    assert.throws(
      () =>
        buildDatabasePoolConfig({
          connectionString: 'postgresql://kartik_billing:secret@localhost:5432/kartik',
          schema: 'billing',
          idleTimeoutMillis: 30_000,
        }),
      /PGPOOL_IDLE_TIMEOUT_MS must be between 1000 and 15000ms/,
    );

    // Reject unknown schema outside auth | chat | agent | billing
    assert.throws(
      () =>
        buildDatabasePoolConfig({
          connectionString: 'postgresql://kartik:secret@localhost:5432/kartik',
          // @ts-expect-error invalid schema name
          schema: 'public',
        }),
      /Invalid database schema/,
    );
  });

  it('commits successful transactions, rolls back failed ones, and always releases the client in withTransaction (Invariant #17)', async () => {
    const mockOk = createMockDatabasePool();
    const res = await withTransaction(
      mockOk.pool,
      async (client) => {
        await client.query('SELECT balance FROM billing.credit_accounts WHERE user_id = $1 FOR UPDATE', ['usr_01']);
        return 'settled';
      },
      { schema: 'billing', isolationLevel: 'READ COMMITTED' },
    );

    assert.equal(res, 'settled');
    assert.equal(mockOk.releasedCount(), 1);
    assert.deepEqual(mockOk.executedQueries, [
      'BEGIN ISOLATION LEVEL READ COMMITTED',
      'SET LOCAL search_path TO billing',
      'SELECT balance FROM billing.credit_accounts WHERE user_id = $1 FOR UPDATE',
      'COMMIT',
    ]);

    const mockFail = createMockDatabasePool();
    await assert.rejects(
      () =>
        withTransaction(mockFail.pool, async (client) => {
          await client.query('UPDATE billing.credit_accounts SET balance = balance - 10');
          throw new Error('Simulated ledger constraint failure');
        }),
      /Simulated ledger constraint failure/,
    );
    assert.equal(mockFail.releasedCount(), 1);
    assert.ok(mockFail.executedQueries.includes('ROLLBACK'));
    assert.ok(!mockFail.executedQueries.includes('COMMIT'));
  });

  it('rejects -pooler URLs for migrations and enforces forward-only checksum immutability (ADR 0004)', async () => {
    assert.equal(
      assertDirectMigrationUrl('postgresql://kartik:secret@ep-cool-sky-123456.us-east-2.aws.neon.tech/kartik'),
      'postgresql://kartik:secret@ep-cool-sky-123456.us-east-2.aws.neon.tech/kartik',
    );

    assert.throws(
      () =>
        assertDirectMigrationUrl(
          'postgresql://kartik:secret@ep-cool-sky-123456-pooler.us-east-2.aws.neon.tech/kartik',
        ),
      /not a -pooler endpoint/,
    );

    const mig1Sql = 'CREATE TABLE chat.conversations (id TEXT PRIMARY KEY);';
    const mig2Sql = 'CREATE TABLE chat.messages (id TEXT PRIMARY KEY);';

    const mockDb = createMockDatabasePool([
      {
        version: '0001',
        filename: '0001_conversations.sql',
        checksum: computeMigrationChecksum(mig1Sql),
      },
    ]);

    const newlyApplied = await runForwardMigrations(mockDb.pool, 'chat', [
      { version: '0001', filename: '0001_conversations.sql', sql: mig1Sql },
      { version: '0002', filename: '0002_messages.sql', sql: mig2Sql },
    ]);

    assert.deepEqual(newlyApplied, ['0002']);

    // Mutating an already-applied migration's SQL throws INTERNAL_ERROR
    await assert.rejects(
      () =>
        runForwardMigrations(mockDb.pool, 'chat', [
          { version: '0001', filename: '0001_conversations.sql', sql: 'DROP TABLE chat.conversations;' },
        ]),
      (err: unknown) => (err as { code?: string }).code === 'INTERNAL_ERROR',
    );
  });

  it('builds server-side storage keys, verifies PDF/PNG magic bytes, and returns 404 on foreign object access (§11, Invariants #10 & #20)', async () => {
    const key = buildObjectStorageKey({
      namespace: 'uploads',
      userId: 'usr_kartik_01',
      resourceId: 'conv_01',
      fileId: 'file_99',
      extension: '.pdf',
    });
    assert.equal(key, 'uploads/usr_kartik_01/conv_01/file_99.pdf');

    // Valid PDF header (%PDF-1.7)
    const pdfHeader = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
    const validUpload = validateUploadFile({
      originalFilename: 'architecture-notes.pdf',
      declaredMimeType: 'application/pdf',
      sizeBytes: 1024 * 100,
      headerBytes: pdfHeader,
    });
    assert.equal(validUpload.mimeType, 'application/pdf');
    assert.equal(validUpload.canonicalExtension, '.pdf');

    // Spoofed PDF (exe bytes disguised as .pdf) -> 400 VALIDATION_FAILED (UNSUPPORTED_FILE_TYPE detail)
    assert.throws(
      () =>
        validateUploadFile({
          originalFilename: 'spoofed.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 2048,
          headerBytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03]),
        }),
      (err: unknown) => (err as { code?: string }).code === 'VALIDATION_FAILED',
    );

    // Oversized file -> 400 VALIDATION_FAILED (FILE_TOO_LARGE detail)
    assert.throws(
      () =>
        validateUploadFile({
          originalFilename: 'huge.pdf',
          declaredMimeType: 'application/pdf',
          sizeBytes: 25 * 1024 * 1024,
          headerBytes: pdfHeader,
        }),
      (err: unknown) => (err as { code?: string }).code === 'VALIDATION_FAILED',
    );

    // Private object storage ownership & anti-enumeration (404 for both foreign and missing)
    const storage = new InMemoryObjectStorage();
    await storage.putPrivateObject({
      key,
      ownerUserId: 'usr_kartik_01',
      mimeType: 'application/pdf',
      body: pdfHeader,
      sha256: 'b'.repeat(64),
    });

    const signed = await storage.createSignedDownloadUrl({
      key,
      requesterUserId: 'usr_kartik_01',
      ttlSeconds: 300,
    });
    assert.ok(signed.signedUrl.includes('X-Amz-Signature='));

    // Foreign user requesting signed URL gets 404 NOT_FOUND (never 403)
    await assert.rejects(
      () =>
        storage.createSignedDownloadUrl({
          key,
          requesterUserId: 'usr_intruder_99',
        }),
      (err: unknown) => (err as { code?: string }).code === 'NOT_FOUND',
    );

    // PostgresObjectStorage persists and retrieves binary objects via SQL private_objects table
    const pgRows = new Map<
      string,
      {
        storage_key: string;
        owner_user_uid: string;
        mime_type: string;
        size_bytes: number;
        sha256_hex: string;
        content_base64: string;
        created_at: string;
      }
    >();
    const pgPool: DatabasePool = {
      async query<TRow>(sql: string, params?: readonly unknown[]): Promise<DatabaseQueryResult<TRow>> {
        if (sql.includes('INSERT INTO private_objects') && params) {
          const row = {
            storage_key: String(params[0]),
            owner_user_uid: String(params[1]),
            mime_type: String(params[2]),
            size_bytes: Number(params[3]),
            sha256_hex: String(params[4]),
            content_base64: String(params[5]),
            created_at: String(params[6]),
          };
          pgRows.set(row.storage_key, row);
          return { rows: [], rowCount: 1 };
        }
        if (sql.includes('FROM private_objects') && params) {
          const found = pgRows.get(String(params[0]));
          return {
            rows: found ? ([found] as unknown as TRow[]) : [],
            rowCount: found ? 1 : 0,
          };
        }
        if (sql.includes('DELETE FROM private_objects') && params) {
          const k = String(params[0]);
          const u = String(params[1]);
          const found = pgRows.get(k);
          if (found && found.owner_user_uid === u) {
            pgRows.delete(k);
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
      async connect(): Promise<DatabaseClient> {
        throw new Error('Not needed');
      },
      async end(): Promise<void> {},
    };

    const pgStorage = new PostgresObjectStorage({ pool: pgPool });
    await pgStorage.putPrivateObject({
      key,
      ownerUserId: 'usr_kartik_01',
      mimeType: 'application/pdf',
      body: pdfHeader,
      sha256: 'c'.repeat(64),
    });

    const loaded = await pgStorage.getPrivateObject(key, 'usr_kartik_01');
    assert.equal(loaded.metadata.sizeBytes, pdfHeader.byteLength);
    assert.deepEqual(Array.from(loaded.body), Array.from(pdfHeader));

    await assert.rejects(
      () => pgStorage.getPrivateObject(key, 'usr_intruder_99'),
      (err: unknown) => (err as { code?: string }).code === 'NOT_FOUND',
    );

    const deleted = await pgStorage.deletePrivateObject(key, 'usr_kartik_01');
    assert.equal(deleted, true);
  });

  it('hardens PostgreSQL TLS certificate verification for sslmode=verify-full, verify-ca, require, and neon.tech while supporting explicit no-verify opt-out (Fix #3)', async () => {
    // 1. sslmode=verify-full enforces rejectUnauthorized: true and servername even if env tries to disable it
    const verifyFullTls = resolvePostgresTlsConfig(
      'postgresql://kartik:secret@ep-rapid-rain.ap-southeast-1.aws.neon.tech/neondb?sslmode=verify-full',
      {
        PGSSL_REJECT_UNAUTHORIZED: 'false',
        PGSSLROOTCERT_PEM: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
      },
    );
    assert.equal(verifyFullTls.requiresSsl, true);
    assert.equal(verifyFullTls.sslMode, 'verify-full');
    assert.equal(verifyFullTls.rejectUnauthorized, true);
    assert.deepEqual(verifyFullTls.ssl, {
      rejectUnauthorized: true,
      ca: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----',
      servername: 'ep-rapid-rain.ap-southeast-1.aws.neon.tech',
    });

    // 2. sslmode=verify-ca enforces rejectUnauthorized: true
    const verifyCaTls = resolvePostgresTlsConfig(
      'postgresql://kartik:secret@db.internal.kartik.ai:5432/kartik?sslmode=verify-ca',
      {},
    );
    assert.equal(verifyCaTls.requiresSsl, true);
    assert.equal(verifyCaTls.sslMode, 'verify-ca');
    assert.equal(verifyCaTls.ssl?.rejectUnauthorized, true);
    assert.equal(verifyCaTls.ssl?.servername, undefined);

    // 3. sslmode=require and *.neon.tech default to rejectUnauthorized: true
    const neonRequireTls = resolvePostgresTlsConfig(
      'postgresql://neondb_owner:secret@ep-rapid-rain-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require',
      {},
    );
    assert.equal(neonRequireTls.requiresSsl, true);
    assert.equal(neonRequireTls.sslMode, 'require');
    assert.equal(neonRequireTls.ssl?.rejectUnauthorized, true);
    assert.equal(
      neonRequireTls.ssl?.servername,
      'ep-rapid-rain-pooler.ap-southeast-1.aws.neon.tech',
    );

    // 4. Explicit sslmode=no-verify opts out of certificate chain verification for self-signed certs
    const noVerifyTls = resolvePostgresTlsConfig(
      'postgresql://kartik:secret@self-signed-pg.local:5432/kartik?sslmode=no-verify',
      {},
    );
    assert.equal(noVerifyTls.requiresSsl, true);
    assert.equal(noVerifyTls.sslMode, 'no-verify');
    assert.equal(noVerifyTls.ssl?.rejectUnauthorized, false);

    // 5. Unsupported sslmode in connection URL is rejected by validatePostgresConnectionUrl
    const invalidSslModeCheck = validatePostgresConnectionUrl(
      'postgresql://kartik:secret@db.kartik.ai:5432/kartik?sslmode=bogus-mode',
    );
    assert.equal(invalidSslModeCheck.valid, false);
    assert.match(invalidSslModeCheck.reason ?? '', /unsupported sslmode "bogus-mode"/);

    // 6. createLazyPostgresPool forwards hardened ssl config to pg.Pool constructor
    const capturedPoolConfigs: Array<Record<string, unknown>> = [];
    class FakePgPool implements UnderlyingPgPoolLike {
      constructor(cfg: Record<string, unknown>) {
        capturedPoolConfigs.push(cfg);
      }
      async connect() {
        return {
          async query() {
            return { rows: [{ ok: 1 }], rowCount: 1 };
          },
          release() {},
        };
      }
      async query() {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      async end() {}
    }

    const verifiedPool = createLazyPostgresPool({
      schema: 'billing',
      connectionString:
        'postgresql://neondb_owner:secret@ep-rapid-rain.ap-southeast-1.aws.neon.tech:5432/neondb?sslmode=verify-full',
      env: {},
      poolConstructor: FakePgPool,
    });
    await verifiedPool.query('SELECT 1 AS ok');
    assert.equal(capturedPoolConfigs.length, 1);
    assert.deepEqual(capturedPoolConfigs[0]?.ssl, {
      rejectUnauthorized: true,
      servername: 'ep-rapid-rain.ap-southeast-1.aws.neon.tech',
    });
  });

  it('Fix #10: falls back cleanly in PostgresObjectStorage & S3CompatibleObjectStorage when PostgreSQL throws INTERNAL_ERROR (Database query failed), while preserving 404 isolation', async () => {
    const failingPool = {
      getSchema: () => 'agent' as const,
      async connect() {
        throw new AppError('INTERNAL_ERROR', 'Database connection failed. Please try again later.');
      },
      async query() {
        throw new AppError('INTERNAL_ERROR', 'Database query failed. Please try again later.');
      },
      async end() {},
    };

    const pgStorage = new PostgresObjectStorage({
      pool: failingPool,
      fallbackStorage: new InMemoryObjectStorage(),
    });
    const s3Storage = new S3CompatibleObjectStorage({
      endpoint: 'https://s3.unreachable.invalid',
      bucket: 'kartik-test',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'SECRETEXAMPLE',
      region: 'ap-southeast-1',
      fetchImpl: (async () => new Response('Not Found', { status: 404 })) as typeof fetch,
      fallbackStorage: pgStorage,
    });

    const key = buildObjectStorageKey({
      namespace: 'artifacts',
      userId: 'usr_owner_1',
      resourceId: 'conv_1',
      fileId: 'art_1',
      extension: '.pdf',
    });
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
    await s3Storage.putPrivateObject({
      key,
      ownerUserId: 'usr_owner_1',
      mimeType: 'application/pdf',
      body: pdfBytes,
      sha256: 'abc123',
    });

    // Owner retrieves raw bytes cleanly even when S3 returns 404 and Postgres throws AppError(INTERNAL_ERROR)
    const fetched = await s3Storage.getPrivateObject(key, 'usr_owner_1');
    assert.deepEqual(Buffer.from(fetched.body), Buffer.from(pdfBytes));

    // Foreign user still strictly receives 404 NOT_FOUND
    await assert.rejects(
      () => s3Storage.getPrivateObject(key, 'usr_foreign_2'),
      (err: unknown) => (err as { code?: string }).code === 'NOT_FOUND',
    );
  });
});


