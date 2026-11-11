import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTERNAL_AUTH_HEADERS,
  generateEd25519KeyPair,
  signUserContextAssertion,
} from '@kartik/shared/auth';
import { InMemoryObjectStorage } from '@kartik/shared/storage';
import {
  AgentGraphExecutor,
  DailyLiveBudgetGuard,
  FileIngestionAndArtifactService,
  InMemoryAgentRepository,
  InMemoryDailyBudgetStore,
  InMemoryVectorStore,
  MockChatModelProvider,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockSearchProvider,
  MockVisionProvider,
  createAgentRouter,
  loadAgentConfig,
  type PurgeExecutionReport,
  type UploadedFileRecord,
} from '../src/index.js';

const { privateKeyPem, publicKeyPem } = generateEd25519KeyPair();
const INTERNAL_CHAT_TOKEN = 'internal-secret-token-chat-to-agent-54a';

const VALID_PDF_BASE64 = Buffer.from(
  '%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF',
  'utf8',
).toString('base64');

function createTestAgentRouter() {
  const config = loadAgentConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/kartik',
    REDIS_URL: 'redis://localhost:6379',
    USER_CONTEXT_PUBLIC_KEY: publicKeyPem,
    INTERNAL_CALLER_TOKEN_CHAT: INTERNAL_CHAT_TOKEN,
  });

  const repository = new InMemoryAgentRepository();
  const objectStorage = new InMemoryObjectStorage();
  const vectorStore = new InMemoryVectorStore();
  const embeddingProvider = new MockEmbeddingProvider();

  const ingestionService = new FileIngestionAndArtifactService({
    config,
    repository,
    objectStorage,
    vectorStore,
    embeddingProvider,
  });

  const budgetGuard = new DailyLiveBudgetGuard({
    store: new InMemoryDailyBudgetStore(),
    dailyLimit: config.dailyLiveCallBudget,
    mockAiDefault: config.mockAi,
  });

  const graphExecutor = new AgentGraphExecutor({
    config,
    budgetGuard,
    chatProvider: new MockChatModelProvider(),
    codingProvider: new MockCodingModelProvider(),
    searchProvider: new MockSearchProvider(),
    embeddingProvider,
    imageProvider: new MockImageGenerationProvider(),
    visionProvider: new MockVisionProvider(),
    vectorStore,
    objectStorage,
    metadataStore: repository,
  });

  const router = createAgentRouter({
    config,
    repository,
    ingestionService,
    graphExecutor,
  });

  return { router, repository, vectorStore, objectStorage };
}

