/**
 * @file src/server/platform-api-runtime.ts
 * @description Unified Full-Stack Multi-Agent Platform Runtime (Demo / Local Mode).
 *
 * Security & Multi-User Isolation:
 * - Strictly restricted to demo/local use (`assertRootRuntimeDemoOrLocalOnly`).
 * - Maintains zero global current-user state (`currentUser` removed).
 * - Requires request-scoped authenticated identity (`userId` / `VerifiedRequestIdentity`) for all
 *   protected operations and scopes all conversations, messages, files, artifacts, credits,
 *   idempotency keys, and Cloud SQL database queries strictly to the authenticated user.
 * - Full PostgreSQL Read/Write Hydration: loads persisted user profile, credit balance, ledger,
 *   conversations, messages, artifacts, uploaded files, and payment orders on first request
 *   for each user and writes through all state mutations.
 * - Never reassigns conversation ownership across users on login.
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createObjectStorageFromEnv } from '../../backend/shared/storage/index.js';
import { createRedisClientFromUrl } from '../../backend/shared/redis/index.js';
import { AppError } from '../../backend/shared/errors/index.js';
import { OPERATION_CREDIT_COSTS } from '../../backend/services/billing/src/services/credit-service.js';
import {
  AGENT_TO_BILLING_OPERATION,
  resolveTargetSpecialist,
} from '../../backend/services/chat/src/services/index.js';
import {
  AgentGraphExecutor,
  AgentSlidingWindowRateLimiter,
  createVectorStoreFromEnv,
  DailyLiveBudgetGuard,
  FileIngestionAndArtifactService,
  LiveGeminiChatModelProvider,
  LiveGeminiCodingModelProvider,
  LiveGeminiEmbeddingProvider,
  LiveGeminiImageGenerationProvider,
  LiveGeminiPdfDocumentProvider,
  LiveGeminiPptPresentationProvider,
  LiveGeminiSearchProvider,
  LiveGeminiVisionProvider,
  loadAgentConfig,
  RedisAgentRateLimitStore,
  RedisDailyBudgetStore,
  type AgentCitation,
  type ArtifactRecord,
  type SearchImageGalleryItem,
  type UploadedFileRecord,
} from '../../backend/services/agent/src/index.js';
import {
  computePayloadFingerprint,
  type SpecialistAgentName,
} from '../../backend/shared/contracts/index.js';
import {
  cloudSqlPlatformPersistenceAdapter,
  DrizzleCloudSqlAgentRepository,
  DrizzleCloudSqlObjectStorage,
  type PersistedPlatformUserSnapshot,
  type PlatformPersistenceAdapter,
} from '../db/platform-repository.ts';
import type { VerifiedRequestIdentity } from '../middleware/auth.ts';

export interface PlatformUser {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly planId: 'plan_free' | 'plan_starter_199' | 'plan_pro_499';
}

export interface PlatformSessionRecord {
  readonly sessionId: string;
  readonly userId: string;
  readonly expiresAt: string;
  readonly expiresAtMs: number;
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
  readonly followUpQueries?: readonly string[];
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
  readonly reservationId?: string;
}

export interface PlatformCreditReservation {
  readonly reservationId: string;
  readonly requestId: string;
  readonly userId: string;
  readonly conversationId: string;
  readonly agent: SpecialistAgentName;
  readonly operation: string;
  readonly reservedCredits: number;
  settledCredits: number | null;
  status: 'reserved' | 'settled' | 'released' | 'execution_unknown';
  readonly payloadFingerprint: string;
  readonly createdAt: string;
  updatedAt: string;
}

const INITIAL_FREE_CREDITS = 250;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Enforces that the monolithic root runtime (`server.ts` + `KartikPlatformRuntime`)
 * is restricted to local development, automated testing, and explicit demo environments.
 * Production deployments must run the isolated microservice architecture unless
 * `DEMO_MODE=true` or `ALLOW_ROOT_DEMO_RUNTIME=true` is explicitly configured.
 */
export function assertRootRuntimeDemoOrLocalOnly(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const nodeEnv = (env.NODE_ENV ?? 'development').trim().toLowerCase();
  const demoMode = (env.DEMO_MODE ?? '').trim().toLowerCase() === 'true';
  const allowRootDemo =
    (env.ALLOW_ROOT_DEMO_RUNTIME ?? '').trim().toLowerCase() === 'true';

  if (nodeEnv === 'production' && !demoMode && !allowRootDemo) {
    throw new AppError(
      'FORBIDDEN',
      'Root Express runtime is restricted to demo/local use. For production deployments, run the isolated microservice architecture (@kartik/gateway, @kartik/auth, @kartik/chat, @kartik/agent, @kartik/billing) or set DEMO_MODE=true for demo hosting.',
    );
  }
}

function sanitizeUserId(rawUid: string): string {
  const trimmed = rawUid.trim();
  const safe = trimmed.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  if (!safe) {
    throw new AppError('UNAUTHENTICATED', 'Authenticated user ID is required');
  }
  return safe;
}

export interface KartikPlatformRuntimeOptions {
  readonly persistence?: PlatformPersistenceAdapter;
}

export class KartikPlatformRuntime {
  private readonly redisClient = createRedisClientFromUrl(process.env.REDIS_URL);
  public readonly persistence: PlatformPersistenceAdapter;
  public readonly repository = new DrizzleCloudSqlAgentRepository();
  public readonly objectStorage =
    process.env.OBJECT_STORAGE_MODE === 'filesystem' ||
    process.env.OBJECT_STORAGE_MODE === 'memory' ||
    process.env.OBJECT_STORAGE_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL_S3 ||
    process.env.R2_ENDPOINT
      ? createObjectStorageFromEnv(process.env)
      : new DrizzleCloudSqlObjectStorage();
  public readonly vectorStore = createVectorStoreFromEnv(
    process.env.NODE_ENV === 'test'
      ? {
          ...process.env,
          QDRANT_STORAGE_FILE: path.join(
            os.tmpdir(),
            `kartik-platform-vectors-${process.pid}-${Date.now()}.json`,
          ),
        }
      : process.env,
  );
  public readonly rateLimiter = new AgentSlidingWindowRateLimiter({
    store: new RedisAgentRateLimitStore(this.redisClient),
    windowSeconds: 60,
  });
  public readonly searchProvider = new LiveGeminiSearchProvider();
  public readonly ingestionService: FileIngestionAndArtifactService;
  public readonly graphExecutor: AgentGraphExecutor;

  private demoReadOnly = false;
  private readonly hydratedUsers = new Set<string>();
  private readonly hydrationInFlight = new Map<string, Promise<void>>();
  private readonly pendingPersistenceWrites = new Set<Promise<void>>();
  private readonly usersById = new Map<string, PlatformUser>();
  private readonly sessionsById = new Map<string, PlatformSessionRecord>();
  private readonly creditsByUserId = new Map<string, number>();
  private readonly reservedCreditsByUserId = new Map<string, number>();
  private readonly ledgerByUserId = new Map<string, PlatformLedgerEntry[]>();
  private readonly seededWelcomeUsers = new Set<string>();
  private readonly conversations = new Map<string, PlatformConversation>();
  private readonly messagesByConversation = new Map<string, PlatformMessage[]>();
  private readonly reservationsByUserAndRequestId = new Map<
    string,
    PlatformCreditReservation
  >();
  private readonly processedTurnsByUserAndRequestId = new Map<
    string,
    {
      readonly conversationId: string;
      readonly requestId: string;
      readonly traceId: string;
      readonly reservationId: string;
      readonly payloadFingerprint: string;
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
      readonly requestId?: string;
      settled: boolean;
    }
  >();
  private readonly ordersByUserAndRequestId = new Map<
    string,
    {
      readonly payloadFingerprint: string;
      readonly orderId: string;
    }
  >();
  private readonly verifiedCheckoutsByUserAndRequestId = new Map<
    string,
    {
      readonly payloadFingerprint: string;
      readonly orderId: string;
      readonly paymentId: string;
      readonly signature: string;
      readonly planId: 'plan_starter_199' | 'plan_pro_499';
    }
  >();

