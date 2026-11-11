import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { ConfigValidationError } from '@kartik/shared/config';
import { ALLOWED_UPLOAD_MIME_TYPES } from '@kartik/shared/storage';
import {
  AGENT_INITIAL_MIGRATION,
  InMemoryVectorStore,
  MOCK_PNG_BYTES,
  MockChatModelProvider,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockSearchProvider,
  MockVisionProvider,
  loadAgentConfig,
} from '../src/index.js';

const { publicKey } = crypto.generateKeyPairSync('ed25519');
const TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

describe('@kartik/agent config, 0001_agent_core migration & deterministic mock providers (5.1.a)', () => {
  it('loads Agent config with MOCK_AI=true and IMAGE_PROVIDER=mock defaults and enforces live keys when MOCK_AI=false (§6.2, §10, §12)', () => {
    const config = loadAgentConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/kartik',
      REDIS_URL: 'redis://localhost:6379',
      USER_CONTEXT_PUBLIC_KEY: TEST_PUBLIC_PEM,
      INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
    });

    assert.equal(config.mockAi, true);
    assert.equal(config.imageProvider, 'mock');
    assert.equal(config.port, 4003);
    assert.equal(config.maxPromptChars, 16_000);
    assert.equal(config.maxPdfPages, 25);
    assert.equal(config.dailyLiveCallBudget, 50);

    assert.throws(
      () =>
        loadAgentConfig({
          NODE_ENV: 'production',
          DATABASE_URL: 'postgresql://user:pass@localhost:5432/kartik',
          REDIS_URL: 'redis://localhost:6379',
          USER_CONTEXT_PUBLIC_KEY: TEST_PUBLIC_PEM,
          INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
          MOCK_AI: 'false',
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigValidationError);
        assert.ok(err.message.includes('GEMINI_API_KEY'));
        assert.ok(err.message.includes('TAVILY_API_KEY'));
        return true;
      },
    );
  });

  it('defines agent.files, agent.artifacts, and agent.document_chunks with ownership and size constraints in 0001_agent_core.sql (Invariant #4)', () => {
    assert.equal(AGENT_INITIAL_MIGRATION.version, '0001_agent_core');
    assert.ok(AGENT_INITIAL_MIGRATION.sql.includes('CREATE TABLE IF NOT EXISTS agent.files'));
    assert.ok(AGENT_INITIAL_MIGRATION.sql.includes('CREATE TABLE IF NOT EXISTS agent.artifacts'));
    assert.ok(AGENT_INITIAL_MIGRATION.sql.includes('CREATE TABLE IF NOT EXISTS agent.document_chunks'));
    assert.ok(AGENT_INITIAL_MIGRATION.sql.includes('ON DELETE CASCADE'));
  });

  it('executes deterministic MockChat, MockCoding, MockSearch, MockImage, and MockVision providers without external calls (Invariant #19)', async () => {
    const chat = new MockChatModelProvider();
    const reply = await chat.generateReply({
      prompt: 'Explain SELECT FOR UPDATE in PostgreSQL',
      maxOutputTokens: 256,
    });
    assert.ok(reply.content.includes('[Mock Chat]'));
    assert.ok(reply.tokensUsed > 0);

    const coding = new MockCodingModelProvider();
    const bundle = await coding.generateCodeBundle({
      prompt: 'Interactive compound interest calculator',
      maxOutputTokens: 512,
    });
    const parsedManifest = JSON.parse(bundle.rawManifestJson) as {
      entryFile: string;
      files: Array<{ path: string }>;
    };
    assert.equal(parsedManifest.entryFile, 'index.html');
    assert.equal(parsedManifest.files.length, 3);

    const search = new MockSearchProvider();
    const results = await search.searchWeb({ query: 'Ed25519 assertions', maxResults: 2 });
    assert.equal(results.length, 2);

    const imageGen = new MockImageGenerationProvider();
    const generated = await imageGen.generateImage({ prompt: 'Architecture diagram' });
    assert.equal(generated.mimeType, 'image/png');
    assert.equal(ALLOWED_UPLOAD_MIME_TYPES['image/png'].matchesMagicBytes(generated.data), true);
    assert.equal(generated.data.byteLength, MOCK_PNG_BYTES.byteLength);

    const vision = new MockVisionProvider();
    const analyzed = await vision.analyzeImage({
      prompt: 'Describe this diagram',
      mimeType: 'image/png',
      imageBytes: generated.data,
    });
    assert.ok(analyzed.analysis.includes('[Mock Vision]'));
  });

  it('enforces strict userId and fileId isolation in InMemoryVectorStore so another user never sees foreign chunks (Invariant #9)', async () => {
    const embedder = new MockEmbeddingProvider();
    const vectorStore = new InMemoryVectorStore();

    const [vecAlice, vecBob] = await embedder.embedTexts([
      'PostgreSQL row-level locking with SELECT FOR UPDATE prevents balance overdraws.',
      'PostgreSQL row-level locking secret internal notes belonging to Bob.',
    ]);

    await vectorStore.upsertChunks([
      {
        chunkId: 'chk_alice_1',
        fileId: 'file_alice_pdf',
        userId: 'usr_alice',
        documentTitle: 'alice-billing-spec.pdf',
        pageNumber: 3,
        chunkIndex: 0,
        textContent: 'PostgreSQL row-level locking with SELECT FOR UPDATE prevents balance overdraws.',
        embeddingVector: vecAlice!,
        createdAt: new Date().toISOString(),
      },
      {
        chunkId: 'chk_bob_1',
        fileId: 'file_bob_pdf',
        userId: 'usr_bob',
        documentTitle: 'bob-private-notes.pdf',
        pageNumber: 1,
        chunkIndex: 0,
        textContent: 'PostgreSQL row-level locking secret internal notes belonging to Bob.',
        embeddingVector: vecBob!,
        createdAt: new Date().toISOString(),
      },
    ]);

    const [queryVec] = await embedder.embedTexts(['PostgreSQL row-level locking']);
    const aliceHits = await vectorStore.searchChunks({
      userId: 'usr_alice',
      queryVector: queryVec!,
      topK: 5,
    });

    assert.equal(aliceHits.length, 1);
    assert.equal(aliceHits[0]?.userId, 'usr_alice');
    assert.equal(aliceHits[0]?.fileId, 'file_alice_pdf');
    assert.equal(aliceHits[0]?.pageNumber, 3);

    // Deleting Alice's file vectors leaves Bob's vectors intact
    const deletedCount = await vectorStore.deleteByFileIds({
      userId: 'usr_alice',
      fileIds: ['file_alice_pdf'],
    });
    assert.equal(deletedCount, 1);
    assert.equal(vectorStore.countAll(), 1);
  });
});