describe('@kartik/agent HTTP Routes & Phase 5 Exit Gate Closure (5.4.a)', () => {
  it('serves /healthz and /readyz probes in the standard response envelope', async () => {
    const { router } = createTestAgentRouter();

    const health = await router.execute<{ error: null; data: { status: string } }>({
      method: 'GET',
      path: '/healthz',
    });
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.error, null);
    assert.equal(health.body.data.status, 'ok');

    const ready = await router.execute<{ error: null; data: { status: string } }>({
      method: 'GET',
      path: '/readyz',
    });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.body.error, null);
    assert.equal(ready.body.data.status, 'ready');
  });

  it('enforces Ed25519 x-user-context (aud="agent") on /files and /artifacts and returns 404 on foreign lookups (Invariants #10 & #20)', async () => {
    const { router } = createTestAgentRouter();

    const aliceAssertion = signUserContextAssertion(
      {
        sub: 'usr_alice',
        aud: 'agent',
        traceId: 'trace_agent_54a_1',
      },
      privateKeyPem,
    );

    const bobAssertion = signUserContextAssertion(
      {
        sub: 'usr_bob',
        aud: 'agent',
        traceId: 'trace_agent_54a_2',
      },
      privateKeyPem,
    );

    const wrongAudAssertion = signUserContextAssertion(
      {
        sub: 'usr_alice',
        aud: 'chat',
        traceId: 'trace_agent_54a_wrong_aud',
      },
      privateKeyPem,
    );

    // Cross-service assertion (aud="chat") must be rejected with 401 UNAUTHENTICATED
    const rejectedAud = await router.execute<{ data: null; error: { code: string } }>({
      method: 'GET',
      path: '/api/v1/files',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: wrongAudAssertion,
      },
    });
    assert.equal(rejectedAud.statusCode, 401);
    assert.equal(rejectedAud.body.data, null);
    assert.equal(rejectedAud.body.error.code, 'UNAUTHENTICATED');

    // Alice uploads a PDF via POST /api/v1/files
    const uploadRes = await router.execute<{ error: null; data: UploadedFileRecord }>({
      method: 'POST',
      path: '/api/v1/files',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
      body: {
        conversationId: 'conv_54a',
        originalFilename: 'blueprint-notes.pdf',
        declaredMimeType: 'application/pdf',
        contentBase64: VALID_PDF_BASE64,
        extractedPdfPages: [
          {
            pageNumber: 4,
            text: 'Agent never calculates, reserves, settles, or mutates credits.',
          },
        ],
      },
    });
    assert.equal(uploadRes.statusCode, 201);
    assert.equal(uploadRes.body.error, null);
    const fileId = uploadRes.body.data.fileId;

    // Alice retrieves her file + signed download URL
    const aliceGet = await router.execute<{
      error: null;
      data: { file: UploadedFileRecord; download: { signedUrl: string } };
    }>({
      method: 'GET',
      path: `/api/v1/files/${fileId}`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
    });
    assert.equal(aliceGet.statusCode, 200);
    assert.ok(aliceGet.body.data.download.signedUrl.includes(fileId));

    // Bob attempting to fetch Alice's file receives 404 NOT_FOUND (never 403, Invariant #20)
    const bobGet = await router.execute<{ data: null; error: { code: string } }>({
      method: 'GET',
      path: `/api/v1/files/${fileId}`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: bobAssertion,
      },
    });
    assert.equal(bobGet.statusCode, 404);
    assert.equal(bobGet.body.error.code, 'NOT_FOUND');
  });

  it('enforces Chat-only service credentials on POST /internal/agent/execute and runs specialist turns (Invariants #6, #9, #12, #14)', async () => {
    const { router } = createTestAgentRouter();

    // Unauthorized caller (gateway or missing token) is rejected
    const unauthExec = await router.execute<{ data: null; error: { code: string } }>({
      method: 'POST',
      path: '/internal/agent/execute',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'gateway',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: INTERNAL_CHAT_TOKEN,
      },
      body: {},
    });
    assert.equal(unauthExec.statusCode, 401);

    // Authorized Chat service executes a Coding specialist turn
    const codingExec = await router.execute<{
      error: null;
      data: { agent: string; artifactIds: string[] };
    }>({
      method: 'POST',
      path: '/internal/agent/execute',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'chat',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: INTERNAL_CHAT_TOKEN,
        [INTERNAL_AUTH_HEADERS.REQUEST_ID]: 'req_54a_coding_001',
      },
      body: {
        requestId: 'req_54a_coding_001',
        traceId: 'trace_54a_exec',
        userId: 'usr_alice',
        conversationId: 'conv_54a',
        messageId: 'msg_54a_1',
        prompt: 'Build an app with a sleek dark mode timer',
      },
    });
    assert.equal(codingExec.statusCode, 200);
    assert.equal(codingExec.body.error, null);
    assert.equal(codingExec.body.data.agent, 'coding');
    assert.equal(codingExec.body.data.artifactIds.length, 1);
  });

  it('executes POST /internal/agent/purge in vectors -> objects -> metadata order and closes Phase 5 Exit Gate (Invariant #18)', async () => {
    const { router } = createTestAgentRouter();

    const aliceAssertion = signUserContextAssertion(
      {
        sub: 'usr_alice',
        aud: 'agent',
        traceId: 'trace_agent_54a_purge',
      },
      privateKeyPem,
    );

    const uploadRes = await router.execute<{ error: null; data: UploadedFileRecord }>({
      method: 'POST',
      path: '/files',
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
      body: {
        conversationId: 'conv_purge_54a',
        originalFilename: 'to-be-purged.pdf',
        declaredMimeType: 'application/pdf',
        contentBase64: VALID_PDF_BASE64,
        extractedPdfPages: [
          { pageNumber: 1, text: 'Purge test page content.' },
        ],
      },
    });
    const fileId = uploadRes.body.data.fileId;

    const purgeRes = await router.execute<{ error: null; data: PurgeExecutionReport }>({
      method: 'POST',
      path: '/internal/agent/purge',
      headers: {
        [INTERNAL_AUTH_HEADERS.SERVICE_CALLER]: 'chat',
        [INTERNAL_AUTH_HEADERS.SERVICE_TOKEN]: INTERNAL_CHAT_TOKEN,
      },
      body: {
        userId: 'usr_alice',
        conversationId: 'conv_purge_54a',
        fileIds: [fileId],
      },
    });

    assert.equal(purgeRes.statusCode, 200);
    assert.deepEqual(purgeRes.body.data.deletionOrder, ['vectors', 'objects', 'metadata']);
    assert.equal(purgeRes.body.data.vectorsDeleted, 1);
    assert.equal(purgeRes.body.data.objectsDeleted, 1);
    assert.equal(purgeRes.body.data.filesDeleted, 1);
    assert.equal(purgeRes.body.data.confirmed, true);

    // Subsequent GET /files/:fileId returns 404 NOT_FOUND
    const afterPurge = await router.execute<{ data: null; error: { code: string } }>({
      method: 'GET',
      path: `/files/${fileId}`,
      headers: {
        [INTERNAL_AUTH_HEADERS.USER_CONTEXT]: aliceAssertion,
      },
    });
    assert.equal(afterPurge.statusCode, 404);
    assert.equal(afterPurge.body.error.code, 'NOT_FOUND');
  });
});
