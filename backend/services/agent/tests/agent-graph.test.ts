import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AppError } from '@kartik/shared/errors';
import { InMemoryObjectStorage } from '@kartik/shared/storage';
import {
  AgentGraphExecutor,
  DailyLiveBudgetGuard,
  InMemoryDailyBudgetStore,
  InMemoryVectorStore,
  MockChatModelProvider,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockSearchProvider,
  MockVisionProvider,
  loadAgentConfig,
  routePromptToSpecialist,
  type AgentMetadataStore,
  type ArtifactRecord,
  type CodingModelProvider,
  type UploadedFileRecord,
} from '../src/index.js';

const { publicKey } = crypto.generateKeyPairSync('ed25519');
const TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

class InMemoryTestMetadataStore implements AgentMetadataStore {
  public readonly files = new Map<string, UploadedFileRecord>();
  public readonly artifacts = new Map<string, ArtifactRecord>();

  public async getFileById(userId: string, fileId: string): Promise<UploadedFileRecord | null> {
    const rec = this.files.get(fileId);
    if (!rec || rec.userId !== userId) {
      return null;
    }
    return rec;
  }

  public async saveArtifact(artifact: ArtifactRecord): Promise<void> {
    this.artifacts.set(artifact.artifactId, artifact);
  }

  public async getArtifactByRequestId(
    userId: string,
    requestId: string,
  ): Promise<ArtifactRecord | null> {
    for (const art of this.artifacts.values()) {
      if (art.userId === userId && art.requestId === requestId) {
        return art;
      }
    }
    return null;
  }
}

function createTestExecutor(overrides?: {
  readonly mockAiDefault?: boolean;
  readonly dailyLimit?: number;
  readonly codingProvider?: CodingModelProvider;
  readonly metadataStore?: InMemoryTestMetadataStore;
  readonly vectorStore?: InMemoryVectorStore;
}) {
  const config = loadAgentConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/kartik',
    REDIS_URL: 'redis://localhost:6379',
    USER_CONTEXT_PUBLIC_KEY: TEST_PUBLIC_PEM,
    INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
    MOCK_AI: overrides?.mockAiDefault === false ? 'false' : 'true',
    GEMINI_API_KEY: 'test-gemini-api-key-value',
    TAVILY_API_KEY: 'test-tavily-api-key',
    DAILY_LIVE_CALL_BUDGET: String(overrides?.dailyLimit ?? 2),
  });

  const budgetStore = new InMemoryDailyBudgetStore();
  const budgetGuard = new DailyLiveBudgetGuard({
    store: budgetStore,
    dailyLimit: config.dailyLiveCallBudget,
    mockAiDefault: config.mockAi,
  });

  const metadataStore = overrides?.metadataStore ?? new InMemoryTestMetadataStore();
  const vectorStore = overrides?.vectorStore ?? new InMemoryVectorStore();
  const objectStorage = new InMemoryObjectStorage();

  const executor = new AgentGraphExecutor({
    config,
    budgetGuard,
    chatProvider: new MockChatModelProvider(),
    codingProvider: overrides?.codingProvider ?? new MockCodingModelProvider(),
    searchProvider: new MockSearchProvider(),
    embeddingProvider: new MockEmbeddingProvider(),
    imageProvider: new MockImageGenerationProvider(),
    visionProvider: new MockVisionProvider(),
    vectorStore,
    objectStorage,
    metadataStore,
  });

  return { executor, metadataStore, vectorStore, objectStorage, budgetGuard };
}