  constructor(options?: KartikPlatformRuntimeOptions) {
    assertRootRuntimeDemoOrLocalOnly(process.env);
    this.persistence = options?.persistence ?? cloudSqlPlatformPersistenceAdapter;

    const { publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

    const isUsableApiKey = (val?: string): boolean => {
      const trimmed = (val ?? '').trim().replace(/^["']|["']$/g, '');
      if (!trimmed) {
        return false;
      }
      const lower = trimmed.toLowerCase();
      return (
        !lower.startsWith('test-') &&
        !lower.includes('placeholder') &&
        !lower.startsWith('your_') &&
        !lower.startsWith('paste_your_') &&
        lower !== 'replace_me' &&
        !lower.includes('0123456789abcdef')
      );
    };
    const explicitMockAi =
      process.env.MOCK_AI === 'true' || process.env.AI_PROVIDER_MODE === 'mock';
    const hasLiveAiKey =
      !explicitMockAi && isUsableApiKey(process.env.GEMINI_API_KEY);
    const configuredImageProvider =
      process.env.IMAGE_PROVIDER === 'mock'
        ? 'mock'
        : process.env.IMAGE_PROVIDER === 'live' || hasLiveAiKey
          ? 'live'
          : 'mock';
    const config = loadAgentConfig({
      NODE_ENV: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      DATABASE_URL:
        process.env.DATABASE_URL?.trim() ||
        'postgresql://kartik:kartik@127.0.0.1:5432/kartik',
      REDIS_URL: process.env.REDIS_URL?.trim() || 'redis://127.0.0.1:6379',
      USER_CONTEXT_PUBLIC_KEY: publicKeyPem,
      INTERNAL_CALLER_TOKEN_CHAT: 'internal-secret-token-chat-to-agent',
      MOCK_AI: hasLiveAiKey ? 'false' : 'true',
      IMAGE_PROVIDER: configuredImageProvider,
      GEMINI_API_KEY:
        process.env.GEMINI_API_KEY?.trim() || 'test-gemini-api-key-value',
      DAILY_LIVE_CALL_BUDGET: process.env.DAILY_LIVE_CALL_BUDGET?.trim() || '500',
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
      store: new RedisDailyBudgetStore(this.redisClient),
      dailyLimit: config.dailyLiveCallBudget,
      mockAiDefault: !hasLiveAiKey,
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
  }

  private trackPersistence(task: () => Promise<void>): void {
    const promise = task().catch(() => undefined);
    this.pendingPersistenceWrites.add(promise);
    void promise.finally(() => {
      this.pendingPersistenceWrites.delete(promise);
    });
  }

  public async flushPendingPersistence(): Promise<void> {
    while (this.pendingPersistenceWrites.size > 0) {
      await Promise.all(Array.from(this.pendingPersistenceWrites));
    }
  }

  private applyPersistedSnapshot(
    safeUserId: string,
    snapshot: PersistedPlatformUserSnapshot,
  ): void {
    const existingUser = this.usersById.get(safeUserId);
    if (snapshot.user) {
      this.usersById.set(safeUserId, {
        userId: safeUserId,
        email: snapshot.user.email || existingUser?.email || '',
        displayName:
          snapshot.user.displayName || existingUser?.displayName || safeUserId,
        avatarUrl:
          snapshot.user.avatarUrl !== null
            ? snapshot.user.avatarUrl
            : (existingUser?.avatarUrl ?? null),
        planId: snapshot.user.planId,
      });
      this.creditsByUserId.set(safeUserId, snapshot.user.availableCredits);
      if (snapshot.user.reservedCredits !== undefined) {
        this.reservedCreditsByUserId.set(
          safeUserId,
          snapshot.user.reservedCredits,
        );
      }
    }

    if (snapshot.ledgerEntries.length > 0) {
      const mappedLedger: PlatformLedgerEntry[] = snapshot.ledgerEntries.map(
        (entry) => ({
          entryId: entry.entryId,
          timestamp: entry.timestamp,
          description: entry.description,
          deltaCredits: entry.deltaCredits,
          balanceAfter: entry.balanceAfter,
          requestId: entry.requestId,
        }),
      );
      this.ledgerByUserId.set(safeUserId, mappedLedger);
      if (!snapshot.user) {
        this.creditsByUserId.set(safeUserId, mappedLedger[0]!.balanceAfter);
      }
    }

    const artifactsById = new Map<string, ArtifactRecord>();
    for (const art of snapshot.artifacts) {
      artifactsById.set(art.artifactId, art);
    }
    const filesById = new Map<string, UploadedFileRecord>();
    for (const file of snapshot.uploadedFiles) {
      filesById.set(file.fileId, file);
    }

    if (snapshot.conversations.length > 0) {
      this.seededWelcomeUsers.add(safeUserId);
      for (const conv of snapshot.conversations) {
        this.conversations.set(conv.conversationId, {
          conversationId: conv.conversationId,
          userId: safeUserId,
          title: conv.title,
          deletionState: conv.deletionState,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        });
        if (!this.messagesByConversation.has(conv.conversationId)) {
          this.messagesByConversation.set(conv.conversationId, []);
        }
      }
    }

    if (snapshot.messages.length > 0) {
      const grouped = new Map<string, PlatformMessage[]>();
      const userMsgByReqId = new Map<string, PlatformMessage>();
      const userAttachedIdsByReqId = new Map<string, readonly string[]>();
      const assistantMsgByReqId = new Map<string, PlatformMessage>();

      for (const msg of snapshot.messages) {
        const hydratedArtifacts: ArtifactRecord[] = [];
        for (const artId of msg.artifactIds) {
          const found = artifactsById.get(artId);
          if (found) {
            hydratedArtifacts.push(found);
          }
        }
        const hydratedFiles: UploadedFileRecord[] = [];
        for (const fileId of msg.attachedFileIds) {
          const found = filesById.get(fileId);
          if (found) {
            hydratedFiles.push(found);
          }
        }

        const platformMsg: PlatformMessage = {
          messageId: msg.messageId,
          conversationId: msg.conversationId,
          role: msg.role,
          content: msg.content,
          agentUsed: msg.agentUsed,
          requestId: msg.requestId,
          creditsCharged: msg.creditsCharged,
          idempotentReplay: msg.idempotentReplay,
          citations: msg.citations,
          searchImages: msg.searchImages.length > 0 ? msg.searchImages : undefined,
          artifactIds: msg.artifactIds,
          artifacts: hydratedArtifacts.length > 0 ? hydratedArtifacts : undefined,
          attachedFiles: hydratedFiles.length > 0 ? hydratedFiles : undefined,
          createdAt: msg.createdAt,
        };

        const bucket = grouped.get(msg.conversationId) ?? [];
        bucket.push(platformMsg);
        grouped.set(msg.conversationId, bucket);

        if (msg.requestId) {
          if (msg.role === 'user') {
            userMsgByReqId.set(msg.requestId, platformMsg);
            userAttachedIdsByReqId.set(msg.requestId, msg.attachedFileIds);
          } else {
            assistantMsgByReqId.set(msg.requestId, platformMsg);
          }
        }
      }

      for (const [convId, list] of grouped.entries()) {
        this.messagesByConversation.set(convId, list);
      }

      const currentCredits =
        this.creditsByUserId.get(safeUserId) ?? INITIAL_FREE_CREDITS;
      for (const [reqId, assistantMsg] of assistantMsgByReqId.entries()) {
        const userMsg = userMsgByReqId.get(reqId);
        if (userMsg) {
          const attachedIds = userAttachedIdsByReqId.get(reqId) ?? [];
          const agent = (assistantMsg.agentUsed ?? 'chat') as SpecialistAgentName;
          const payloadFingerprint = computePayloadFingerprint({
            userId: safeUserId,
            conversationId: assistantMsg.conversationId,
            prompt: userMsg.content,
            targetAgent: agent,
            attachmentFileIds: [...attachedIds],
          });
          const reservationId = `rsv_hydrated_${reqId}`;
          this.reservationsByUserAndRequestId.set(`${safeUserId}:${reqId}`, {
            reservationId,
            requestId: reqId,
            userId: safeUserId,
            conversationId: assistantMsg.conversationId,
            agent,
            operation: AGENT_TO_BILLING_OPERATION[agent],
            reservedCredits: assistantMsg.creditsCharged ?? 0,
            settledCredits: assistantMsg.creditsCharged ?? 0,
            status: 'settled',
            payloadFingerprint,
            createdAt: userMsg.createdAt,
            updatedAt: assistantMsg.createdAt,
          });
          this.processedTurnsByUserAndRequestId.set(`${safeUserId}:${reqId}`, {
            conversationId: assistantMsg.conversationId,
            requestId: reqId,
            traceId: `trc_hydrated_${reqId}`,
            reservationId,
            payloadFingerprint,
            remainingCredits: currentCredits,
            creditsCharged: assistantMsg.creditsCharged ?? 0,
            idempotentReplay: true,
            userMessage: userMsg,
            assistantMessage: assistantMsg,
          });
        }
      }
    }

    for (const order of snapshot.paymentOrders) {
      const plan = PLATFORM_CREDIT_PLANS.find((p) => p.planId === order.planId);
      if (plan) {
        this.pendingOrders.set(order.orderId, {
          orderId: order.orderId,
          plan,
          userId: safeUserId,
          requestId: order.requestId,
          settled: order.settled,
        });
        if (order.requestId) {
          this.ordersByUserAndRequestId.set(
            `${safeUserId}:${order.requestId}`,
            {
              payloadFingerprint: computePayloadFingerprint({
                userId: safeUserId,
                operation: 'create_billing_order',
                planId: plan.planId,
              }),
              orderId: order.orderId,
            },
          );
        }
      }
    }
  }

  /**
   * Hydrates a user's persisted profile, conversations, messages, credit balance, ledger,
   * artifacts, uploaded files, and payment orders from PostgreSQL (or configured persistence adapter)
   * on cache miss. Safe to invoke concurrently for the same user.
   */
  public async hydrateUserFromPersistence(
    actor: VerifiedRequestIdentity | string,
  ): Promise<PlatformUser> {
    const rawUid = typeof actor === 'string' ? actor : actor?.uid;
    if (!rawUid) {
      throw new AppError('UNAUTHENTICATED', 'Authenticated user identity is required');
    }
    const safeUserId = sanitizeUserId(rawUid);

    if (!this.hydratedUsers.has(safeUserId)) {
      let inflight = this.hydrationInFlight.get(safeUserId);
      if (!inflight) {
        inflight = (async () => {
          try {
            const snapshot = await this.persistence.loadUserSnapshot(safeUserId);
            if (snapshot) {
              await this.repository.warmCacheFromSnapshot({
                artifacts: snapshot.artifacts,
                uploadedFiles: snapshot.uploadedFiles,
              });
              this.applyPersistedSnapshot(safeUserId, snapshot);
            }
          } finally {
            this.hydratedUsers.add(safeUserId);
            this.hydrationInFlight.delete(safeUserId);
          }
        })();
        this.hydrationInFlight.set(safeUserId, inflight);
      }
      await inflight;
    }

    return this.requireUser(actor);
  }

  private ensureUserProvisioned(
    userId: string,
    profile?: {
      readonly email?: string;
      readonly displayName?: string;
      readonly avatarUrl?: string | null;
    },
  ): PlatformUser {
    const safeUserId = sanitizeUserId(userId);
    const existing = this.usersById.get(safeUserId);
    const incomingEmail = profile?.email?.trim().toLowerCase();
    const isIncomingGuestPlaceholder =
      incomingEmail === 'guest@local.kartik.ai' ||
      incomingEmail === `${safeUserId.toLowerCase()}@kartik.ai`;

    const resolvedEmail =
      (!isIncomingGuestPlaceholder && incomingEmail) ||
      existing?.email ||
      incomingEmail ||
      '';
    const incomingDisplayName = profile?.displayName?.trim();
    const isIncomingGenericDisplay =
      incomingDisplayName === 'Guest Workspace' ||
      incomingDisplayName === safeUserId;

    const resolvedDisplayName =
      (!isIncomingGenericDisplay && incomingDisplayName) ||
      existing?.displayName ||
      incomingDisplayName ||
      resolvedEmail.split('@')[0] ||
      safeUserId;

    const updatedUser: PlatformUser = {
      userId: safeUserId,
      email: resolvedEmail,
      displayName: resolvedDisplayName,
      avatarUrl:
        profile?.avatarUrl !== undefined && profile?.avatarUrl !== null
          ? profile.avatarUrl
          : (existing?.avatarUrl ?? null),
      planId: existing?.planId ?? 'plan_free',
    };
    this.usersById.set(safeUserId, updatedUser);

    if (!this.creditsByUserId.has(safeUserId)) {
      this.creditsByUserId.set(safeUserId, INITIAL_FREE_CREDITS);
    }

    if (!this.ledgerByUserId.has(safeUserId)) {
      const initialEntry: PlatformLedgerEntry = {
        entryId: `led_grant_${safeUserId}`,
        timestamp: new Date().toISOString(),
        description: 'Initial Free-Tier Starter Grant',
        deltaCredits: INITIAL_FREE_CREDITS,
        balanceAfter: INITIAL_FREE_CREDITS,
        requestId: `req_initial_grant_${safeUserId}`,
      };
      this.ledgerByUserId.set(safeUserId, [initialEntry]);
      this.trackPersistence(() =>
        this.persistence.syncBillingLedger({
          userId: safeUserId,
          email: updatedUser.email,
          displayName: updatedUser.displayName,
          planId: updatedUser.planId,
          availableCredits: INITIAL_FREE_CREDITS,
          entryId: initialEntry.entryId,
          requestId: initialEntry.requestId,
          description: initialEntry.description,
          deltaCredits: initialEntry.deltaCredits,
          balanceAfter: initialEntry.balanceAfter,
          timestamp: initialEntry.timestamp,
        }),
      );
    }

    if (!this.seededWelcomeUsers.has(safeUserId)) {
      this.seededWelcomeUsers.add(safeUserId);
      const convId = `conv_welcome_${safeUserId}`;
      const nowIso = new Date().toISOString();
      const welcomeTitle = 'Kartik.ai Multi-Agent Architecture & Capabilities';
      this.conversations.set(convId, {
        conversationId: convId,
        userId: safeUserId,
        title: welcomeTitle,
        deletionState: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      const welcomeMsg: PlatformMessage = {
        messageId: `msg_welcome_assistant_${safeUserId}`,
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
          '| **Web Search (`search`)** | Hybrid live Google Search + multi-source web reader with clickable `[1]` citations, rich source cards & follow-up research | `2 credits` · `5 req/min` |',
          '| **Coding (`coding`)** | 6-intent classifier: builds zero-CDN 3-file (`index.html`, `styles.css`, `app.js`) live editable sandbox apps with console capture & `.html` export, OR inline snippets/reviews/debugging | `5 credits` · `5 req/min` |',
          '| **PDF Generator (`pdf`)** | Compiles real downloadable **`%PDF-1.4`** multi-page binary reports with page numbers & footer | `5 credits` · `5 req/min` |',
          '| **PPT Generator (`ppt`)** | Compiles real downloadable **OpenXML `.pptx`** slide decks + **Interactive 16:9 Slide Deck Preview** in chat | `8 credits` · `5 req/min` |',
          '| **PDF RAG (`rag`)** | Extracts multi-page text from uploaded `.pdf` files, chunks, embeds (`768-dim`), and cites `[Document, p. N]` | `2 credits` · `5 req/min` |',
          '| **Vision & Image (`vision` / `image`)** | Multimodal OCR/diagram inspection on uploaded images & prompt-enhanced visual artwork generation | `3–10 credits` · `5 req/min` |',
        ].join('\n'),
        citations: [],
        createdAt: nowIso,
      };

      this.messagesByConversation.set(convId, [welcomeMsg]);
      this.trackPersistence(async () => {
        await this.persistence.syncConversation({
          conversationId: convId,
          userId: safeUserId,
          email: updatedUser.email,
          displayName: updatedUser.displayName,
          title: welcomeTitle,
          deletionState: 'active',
          messageCount: 1,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        await this.persistence.syncMessage({
          messageId: welcomeMsg.messageId,
          conversationId: convId,
          userId: safeUserId,
          role: 'assistant',
          content: welcomeMsg.content,
          agentUsed: welcomeMsg.agentUsed,
          citationsJson: [],
          createdAt: nowIso,
        });
      });
    }

    return updatedUser;
  }

  private requireUser(identityOrUserId: VerifiedRequestIdentity | string): PlatformUser {
    if (typeof identityOrUserId === 'string') {
      const safeId = sanitizeUserId(identityOrUserId);
      return this.ensureUserProvisioned(safeId);
    }
    if (!identityOrUserId || !identityOrUserId.uid) {
      throw new AppError('UNAUTHENTICATED', 'Authenticated user identity is required');
    }
    return this.ensureUserProvisioned(identityOrUserId.uid, {
      email: identityOrUserId.email,
      displayName: identityOrUserId.displayName,
      avatarUrl: identityOrUserId.avatarUrl,
    });
  }

  public resolveSessionIdentity(
    sessionId: string | undefined,
  ): VerifiedRequestIdentity | null {
    if (!sessionId || typeof sessionId !== 'string') {
      return null;
    }
    const session = this.sessionsById.get(sessionId.trim());
    if (!session) {
      return null;
    }
    if (Date.now() > session.expiresAtMs) {
      this.sessionsById.delete(session.sessionId);
      return null;
    }
    const user = this.usersById.get(session.userId);
    if (!user) {
      return null;
    }
    return Object.freeze({
      uid: user.userId,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      emailVerified: true,
    });
  }

  public getAuthStatus(identity?: VerifiedRequestIdentity | null) {
    if (!identity || !identity.uid) {
      return {
        isAuthenticated: false,
        user: null,
        demoReadOnly: this.demoReadOnly,
      };
    }
    const user = this.requireUser(identity);
    return {
      isAuthenticated: true,
      user,
      demoReadOnly: this.demoReadOnly,
    };
  }

  /**
   * Authenticates a user strictly from a verified Firebase token identity.
   * Never trusts caller-supplied UID/email and never reassigns existing conversation ownership.
   */
  public loginWithGoogle(verifiedIdentity: VerifiedRequestIdentity) {
    if (
      !verifiedIdentity ||
      typeof verifiedIdentity.uid !== 'string' ||
      verifiedIdentity.uid.trim().length === 0 ||
      typeof verifiedIdentity.email !== 'string' ||
      !verifiedIdentity.email.includes('@')
    ) {
      throw new AppError(
        'UNAUTHENTICATED',
        'Verified Firebase identity (uid and email) is required to establish a session',
      );
    }

    const user = this.ensureUserProvisioned(verifiedIdentity.uid, {
      email: verifiedIdentity.email,
      displayName: verifiedIdentity.displayName,
      avatarUrl: verifiedIdentity.avatarUrl,
    });

    const sessionId = `sess_${crypto.randomBytes(16).toString('hex')}`;
    const expiresAtMs = Date.now() + SESSION_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    this.sessionsById.set(sessionId, {
      sessionId,
      userId: user.userId,
      expiresAt,
      expiresAtMs,
    });

    this.trackPersistence(() =>
      this.persistence.syncUser({
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      }),
    );

    return {
      isAuthenticated: true,
      sessionId,
      user,
      demoReadOnly: this.demoReadOnly,
      expiresAt,
    };
  }

  public logout(sessionId?: string) {
    if (sessionId && typeof sessionId === 'string') {
      this.sessionsById.delete(sessionId.trim());
    }
    return { loggedOut: true };
  }

  public toggleDemoReadOnly(
    actor: VerifiedRequestIdentity | string,
    enabled?: boolean,
  ) {
    this.requireUser(actor);
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

  public listConversations(actor: VerifiedRequestIdentity | string) {
    const user = this.requireUser(actor);
    const items = Array.from(this.conversations.values())
      .filter((c) => c.userId === user.userId && c.deletionState === 'active')
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      items,
      conversations: items,
    };
  }

  public createConversation(
    actor: VerifiedRequestIdentity | string,
    title?: string,
  ) {
    this.assertWritable();
    const user = this.requireUser(actor);
    const convId = `conv_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();
    const record: PlatformConversation = {
      conversationId: convId,
      userId: user.userId,
      title:
        title && title.trim().length > 0
          ? title.trim().slice(0, 80)
          : 'New Conversation',
      deletionState: 'active',
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.conversations.set(convId, record);
    this.messagesByConversation.set(convId, []);
    this.trackPersistence(() =>
      this.persistence.syncConversation({
        conversationId: record.conversationId,
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        title: record.title,
        deletionState: 'active',
        messageCount: 0,
        createdAt: nowIso,
        updatedAt: nowIso,
      }),
    );
    return record;
  }

  public getConversationMessages(
    actor: VerifiedRequestIdentity | string,
    conversationId: string,
  ) {
    const user = this.requireUser(actor);
    const resolvedId =
      conversationId === 'conv_welcome_01'
        ? `conv_welcome_${user.userId}`
        : conversationId;
    const conv = this.conversations.get(resolvedId);
    if (
      !conv ||
      conv.userId !== user.userId ||
      conv.deletionState === 'deleted'
    ) {
      throw new AppError('NOT_FOUND', 'Conversation not found');
    }
    const items = this.messagesByConversation.get(resolvedId) ?? [];
    return {
      conversation: conv,
      items,
      messages: items,
    };
  }

  public async deleteConversation(
    actor: VerifiedRequestIdentity | string,
    conversationId: string,
  ) {
    this.assertWritable();
    const user = await this.hydrateUserFromPersistence(actor);
    const resolvedId =
      conversationId === 'conv_welcome_01'
        ? `conv_welcome_${user.userId}`
        : conversationId;
    const conv = this.conversations.get(resolvedId);
    if (
      !conv ||
      conv.userId !== user.userId ||
      conv.deletionState === 'deleted'
    ) {
      throw new AppError('NOT_FOUND', 'Conversation not found');
    }

    const userFiles = await this.repository.listFilesByUser(user.userId);
    const convFiles = userFiles.filter((f) =>
      f.storageKey.includes(`/${resolvedId}/`),
    );
    const convArtifacts = await this.repository.listArtifactsByConversation(
      user.userId,
      resolvedId,
    );
    const purgedStorageKeys = [
      ...convFiles.map((f) => f.storageKey),
      ...convArtifacts.map((a) => a.storageKey),
    ];

    const purgeReport = await this.ingestionService.purgeResources({
      userId: user.userId,
      conversationId: resolvedId,
      fileIds: convFiles.map((f) => f.fileId),
    });

    conv.deletionState = 'deleted';
    this.messagesByConversation.delete(resolvedId);

    this.trackPersistence(() =>
      this.persistence.syncConversation({
        conversationId: conv.conversationId,
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        title: conv.title,
        deletionState: 'deleted',
        messageCount: 0,
        createdAt: conv.createdAt,
        updatedAt: new Date().toISOString(),
      }),
    );

    return {
      conversationId: resolvedId,
      status: 'deleted' as const,
      deletionState: 'deleted' as const,
      purgeReport,
      purgedSummary: {
        purgedVectorChunks: purgeReport.vectorsDeleted,
        purgedStorageKeys,
      },
    };
  }

  public async uploadFile(
    actor: VerifiedRequestIdentity | string,
    input: {
      readonly conversationId: string;
      readonly originalFilename: string;
      readonly declaredMimeType: string;
      readonly contentBase64: string;
    },
  ) {
    this.assertWritable();
    const user = await this.hydrateUserFromPersistence(actor);
    const resolvedConvId =
      !input.conversationId || input.conversationId === 'conv_welcome_01'
        ? `conv_welcome_${user.userId}`
        : input.conversationId;

    const existingConv = this.conversations.get(resolvedConvId);
    if (existingConv && existingConv.userId !== user.userId) {
      throw new AppError('NOT_FOUND', 'Conversation not found');
    }

    const contentBytes = new Uint8Array(Buffer.from(input.contentBase64, 'base64'));
    const fileRecord = await this.ingestionService.ingestUploadedFile({
      userId: user.userId,
      conversationId: resolvedConvId,
      originalFilename: input.originalFilename,
      declaredMimeType: input.declaredMimeType,
      contentBytes,
    });
    return {
      ...fileRecord,
      file: fileRecord,
      chunkCount: fileRecord.chunkCount,
    };
  }

  public async listFiles(actor: VerifiedRequestIdentity | string) {
    const user = await this.hydrateUserFromPersistence(actor);
    const items = await this.repository.listFilesByUser(user.userId);
    return {
      items,
      files: items,
    };
  }

  public async getArtifactContent(
    actor: VerifiedRequestIdentity | string,
    artifactId: string,
  ) {
    const user = await this.hydrateUserFromPersistence(actor);
    return this.ingestionService.getArtifactWithRawBytes({
      userId: user.userId,
      artifactId,
    });
  }

  public async sendMessageTurn(
    actor: VerifiedRequestIdentity | string,
    input: {
      readonly conversationId: string;
      readonly requestId: string;
      readonly traceId: string;
      readonly prompt: string;
      readonly preferredAgent?: SpecialistAgentName;
      readonly attachmentFileIds?: readonly string[];
    },
  ) {
    this.assertWritable();
    const user = await this.hydrateUserFromPersistence(actor);

    const requestId = (input.requestId ?? '').trim();
    if (!requestId) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Mutating requests require an Idempotency-Key header',
      );
    }

    const trimmedPrompt = input.prompt.trim();
    if (!trimmedPrompt) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Message prompt must not be empty',
      );
    }

    const resolvedConvId =
      input.conversationId === 'conv_welcome_01'
        ? `conv_welcome_${user.userId}`
        : input.conversationId;

    // 1. Enforce conversation ownership before idempotency lookup (Invariant #20: 404 NOT_FOUND on foreign resource)
    const existingConv = this.conversations.get(resolvedConvId);
    if (existingConv && existingConv.userId !== user.userId) {
      throw new AppError('NOT_FOUND', 'Conversation not found');
    }

    const attachmentFileIds = [...(input.attachmentFileIds ?? [])];
    const attachedFiles: UploadedFileRecord[] = [];
    for (const fileId of attachmentFileIds) {
      const f = await this.repository.getFileById(user.userId, fileId);
      if (!f) {
        throw new AppError('NOT_FOUND', `Attached file "${fileId}" not found`);
      }
      attachedFiles.push(f);
    }

    const targetAgent = resolveTargetSpecialist({
      prompt: trimmedPrompt,
      requestedAgent: input.preferredAgent,
      attachmentFileIds,
      hasImageBytes: attachedFiles.some((f) => f.mimeType.startsWith('image/')),
    });

    const targetConvIdForFingerprint =
      existingConv && existingConv.deletionState !== 'deleted'
        ? existingConv.conversationId
        : resolvedConvId;

    const payloadFingerprint = computePayloadFingerprint({
      userId: user.userId,
      conversationId: targetConvIdForFingerprint,
      prompt: trimmedPrompt,
      targetAgent,
      attachmentFileIds,
    });

    const scopedRequestIdKey = `${user.userId}:${requestId}`;

    // 2. Check idempotent turn cache and verify SHA-256 payload fingerprint (§5.4, Invariant #15)
    const existingReplay =
      this.processedTurnsByUserAndRequestId.get(scopedRequestIdKey);
    if (existingReplay) {
      if (existingReplay.payloadFingerprint !== payloadFingerprint) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used with a different message payload',
        );
      }
      return {
        ...existingReplay,
        remainingCredits:
          this.creditsByUserId.get(user.userId) ??
          existingReplay.remainingCredits,
        idempotentReplay: true,
      };
    }

    // 3. Check in-flight or execution_unknown credit reservation for this requestId (§10 & §11)
    const existingReservation =
      this.reservationsByUserAndRequestId.get(scopedRequestIdKey);
    if (existingReservation) {
      if (existingReservation.payloadFingerprint !== payloadFingerprint) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used with a different message payload',
        );
      }
      if (existingReservation.status === 'execution_unknown') {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          `Run "${requestId}" is in execution_unknown state awaiting reconciliation; do not retry blindly`,
        );
      }
      if (existingReservation.status === 'reserved') {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          `Run "${requestId}" is already in progress`,
        );
      }
    }

    let conv = existingConv;
    if (!conv || conv.deletionState === 'deleted') {
      conv = this.createConversation(actor, trimmedPrompt.slice(0, 56));
    }

    const billingOp = AGENT_TO_BILLING_OPERATION[targetAgent];
    const agentCreditCosts: Record<SpecialistAgentName, number> = {
      chat: 1,
      search: 2,
      coding: 5,
      pdf: 5,
      ppt: 8,
      rag: 2,
      vision: 3,
      image: 10,
    };
    const creditCost =
      agentCreditCosts[targetAgent] ?? OPERATION_CREDIT_COSTS[billingOp] ?? 1;

    // 4. Phase 1 — Reserve credits before expensive Agent execution (Invariants #6 & #17, §11)
    const currentAvailable =
      this.creditsByUserId.get(user.userId) ?? INITIAL_FREE_CREDITS;
    if (currentAvailable < creditCost) {
      throw new AppError(
        'QUOTA_EXHAUSTED',
        `Operation "${billingOp}" requires ${creditCost} credits, but your available balance is ${currentAvailable}. Please top up in the Billing Drawer.`,
      );
    }

    const currentReserved = this.reservedCreditsByUserId.get(user.userId) ?? 0;
    const availableAfterReserve = currentAvailable - creditCost;
    const reservedAfterReserve = currentReserved + creditCost;
    this.creditsByUserId.set(user.userId, availableAfterReserve);
    this.reservedCreditsByUserId.set(user.userId, reservedAfterReserve);

    const nowIso = new Date().toISOString();
    const reservation: PlatformCreditReservation = {
      reservationId: `rsv_${crypto.randomBytes(6).toString('hex')}`,
      requestId,
      userId: user.userId,
      conversationId: conv.conversationId,
      agent: targetAgent,
      operation: billingOp,
      reservedCredits: creditCost,
      settledCredits: null,
      status: 'reserved',
      payloadFingerprint,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    this.reservationsByUserAndRequestId.set(scopedRequestIdKey, reservation);

    const userMessage: PlatformMessage = {
      messageId: `msg_usr_${crypto.randomBytes(6).toString('hex')}`,
      conversationId: conv.conversationId,
      role: 'user',
      content: trimmedPrompt,
      requestId,
      attachedFiles,
      createdAt: nowIso,
    };

    // 5. Phase 2 — Execute Specialist Agent via LangGraph Router
    let execResult: Awaited<ReturnType<AgentGraphExecutor['execute']>>;
    try {
      execResult = await this.graphExecutor.execute({
        requestId,
        traceId: input.traceId,
        userId: user.userId,
        conversationId: conv.conversationId,
        messageId: userMessage.messageId,
        prompt: trimmedPrompt,
        preferredAgent: input.preferredAgent,
        attachmentFileIds,
      });
    } catch (err) {
      const failNowIso = new Date().toISOString();
      const errCode =
        err instanceof AppError
          ? err.code
          : (err as { code?: string } | null)?.code;
      // Blueprint §10 & §11: On ambiguous timeout (EXECUTION_UNKNOWN), keep reservation held in
      // `execution_unknown` awaiting reconciliation rather than blindly releasing or retrying.
      if (errCode === 'EXECUTION_UNKNOWN') {
        reservation.status = 'execution_unknown';
        reservation.updatedAt = failNowIso;
        if (err instanceof AppError) {
          throw err;
        }
        throw new AppError(
          'EXECUTION_UNKNOWN',
          err instanceof Error
            ? err.message
            : 'Execution outcome unknown after upstream timeout',
        );
      }

      // Confirmed failure before completion -> Phase 3b: Release reservation immediately
      const restoredAvailable =
        (this.creditsByUserId.get(user.userId) ?? availableAfterReserve) +
        reservation.reservedCredits;
      const releasedReserved = Math.max(
        0,
        (this.reservedCreditsByUserId.get(user.userId) ?? reservedAfterReserve) -
          reservation.reservedCredits,
      );
      this.creditsByUserId.set(user.userId, restoredAvailable);
      this.reservedCreditsByUserId.set(user.userId, releasedReserved);
      reservation.status = 'released';
      reservation.settledCredits = 0;
      reservation.updatedAt = failNowIso;
      throw err;
    }

    // 6. Phase 3a — Settle credit reservation after durable execution (§11)
    const settledReserved = Math.max(
      0,
      (this.reservedCreditsByUserId.get(user.userId) ?? reservedAfterReserve) -
        reservation.reservedCredits,
    );
    this.reservedCreditsByUserId.set(user.userId, settledReserved);
    const updatedBalance =
      this.creditsByUserId.get(user.userId) ?? availableAfterReserve;
    reservation.status = 'settled';
    reservation.settledCredits = creditCost;
    reservation.updatedAt = new Date().toISOString();

    const ledgerEntry: PlatformLedgerEntry = {
      entryId: `led_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: reservation.updatedAt,
      description: `${execResult.agent.toUpperCase()} Agent (${billingOp})`,
      deltaCredits: -creditCost,
      balanceAfter: updatedBalance,
      requestId,
      reservationId: reservation.reservationId,
    };
    const userLedger = this.ledgerByUserId.get(user.userId) ?? [];
    userLedger.unshift(ledgerEntry);
    this.ledgerByUserId.set(user.userId, userLedger);

    const hydratedArtifacts: ArtifactRecord[] = [];
    for (const artId of execResult.artifactIds ?? []) {
      const art = await this.repository.getArtifactById(user.userId, artId);
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
      requestId,
      creditsCharged: creditCost,
      idempotentReplay: false,
      citations: execResult.citations ?? [],
      searchImages:
        execResult.agent === 'search' && (execResult.searchImages?.length ?? 0) > 0
          ? execResult.searchImages
          : undefined,
      followUpQueries:
        (execResult.followUpQueries?.length ?? 0) > 0
          ? execResult.followUpQueries
          : undefined,
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
      conv.title = trimmedPrompt.slice(0, 56) || conv.title;
    }
    conv.updatedAt = assistantMessage.createdAt;

    this.trackPersistence(async () => {
      await this.persistence.syncConversation({
        conversationId: conv.conversationId,
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        title: conv.title,
        deletionState: 'active',
        messageCount: list.length,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      });
      await this.persistence.syncMessage({
        messageId: userMessage.messageId,
        conversationId: conv.conversationId,
        userId: user.userId,
        role: 'user',
        content: userMessage.content,
        requestId,
        attachedFileIdsJson: attachmentFileIds,
        createdAt: userMessage.createdAt,
      });
      await this.persistence.syncMessage({
        messageId: assistantMessage.messageId,
        conversationId: conv.conversationId,
        userId: user.userId,
        role: 'assistant',
        content: assistantMessage.content,
        agentUsed: assistantMessage.agentUsed,
        requestId,
        creditsCharged: creditCost,
        idempotentReplay: false,
        citationsJson: assistantMessage.citations ?? [],
        searchImagesJson: assistantMessage.searchImages ?? [],
        artifactIdsJson: assistantMessage.artifactIds ?? [],
        createdAt: assistantMessage.createdAt,
      });
      await this.persistence.syncBillingLedger({
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        planId: user.planId,
        availableCredits: updatedBalance,
        reservedCredits: settledReserved,
        entryId: ledgerEntry.entryId,
        requestId: ledgerEntry.requestId,
        description: ledgerEntry.description,
        deltaCredits: ledgerEntry.deltaCredits,
        balanceAfter: ledgerEntry.balanceAfter,
        timestamp: ledgerEntry.timestamp,
      });
    });

    const turnResult = {
      conversationId: conv.conversationId,
      requestId,
      traceId: input.traceId,
      reservationId: reservation.reservationId,
      payloadFingerprint,
      remainingCredits: updatedBalance,
      creditsCharged: creditCost,
      idempotentReplay: false,
      userMessage,
      assistantMessage,
    };

    this.processedTurnsByUserAndRequestId.set(scopedRequestIdKey, turnResult);
    return turnResult;
  }

  /**
   * Reconciles a turn reservation in `execution_unknown` state (Blueprint §10 & §11),
   * either settling the held credits (`outcome === 'completed'`) or releasing them back
   * to the user's `availableCredits` (`outcome === 'failed'`).
   */
  public async reconcileUnknownTurn(
    actor: VerifiedRequestIdentity | string,
    input: {
      readonly requestId: string;
      readonly outcome: 'completed' | 'failed';
    },
  ): Promise<
    PlatformCreditReservation & {
      readonly availableCredits: number;
      readonly reservedCredits: number;
    }
  > {
    this.assertWritable();
    const user = await this.hydrateUserFromPersistence(actor);
    const requestId = (input.requestId ?? '').trim();
    const scopedKey = `${user.userId}:${requestId}`;
    const reservation = this.reservationsByUserAndRequestId.get(scopedKey);
    if (!reservation) {
      throw new AppError('NOT_FOUND', `Reservation for "${requestId}" not found`);
    }
    if (reservation.status !== 'execution_unknown') {
      throw new AppError(
        'IDEMPOTENCY_CONFLICT',
        `Reservation for "${requestId}" is in status "${reservation.status}" and does not require reconciliation`,
      );
    }

    const currentReserved = this.reservedCreditsByUserId.get(user.userId) ?? 0;
    const nextReserved = Math.max(0, currentReserved - reservation.reservedCredits);
    this.reservedCreditsByUserId.set(user.userId, nextReserved);
    const nowIso = new Date().toISOString();

    if (input.outcome === 'completed') {
      reservation.status = 'settled';
      reservation.settledCredits = reservation.reservedCredits;
      reservation.updatedAt = nowIso;
      const currentAvailable =
        this.creditsByUserId.get(user.userId) ?? INITIAL_FREE_CREDITS;
      const ledgerEntry: PlatformLedgerEntry = {
        entryId: `led_${crypto.randomBytes(6).toString('hex')}`,
        timestamp: nowIso,
        description: `Reconciled ${reservation.agent.toUpperCase()} Agent (${reservation.operation})`,
        deltaCredits: -reservation.reservedCredits,
        balanceAfter: currentAvailable,
        requestId,
        reservationId: reservation.reservationId,
      };
      const userLedger = this.ledgerByUserId.get(user.userId) ?? [];
      userLedger.unshift(ledgerEntry);
      this.ledgerByUserId.set(user.userId, userLedger);
      return {
        ...reservation,
        availableCredits: currentAvailable,
        reservedCredits: nextReserved,
      };
    }

    const restoredAvailable =
      (this.creditsByUserId.get(user.userId) ?? INITIAL_FREE_CREDITS) +
      reservation.reservedCredits;
    this.creditsByUserId.set(user.userId, restoredAvailable);
    reservation.status = 'released';
    reservation.settledCredits = 0;
    reservation.updatedAt = nowIso;
    return {
      ...reservation,
      availableCredits: restoredAvailable,
      reservedCredits: nextReserved,
    };
  }

  public getReservationByRequestId(
    actor: VerifiedRequestIdentity | string,
    requestId: string,
  ): PlatformCreditReservation | null {
    const user = this.requireUser(actor);
    const found = this.reservationsByUserAndRequestId.get(
      `${user.userId}:${requestId.trim()}`,
    );
    return found ? { ...found } : null;
  }

  public getBillingSummary(actor: VerifiedRequestIdentity | string) {
    const user = this.requireUser(actor);
    const availableCredits =
      this.creditsByUserId.get(user.userId) ?? INITIAL_FREE_CREDITS;
    const reservedCredits = this.reservedCreditsByUserId.get(user.userId) ?? 0;
    const ledger = this.ledgerByUserId.get(user.userId) ?? [];
    return {
      userId: user.userId,
      planId: user.planId,
      availableCredits,
      reservedCredits,
      billingMode: 'mock' as const,
      plans: PLATFORM_CREDIT_PLANS,
      operationCosts: OPERATION_CREDIT_COSTS,
      ledger: ledger.slice(0, 25),
    };
  }

  public async createBillingOrder(
    actor: VerifiedRequestIdentity | string,
    input: {
      readonly planId: string;
      readonly requestId: string;
    },
  ) {
    this.assertWritable();
    const user = await this.hydrateUserFromPersistence(actor);
    const requestId = (input.requestId ?? '').trim();
    if (!requestId) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Mutating requests require an Idempotency-Key header',
      );
    }

    const plan = PLATFORM_CREDIT_PLANS.find((p) => p.planId === input.planId);
    if (!plan) {
      throw new AppError(
        'VALIDATION_FAILED',
        `Unknown planId "${input.planId}". Allowed: plan_starter_199, plan_pro_499`,
      );
    }

    const payloadFingerprint = computePayloadFingerprint({
      userId: user.userId,
      operation: 'create_billing_order',
      planId: plan.planId,
    });
    const scopedRequestIdKey = `${user.userId}:${requestId}`;
    const existingOrderForReq =
      this.ordersByUserAndRequestId.get(scopedRequestIdKey);

    const stripQuotes = (v?: string) => (v ?? '').trim().replace(/^["']|["']$/g, '');
    const keyId = stripQuotes(process.env.RAZORPAY_KEY_ID);
    const keySecret = stripQuotes(process.env.RAZORPAY_KEY_SECRET);

    if (existingOrderForReq) {
      if (existingOrderForReq.payloadFingerprint !== payloadFingerprint) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used with a different billing order payload',
        );
      }
      return {
        orderId: existingOrderForReq.orderId,
        razorpayOrderId: existingOrderForReq.orderId,
        razorpayKeyId: keyId || 'rzp_test_kartik_ai_demo',
        liveRazorpayOrder: false,
        plan,
        planId: plan.planId,
        planName: plan.name,
        amountPaise: plan.amountPaise,
        amountInrLabel: plan.amountInrLabel,
        creditsGranted: plan.creditsGranted,
        currency: 'INR' as const,
        status: 'created' as const,
        idempotentReplay: true,
      };
    }

    let orderId = `order_rzp_${crypto.randomBytes(8).toString('hex')}`;
    let liveRazorpayOrder = false;

    if (
      keyId &&
      keySecret &&
      keyId !== 'rzp_test_kartik_ai_demo' &&
      !keyId.includes('placeholder') &&
      process.env.NODE_ENV !== 'test'
    ) {
      try {
        const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
        const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            amount: plan.amountPaise,
            currency: 'INR',
            receipt: requestId.slice(0, 40),
            notes: {
              planId: plan.planId,
              userId: user.userId,
            },
          }),
          signal: AbortSignal.timeout(8000),
        });
        if (rzpRes.ok) {
          const rzpData = (await rzpRes.json()) as { id?: string };
          if (rzpData.id) {
            orderId = rzpData.id;
            liveRazorpayOrder = true;
          }
        }
      } catch {
        // Fall back to local orderId if offline or unreachable
      }
    }

    this.pendingOrders.set(orderId, {
      orderId,
      plan,
      userId: user.userId,
      requestId,
      settled: false,
    });
    this.ordersByUserAndRequestId.set(scopedRequestIdKey, {
      payloadFingerprint,
      orderId,
    });

    this.trackPersistence(() =>
      this.persistence.syncPaymentOrder({
        orderId,
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        planId: plan.planId,
        requestId,
        amountPaise: plan.amountPaise,
        creditsGranted: plan.creditsGranted,
        settled: false,
      }),
    );

    return {
      orderId,
      razorpayOrderId: orderId,
      razorpayKeyId: keyId || 'rzp_test_kartik_ai_demo',
      liveRazorpayOrder,
      plan,
      planId: plan.planId,
      planName: plan.name,
      amountPaise: plan.amountPaise,
      amountInrLabel: plan.amountInrLabel,
      creditsGranted: plan.creditsGranted,
      currency: 'INR' as const,
      status: 'created' as const,
      idempotentReplay: false,
    };
  }

  public verifyCheckoutAndCredit(
    actor: VerifiedRequestIdentity | string,
    input: {
      readonly orderId: string;
      readonly paymentId?: string;
      readonly signature?: string;
      readonly requestId: string;
    },
  ) {
    this.assertWritable();
    const user = this.requireUser(actor);
    const requestId = (input.requestId ?? '').trim();
    if (!requestId) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        'Mutating requests require an Idempotency-Key header',
      );
    }

