/**
 * @kartik/frontend/app/interactive-demo-harness — Deterministic In-Browser Gateway & Multi-Agent Demo Harness (Micro-step 8.6.a).
 *
 * Provides a zero-dependency `HttpTransport` and `InteractiveDemoHarness` that wire `KartikWorkspaceShellController`
 * (`@kartik/frontend`) to a deterministic in-memory simulation of the API Gateway (`/api/v1/*`):
 * - Supports all 6 specialist agents (`chat`, `search`, `rag`, `coding`, `vision`, `image`) in `MOCK_AI=true` mode
 * - Enforces `Idempotency-Key` requirement and 24h idempotent turn replay (`idempotentReplay: true` with 0 duplicate credit deduction)
 * - Supports dynamic `DEMO_READ_ONLY` kill-switch toggling (`403 DEMO_READ_ONLY` on mutating methods while `GET` succeeds)
 * - Generates sandboxed coding artifact bundles (`FrontendArtifactBundle`) and grounded citations (`MessageCitation[]`)
 * - Records a real-time wire audit log (`GatewayAuditEntry[]`) for inspection in tests and the interactive workbench UI
 */

import type { FrontendArtifactBundle } from '../features/sandbox/index.js';
import {
  KartikGatewayClient,
  type HttpTransport,
  type HttpTransportRequest,
  type HttpTransportResponse,
} from '../lib/api-client.js';
import type {
  ApiResponseEnvelope,
  AuthenticatedUserProfile,
  BillingPlanId,
  ChatMessageItem,
  ConversationSummary,
  CreditBalanceSnapshot,
  MessageCitation,
  PaymentOrderSummary,
  PaymentVerificationResult,
  SendMessageTurnResponse,
  SpecialistAgentName,
  UploadedFileSummary,
} from '../types/index.js';
import { KartikWorkspaceShellController } from './workspace-shell.js';

export interface GatewayAuditEntry {
  readonly auditId: string;
  readonly timestamp: string;
  readonly method: string;
  readonly path: string;
  readonly statusCode: number;
  readonly traceId: string;
  readonly requestId: string | undefined;
  readonly agentUsed: SpecialistAgentName | null;
  readonly creditsDelta: number;
  readonly idempotentReplay: boolean;
  readonly errorCode: string | null;
}

const PLAN_CATALOGUE: Readonly<
  Record<BillingPlanId, { readonly amountPaise: number; readonly credits: number }>
> = Object.freeze({
  starter_100: { amountPaise: 9900, credits: 100 },
  pro_500: { amountPaise: 39900, credits: 500 },
  scale_2000: { amountPaise: 129900, credits: 2000 },
});

const SPECIALIST_CREDIT_COST: Readonly<Record<SpecialistAgentName, number>> =
  Object.freeze({
    chat: 2,
    search: 5,
    rag: 6,
    vision: 8,
    coding: 10,
    image: 15,
  });

export function inferSpecialistFromPrompt(
  prompt: string,
  hasAttachments: boolean,
  requestedAgent?: SpecialistAgentName,
): SpecialistAgentName {
  if (requestedAgent) {
    return requestedAgent;
  }
  const lower = prompt.toLowerCase();
  if (
    lower.includes('build') ||
    lower.includes('code') ||
    lower.includes('widget') ||
    lower.includes('html') ||
    lower.includes('calculator') ||
    lower.includes('component')
  ) {
    return 'coding';
  }
  if (
    hasAttachments ||
    lower.includes('pdf') ||
    lower.includes('document') ||
    lower.includes('according to the file') ||
    lower.includes('page')
  ) {
    return 'rag';
  }
  if (
    lower.includes('search') ||
    lower.includes('latest') ||
    lower.includes('news') ||
    lower.includes('cite web')
  ) {
    return 'search';
  }
  if (
    lower.includes('generate image') ||
    lower.includes('draw') ||
    lower.includes('illustration') ||
    lower.includes('poster')
  ) {
    return 'image';
  }
  if (
    lower.includes('screenshot') ||
    lower.includes('diagram') ||
    lower.includes('inspect image') ||
    lower.includes('vision')
  ) {
    return 'vision';
  }
  return 'chat';
}