describe('@kartik/agent Router, Specialist Graph & Daily Redis Budget Guard (5.2.a)', () => {
  it('routes prompts and attachments deterministically across all 6 specialists (routePromptToSpecialist)', () => {
    assert.equal(routePromptToSpecialist({ prompt: 'Hello, how are you?' }), 'chat');
    assert.equal(
      routePromptToSpecialist({ prompt: 'Please search the web and cite sources for Node 24' }),
      'search',
    );
    assert.equal(
      routePromptToSpecialist({ prompt: 'Build an app in React with a calculator component' }),
      'coding',
    );
    assert.equal(
      routePromptToSpecialist({ prompt: 'Generate an image of a futuristic server rack' }),
      'image',
    );
    assert.equal(
      routePromptToSpecialist({
        prompt: 'Summarize this file',
        attachedFiles: [
          {
            fileId: 'file_1',
            userId: 'usr_1',
            originalFilename: 'spec.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1024,
            storageKey: 'uploads/usr_1/conv_1/file_1.pdf',
            sha256Hex: 'a'.repeat(64),
            pageCount: 2,
            chunkCount: 4,
            status: 'ready',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      'rag',
    );
    assert.equal(
      routePromptToSpecialist({
        prompt: 'What is in this screenshot?',
        attachedFiles: [
          {
            fileId: 'file_2',
            userId: 'usr_1',
            originalFilename: 'ui.png',
            mimeType: 'image/png',
            sizeBytes: 2048,
            storageKey: 'uploads/usr_1/conv_1/file_2.png',
            sha256Hex: 'b'.repeat(64),
            pageCount: null,
            chunkCount: 0,
            status: 'ready',
            createdAt: new Date().toISOString(),
          },
        ],
      }),
      'vision',
    );
  });

  it('enforces daily Redis budget counter (quota:{userId}:{day}) and degrades gracefully to mock mode on exhaustion (§12)', async () => {
    const { executor } = createTestExecutor({
      mockAiDefault: false,
      dailyLimit: 2,
    });

    const first = await executor.execute({
      requestId: 'req_budget_000001',
      traceId: 'trace_1',
      userId: 'usr_budget',
      conversationId: 'conv_1',
      messageId: 'msg_1',
      prompt: 'First live-eligible turn',
    });
    assert.equal(first.usage.mock, false);
    assert.ok(!first.replyContent.includes('[Budget Guard:'));

    const second = await executor.execute({
      requestId: 'req_budget_000002',
      traceId: 'trace_2',
      userId: 'usr_budget',
      conversationId: 'conv_1',
      messageId: 'msg_2',
      prompt: 'Second live-eligible turn',
    });
    assert.equal(second.usage.mock, false);

    // 3rd call exceeds dailyLimit=2 -> gracefully degrades to mock mode without throwing!
    const third = await executor.execute({
      requestId: 'req_budget_000003',
      traceId: 'trace_3',
      userId: 'usr_budget',
      conversationId: 'conv_1',
      messageId: 'msg_3',
      prompt: 'Third turn exceeding daily live budget',
    });
    assert.equal(third.usage.mock, true);
    assert.ok(
      third.replyContent.includes(
        '[Budget Guard: Daily live provider allowance reached; served via deterministic mock fallback.]',
      ),
    );
  });

  it('grounds RAG answers in userId-scoped chunks with document + page citations and reports honestly when nothing matches (§10, Invariant #9)', async () => {
    const vectorStore = new InMemoryVectorStore();
    const embedder = new MockEmbeddingProvider();
    const [vec] = await embedder.embedTexts([
      'Razorpay webhook signatures must be verified over rawBody.',
    ]);

    await vectorStore.upsertChunks([
      {
        chunkId: 'chk_rag_1',
        fileId: 'file_pdf_1',
        userId: 'usr_alice',
        documentTitle: 'security-handbook.pdf',
        pageNumber: 7,
        chunkIndex: 0,
        textContent: 'Razorpay webhook signatures must be verified over rawBody.',
        embeddingVector: vec!,
        createdAt: new Date().toISOString(),
      },
    ]);

    const { executor } = createTestExecutor({ vectorStore });

    const aliceRag = await executor.execute({
      requestId: 'req_rag_alice_001',
      traceId: 'trace_rag_1',
      userId: 'usr_alice',
      conversationId: 'conv_rag',
      messageId: 'msg_rag_1',
      prompt: 'According to the document, how are Razorpay webhook signatures verified?',
      preferredAgent: 'rag',
    });

    assert.equal(aliceRag.agent, 'rag');
    assert.equal(aliceRag.citations?.length, 1);
    assert.equal(aliceRag.citations?.[0]?.title, 'security-handbook.pdf');
    assert.equal(aliceRag.citations?.[0]?.urlOrPage, 'p. 7');
    assert.ok(aliceRag.replyContent.includes('[security-handbook.pdf, p. 7]'));

    // Bob queries the exact same question -> sees 0 chunks from Alice and gets honest empty-retrieval message
    const bobRag = await executor.execute({
      requestId: 'req_rag_bob_00002',
      traceId: 'trace_rag_2',
      userId: 'usr_bob',
      conversationId: 'conv_rag_bob',
      messageId: 'msg_rag_2',
      prompt: 'According to the document, how are Razorpay webhook signatures verified?',
      preferredAgent: 'rag',
    });

    assert.equal(bobRag.citations?.length, 0);
    assert.ok(
      bobRag.replyContent.includes('No relevant sections were found in your uploaded documents'),
    );
  });

  it('validates untrusted coding model JSON manifests and rejects path traversal with 502 ARTIFACT_INVALID (§10, Invariant #12)', async () => {
    const { executor, metadataStore } = createTestExecutor();

    const validRes = await executor.execute({
      requestId: 'req_coding_valid_1',
      traceId: 'trace_code_1',
      userId: 'usr_dev',
      conversationId: 'conv_code',
      messageId: 'msg_code_1',
      prompt: 'Build an app with a compound interest calculator',
      preferredAgent: 'coding',
    });

    assert.equal(validRes.agent, 'coding');
    assert.equal(validRes.artifactIds?.length, 1);
    assert.equal(metadataStore.artifacts.size, 1);

    // Malicious model attempting path traversal ("../etc/passwd.js") must be rejected with 502 ARTIFACT_INVALID
    const maliciousCodingProvider: CodingModelProvider = {
      providerName: 'malicious-coding-model',
      async generateCodeBundle() {
        const content = 'console.log("pwned");';
        return {
          summary: 'Attempted traversal',
          rawManifestJson: JSON.stringify({
            title: 'Malicious App',
            entryFile: '../etc/passwd.js',
            files: [
              {
                path: '../etc/passwd.js',
                mimeType: 'application/javascript',
                sizeBytes: Buffer.byteLength(content),
                sha256: crypto.createHash('sha256').update(content).digest('hex'),
                content,
              },
            ],
          }),
          tokensUsed: 42,
        };
      },
    };

    const { executor: badExecutor } = createTestExecutor({
      codingProvider: maliciousCodingProvider,
    });

    await assert.rejects(
      () =>
        badExecutor.execute({
          requestId: 'req_coding_bad_001',
          traceId: 'trace_code_bad',
          userId: 'usr_dev',
          conversationId: 'conv_code',
          messageId: 'msg_code_bad',
          prompt: 'Build an app',
          preferredAgent: 'coding',
        }),
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, 'ARTIFACT_INVALID');
        assert.equal(err.httpStatus, 502);
        return true;
      },
    );
  });
});
