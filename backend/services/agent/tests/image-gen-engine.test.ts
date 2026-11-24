import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { AppError } from '@kartik/shared/errors';
import { InMemoryObjectStorage } from '@kartik/shared/storage';
import {
  AgentGraphExecutor,
  CLOUDFLARE_IMAGE_DEFAULT_MODEL,
  CloudflareWorkersAiImageProvider,
  DailyLiveBudgetGuard,
  FileIngestionAndArtifactService,
  GEMINI_IMAGE_DEFAULT_MODEL,
  GEMINI_IMAGE_PRO_MODEL,
  IMAGE_ASPECT_RATIOS,
  IMAGE_STYLE_ARCHETYPES,
  InMemoryAgentRepository,
  InMemoryDailyBudgetStore,
  InMemoryVectorStore,
  LiveGeminiImageGenerationProvider,
  MockChatModelProvider,
  MockCodingModelProvider,
  MockEmbeddingProvider,
  MockSearchProvider,
  MockVisionProvider,
  buildCloudflareImageRequestBody,
  buildEnhancedImagePrompt,
  buildImageFollowUps,
  buildImageSpecManifestPayload,
  classifyGeminiImageError,
  classifyImageStyle,
  decodeCloudflareImageResponse,
  detectImageAspectRatio,
  detectImageMimeFromMagicBytes,
  formatImageCaption,
  getImageStyleDisplayLabel,
  hasCloudflareImageCredentials,
  loadAgentConfig,
  parseGeminiRetryDelayMs,
  parseImageDimensions,
  routePromptToSpecialist,
  selectGeminiImageModel,
  type ImageGenerationProvider,
  type ImageStyleArchetype,
  type UploadedFileRecord,
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
function buildSyntheticPng(width: number, height: number): Uint8Array {
  const buf = new Uint8Array(24);
  buf.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(buf.buffer);
  view.setUint32(8, 13, false);
  buf.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

describe('Fix #20 — Image Gen Art-Direction, Aspect Ratio & Studio Engine', () => {
  it('classifies image generation prompts across all 6 visual style archetypes', () => {
    assert.equal(IMAGE_STYLE_ARCHETYPES.length, 6);
    assert.equal(
      classifyImageStyle('Design a minimalist geometric app icon logo for a cloud fintech brand'),
      'logo_icon',
    );
    assert.equal(
      classifyImageStyle('Create an isometric architecture diagram of a zero-trust Kubernetes mesh'),
      'technical_diagram',
    );
    assert.equal(
      classifyImageStyle('Render a studio product shot of anodized titanium wireless headphones'),
      'ui_product_mockup',
    );
    assert.equal(
      classifyImageStyle('35mm street photography portrait in Tokyo during golden hour'),
      'photorealistic',
    );
    assert.equal(
      classifyImageStyle('Create a watercolor storybook editorial illustration of a floating library'),
      'editorial_illustration',
    );
    assert.equal(
      classifyImageStyle('A futuristic quantum computing data center bathed in emerald light'),
      'cinematic_artwork',
    );
  });

  it('detects explicit and semantic aspect ratios accurately with 1:1 default', () => {
    assert.equal(IMAGE_ASPECT_RATIOS.length, 5);
    assert.equal(detectImageAspectRatio('16:9 widescreen nebula over an ocean'), '16:9');
    assert.equal(detectImageAspectRatio('9:16 vertical phone wallpaper of misty mountains'), '9:16');
    assert.equal(detectImageAspectRatio('4:3 editorial spread of brutalist architecture'), '4:3');
    assert.equal(detectImageAspectRatio('3:4 vertical book cover of an astronaut'), '3:4');
    assert.equal(detectImageAspectRatio('1:1 square emblem of a compass'), '1:1');

    // Semantic cues without explicit numbers
    assert.equal(detectImageAspectRatio('Create a cinematic hero banner for our landing page'), '16:9');
    assert.equal(detectImageAspectRatio('Make a mobile wallpaper with neon reflections'), '9:16');
    assert.equal(detectImageAspectRatio('Design a vintage travel poster of Kyoto'), '3:4');
    assert.equal(detectImageAspectRatio('Create a classic presentation slide illustration'), '4:3');
    assert.equal(detectImageAspectRatio('Minimalist app icon for a weather app'), '1:1');
    assert.equal(detectImageAspectRatio('A glowing crystal prism on obsidian'), '1:1');
  });

  it('builds deterministic art-directed prompts, image-edit instructions, backward-compatible captions, and 3 follow-ups', () => {
    const enhanced = buildEnhancedImagePrompt({
      prompt: 'A futuristic quantum computing data center',
      style: 'cinematic_artwork',
      aspectRatio: '16:9',
    });
    assert.ok(enhanced.includes('A futuristic quantum computing data center'));
    assert.ok(enhanced.includes('16:9'));
    assert.ok(enhanced.includes('no watermarks'));

    const editPrompt = buildEnhancedImagePrompt({
      prompt: 'Convert into a moody watercolor illustration at dusk',
      style: 'editorial_illustration',
      aspectRatio: '4:3',
      isEdit: true,
    });
    assert.ok(editPrompt.includes('reference image'));
    assert.ok(editPrompt.includes('Convert into a moody watercolor illustration at dusk'));

    const caption = formatImageCaption({
      originalPrompt: 'Quantum data center',
      enhancedPrompt: enhanced,
      style: 'cinematic_artwork',
      aspectRatio: '16:9',
    });
    assert.ok(caption.includes('### Generated Visual Artwork'));
    assert.ok(caption.includes('Cinematic Concept Art'));
    assert.ok(caption.includes('16:9'));
    assert.ok(caption.includes('**Enhanced Prompt:**'));

    const editCaption = formatImageCaption({
      originalPrompt: 'Restyle into watercolor',
      enhancedPrompt: editPrompt,
      style: 'editorial_illustration',
      aspectRatio: '4:3',
      isEdit: true,
      referenceFilename: 'campus.png',
    });
    assert.ok(editCaption.includes('Restyled Visual Artwork'));
    assert.ok(editCaption.includes('campus.png'));

    const followUps = buildImageFollowUps(
      'Create a 16:9 widescreen futuristic quantum data center with glowing glass server racks and volumetric lighting',
      'cinematic_artwork',
      '16:9',
    );
    assert.equal(followUps.length, 3);
    assert.ok(followUps[0]?.includes('3:4'));
    // Must strip leading "Create a 16:9 widescreen" and never slice mid-word
    assert.ok(!followUps[0]?.includes('of Create'));
    assert.ok(!followUps[1]?.includes('glowing gla '));

    const logoFollowUps = buildImageFollowUps('Design a logo for NovaPay', 'logo_icon', '1:1');
    assert.equal(logoFollowUps.length, 3);
    assert.ok(logoFollowUps.some((q) => /monochrome/i.test(q)));

    const spec = buildImageSpecManifestPayload({
      originalPrompt: 'Quantum data center',
      enhancedPrompt: enhanced,
      style: 'cinematic_artwork',
      aspectRatio: '16:9',
      width: 1344,
      height: 768,
      model: 'gemini-3.1-flash-lite-image',
      isEdit: false,
      liveGenerated: true,
    });
    assert.equal(spec.styleLabel, getImageStyleDisplayLabel('cinematic_artwork'));
    assert.equal(spec.width, 1344);
    assert.equal(spec.height, 768);
  });

  it('expands Auto-Router image generation detection for natural visual requests', () => {
    const sampleImageFile: UploadedFileRecord = {
      fileId: 'fil_sample_img',
      userId: 'usr_router_test',
      originalFilename: 'receipt.png',
      mimeType: 'image/png',
      sizeBytes: 128,
      sha256Hex: 'a'.repeat(64),
      pageCount: 0,
      chunkCount: 0,
      storageKey: 'users/usr_router_test/uploads/fil_sample_img.png',
      status: 'ready',
      createdAt: new Date().toISOString(),
    };

    assert.equal(
      routePromptToSpecialist({ prompt: 'Design a logo for an aerospace robotics startup' }),
      'image',
    );
    assert.equal(
      routePromptToSpecialist({ prompt: 'Generate a poster for a jazz festival in 3:4' }),
      'image',
    );
    assert.equal(
      routePromptToSpecialist({ prompt: 'Create concept art of a solar-powered floating city' }),
      'image',
    );
    assert.equal(
      routePromptToSpecialist({ prompt: 'Generate a photorealistic image of a ceramic espresso cup' }),
      'image',
    );
    // Vision OCR still takes precedence when an image is uploaded without explicit preferredAgent
    assert.equal(
      routePromptToSpecialist({
        prompt: 'Extract text from this receipt',
        attachedFiles: [sampleImageFile],
      }),
      'vision',
    );
    // Explicit preferredAgent: 'image' enables multimodal image-to-image restyling even with attached image
    assert.equal(
      routePromptToSpecialist({
        prompt: 'Restyle this photo as a vintage risograph poster',
        attachedFiles: [sampleImageFile],
        preferredAgent: 'image',
      }),
      'image',
    );
  });

  it('executes Image Gen in AgentGraphExecutor with art-directed spec manifest, parsed dimensions, follow-ups, and multimodal referenceImage forwarding', async () => {
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

    const capturedCalls: Array<Parameters<ImageGenerationProvider['generateImage']>[0]> = [];
    const spyImageProvider: ImageGenerationProvider = {
      providerName: 'spy-image-provider',
      async generateImage(input) {
        capturedCalls.push(input);
        const style = (input.style as ImageStyleArchetype | undefined) ?? 'cinematic_artwork';
        return {
          data: buildSyntheticPng(1344, 768),
          mimeType: 'image/png',
          caption: formatImageCaption({
            originalPrompt: input.prompt,
            enhancedPrompt: input.enhancedPrompt ?? input.prompt,
            style,
            aspectRatio: input.aspectRatio ?? '16:9',
            isEdit: Boolean(input.referenceImage),
            referenceFilename: input.referenceImage?.filename,
          }),
          enhancedPrompt: input.enhancedPrompt ?? input.prompt,
          aspectRatio: input.aspectRatio ?? '16:9',
          style,
          modelUsed: 'gemini-3.1-flash-lite-image',
          liveGenerated: true,
        };
      },
    };

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
      visionProvider: new MockVisionProvider(),
      imageProvider: spyImageProvider,
      loadImageBytes: async (storageKey, userId) => {
        const obj = await objectStorage.getPrivateObject(storageKey, userId);
        return obj.body;
      },
    });

    // 1) Text-to-image widescreen generation
    const genOut = await executor.execute({
      requestId: 'req_img_01',
      traceId: 'trace_img_01',
      userId: 'usr_image_test',
      conversationId: 'conv_image_1',
      messageId: 'msg_img_01',
      prompt: 'Generate a 16:9 widescreen futuristic quantum computing data center',
      preferredAgent: 'image',
      attachmentFileIds: [],
    });

    assert.equal(genOut.agent, 'image');
    assert.equal(capturedCalls.length, 1);
    assert.equal(capturedCalls[0]?.aspectRatio, '16:9');
    assert.equal(capturedCalls[0]?.style, 'cinematic_artwork');
    assert.equal(capturedCalls[0]?.referenceImage, undefined);
    assert.equal(genOut.followUpQueries?.length, 3);
    assert.equal(genOut.artifactIds?.length, 1);

    const genArtifact = await repository.getArtifactById('usr_image_test', genOut.artifactIds![0]!);
    assert.ok(genArtifact);
    const specEntry = genArtifact.filesManifest?.find(
      (f: { path: string }) => f.path === 'image-spec.json',
    );
    assert.ok(specEntry?.content);
    const parsedSpec = JSON.parse(specEntry.content);
    assert.equal(parsedSpec.aspectRatio, '16:9');
    assert.equal(parsedSpec.style, 'cinematic_artwork');
    assert.equal(parsedSpec.styleLabel, 'Cinematic Concept Art');
    assert.equal(parsedSpec.width, 1344);
    assert.equal(parsedSpec.height, 768);
    assert.equal(parsedSpec.isEdit, false);
    assert.equal(parsedSpec.liveGenerated, true);

    // 2) Multimodal image-to-image restyling when reference image is attached with preferredAgent: 'image'
    const uploaded = await ingestion.ingestUploadedFile({
      userId: 'usr_image_test',
      conversationId: 'conv_image_1',
      originalFilename: 'studio-desk.png',
      declaredMimeType: 'image/png',
      contentBytes: buildSyntheticPng(800, 600),
    });

    const editOut = await executor.execute({
      requestId: 'req_img_02',
      traceId: 'trace_img_02',
      userId: 'usr_image_test',
      conversationId: 'conv_image_1',
      messageId: 'msg_img_02',
      prompt: 'Transform this desk into a warm watercolor editorial illustration in 4:3',
      preferredAgent: 'image',
      attachmentFileIds: [uploaded.fileId],
    });

    assert.equal(editOut.agent, 'image');
    assert.equal(capturedCalls.length, 2);
    assert.equal(capturedCalls[1]?.referenceImage?.filename, 'studio-desk.png');
    assert.equal(capturedCalls[1]?.referenceImage?.mimeType, 'image/png');
    assert.ok((capturedCalls[1]?.referenceImage?.data.byteLength ?? 0) > 0);
    assert.equal(capturedCalls[1]?.aspectRatio, '4:3');

    assert.equal(editOut.artifactIds?.length, 1);
    const editArtifact = await repository.getArtifactById('usr_image_test', editOut.artifactIds![0]!);
    assert.ok(editArtifact);
    const editSpecEntry = editArtifact.filesManifest?.find(
      (f: { path: string }) => f.path === 'image-spec.json',
    );
    assert.ok(editSpecEntry?.content);
    const parsedEditSpec = JSON.parse(editSpecEntry.content);
    assert.equal(parsedEditSpec.isEdit, true);
    assert.equal(parsedEditSpec.referenceFilename, 'studio-desk.png');
    assert.equal(parsedEditSpec.aspectRatio, '4:3');
  });

  it('LiveGeminiImageGenerationProvider offline fallback preserves Enhanced Prompt caption and detected aspectRatio/style', async () => {
    const provider = new LiveGeminiImageGenerationProvider({ apiKey: '' });
    const out = await provider.generateImage({
      prompt: 'Design a minimalist vector logo mark for Orbital Labs',
    });

    assert.equal(out.mimeType, 'image/png');
    assert.ok(out.data.byteLength > 500);
    assert.deepEqual(Array.from(out.data.slice(0, 4)), [0x89, 0x50, 0x4e, 0x47]);
    assert.deepEqual(parseImageDimensions('image/png', out.data), {
      width: 512,
      height: 512,
      aspectRatio: '1:1',
    });
    assert.equal(out.style, 'logo_icon');
    assert.equal(out.aspectRatio, '1:1');
    assert.equal(out.liveGenerated, false);
    assert.ok(out.caption.includes('Enhanced Prompt:'));
    assert.ok(out.enhancedPrompt && out.enhancedPrompt.includes('Orbital Labs'));
  });
});

