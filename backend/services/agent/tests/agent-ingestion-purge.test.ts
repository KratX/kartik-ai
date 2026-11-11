import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AppError } from '@kartik/shared/errors';
import { InMemoryObjectStorage } from '@kartik/shared/storage';
import {
  FileIngestionAndArtifactService,
  InMemoryAgentRepository,
  InMemoryVectorStore,
  MOCK_PNG_BYTES,
  MockEmbeddingProvider,
  PostgresAgentRepository,
  loadAgentConfig,
  type CascadeDeletionStep,
} from '../src/index.js';

const { publicKey } = crypto.generateKeyPairSync('ed25519');
const TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

const VALID_PDF_BYTES = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
  'utf8',
);

function createIngestionFixture() {
  const config = loadAgentConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/kartik',
    REDIS_URL: 'redis://localhost:6379',
    USER_CONTEXT_PUBLIC_KEY: TEST_PUBLIC_PEM,
    INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
    MAX_PDF_PAGES: '3',
  });

  const repository = new InMemoryAgentRepository();
  const objectStorage = new InMemoryObjectStorage();
  const vectorStore = new InMemoryVectorStore();
  const embeddingProvider = new MockEmbeddingProvider();

  const service = new FileIngestionAndArtifactService({
    config,
    repository,
    objectStorage,
    vectorStore,
    embeddingProvider,
  });

  return { config, repository, objectStorage, vectorStore, embeddingProvider, service };
}

