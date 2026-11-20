import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { InMemoryObjectStorage } from '@kartik/shared/storage';
import {
  AgentGraphExecutor,
  DailyLiveBudgetGuard,
  FileIngestionAndArtifactService,
  InMemoryAgentRepository,
  InMemoryDailyBudgetStore,
  InMemoryVectorStore,
  LiveGeminiVisionProvider,
  MOCK_PNG_BYTES,
  MockChatModelProvider,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockImageGenerationProvider,
  MockSearchProvider,
  MockVisionProvider,
  buildVisionFollowUps,
  buildVisionSystemInstruction,
  buildVisionUserPrompt,
  classifyVisionIntent,
  formatOfflineVisionFallback,
  loadAgentConfig,
  parseImageDimensions,
} from '../src/index.js';

const { publicKey } = crypto.generateKeyPairSync('ed25519');
const TEST_PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function buildTestConfig() {
  return loadAgentConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
    REDIS_URL: 'redis://127.0.0.1:6379',
    USER_CONTEXT_PUBLIC_KEY: TEST_PUBLIC_PEM,
    INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
    MOCK_AI: 'true',
    IMAGE_PROVIDER: 'mock',
    DAILY_LIVE_CALL_BUDGET: '25',
  });
}

/** Builds a valid minimal PNG header with arbitrary width/height. */
function buildSyntheticPngHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13, false); // IHDR length
  buf.set([0x49, 0x48, 0x44, 0x52], 12); // "IHDR"
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

/** Builds a valid minimal JPEG SOI + SOF0 header with arbitrary width/height. */
function buildSyntheticJpegHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(19);
  const view = new DataView(buf.buffer);
  buf[0] = 0xff;
  buf[1] = 0xd8; // SOI
  buf[2] = 0xff;
  buf[3] = 0xc0; // SOF0
  view.setUint16(4, 11, false); // segment length
  buf[6] = 8; // precision
  view.setUint16(7, height, false);
  view.setUint16(9, width, false);
  buf[11] = 3; // components
  return buf;
}

/** Builds a valid minimal WebP VP8X header with arbitrary width/height. */
function buildSyntheticWebpVp8xHeader(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(30);
  buf.set(Buffer.from('RIFF', 'ascii'), 0);
  buf.set(Buffer.from('WEBP', 'ascii'), 8);
  buf.set(Buffer.from('VP8X', 'ascii'), 12);
  const wMinus1 = width - 1;
  const hMinus1 = height - 1;
  buf[24] = wMinus1 & 0xff;
  buf[25] = (wMinus1 >> 8) & 0xff;
  buf[26] = (wMinus1 >> 16) & 0xff;
  buf[27] = hMinus1 & 0xff;
  buf[28] = (hMinus1 >> 8) & 0xff;
  buf[29] = (hMinus1 >> 16) & 0xff;
  return buf;
}

