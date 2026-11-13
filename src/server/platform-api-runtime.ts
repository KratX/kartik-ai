/**
 * @file src/server/platform-api-runtime.ts
 * @description Unified Full-Stack Multi-Agent Platform Runtime (Micro-step 9.3.a).
 *
 * Connects the Gateway API contract (`/api/v1/*`) to the real `@kartik/agent` execution engine
 * (`AgentGraphExecutor`, `LiveGemini*Provider`, `AgentSlidingWindowRateLimiter`,
 * `FileIngestionAndArtifactService`, `buildPdfBinaryBuffer`, `buildPptxBinaryBuffer`),
 * `@kartik/billing` integer-paise plans & credit ledger, `@kartik/auth` sessions, and
 * `@kartik/chat` conversation/message lifecycle with ordered cascade deletion.
 */

import crypto from 'node:crypto';
import { InMemoryObjectStorage } from '../../backend/shared/storage/index.js';
import { AppError } from '../../backend/shared/errors/index.js';
import { OPERATION_CREDIT_COSTS } from '../../backend/services/billing/src/services/credit-service.js';
import {
  AGENT_TO_BILLING_OPERATION,
  resolveTargetSpecialist,
} from '../../backend/services/chat/src/services/index.js';
import {
  AgentGraphExecutor,
  AgentSlidingWindowRateLimiter,
  DailyLiveBudgetGuard,
  FileIngestionAndArtifactService,
  InMemoryAgentRateLimitStore,
  InMemoryAgentRepository,
  InMemoryDailyBudgetStore,
  InMemoryVectorStore,
  LiveGeminiChatModelProvider,
  LiveGeminiCodingModelProvider,
  LiveGeminiEmbeddingProvider,
  LiveGeminiImageGenerationProvider,
  LiveGeminiPdfDocumentProvider,
  LiveGeminiPptPresentationProvider,
  LiveGeminiSearchProvider,
  LiveGeminiVisionProvider,
  loadAgentConfig,
  type AgentCitation,
  type ArtifactRecord,
  type SearchImageGalleryItem,
  type UploadedFileRecord,
} from '../../backend/services/agent/src/index.js';
import type { SpecialistAgentName } from '../../backend/shared/contracts/index.js';

export interface PlatformUser {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly planId: 'plan_free' | 'plan_starter_199' | 'plan_pro_499';
}

export interface PlatformMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly role: 'user' | 'assistant';
  readonly content: string;
  readonly agentUsed?: SpecialistAgentName;
  readonly requestId?: string;
  readonly creditsCharged?: number;
  readonly idempotentReplay?: boolean;
  readonly citations?: readonly AgentCitation[];
  readonly searchImages?: readonly SearchImageGalleryItem[];
  readonly artifactIds?: readonly string[];
  readonly artifacts?: readonly ArtifactRecord[];
  readonly attachedFiles?: readonly UploadedFileRecord[];
  readonly createdAt: string;
}

export interface PlatformConversation {
  readonly conversationId: string;
  readonly userId: string;
  title: string;
  deletionState: 'active' | 'deleted';
  readonly createdAt: string;
  updatedAt: string;
}

export interface PlatformCreditPlan {
  readonly planId: 'plan_starter_199' | 'plan_pro_499';
  readonly name: string;
  readonly badge: string;
  readonly amountPaise: number;
  readonly amountInrLabel: string;
  readonly creditsGranted: number;
  readonly features: readonly string[];
}

export const PLATFORM_CREDIT_PLANS: readonly PlatformCreditPlan[] = Object.freeze([
  {
    planId: 'plan_starter_199',
    name: 'Starter Plan',
    badge: 'POPULAR FOR BUILDERS',
    amountPaise: 19900,
    amountInrLabel: '₹199',
    creditsGranted: 500,
    features: [
      '500 Multi-Agent Execution Credits',
      'Full access to Coding, PDF 1.4 & PPTX Generators',
      'PDF RAG Vector Search & Multimodal Vision OCR',
      'Idempotent 0-Charge Replay Protection',
    ],
  },
  {
    planId: 'plan_pro_499',
    name: 'Pro Plan',
    badge: 'BEST VALUE · 3× CREDITS',
    amountPaise: 49900,
    amountInrLabel: '₹499',
    creditsGranted: 1500,
    features: [
      '1,500 Multi-Agent Execution Credits',
      'Priority Live Gemini 3.8 Flash & Search Grounding',
      'Unlimited Multi-File Code Sandbox & Binary Exports',
      'Full Ledger Audit Trail & Razorpay Receipt Verification',
    ],
  },
]);