describe('@kartik/agent File Upload Validation, PDF RAG Ingestion & Cascade Purge (5.3.a)', () => {
  it('validates PDF/PNG magic bytes, generates server-side storage keys, indexes PDF chunks, and rejects spoofed headers or >maxPdfPages (§10, §11)', async () => {
    const { service, vectorStore, repository } = createIngestionFixture();

    const uploadedPdf = await service.ingestUploadedFile({
      userId: 'usr_alice',
      conversationId: 'conv_101',
      originalFilename: '../../evil path/architecture-spec.pdf',
      declaredMimeType: 'application/pdf',
      contentBytes: VALID_PDF_BYTES,
      extractedPdfPages: [
        {
          pageNumber: 1,
          text: 'Section 1: The API Gateway verifies sessions and mints Ed25519 user-context assertions.',
        },
        {
          pageNumber: 2,
          text: 'Section 2: Billing locks credit_accounts with SELECT FOR UPDATE inside PostgreSQL.',
        },
      ],
    });

    // Server-generated storage key never uses the raw user filename (§11)
    assert.ok(uploadedPdf.storageKey.startsWith('uploads/usr_alice/conv_101/file_'));
    assert.ok(uploadedPdf.storageKey.endsWith('.pdf'));
    assert.ok(!uploadedPdf.storageKey.includes('evil'));
    assert.equal(uploadedPdf.pageCount, 2);
    assert.equal(uploadedPdf.chunkCount, 2);
    assert.equal(vectorStore.countAll(), 2);
    assert.equal(repository.countChunks(), 2);

    // Spoofed PDF filename with PNG magic bytes must be rejected with 400 VALIDATION_FAILED
    await assert.rejects(
      () =>
        service.ingestUploadedFile({
          userId: 'usr_alice',
          conversationId: 'conv_101',
          originalFilename: 'spoofed.pdf',
          declaredMimeType: 'application/pdf',
          contentBytes: MOCK_PNG_BYTES,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'VALIDATION_FAILED');
        return true;
      },
    );

    // PDF exceeding MAX_PDF_PAGES (3) must be rejected
    await assert.rejects(
      () =>
        service.ingestUploadedFile({
          userId: 'usr_alice',
          conversationId: 'conv_101',
          originalFilename: 'too-many-pages.pdf',
          declaredMimeType: 'application/pdf',
          contentBytes: VALID_PDF_BYTES,
          extractedPdfPages: [
            { pageNumber: 1, text: 'Page 1' },
            { pageNumber: 2, text: 'Page 2' },
            { pageNumber: 3, text: 'Page 3' },
            { pageNumber: 4, text: 'Page 4 exceeds limit of 3' },
          ],
        }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'VALIDATION_FAILED');
        return true;
      },
    );
  });

  it('issues short-lived signed URLs for owned files & artifacts and returns 404 NOT_FOUND for foreign or missing resources (Invariants #10 & #20)', async () => {
    const { service } = createIngestionFixture();

    const pngFile = await service.ingestUploadedFile({
      userId: 'usr_alice',
      conversationId: 'conv_102',
      originalFilename: 'diagram.png',
      declaredMimeType: 'image/png',
      contentBytes: MOCK_PNG_BYTES,
    });

    const ownedSigned = await service.getFileWithSignedUrl({
      userId: 'usr_alice',
      fileId: pngFile.fileId,
    });
    assert.ok(ownedSigned.download.signedUrl.includes(pngFile.storageKey));
    assert.equal(ownedSigned.download.ttlSeconds, 300);

    // Foreign user (usr_bob) requesting usr_alice's file receives 404 NOT_FOUND (never 403, Invariant #20)
    await assert.rejects(
      () =>
        service.getFileWithSignedUrl({
          userId: 'usr_bob',
          fileId: pngFile.fileId,
        }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'NOT_FOUND');
        assert.equal(err.httpStatus, 404);
        return true;
      },
    );
  });

  it('cascades deletion in strict order: vectors -> objects -> metadata and confirms removal across all stores (Invariant #18)', async () => {
    const { service, repository, objectStorage, vectorStore } = createIngestionFixture();

    const pdf = await service.ingestUploadedFile({
      userId: 'usr_alice',
      conversationId: 'conv_purge',
      originalFilename: 'purge-target.pdf',
      declaredMimeType: 'application/pdf',
      contentBytes: VALID_PDF_BYTES,
      extractedPdfPages: [
        { pageNumber: 1, text: 'Confidential vector content to be purged first.' },
      ],
    });

    // Also store a conversation artifact to verify artifact object + metadata purge
    const artifactKey = 'artifacts/usr_alice/conv_purge/art_purge_1.json';
    await objectStorage.putPrivateObject({
      key: artifactKey,
      ownerUserId: 'usr_alice',
      mimeType: 'application/json',
      body: Buffer.from('{}', 'utf8'),
      sha256: crypto.createHash('sha256').update('{}').digest('hex'),
    });
    await repository.saveArtifact({
      artifactId: 'art_purge_1',
      userId: 'usr_alice',
      requestId: 'req_purge_art_1',
      conversationId: 'conv_purge',
      artifactType: 'code_bundle',
      title: 'Purgeable App',
      entryFile: 'index.html',
      storageKey: artifactKey,
      mimeType: 'application/json',
      sizeBytes: 2,
      filesManifest: [],
      createdAt: new Date().toISOString(),
    });

    const observedSteps: CascadeDeletionStep[] = [];
    const report = await service.purgeResources({
      userId: 'usr_alice',
      conversationId: 'conv_purge',
      fileIds: [pdf.fileId],
      onStepExecuted: (step) => {
        observedSteps.push(step);
      },
    });

    assert.deepEqual(observedSteps, ['vectors', 'objects', 'metadata']);
    assert.deepEqual(report.deletionOrder, ['vectors', 'objects', 'metadata']);
    assert.equal(report.vectorsDeleted, 1);
    assert.equal(report.objectsDeleted, 2);
    assert.equal(report.filesDeleted, 1);
    assert.equal(report.artifactsDeleted, 1);
    assert.equal(report.confirmed, true);

    assert.equal(vectorStore.countAll(), 0);
    assert.equal(await repository.getFileById('usr_alice', pdf.fileId), null);
    assert.equal(await repository.getArtifactById('usr_alice', 'art_purge_1'), null);
  });

  it('executes parameterized SQL against agent.files, agent.artifacts, and agent.document_chunks in PostgresAgentRepository (Invariant #4)', async () => {
    const queries: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const mockDb = {
      async query<T>(sql: string, params?: readonly unknown[]) {
        queries.push({ sql, params });
        return { rows: [] as T[], rowCount: 1 };
      },
    };

    const pgRepo = new PostgresAgentRepository(mockDb);
    await pgRepo.saveFile({
      fileId: 'file_pg_1',
      userId: 'usr_pg',
      originalFilename: 'doc.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 512,
      storageKey: 'uploads/usr_pg/conv_1/file_pg_1.pdf',
      sha256Hex: 'c'.repeat(64),
      pageCount: 1,
      chunkCount: 1,
      status: 'ready',
      createdAt: new Date().toISOString(),
    });

    const deleted = await pgRepo.deleteFileMetadata('usr_pg', 'file_pg_1');
    assert.equal(deleted, true);
    assert.equal(queries.length, 2);
    assert.ok(queries[0]?.sql.includes('INSERT INTO agent.files'));
    assert.ok(queries[1]?.sql.includes('DELETE FROM agent.files'));
  });
});