describe('Fix #31 — Image Gen HTTP 429 RESOURCE_EXHAUSTED Classification, Backoff & Fail-Fast Behavior', () => {
  it('classifies free-tier limit:0 429 separately from transient burst 429 and parses Retry-After / retryDelay', () => {
    const freeTierBody = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message:
          'You exceeded your current quota, please check your plan and billing details. Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-lite-image',
      },
    });
    const paidTierErr = classifyGeminiImageError({
      status: 429,
      rawBody: freeTierBody,
      model: GEMINI_IMAGE_DEFAULT_MODEL,
    });
    assert.equal(paidTierErr.kind, 'paid_tier_required');
    assert.equal(paidTierErr.retryable, false);
    assert.equal(paidTierErr.appErrorCode, 'RATE_LIMITED');
    assert.ok(paidTierErr.userMessage.includes('free-tier quota of 0'));
    assert.ok(paidTierErr.userMessage.includes('IMAGE_PROVIDER=mock'));
    assert.ok(paidTierErr.userMessage.includes('No credits were charged'));

    const transientBody = JSON.stringify({
      error: {
        code: 429,
        status: 'RESOURCE_EXHAUSTED',
        message: 'Too many requests per minute. Please retry in 2.5s.',
        details: [{ retryDelay: '2s' }],
      },
    });
    const transientErr = classifyGeminiImageError({
      status: 429,
      rawBody: transientBody,
      model: GEMINI_IMAGE_DEFAULT_MODEL,
    });
    assert.equal(transientErr.kind, 'transient_rate_limit');
    assert.equal(transientErr.retryable, true);
    assert.equal(transientErr.retryDelayMs, 2000);
    assert.equal(transientErr.appErrorCode, 'RATE_LIMITED');

    assert.equal(parseGeminiRetryDelayMs('', '3'), 3000);
    assert.equal(parseGeminiRetryDelayMs('Please retry in 500ms'), 500);
    assert.equal(parseGeminiRetryDelayMs('"retryDelay": "12s"'), 4000);
  });

  it('selects active Gemini image models and ignores deprecated imagen-* / gemini-2.0-* overrides', () => {
    assert.equal(
      selectGeminiImageModel({ prompt: 'A minimalist glass pavilion at dusk' }),
      GEMINI_IMAGE_DEFAULT_MODEL,
    );
    assert.equal(
      selectGeminiImageModel({ prompt: 'Render a 4K cinematic mountain temple' }),
      GEMINI_IMAGE_PRO_MODEL,
    );
    assert.equal(
      selectGeminiImageModel({
        prompt: 'A minimalist icon',
        configuredModel: 'imagen-3.0-generate-002',
      }),
      GEMINI_IMAGE_DEFAULT_MODEL,
    );
    assert.equal(
      selectGeminiImageModel({
        prompt: 'A minimalist icon',
        configuredModel: 'gemini-2.0-flash-exp-image-generation',
      }),
      GEMINI_IMAGE_DEFAULT_MODEL,
    );
    assert.equal(
      selectGeminiImageModel({
        prompt: 'A minimalist icon',
        configuredModel: GEMINI_IMAGE_PRO_MODEL,
      }),
      GEMINI_IMAGE_PRO_MODEL,
    );
  });

  it('fails fast with AppError(RATE_LIMITED) on free-tier limit:0 429 without calling deprecated Imagen or returning a fake preview PNG', async () => {
    const originalFetch = globalThis.fetch;
    const prevCfToken = process.env.CLOUDFLARE_API_TOKEN;
    const prevCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const requestedUrls: string[] = [];
    const sleepCalls: number[] = [];

    try {
      delete process.env.CLOUDFLARE_API_TOKEN;
      delete process.env.CLOUDFLARE_ACCOUNT_ID;
      globalThis.fetch = (async (inputUrl) => {
        requestedUrls.push(String(inputUrl));
        return new Response(
          JSON.stringify({
            error: {
              code: 429,
              status: 'RESOURCE_EXHAUSTED',
              message:
                'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-lite-image',
            },
          }),
          { status: 429, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch;

      const provider = new LiveGeminiImageGenerationProvider({
        apiKey: 'AIzaSyTestFreeTierKey9876543210',
        maxTransientRetries: 2,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      await assert.rejects(
        () => provider.generateImage({ prompt: 'A futuristic observatory on Mars' }),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, 'RATE_LIMITED');
          assert.equal(err.httpStatus, 429);
          assert.deepEqual(err.details?.reason, ['paid_tier_required']);
          assert.ok(err.message.includes('free-tier quota of 0'));
          assert.ok(err.message.includes('No credits were charged'));
          return true;
        },
      );

      // Must fail fast on attempt 1: zero wasted backoff sleeps, zero deprecated imagen-3 calls
      assert.equal(requestedUrls.length, 1);
      assert.equal(sleepCalls.length, 0);
      assert.ok(requestedUrls[0]?.includes('gemini-3.1-flash-lite-image:generateContent'));
      assert.ok(!requestedUrls.some((u) => u.includes('imagen-')));
    } finally {
      globalThis.fetch = originalFetch;
      if (prevCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = prevCfToken;
      if (prevCfAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
      else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAccount;
    }
  });

  it('retries transient HTTP 429 with bounded backoff and succeeds once quota window clears', async () => {
    const originalFetch = globalThis.fetch;
    const sleepCalls: number[] = [];
    let attemptCount = 0;
    const realPngBytes = buildSyntheticPng(1024, 1024);
    const paddedPng = Buffer.concat([Buffer.from(realPngBytes), Buffer.alloc(128, 7)]);

    try {
      globalThis.fetch = (async () => {
        attemptCount += 1;
        if (attemptCount === 1) {
          return new Response(
            JSON.stringify({
              error: {
                code: 429,
                status: 'RESOURCE_EXHAUSTED',
                message: 'Rate limit exceeded. Please retry in 1s.',
              },
            }),
            {
              status: 429,
              headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
            },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: 'Generated image' },
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: paddedPng.toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch;

      const provider = new LiveGeminiImageGenerationProvider({
        apiKey: 'AIzaSyTestPaidTierKey9876543210',
        maxTransientRetries: 2,
        sleepFn: async (ms) => {
          sleepCalls.push(ms);
        },
      });

      const out = await provider.generateImage({ prompt: 'A sunlit botanical glasshouse' });
      assert.equal(attemptCount, 2);
      assert.deepEqual(sleepCalls, [1000]);
      assert.equal(out.liveGenerated, true);
      assert.equal(out.modelUsed, GEMINI_IMAGE_DEFAULT_MODEL);
      assert.deepEqual(Buffer.from(out.data), paddedPng);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('automatically retries without responseModalities if upstream returns HTTP 400 modality error', async () => {
    const originalFetch = globalThis.fetch;
    const seenBodies: Array<Record<string, unknown>> = [];
    const paddedPng = Buffer.concat([Buffer.from(buildSyntheticPng(512, 512)), Buffer.alloc(128, 9)]);

    try {
      globalThis.fetch = (async (_url, init) => {
        const parsed = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        seenBodies.push(parsed);
        if (seenBodies.length === 1) {
          return new Response(
            JSON.stringify({
              error: {
                code: 400,
                status: 'INVALID_ARGUMENT',
                message: 'responseModalities is not supported for this image model',
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: 'image/png',
                        data: paddedPng.toString('base64'),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch;

      const provider = new LiveGeminiImageGenerationProvider({
        apiKey: 'AIzaSyTestModalityRetry9876543210',
        sleepFn: async () => undefined,
      });

      const out = await provider.generateImage({ prompt: 'Minimalist ceramic teapot' });
      assert.equal(seenBodies.length, 2);
      const firstGenCfg = seenBodies[0]?.generationConfig as Record<string, unknown> | undefined;
      const secondGenCfg = seenBodies[1]?.generationConfig as Record<string, unknown> | undefined;
      assert.ok(Array.isArray(firstGenCfg?.responseModalities));
      assert.equal(secondGenCfg?.responseModalities, undefined);
      assert.deepEqual(secondGenCfg?.imageConfig, { aspectRatio: '1:1' });
      assert.equal(out.liveGenerated, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws PROVIDER_UNAVAILABLE instead of returning a fake preview PNG when live Gemini returns text-only without image bytes', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'I cannot generate that image.' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )) as typeof fetch;

      const provider = new LiveGeminiImageGenerationProvider({
        apiKey: 'AIzaSyTestEmptyImageKey9876543210',
        sleepFn: async () => undefined,
      });

      await assert.rejects(
        () => provider.generateImage({ prompt: 'Test empty response' }),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
          assert.ok(err.message.includes('I cannot generate that image.'));
          assert.ok(err.message.includes('No credits were charged'));
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Fix #32 — Cloudflare Workers AI Image Generation (FLUX.1 Schnell) & Free-Tier Fallback', () => {
  const TEST_ACCOUNT_ID = '0123456789abcdef0123456789abcdef';
  const TEST_CF_TOKEN = 'cfut_unit_test_workers_ai_token_1234567890';
  const SYNTHETIC_JPEG = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    Buffer.alloc(128, 0x33),
  ]);

  it('builds valid Cloudflare request bodies and decodes JSON base64 & raw binary image responses', () => {
    const fluxBody = buildCloudflareImageRequestBody({
      model: CLOUDFLARE_IMAGE_DEFAULT_MODEL,
      prompt: 'A'.repeat(2500),
      aspectRatio: '16:9',
      steps: 4,
    });
    assert.equal((fluxBody.prompt as string).length, 2048);
    assert.equal(fluxBody.steps, 4);

    const sdxlBody = buildCloudflareImageRequestBody({
      model: '@cf/stabilityai/stable-diffusion-xl-base-1.0',
      prompt: 'Minimalist pavilion',
      aspectRatio: '16:9',
    });
    assert.equal(sdxlBody.width, 1024);
    assert.equal(sdxlBody.height, 576);
    assert.equal(sdxlBody.num_steps, 16);

    assert.equal(detectImageMimeFromMagicBytes(new Uint8Array(SYNTHETIC_JPEG)), 'image/jpeg');
    assert.equal(detectImageMimeFromMagicBytes(buildSyntheticPng(64, 64)), 'image/png');

    const jsonDecoded = decodeCloudflareImageResponse({
      contentType: 'application/json',
      bodyBytes: new Uint8Array(
        Buffer.from(
          JSON.stringify({
            success: true,
            result: { image: SYNTHETIC_JPEG.toString('base64') },
          }),
          'utf8',
        ),
      ),
    });
    assert.ok(jsonDecoded);
    assert.equal(jsonDecoded.mimeType, 'image/jpeg');
    assert.deepEqual(Buffer.from(jsonDecoded.data), SYNTHETIC_JPEG);

    const pngBytes = Buffer.concat([Buffer.from(buildSyntheticPng(512, 512)), Buffer.alloc(96, 4)]);
    const binDecoded = decodeCloudflareImageResponse({
      contentType: 'image/png',
      bodyBytes: new Uint8Array(pngBytes),
    });
    assert.ok(binDecoded);
    assert.equal(binDecoded.mimeType, 'image/png');
    assert.deepEqual(Buffer.from(binDecoded.data), pngBytes);
  });

  it('generates live FLUX.1 Schnell images via Cloudflare Workers AI REST API and validates credentials helper', async () => {
    assert.equal(
      hasCloudflareImageCredentials({
        CLOUDFLARE_API_TOKEN: TEST_CF_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: TEST_ACCOUNT_ID,
      }),
      true,
    );
    assert.equal(
      hasCloudflareImageCredentials({
        CLOUDFLARE_API_TOKEN: TEST_CF_TOKEN,
        CLOUDFLARE_ACCOUNT_ID: '',
      }),
      false,
    );

    const originalFetch = globalThis.fetch;
    let seenUrl = '';
    let seenAuth = '';
    try {
      globalThis.fetch = (async (inputUrl, init) => {
        seenUrl = String(inputUrl);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        seenAuth = headers.Authorization ?? '';
        return new Response(
          JSON.stringify({
            success: true,
            result: { image: SYNTHETIC_JPEG.toString('base64') },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch;

      const provider = new CloudflareWorkersAiImageProvider({
        apiToken: TEST_CF_TOKEN,
        accountId: TEST_ACCOUNT_ID,
        sleepFn: async () => undefined,
      });

      const out = await provider.generateImage({
        prompt: '16:9 minimalist concrete library in pine forest',
      });
      assert.equal(
        seenUrl,
        `https://api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/${CLOUDFLARE_IMAGE_DEFAULT_MODEL}`,
      );
      assert.equal(seenAuth, `Bearer ${TEST_CF_TOKEN}`);
      assert.equal(out.liveGenerated, true);
      assert.equal(out.mimeType, 'image/jpeg');
      assert.equal(out.modelUsed, CLOUDFLARE_IMAGE_DEFAULT_MODEL);
      assert.deepEqual(Buffer.from(out.data), SYNTHETIC_JPEG);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('throws actionable PROVIDER_UNAVAILABLE when CLOUDFLARE_ACCOUNT_ID is missing and token cannot list accounts', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ success: true, result: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      const provider = new CloudflareWorkersAiImageProvider({
        apiToken: 'cfut_scoped_workers_ai_only_token_999999',
        accountId: '',
        sleepFn: async () => undefined,
      });

      await assert.rejects(
        () => provider.generateImage({ prompt: 'A glass prism' }),
        (err: unknown) => {
          assert.ok(err instanceof AppError);
          assert.equal(err.code, 'PROVIDER_UNAVAILABLE');
          assert.deepEqual(err.details?.reason, ['missing_cloudflare_account_id']);
          assert.ok(err.message.includes('CLOUDFLARE_ACCOUNT_ID'));
          assert.ok(err.message.includes('No credits were charged'));
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('automatically falls back to Cloudflare Workers AI FLUX when Gemini returns free-tier limit:0 429', async () => {
    const originalFetch = globalThis.fetch;
    const prevCfToken = process.env.CLOUDFLARE_API_TOKEN;
    const prevCfAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
    const requestedUrls: string[] = [];

    try {
      process.env.CLOUDFLARE_API_TOKEN = TEST_CF_TOKEN;
      process.env.CLOUDFLARE_ACCOUNT_ID = TEST_ACCOUNT_ID;

      globalThis.fetch = (async (inputUrl) => {
        const urlStr = String(inputUrl);
        requestedUrls.push(urlStr);
        if (urlStr.startsWith('https://generativelanguage.googleapis.com/')) {
          return new Response(
            JSON.stringify({
              error: {
                code: 429,
                status: 'RESOURCE_EXHAUSTED',
                message:
                  'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-lite-image',
              },
            }),
            { status: 429, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(
          JSON.stringify({
            success: true,
            result: { image: SYNTHETIC_JPEG.toString('base64') },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }) as typeof fetch;

      const geminiProvider = new LiveGeminiImageGenerationProvider({
        apiKey: 'AIzaSyTestFreeTierKeyWithCloudflareFallback99',
        sleepFn: async () => undefined,
      });

      const out = await geminiProvider.generateImage({
        prompt: 'Futuristic botanical conservatory at sunrise',
      });
      assert.equal(requestedUrls.length, 2);
      assert.ok(requestedUrls[0]?.includes('generativelanguage.googleapis.com'));
      assert.ok(requestedUrls[1]?.includes(`api.cloudflare.com/client/v4/accounts/${TEST_ACCOUNT_ID}/ai/run/`));
      assert.equal(out.liveGenerated, true);
      assert.equal(out.modelUsed, CLOUDFLARE_IMAGE_DEFAULT_MODEL);
      assert.deepEqual(Buffer.from(out.data), SYNTHETIC_JPEG);
    } finally {
      globalThis.fetch = originalFetch;
      if (prevCfToken === undefined) delete process.env.CLOUDFLARE_API_TOKEN;
      else process.env.CLOUDFLARE_API_TOKEN = prevCfToken;
      if (prevCfAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
      else process.env.CLOUDFLARE_ACCOUNT_ID = prevCfAccount;
    }
  });
});