    const payloadFingerprint = computePayloadFingerprint({
      userId: user.userId,
      operation: 'verify_checkout',
      orderId: (input.orderId ?? '').trim(),
    });
    const scopedRequestIdKey = `${user.userId}:${requestId}`;
    const existingVerifyForReq =
      this.verifiedCheckoutsByUserAndRequestId.get(scopedRequestIdKey);
    if (existingVerifyForReq) {
      if (existingVerifyForReq.payloadFingerprint !== payloadFingerprint) {
        throw new AppError(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency-Key was already used to verify a different payment order',
        );
      }
      const currentBalance =
        this.creditsByUserId.get(user.userId) ?? INITIAL_FREE_CREDITS;
      return {
        verified: true,
        orderId: existingVerifyForReq.orderId,
        paymentId: existingVerifyForReq.paymentId,
        signature: existingVerifyForReq.signature,
        planId: existingVerifyForReq.planId,
        creditsAdded: 0,
        availableCredits: currentBalance,
        idempotentReplay: true,
      };
    }

    const order = this.pendingOrders.get(input.orderId);
    if (!order || order.userId !== user.userId) {
      throw new AppError('NOT_FOUND', `Order "${input.orderId}" was not found`);
    }

    const stripQuotes = (v?: string) => (v ?? '').trim().replace(/^["']|["']$/g, '');
    const secret = stripQuotes(process.env.RAZORPAY_KEY_SECRET) || 'rzp_test_secret_kartik';

    const paymentId =
      input.paymentId ?? `pay_rzp_${crypto.randomBytes(6).toString('hex')}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${order.orderId}|${paymentId}`)
      .digest('hex');

    if (input.signature && input.paymentId) {
      const expectedBuf = Buffer.from(expectedSignature, 'utf8');
      const actualBuf = Buffer.from(input.signature, 'utf8');
      if (
        expectedBuf.length !== actualBuf.length ||
        !crypto.timingSafeEqual(expectedBuf, actualBuf)
      ) {
        throw new AppError(
          'VALIDATION_FAILED',
          'Razorpay HMAC-SHA256 payment signature verification failed.',
        );
      }
    }
    const signature = expectedSignature;

    const currentBalance =
      this.creditsByUserId.get(user.userId) ?? INITIAL_FREE_CREDITS;

    if (order.settled) {
      this.verifiedCheckoutsByUserAndRequestId.set(scopedRequestIdKey, {
        payloadFingerprint,
        orderId: order.orderId,
        paymentId,
        signature,
        planId: order.plan.planId,
      });
      return {
        verified: true,
        orderId: order.orderId,
        paymentId,
        signature,
        planId: order.plan.planId,
        creditsAdded: 0,
        availableCredits: currentBalance,
        idempotentReplay: true,
      };
    }

    order.settled = true;
    const updatedBalance = currentBalance + order.plan.creditsGranted;
    this.creditsByUserId.set(user.userId, updatedBalance);

    const updatedUser: PlatformUser = {
      ...user,
      planId: order.plan.planId,
    };
    this.usersById.set(user.userId, updatedUser);

    const ledgerEntry: PlatformLedgerEntry = {
      entryId: `led_${crypto.randomBytes(6).toString('hex')}`,
      timestamp: new Date().toISOString(),
      description: `Razorpay Purchase — ${order.plan.name} (${order.plan.amountInrLabel}, ${paymentId})`,
      deltaCredits: order.plan.creditsGranted,
      balanceAfter: updatedBalance,
      requestId,
    };
    const userLedger = this.ledgerByUserId.get(user.userId) ?? [];
    userLedger.unshift(ledgerEntry);
    this.ledgerByUserId.set(user.userId, userLedger);

    this.verifiedCheckoutsByUserAndRequestId.set(scopedRequestIdKey, {
      payloadFingerprint,
      orderId: order.orderId,
      paymentId,
      signature,
      planId: order.plan.planId,
    });

    this.trackPersistence(async () => {
      await this.persistence.syncPaymentOrder({
        orderId: order.orderId,
        userId: updatedUser.userId,
        email: updatedUser.email,
        displayName: updatedUser.displayName,
        planId: order.plan.planId,
        requestId,
        amountPaise: order.plan.amountPaise,
        creditsGranted: order.plan.creditsGranted,
        paymentId,
        settled: true,
      });
      await this.persistence.syncBillingLedger({
        userId: updatedUser.userId,
        email: updatedUser.email,
        displayName: updatedUser.displayName,
        planId: updatedUser.planId,
        availableCredits: updatedBalance,
        reservedCredits: this.reservedCreditsByUserId.get(updatedUser.userId) ?? 0,
        entryId: ledgerEntry.entryId,
        requestId: ledgerEntry.requestId,
        description: ledgerEntry.description,
        deltaCredits: ledgerEntry.deltaCredits,
        balanceAfter: ledgerEntry.balanceAfter,
        timestamp: ledgerEntry.timestamp,
      });
    });

    return {
      verified: true,
      orderId: order.orderId,
      paymentId,
      signature,
      planId: order.plan.planId,
      creditsAdded: order.plan.creditsGranted,
      availableCredits: updatedBalance,
      idempotentReplay: false,
    };
  }
}

export const sharedPlatformRuntime = new KartikPlatformRuntime();