export function buildDemoCodingArtifactBundle(
  artifactId: string,
  prompt: string,
): FrontendArtifactBundle {
  const safePromptSummary = prompt
    .replace(/[<>&"']/g, '')
    .slice(0, 60)
    .trim() || 'Interactive Kartik.ai Widget';

  return Object.freeze({
    artifactId,
    title: `Sandboxed Widget — ${safePromptSummary}`,
    entryFile: 'index.html',
    files: Object.freeze([
      {
        path: 'index.html',
        mimeType: 'text/html',
        content: `<div class="card">
  <div class="badge">Isolated Sandbox Preview (allow-scripts only)</div>
  <h2>${safePromptSummary}</h2>
  <p>Running inside an opaque-origin iframe with <code>connect-src 'none'</code> and zero access to parent cookies or storage.</p>
  <div class="row">
    <button id="incBtn" type="button">Simulate Token Counter (+1)</button>
    <span id="counterVal">Count: 1</span>
  </div>
</div>`,
      },
      {
        path: 'styles.css',
        mimeType: 'text/css',
        content: `body { font-family: system-ui, sans-serif; background: #090d16; color: #f1f5f9; margin: 0; padding: 16px; }
.card { background: #0f172a; border: 1px solid #1e293b; border-radius: 8px; padding: 16px; }
.badge { display: inline-block; font-size: 11px; font-family: monospace; color: #34d399; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 8px; border-radius: 4px; margin-bottom: 8px; }
h2 { margin: 4px 0 8px; font-size: 16px; color: #f8fafc; }
p { margin: 0 0 14px; font-size: 13px; color: #94a3b8; line-height: 1.5; }
.row { display: flex; align-items: center; gap: 12px; }
button { background: #10b981; color: #020617; border: none; border-radius: 6px; padding: 7px 12px; font-weight: 600; font-size: 12px; cursor: pointer; }
button:hover { background: #34d399; }
#counterVal { font-family: monospace; font-size: 13px; color: #38bdf8; }`,
      },
      {
        path: 'app.js',
        mimeType: 'application/javascript',
        content: `let count = 1;
const btn = document.getElementById('incBtn');
const label = document.getElementById('counterVal');
if (btn && label) {
  btn.addEventListener('click', () => {
    count += 1;
    label.textContent = 'Count: ' + count;
  });
}`,
      },
    ]),
  });
}

export interface InteractiveDemoHarness {
  readonly shell: KartikWorkspaceShellController;
  readonly client: KartikGatewayClient;
  getDemoReadOnly(): boolean;
  setDemoReadOnly(enabled: boolean): void;
  getCreditSnapshot(): CreditBalanceSnapshot;
  getConversations(): readonly ConversationSummary[];
  getMessages(conversationId: string): readonly ChatMessageItem[];
  getAuditTrail(): readonly GatewayAuditEntry[];
  getArtifactBundle(artifactId: string): FrontendArtifactBundle | undefined;
  replayLastTurnWithSameIdempotencyKey(): Promise<SendMessageTurnResponse | null>;
}

export function createInteractiveDemoHarness(options?: {
  readonly initialCredits?: number;
  readonly initialDemoReadOnly?: boolean;
}): InteractiveDemoHarness {
  let demoReadOnly = options?.initialDemoReadOnly ?? false;
  let availableCredits = options?.initialCredits ?? 200;
  let lifetimeCredited = availableCredits;
  let lifetimeDebited = 0;
  let traceCounter = 100;
  let messageCounter = 10;
  let orderCounter = 1;
  let fileCounter = 1;

  const currentUser: AuthenticatedUserProfile = Object.freeze({
    userId: 'usr_demo_001',
    email: 'kartik@kartik.ai',
    displayName: 'Kartik Rawat',
    avatarUrl: null,
  });

  const conversations = new Map<string, ConversationSummary>();
  const messagesByConv = new Map<string, ChatMessageItem[]>();
  const filesByConv = new Map<string, UploadedFileSummary[]>();
  const artifactsById = new Map<string, FrontendArtifactBundle>();
  const ordersByRazorpayId = new Map<string, PaymentOrderSummary>();
  const verifiedOrders = new Set<string>();
  const turnReplayCache = new Map<string, SendMessageTurnResponse>();
  const auditTrail: GatewayAuditEntry[] = [];

  let lastTurnRequest: {
    readonly conversationId: string;
    readonly prompt: string;
    readonly requestedAgent?: SpecialistAgentName;
    readonly attachmentFileIds?: readonly string[];
    readonly idempotencyKey: string;
  } | null = null;

  // Seed default conversation + initial architecture welcome message
  const seedConvId = 'conv_seed_architecture_01';
  const seedTimestamp = '2026-11-12T09:00:00.000Z';
  const defaultArtifactId = 'art_seed_sandbox_01';
  artifactsById.set(
    defaultArtifactId,
    buildDemoCodingArtifactBundle(
      defaultArtifactId,
      'Kartik.ai Credit & Idempotency Telemetry Widget',
    ),
  );

  conversations.set(seedConvId, {
    conversationId: seedConvId,
    userId: currentUser.userId,
    title: 'Architecture & Specialist Agent Walkthrough',
    deletionState: 'active',
    messageCount: 2,
    lastMessageAt: seedTimestamp,
    createdAt: seedTimestamp,
    updatedAt: seedTimestamp,
  });

  messagesByConv.set(seedConvId, [
    {
      messageId: 'msg_seed_user_01',
      conversationId: seedConvId,
      userId: currentUser.userId,
      requestId: 'req_seed_initial_01',
      role: 'user',
      content: 'Show me how Kartik.ai routes prompts across specialists and sandboxes code artifacts.',
      agentUsed: null,
      attachmentFileIds: [],
      artifactIds: [],
      citations: [],
      createdAt: seedTimestamp,
    },
    {
      messageId: 'msg_seed_asst_02',
      conversationId: seedConvId,
      userId: currentUser.userId,
      requestId: 'req_seed_initial_01',
      role: 'assistant',
      content:
        'Kartik.ai routes every turn through the API Gateway (`/api/v1/*`) with a client-owned `Idempotency-Key` (`requestId`), reserves credits in `@kartik/billing` using `SELECT ... FOR UPDATE`, dispatches the LangGraph supervisor in `@kartik/agent` (`MOCK_AI=true` by default), and renders generated code inside an opaque-origin `<iframe sandbox="allow-scripts">` with `connect-src \'none\'`.',
      agentUsed: 'coding',
      attachmentFileIds: [],
      artifactIds: [defaultArtifactId],
      citations: [
        {
          sourceId: 'src_blueprint_s9',
          title: 'Kartik.ai Blueprint v4.4 — Section 9 Architecture Invariants',
          urlOrPage: 'Page 14',
        },
      ],
      createdAt: seedTimestamp,
    },
  ]);

  function recordAudit(entry: Omit<GatewayAuditEntry, 'auditId' | 'timestamp'>): void {
    auditTrail.unshift(
      Object.freeze({
        auditId: `aud_${auditTrail.length + 1}`,
        timestamp: new Date().toISOString(),
        ...entry,
      }),
    );
  }

  function makeJsonResponse<T>(
    status: number,
    envelope: ApiResponseEnvelope<T>,
    headers?: Record<string, string>,
  ): HttpTransportResponse {
    return {
      status,
      headers,
      json: async () => envelope,
    };
  }

  const transport: HttpTransport = async (
    req: HttpTransportRequest,
  ): Promise<HttpTransportResponse> => {
    traceCounter += 1;
    const traceId = `trc_demo_${traceCounter}`;
    const requestId = req.headers['Idempotency-Key'];
    const pathOnly = req.url.replace(/^\/api\/v1/, '') || '/';
    const [pathname] = pathOnly.split('?');
    const isMutating = req.method !== 'GET';

    // 1. DEMO_READ_ONLY kill switch check on all mutating routes (§12)
    if (isMutating && demoReadOnly) {
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 403,
        traceId,
        requestId,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: 'DEMO_READ_ONLY',
      });
      return makeJsonResponse(403, {
        traceId,
        requestId,
        data: null,
        meta: { nextCursor: null },
        error: {
          code: 'DEMO_READ_ONLY',
          message:
            'DEMO_READ_ONLY kill switch is active: mutating requests are blocked while browsing remains available.',
        },
      });
    }

    // 2. Require Idempotency-Key on mutating requests (Invariant #15)
    if (isMutating && (!requestId || !requestId.trim())) {
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 400,
        traceId,
        requestId: undefined,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: 'IDEMPOTENCY_KEY_REQUIRED',
      });
      return makeJsonResponse(400, {
        traceId,
        data: null,
        meta: { nextCursor: null },
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: 'Mutating requests require a client-supplied Idempotency-Key header.',
        },
      });
    }

    const parsedBody = req.body ? (JSON.parse(req.body) as Record<string, unknown>) : {};

    // Route: POST /auth/google & GET /auth/me
    if (
      (req.method === 'POST' && pathname === '/auth/google') ||
      (req.method === 'GET' && pathname === '/auth/me')
    ) {
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 200,
        traceId,
        requestId,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(200, {
        traceId,
        requestId,
        data: { user: currentUser },
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: POST /auth/logout
    if (req.method === 'POST' && pathname === '/auth/logout') {
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 200,
        traceId,
        requestId,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(200, {
        traceId,
        requestId,
        data: { loggedOut: true },
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: GET /conversations
    if (req.method === 'GET' && pathname === '/conversations') {
      const items = Array.from(conversations.values()).filter(
        (c) => c.deletionState === 'active',
      );
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 200,
        traceId,
        requestId: undefined,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(200, {
        traceId,
        data: { items },
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: POST /conversations
    if (req.method === 'POST' && pathname === '/conversations') {
      const title =
        typeof parsedBody.title === 'string' && parsedBody.title.trim()
          ? parsedBody.title.trim()
          : 'Untitled Conversation';
      const convId = `conv_demo_${conversations.size + 1}`;
      const nowIso = new Date().toISOString();
      const summary: ConversationSummary = {
        conversationId: convId,
        userId: currentUser.userId,
        title,
        deletionState: 'active',
        messageCount: 0,
        lastMessageAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      conversations.set(convId, summary);
      messagesByConv.set(convId, []);
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 201,
        traceId,
        requestId,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(201, {
        traceId,
        requestId,
        data: summary,
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: POST /conversations/:id/messages
    const msgMatch = pathname?.match(/^\/conversations\/([^/]+)\/messages$/);
    if (req.method === 'POST' && msgMatch) {
      const conversationId = decodeURIComponent(msgMatch[1]!);
      const conv = conversations.get(conversationId);
      if (!conv || conv.deletionState !== 'active') {
        return makeJsonResponse(404, {
          traceId,
          requestId,
          data: null,
          meta: { nextCursor: null },
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
      }

      // Check 24h idempotent replay cache (Invariant #15)
      const cachedTurn = turnReplayCache.get(requestId!);
      if (cachedTurn) {
        const replayed: SendMessageTurnResponse = {
          ...cachedTurn,
          traceId,
          remainingCredits: availableCredits,
          idempotentReplay: true,
        };
        recordAudit({
          method: req.method,
          path: req.url,
          statusCode: 200,
          traceId,
          requestId,
          agentUsed: cachedTurn.assistantMessage.agentUsed,
          creditsDelta: 0,
          idempotentReplay: true,
          errorCode: null,
        });
        return makeJsonResponse(200, {
          traceId,
          requestId,
          data: replayed,
          meta: { nextCursor: null },
          error: null,
        });
      }

      const prompt = String(parsedBody.prompt ?? '').trim();
      const requestedAgent = parsedBody.requestedAgent as
        | SpecialistAgentName
        | undefined;
      const attachmentFileIds = Array.isArray(parsedBody.attachmentFileIds)
        ? (parsedBody.attachmentFileIds as string[])
        : [];
      const convFiles = filesByConv.get(conversationId) ?? [];

      const agentUsed = inferSpecialistFromPrompt(
        prompt,
        attachmentFileIds.length > 0 || convFiles.length > 0,
        requestedAgent,
      );
      const cost = SPECIALIST_CREDIT_COST[agentUsed];

      if (availableCredits < cost) {
        recordAudit({
          method: req.method,
          path: req.url,
          statusCode: 402,
          traceId,
          requestId,
          agentUsed,
          creditsDelta: 0,
          idempotentReplay: false,
          errorCode: 'QUOTA_EXHAUSTED',
        });
        return makeJsonResponse(402, {
          traceId,
          requestId,
          data: null,
          meta: { nextCursor: null },
          error: {
            code: 'QUOTA_EXHAUSTED',
            message: `Insufficient credits: specialist '${agentUsed}' requires ${cost} credits, but only ${availableCredits} available.`,
          },
        });
      }

      availableCredits -= cost;
      lifetimeDebited += cost;

      messageCounter += 1;
      const nowIso = new Date().toISOString();
      const userMsg: ChatMessageItem = {
        messageId: `msg_u_${messageCounter}`,
        conversationId,
        userId: currentUser.userId,
        requestId: requestId!,
        role: 'user',
        content: prompt,
        agentUsed: null,
        attachmentFileIds,
        artifactIds: [],
        citations: [],
        createdAt: nowIso,
      };

      messageCounter += 1;
      const artifactIds: string[] = [];
      const citations: MessageCitation[] = [];
      let assistantText = '';

      if (agentUsed === 'coding') {
        const artId = `art_demo_${messageCounter}`;
        artifactsById.set(artId, buildDemoCodingArtifactBundle(artId, prompt));
        artifactIds.push(artId);
        assistantText = `[MOCK_AI=true · Specialist: coding] Generated a multi-file HTML/CSS/JS artifact bundle (${artId}) validated against path-traversal and MIME schemas, ready for preview inside an opaque-origin <iframe sandbox="allow-scripts"> with connect-src 'none'.`;
      } else if (agentUsed === 'rag') {
        const docName =
          convFiles[convFiles.length - 1]?.originalFilename ??
          'kartik_ai_blueprint_v4.4.pdf';
        citations.push(
          {
            sourceId: 'rag_chunk_01',
            title: `${docName} — Schema & Ownership Isolation`,
            urlOrPage: 'Page 7',
          },
          {
            sourceId: 'rag_chunk_02',
            title: `${docName} — Atomic Credit Ledger & SELECT FOR UPDATE`,
            urlOrPage: 'Page 19',
          },
        );
        assistantText = `[MOCK_AI=true · Specialist: rag] Grounded answer synthesized strictly from Qdrant chunks filtered by { userId: "${currentUser.userId}", fileId } in <untrusted_retrieved_data data_only="true"> context for "${prompt}".`;
      } else if (agentUsed === 'search') {
        citations.push(
          {
            sourceId: 'web_src_01',
            title: 'Node.js 26 LTS & TypeScript Monorepo Architecture Guide',
            urlOrPage: 'https://nodejs.org/en/blog/release',
          },
          {
            sourceId: 'web_src_02',
            title: 'OWASP Sandboxed Iframe & Ed25519 Microservice Security',
            urlOrPage: 'https://owasp.org/www-project-top-ten/',
          },
        );
        assistantText = `[MOCK_AI=true · Specialist: search] Synthesized web search findings for "${prompt}" with explicit separation between cited external sources and model synthesis.`;
      } else if (agentUsed === 'image') {
        assistantText = `[MOCK_AI=true · IMAGE_PROVIDER=mock · Specialist: image] Generated deterministic mock SVG/PNG asset descriptor for "${prompt}" without consuming live image generation quota.`;
      } else if (agentUsed === 'vision') {
        assistantText = `[MOCK_AI=true · Specialist: vision] Inspected visual layout and structural elements for "${prompt}" with magic-byte and dimension validation.`;
      } else {
        assistantText = `[MOCK_AI=true · Specialist: chat] Processed conversational turn for "${prompt}". Reserved and settled ${cost} credits atomically via @kartik/billing.`;
      }

      const assistantMsg: ChatMessageItem = {
        messageId: `msg_a_${messageCounter}`,
        conversationId,
        userId: currentUser.userId,
        requestId: requestId!,
        role: 'assistant',
        content: assistantText,
        agentUsed,
        attachmentFileIds: [],
        artifactIds,
        citations,
        createdAt: nowIso,
      };

      const existingMsgs = messagesByConv.get(conversationId) ?? [];
      messagesByConv.set(conversationId, [...existingMsgs, userMsg, assistantMsg]);
      conversations.set(conversationId, {
        ...conv,
        messageCount: existingMsgs.length + 2,
        lastMessageAt: nowIso,
        updatedAt: nowIso,
      });

      const responsePayload: SendMessageTurnResponse = {
        conversationId,
        requestId: requestId!,
        traceId,
        userMessage: userMsg,
        assistantMessage: assistantMsg,
        remainingCredits: availableCredits,
        idempotentReplay: false,
      };
      turnReplayCache.set(requestId!, responsePayload);
      lastTurnRequest = {
        conversationId,
        prompt,
        requestedAgent,
        attachmentFileIds,
        idempotencyKey: requestId!,
      };

      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 201,
        traceId,
        requestId,
        agentUsed,
        creditsDelta: -cost,
        idempotentReplay: false,
        errorCode: null,
      });

      return makeJsonResponse(201, {
        traceId,
        requestId,
        data: responsePayload,
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: DELETE /conversations/:id
    const delMatch = pathname?.match(/^\/conversations\/([^/]+)$/);
    if (req.method === 'DELETE' && delMatch) {
      const conversationId = decodeURIComponent(delMatch[1]!);
      const conv = conversations.get(conversationId);
      if (!conv || conv.deletionState !== 'active') {
        return makeJsonResponse(404, {
          traceId,
          requestId,
          data: null,
          meta: { nextCursor: null },
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
      }
      conversations.set(conversationId, {
        ...conv,
        deletionState: 'purged',
      });
      messagesByConv.delete(conversationId);
      filesByConv.delete(conversationId);

      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 200,
        traceId,
        requestId,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(200, {
        traceId,
        requestId,
        data: {
          conversationId,
          deletionState: 'purged',
          cascadeOrder: ['vectors', 'objects', 'metadata'],
        },
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: POST /files
    if (req.method === 'POST' && pathname === '/files') {
      fileCounter += 1;
      const conversationId = String(parsedBody.conversationId ?? seedConvId);
      const originalFilename = String(parsedBody.originalFilename ?? 'document.pdf');
      const declaredMimeType = String(
        parsedBody.declaredMimeType ?? 'application/pdf',
      );
      const contentBase64 = String(parsedBody.contentBase64 ?? '');
      const uploaded: UploadedFileSummary = {
        fileId: `file_demo_${fileCounter}`,
        userId: currentUser.userId,
        conversationId,
        originalFilename,
        mimeType: declaredMimeType,
        sizeBytes: Math.max(128, Math.floor((contentBase64.length * 3) / 4)),
      };
      const existing = filesByConv.get(conversationId) ?? [];
      filesByConv.set(conversationId, [...existing, uploaded]);

      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 201,
        traceId,
        requestId,
        agentUsed: 'rag',
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(201, {
        traceId,
        requestId,
        data: uploaded,
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: GET /billing/balance
    if (req.method === 'GET' && pathname === '/billing/balance') {
      const snapshot: CreditBalanceSnapshot = {
        userId: currentUser.userId,
        availableCredits,
        reservedCredits: 0,
        lifetimeCredited,
        lifetimeDebited,
      };
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 200,
        traceId,
        requestId: undefined,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(200, {
        traceId,
        data: snapshot,
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: POST /billing/orders
    if (req.method === 'POST' && pathname === '/billing/orders') {
      const planId = parsedBody.planId as BillingPlanId;
      const plan = PLAN_CATALOGUE[planId];
      if (!plan) {
        return makeJsonResponse(400, {
          traceId,
          requestId,
          data: null,
          meta: { nextCursor: null },
          error: { code: 'VALIDATION_FAILED', message: 'Invalid planId' },
        });
      }
      orderCounter += 1;
      const order: PaymentOrderSummary = {
        orderId: `ord_demo_${orderCounter}`,
        razorpayOrderId: `order_rzp_mock_${orderCounter}`,
        planId,
        amountPaise: plan.amountPaise,
        creditsGranted: plan.credits,
        currency: 'INR',
        status: 'CREATED',
      };
      ordersByRazorpayId.set(order.razorpayOrderId, order);

      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 201,
        traceId,
        requestId,
        agentUsed: null,
        creditsDelta: 0,
        idempotentReplay: false,
        errorCode: null,
      });
      return makeJsonResponse(201, {
        traceId,
        requestId,
        data: order,
        meta: { nextCursor: null },
        error: null,
      });
    }

    // Route: POST /billing/verify
    if (req.method === 'POST' && pathname === '/billing/verify') {
      const rzpOrderId = String(parsedBody.razorpayOrderId ?? '');
      const order = ordersByRazorpayId.get(rzpOrderId);
      if (!order) {
        return makeJsonResponse(400, {
          traceId,
          requestId,
          data: null,
          meta: { nextCursor: null },
          error: {
            code: 'PAYMENT_VERIFICATION_FAILED',
            message: 'Unknown Razorpay order ID',
          },
        });
      }
      const alreadyCredited = verifiedOrders.has(rzpOrderId);
      if (!alreadyCredited) {
        verifiedOrders.add(rzpOrderId);
        availableCredits += order.creditsGranted;
        lifetimeCredited += order.creditsGranted;
      }
      const verification: PaymentVerificationResult = {
        orderId: order.orderId,
        razorpayOrderId: order.razorpayOrderId,
        status: 'PAID',
        creditsAdded: alreadyCredited ? 0 : order.creditsGranted,
        availableCreditsAfter: availableCredits,
        alreadyCredited,
      };
      recordAudit({
        method: req.method,
        path: req.url,
        statusCode: 200,
        traceId,
        requestId,
        agentUsed: null,
        creditsDelta: alreadyCredited ? 0 : order.creditsGranted,
        idempotentReplay: alreadyCredited,
        errorCode: null,
      });
      return makeJsonResponse(200, {
        traceId,
        requestId,
        data: verification,
        meta: { nextCursor: null },
        error: null,
      });
    }

    return makeJsonResponse(404, {
      traceId,
      requestId,
      data: null,
      meta: { nextCursor: null },
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${pathname} not found` },
    });
  };

  const client = new KartikGatewayClient({
    baseUrl: '/api/v1',
    transport,
  });

  const shell = new KartikWorkspaceShellController({
    client,
    initialCredits: availableCredits,
  });

  return Object.freeze({
    shell,
    client,
    getDemoReadOnly: () => demoReadOnly,
    setDemoReadOnly: (enabled: boolean) => {
      demoReadOnly = enabled;
    },
    getCreditSnapshot: () => ({
      userId: currentUser.userId,
      availableCredits,
      reservedCredits: 0,
      lifetimeCredited,
      lifetimeDebited,
    }),
    getConversations: () =>
      Object.freeze(
        Array.from(conversations.values()).filter(
          (c) => c.deletionState === 'active',
        ),
      ),
    getMessages: (conversationId: string) =>
      Object.freeze([...(messagesByConv.get(conversationId) ?? [])]),
    getAuditTrail: () => Object.freeze([...auditTrail]),
    getArtifactBundle: (artifactId: string) => artifactsById.get(artifactId),
    replayLastTurnWithSameIdempotencyKey: async () => {
      if (!lastTurnRequest) {
        return null;
      }
      return client.sendMessage(lastTurnRequest);
    },
  });
}
