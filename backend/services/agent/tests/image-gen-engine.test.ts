import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { describe, it } from 'node:test';
import { InMemoryObjectStorage } from '@kartik/shared/storage';
import {
  AgentGraphExecutor,
  DailyLiveBudgetGuard,
  FileIngestionAndArtifactService,
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
  buildEnhancedImagePrompt,
  buildImageFollowUps,
  buildImageSpecManifestPayload,
  classifyImageStyle,
  detectImageAspectRatio,
  formatImageCaption,
  getImageStyleDisplayLabel,
  loadAgentConfig,
  parseImageDimensions,
  routePromptToSpecialist,
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