export interface PlatformLedgerEntry {
  readonly entryId: string;
  readonly timestamp: string;
  readonly description: string;
  readonly deltaCredits: number;
  readonly balanceAfter: number;
  readonly requestId: string;
}

export class KartikPlatformRuntime {
  public readonly repository = new InMemoryAgentRepository();
  public readonly objectStorage = new InMemoryObjectStorage();
  public readonly vectorStore = new InMemoryVectorStore();
  public readonly rateLimiter = new AgentSlidingWindowRateLimiter({
    store: new InMemoryAgentRateLimitStore(),
    windowSeconds: 60,
  });
  public readonly searchProvider = new LiveGeminiSearchProvider();
  public readonly ingestionService: FileIngestionAndArtifactService;
  public readonly graphExecutor: AgentGraphExecutor;

  private currentUser: PlatformUser = {
    userId: 'usr_kartik_owner_01',
    email: 'kartikrawat9@gmail.com',
    displayName: 'Kartik Rawat',
    avatarUrl: null,
    planId: 'plan_free',
  };
  private isAuthenticated = true;
  private demoReadOnly = false;
  private availableCredits = 250;
  private readonly ledger: PlatformLedgerEntry[] = [];
  private readonly conversations = new Map<string, PlatformConversation>();
  private readonly messagesByConversation = new Map<string, PlatformMessage[]>();
  private readonly processedTurnsByRequestId = new Map<
    string,
    {
      readonly conversationId: string;
      readonly requestId: string;
      readonly traceId: string;
      readonly remainingCredits: number;
      readonly creditsCharged: number;
      readonly idempotentReplay: boolean;
      readonly userMessage: PlatformMessage;
      readonly assistantMessage: PlatformMessage;
    }
  >();
  private readonly pendingOrders = new Map<
    string,
    {
      readonly orderId: string;
      readonly plan: PlatformCreditPlan;
      readonly userId: string;
      settled: boolean;
    }
  >();

  constructor() {
    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const config = loadAgentConfig({
      NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
      REDIS_URL: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
      USER_CONTEXT_PUBLIC_KEY: publicKeyPem,
      INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
      MOCK_AI: process.env.GEMINI_API_KEY ? 'false' : 'true',
      GEMINI_API_KEY: process.env.GEMINI_API_KEY ?? 'test-gemini-api-key-value',
      TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? 'test-tavily-api-key',
      DAILY_LIVE_CALL_BUDGET: process.env.DAILY_LIVE_CALL_BUDGET ?? '100',
    });

    const embeddingProvider = new LiveGeminiEmbeddingProvider();
    this.ingestionService = new FileIngestionAndArtifactService({
      config,
      repository: this.repository,
      objectStorage: this.objectStorage,
      vectorStore: this.vectorStore,
      embeddingProvider,
    });

    const budgetGuard = new DailyLiveBudgetGuard({
      store: new InMemoryDailyBudgetStore(),
      dailyLimit: 100,
      mockAiDefault: false,
    });

    this.graphExecutor = new AgentGraphExecutor({
      config,
      budgetGuard,
      rateLimiter: this.rateLimiter,
      chatProvider: new LiveGeminiChatModelProvider(),
      codingProvider: new LiveGeminiCodingModelProvider(),
      searchProvider: this.searchProvider,
      embeddingProvider,
      imageProvider: new LiveGeminiImageGenerationProvider(),
      visionProvider: new LiveGeminiVisionProvider(),
      pdfProvider: new LiveGeminiPdfDocumentProvider(),
      pptProvider: new LiveGeminiPptPresentationProvider(),
      vectorStore: this.vectorStore,
      objectStorage: this.objectStorage,
      metadataStore: this.repository,
      loadImageBytes: async (storageKey, userId) => {
        const obj = await this.objectStorage.getPrivateObject(storageKey, userId);
        return obj.body;
      },
    });

    this.seedInitialWorkspace();
  }