describe('Fix #19 — Vision OCR & Multimodal Image Inspector Engine', () => {
  it('classifies Vision prompts across all 5 specialized multimodal intents', () => {
    assert.equal(
      classifyVisionIntent('Extract all line items and subtotal from this invoice receipt into a table'),
      'table_receipt',
    );
    assert.equal(
      classifyVisionIntent('Explain the microservices data flow in this architecture diagram'),
      'diagram_architecture',
    );
    assert.equal(
      classifyVisionIntent('Audit this dashboard UI screenshot for contrast and React layout bugs'),
      'ui_code_audit',
    );
    assert.equal(
      classifyVisionIntent('Run OCR and transcribe all text verbatim from this scanned note'),
      'ocr_extract',
    );
    assert.equal(
      classifyVisionIntent('What landmark is shown in the background of this photo?'),
      'visual_qa',
    );
  });

  it('parses exact pixel dimensions and aspect ratios from PNG, JPEG, and WebP binary headers', () => {
    const mockPngDims = parseImageDimensions('image/png', MOCK_PNG_BYTES);
    assert.deepEqual(mockPngDims, { width: 1, height: 1, aspectRatio: '1:1' });

    const png16x9 = parseImageDimensions(
      'image/png',
      buildSyntheticPngHeader(1280, 720),
    );
    assert.deepEqual(png16x9, { width: 1280, height: 720, aspectRatio: '16:9' });

    const jpeg4x3 = parseImageDimensions(
      'image/jpeg',
      buildSyntheticJpegHeader(1600, 1200),
    );
    assert.deepEqual(jpeg4x3, { width: 1600, height: 1200, aspectRatio: '4:3' });

    const webpDims = parseImageDimensions(
      'image/webp',
      buildSyntheticWebpVp8xHeader(1024, 768),
    );
    assert.deepEqual(webpDims, { width: 1024, height: 768, aspectRatio: '4:3' });

    // Truncated/invalid buffers gracefully return null without throwing
    assert.equal(parseImageDimensions('image/png', new Uint8Array([0x89, 0x50])), null);
    assert.equal(parseImageDimensions('image/jpeg', new Uint8Array(20)), null);
  });

  it('builds grounded anti-hallucination system instructions, contextual user prompts, and 3 follow-ups', () => {
    const tableSys = buildVisionSystemInstruction('table_receipt');
    assert.ok(tableSys.includes('[unreadable]'));
    assert.ok(tableSys.includes('GitHub-Flavored Markdown table'));
    assert.ok(tableSys.includes('untrusted data'));

    const ocrSys = buildVisionSystemInstruction('ocr_extract');
    assert.ok(ocrSys.includes('### Extracted Text'));

    const userPrompt = buildVisionUserPrompt('Extract totals', {
      mimeType: 'image/png',
      sizeBytes: 4096,
      filename: 'q4-invoice.png',
      dimensions: { width: 1200, height: 800, aspectRatio: '3:2' },
    });
    assert.ok(userPrompt.includes('"q4-invoice.png"'));
    assert.ok(userPrompt.includes('1200×800 px (3:2)'));

    const followUps = buildVisionFollowUps(
      'table_receipt',
      'Extract totals',
      'q4-invoice.png',
    );
    assert.equal(followUps.length, 3);
    assert.ok(followUps.every((q) => q.includes('q4-invoice.png')));

    const offline = formatOfflineVisionFallback({
      prompt: 'Read text',
      intent: 'ocr_extract',
      meta: {
        mimeType: 'image/png',
        sizeBytes: MOCK_PNG_BYTES.byteLength,
        filename: 'sample.png',
        dimensions: { width: 1, height: 1, aspectRatio: '1:1' },
      },
    });
    assert.ok(offline.includes('image/png'));
    assert.ok(offline.includes('1×1 px'));
  });

  it('executes Vision specialist in AgentGraphExecutor with tailored systemInstruction, filename, and 3 followUpQueries', async () => {
    const config = buildTestConfig();
    const repository = new InMemoryAgentRepository();
    const objectStorage = new InMemoryObjectStorage();
    const vectorStore = new InMemoryVectorStore();
    const ingestion = new FileIngestionAndArtifactService({
      config,
      repository,
      objectStorage,
      vectorStore,
      embeddingProvider: new MockEmbeddingProvider(),
    });

    const uploaded = await ingestion.ingestUploadedFile({
      userId: 'usr_vision_1',
      conversationId: 'conv_vision_1',
      originalFilename: 'architecture-topology.png',
      declaredMimeType: 'image/png',
      contentBytes: MOCK_PNG_BYTES,
    });

    // Ownership-scoped raw bytes retrieval succeeds for owner and returns 404 for foreign user
    const rawOwned = await ingestion.getFileWithRawBytes({
      userId: 'usr_vision_1',
      fileId: uploaded.fileId,
    });
    assert.equal(rawOwned.file.fileId, uploaded.fileId);
    assert.deepEqual(
      new Uint8Array(Buffer.from(rawOwned.contentBase64, 'base64')),
      MOCK_PNG_BYTES,
    );
    await assert.rejects(
      () =>
        ingestion.getFileWithRawBytes({
          userId: 'usr_foreign_2',
          fileId: uploaded.fileId,
        }),
      (err: unknown) => (err as { code?: string })?.code === 'NOT_FOUND',
    );

    let capturedFilename: string | undefined;
    let capturedSystemInstruction: string | undefined;

    const executor = new AgentGraphExecutor({
      config,
      metadataStore: repository,
      vectorStore,
      objectStorage,
      budgetGuard: new DailyLiveBudgetGuard({
        store: new InMemoryDailyBudgetStore(),
        dailyLimit: config.dailyLiveCallBudget,
        mockAiDefault: config.mockAi,
      }),
      chatProvider: new MockChatModelProvider(),
      codingProvider: new MockCodingModelProvider(),
      searchProvider: new MockSearchProvider(),
      embeddingProvider: new MockEmbeddingProvider(),
      imageProvider: new MockImageGenerationProvider(),
      visionProvider: {
        providerName: 'spy-vision-provider',
        async analyzeImage(input) {
          capturedFilename = input.filename;
          capturedSystemInstruction = input.systemInstruction;
          return {
            analysis: '### High-Level Architecture\nGateway routes traffic to Agent & Billing services.',
            tokensUsed: 96,
          };
        },
      },
      loadImageBytes: async (storageKey, userId) => {
        const obj = await objectStorage.getPrivateObject(storageKey, userId);
        return obj.body;
      },
    });

    const result = await executor.execute({
      requestId: 'req_vision_01',
      traceId: 'trace_vision_01',
      userId: 'usr_vision_1',
      conversationId: 'conv_vision_1',
      messageId: 'msg_vision_01',
      prompt: 'Inspect this microservices architecture diagram and list components',
      preferredAgent: 'vision',
      attachmentFileIds: [uploaded.fileId],
    });

    assert.equal(result.agent, 'vision');
    assert.equal(capturedFilename, 'architecture-topology.png');
    assert.ok(capturedSystemInstruction?.includes('MODE: Architecture, Flowchart & Diagram Inspector'));
    assert.equal(result.followUpQueries?.length, 3);
    assert.ok(result.followUpQueries?.some((q) => q.includes('Mermaid')));

    // Missing image attachment fails cleanly with VALIDATION_FAILED
    await assert.rejects(
      () =>
        executor.execute({
          requestId: 'req_vision_no_img',
          traceId: 'trace_vision_no_img',
          userId: 'usr_vision_1',
          conversationId: 'conv_vision_1',
          messageId: 'msg_vision_02',
          prompt: 'Read text from image',
          preferredAgent: 'vision',
          attachmentFileIds: [],
        }),
      (err: unknown) => (err as { code?: string })?.code === 'VALIDATION_FAILED',
    );

    // Offline LiveGeminiVisionProvider preserves image/png metadata and dimensions
    const offlineLive = new LiveGeminiVisionProvider({ apiKey: '' });
    const offlineOut = await offlineLive.analyzeImage({
      prompt: 'Transcribe all text verbatim',
      mimeType: 'image/png',
      imageBytes: MOCK_PNG_BYTES,
      filename: 'architecture-topology.png',
    });
    assert.ok(offlineOut.analysis.includes('image/png'));
    assert.ok(offlineOut.analysis.includes('1×1 px'));
  });
});
