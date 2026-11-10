import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDirectMigrationUrl,
  buildDatabasePoolConfig,
  buildObjectStorageKey,
  computeMigrationChecksum,
  InMemoryObjectStorage,
  runForwardMigrations,
  validateUploadFile,
  withTransaction,
  type DatabaseClient,
  type DatabasePool,
  type DatabaseQueryResult,
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
  it('enforces Neon 10s idleTimeoutMillis cap and schema search_path isolation in buildDatabasePoolConfig (ADR 0004)', () => {
    const cfg = buildDatabasePoolConfig({
      connectionString: 'postgresql://kartik_billing:secret@localhost:5432/kartik',
      schema: 'billing',
    });

    assert.equal(cfg.idleTimeoutMillis, 10_000);
    assert.equal(cfg.options, '-c search_path=billing');
    assert.equal(cfg.max, 10);

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
  });
});