  private seedInitialWorkspace(): void {
    const convId = 'conv_welcome_01';
    const nowIso = new Date().toISOString();
    this.conversations.set(convId, {
      conversationId: convId,
      userId: this.currentUser.userId,
      title: 'Kartik.ai Multi-Agent Architecture & Capabilities',
      deletionState: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    this.ledger.push({
      entryId: 'led_grant_initial',
      timestamp: nowIso,
      description: 'Initial Free-Tier Starter Grant',
      deltaCredits: 250,
      balanceAfter: 250,
      requestId: 'req_initial_grant_0001',
    });

    this.messagesByConversation.set(convId, [
      {
        messageId: 'msg_welcome_assistant_01',
        conversationId: convId,
        role: 'assistant',
        agentUsed: 'chat',
        content: [
          '### Welcome to **Kartik.ai** — Multi-Agent AI Workspace',
          '',
          'Select any specialist agent pill below or type naturally and the **LangGraph Router** will dispatch your turn automatically:',
          '',
          '| Specialist Agent | What It Produces | Cost / Rate Limit |',
          '| :--- | :--- | :--- |',
          '| **Chat (`chat`)** | Multi-turn technical synthesis, Markdown tables & architecture reasoning | `1 credit` · `20 req/min` |',
          '| **Web Search (`search`)** | Live Google Search grounding citations + **4-image Interactive Lightbox Gallery** | `2 credits` · `5 req/min` |',
          '| **Coding (`coding`)** | Two-stage classifier: builds 3-file (`index.html`, `styles.css`, `app.js`) live sandboxed apps OR inline code reviews | `5 credits` · `5 req/min` |',
          '| **PDF Generator (`pdf`)** | Compiles real downloadable **`%PDF-1.4`** multi-page binary reports with page numbers & footer | `5 credits` · `5 req/min` |',
          '| **PPT Generator (`ppt`)** | Compiles real downloadable **OpenXML `.pptx`** slide decks + **Interactive 16:9 Slide Deck Preview** in chat | `8 credits` · `5 req/min` |',
          '| **PDF RAG (`rag`)** | Extracts multi-page text from uploaded `.pdf` files, chunks, embeds (`768-dim`), and cites `[Document, p. N]` | `2 credits` · `5 req/min` |',
          '| **Vision & Image (`vision` / `image`)** | Multimodal OCR/diagram inspection on uploaded images & prompt-enhanced visual artwork generation | `3–10 credits` · `5 req/min` |',
        ].join('\n'),
        citations: [],
        createdAt: nowIso,
      },
    ]);
  }

  public getAuthStatus() {
    if (!this.isAuthenticated) {
      throw new AppError('UNAUTHENTICATED', 'No active session cookie');
    }
    return {
      user: this.currentUser,
      demoReadOnly: this.demoReadOnly,
    };
  }

  public loginWithGoogle(input?: {
    readonly email?: string;
    readonly displayName?: string;
  }) {
    this.isAuthenticated = true;
    if (input?.email || input?.displayName) {
      this.currentUser = {
        ...this.currentUser,
        email: input.email?.trim() || this.currentUser.email,
        displayName: input.displayName?.trim() || this.currentUser.displayName,
      };
    }
    return {
      sessionId: `sess_${crypto.randomBytes(12).toString('hex')}`,
      user: this.currentUser,
      demoReadOnly: this.demoReadOnly,
    };
  }

  public logout() {
    this.isAuthenticated = false;
    return { loggedOut: true };
  }

  public toggleDemoReadOnly(enabled?: boolean) {
    this.demoReadOnly = enabled ?? !this.demoReadOnly;
    return { demoReadOnly: this.demoReadOnly };
  }

  private assertWritable(): void {
    if (this.demoReadOnly) {
      throw new AppError(
        'DEMO_READ_ONLY',
        'Demo read-only freeze is active: mutating endpoints are temporarily disabled while browsing remains available.',
      );
    }
  }

  public listConversations() {
    const items = Array.from(this.conversations.values())
      .filter(
        (c) => c.userId === this.currentUser.userId && c.deletionState === 'active',
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { items };
  }

  public createConversation(title?: string) {
    this.assertWritable();
    const convId = `conv_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const record: PlatformConversation = {
      conversationId: convId,
      userId: this.currentUser.userId,
      title: title && title.trim().length > 0 ? title.trim().slice(0, 80) : 'New Conversation',
      deletionState: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.conversations.set(convId, record);
    this.messagesByConversation.set(convId, []);
    return record;
  }

  public getConversationMessages(conversationId: string) {
    const conv = this.conversations.get(conversationId);
    if (
      !conv ||
      conv.userId !== this.currentUser.userId ||
      conv.deletionState === 'deleted'
    ) {
      throw new AppError('NOT_FOUND', 'Conversation not found');
    }
    const items = this.messagesByConversation.get(conversationId) ?? [];
    return {
      conversation: conv,
      items,
    };
  }

  public async deleteConversation(conversationId: string) {
    this.assertWritable();
    const conv = this.conversations.get(conversationId);
    if (
      !conv ||
      conv.userId !== this.currentUser.userId ||
      conv.deletionState === 'deleted'
    ) {
      throw new AppError('NOT_FOUND', 'Conversation not found');
    }

    const userFiles = await this.repository.listFilesByUser(this.currentUser.userId);
    const convFiles = userFiles.filter((f) =>
      f.storageKey.includes(`/${conversationId}/`),
    );

    const purgeReport = await this.ingestionService.purgeResources({
      userId: this.currentUser.userId,
      conversationId,
      fileIds: convFiles.map((f) => f.fileId),
    });

    conv.deletionState = 'deleted';
    this.messagesByConversation.delete(conversationId);

    return {
      conversationId,
      status: 'deleted' as const,
      purgeReport,
    };
  }

  public async uploadFile(input: {
    readonly conversationId: string;
    readonly originalFilename: string;
    readonly declaredMimeType: string;
    readonly contentBase64: string;
  }) {
    this.assertWritable();
    const contentBytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
    return this.ingestionService.ingestUploadedFile({
      userId: this.currentUser.userId,
      conversationId: input.conversationId,
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      contentBytes,
    });
  }

  public async listFiles() {
    const items = await this.repository.listFilesByUser(this.currentUser.userId);
    return { items };
  }

  public async getArtifactContent(artifactId: string) {
    return this.ingestionService.getArtifactWithRawBytes({
      userId: this.currentUser.userId,
      artifactId,
    });
  }

  public async sendMessageTurn(input: {
    readonly conversationId: string;
    readonly requestId: string;
    readonly traceId: string;
    readonly prompt: string;
    readonly preferredAgent?: SpecialistAgentName;
    readonly attachmentFileIds?: readonly string[];
  }) {
    this.assertWritable();

    if (!input.requestId || input.requestId.trim().length === 0) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Mutating requests require an Idempotency-Key header',
      );
    }

    const existingReplay = this.processedTurnsByRequestId.get(input.requestId);
    if (existingReplay) {
      return {
        ...existingReplay,
        idempotentReplay: true,
      };
    }

    let conv = this.conversations.get(input.conversationId);
    if (!conv || conv.deletionState === 'deleted') {
      conv = this.createConversation(input.prompt.slice(0, 56));
    }

    const attachedFiles: UploadedFileRecord[] = [];
    for (const fileId of input.attachmentFileIds ?? []) {
      const f = await this.repository.getFileById(this.currentUser.userId, fileId);
      if (!f) {
        throw new AppError('NOT_FOUND', `Attached file "${fileId}" not found`);
      }
      attachedFiles.push(f);
    }

    const targetAgent = resolveTargetSpecialist({
      prompt: input.prompt,
      requestedAgent: input.preferredAgent,
      attachmentFileIds: input.attachmentFileIds,
      hasImageBytes: attachedFiles.some((f) => f.mimeType.startsWith('image/')),
    });

    const billingOp = AGENT_TO_BILLING_OPERATION[targetAgent];
    const creditCost = OPERATION_CREDIT_COSTS[billingOp] ?? 1;

    if (this.availableCredits < creditCost) {
      throw new AppError(
        'QUOTA_EXHAUSTED',
        `Operation "${billingOp}" requires ${creditCost} credits, but your available balance is ${this.availableCredits}. Please top up in the Billing Drawer.`,
      );
    }

    const nowIso = new Date().toISOString();
    const userMessage: PlatformMessage = {
      messageId: `msg_usr_${crypto.randomBytes(6).toString('hex')}`,
      conversationId: conv.conversationId,
      role: 'user',
      content: input.prompt.trim(),
      requestId: input.requestId,
      attachedFiles,
      createdAt: nowIso,
    };

    const execResult = await this.graphExecutor.execute({
      requestId: input.requestId,
      traceId: input.traceId,
      userId: this.currentUser.userId,
      conversationId: conv.conversationId,
      messageId: userMessage.messageId,
      prompt: input.prompt,
      preferredAgent: input.preferredAgent,
      attachmentFileIds: input.attachmentFileIds,
    });

    // Deduct credits atomically after durable execution
    this.availableCredits -= creditCost;
    this.ledger.unshift({
      entryId: `led_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: new Date().toISOString(),
      description: `${execResult.agent.toUpperCase()} Agent (${billingOp})`,
      deltaCredits: -creditCost,
      balanceAfter: this.availableCredits,
      requestId: input.requestId,
    });

    const hydratedArtifacts: ArtifactRecord[] = [];
    for (const artId of execResult.artifactIds ?? []) {
      const art = await this.repository.getArtifactById(this.currentUser.userId, artId);
      if (art) {
        hydratedArtifacts.push(art);
      }
    }

    const assistantMessage: PlatformMessage = {
      messageId: `msg_ast_${crypto.randomBytes(6).toString('hex')}`,
      conversationId: conv.conversationId,
      role: 'assistant',
      content: execResult.replyContent,
      agentUsed: execResult.agent,
      requestId: input.requestId,
      creditsCharged: creditCost,
      idempotentReplay: false,
      citations: execResult.citations ?? [],
      searchImages:
        execResult.agent === 'search' ? this.searchProvider.lastSearchImages : undefined,
      artifactIds: execResult.artifactIds ?? [],
      artifacts: hydratedArtifacts,
      createdAt: new Date().toISOString(),
    };

    const list = this.messagesByConversation.get(conv.conversationId) ?? [];
    list.push(userMessage, assistantMessage);
    this.messagesByConversation.set(conv.conversationId, list);

    if (
      conv.title === 'New Conversation' ||
      conv.title.startsWith('Kartik.ai Multi-Agent')
    ) {
      conv.title = input.prompt.trim().slice(0, 56) || conv.title;
    }
    conv.updatedAt = assistantMessage.createdAt;

    const turnResult = {
      conversationId: conv.conversationId,
      requestId: input.requestId,
      traceId: input.traceId,
      remainingCredits: this.availableCredits,
      creditsCharged: creditCost,
      idempotentReplay: false,
      userMessage,
      assistantMessage,
    };

    this.processedTurnsByRequestId.set(input.requestId, turnResult);
    return turnResult;
  }

  public getBillingSummary() {
    return {
      userId: this.currentUser.userId,
      planId: this.currentUser.planId,
      availableCredits: this.availableCredits,
      reservedCredits: 0,
      billingMode: 'mock' as const,
      plans: PLATFORM_CREDIT_PLANS,
      operationCosts: OPERATION_CREDIT_COSTS,
      ledger: this.ledger.slice(0, 25),
    };
  }

  public createBillingOrder(input: {
    readonly planId: string;
    readonly requestId: string;
  }) {
    this.assertWritable();
    const plan = PLATFORM_CREDIT_PLANS.find((p) => p.planId === input.planId);
    if (!plan) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Unknown planId "${input.planId}". Allowed: plan_starter_199, plan_pro_499`,
      );
    }

    const orderId = `order_rzp_${crypto.randomBytes(8).toString('hex')}`;
    this.pendingOrders.set(orderId, {
      orderId,
      plan,
      userId: this.currentUser.userId,
      settled: false,
    });

    return {
      orderId,
      razorpayOrderId: orderId,
      razorpayKeyId: process.env.RAZORPAY_KEY_ID ?? 'rzp_test_kartik_ai_demo',
      planId: plan.planId,
      planName: plan.name,
      amountPaise: plan.amountPaise,
      amountInrLabel: plan.amountInrLabel,
      creditsGranted: plan.creditsGranted,
      currency: 'INR',
      status: 'created' as const,
    };
  }

  public verifyCheckoutAndCredit(input: {
    readonly orderId: string;
    readonly paymentId?: string;
    readonly requestId: string;
  }) {
    this.assertWritable();
    const order = this.pendingOrders.get(input.orderId);
    if (!order) {
      throw new AppError('NOT_FOUND', `Order "${input.orderId}" was not found`);
    }

    if (order.settled) {
      return {
        orderId: order.orderId,
        planId: order.plan.planId,
        creditsAdded: 0,
        availableCredits: this.availableCredits,
        idempotentReplay: true,
      };
    }

    order.settled = true;
    this.availableCredits += order.plan.creditsGranted;
    this.currentUser = {
      ...this.currentUser,
      planId: order.plan.planId,
    };

    const paymentId =
      input.paymentId ?? `pay_rzp_${crypto.randomBytes(6).toString('hex')}`;
    this.ledger.unshift({
      entryId: `led_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: new Date().toISOString(),
      description: `Razorpay Purchase — ${order.plan.name} (${order.plan.amountInrLabel}, ${paymentId})`,
      deltaCredits: order.plan.creditsGranted,
      balanceAfter: this.availableCredits,
      requestId: input.requestId,
    });

    return {
      orderId: order.orderId,
      paymentId,
      planId: order.plan.planId,
      creditsAdded: order.plan.creditsGranted,
      availableCredits: this.availableCredits,
      idempotentReplay: false,
    };
  }
}

export const sharedPlatformRuntime = new KartikPlatformRuntime();
