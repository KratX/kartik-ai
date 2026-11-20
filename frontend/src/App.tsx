/**
 * @file frontend/src/App.tsx
 * @description Kartik.ai 3-Pane Multi-Agent Production Workspace UI (`@kartik/frontend`).
 *
 * Connects exclusively to the API Gateway (`/api/v1/*`) (Blueprint Invariant #1):
 * - Left Pane: `Sidebar` (Conversations, Search Filter, Indexed RAG/Vision Files, Balance & Auth)
 * - Center Pane: `Nav` + `ChatArea` (Quick-Launch Cards, Message Thread, 16:9 Slide Deck Preview,
 *   4-Image Search Lightbox, Grounded Citations, Direct PDF/PPTX/PNG Binary Downloads) + `ChatInput`
 * - Right Pane: Collapsible `ArtifactPanel` (Isolated `<iframe sandbox="allow-scripts">` Live Preview & Multi-File Source Viewer)
 * - Modals/Drawers: `BillingDrawer` (Starter ₹199 / Pro ₹499 Razorpay Checkout + Immutable Ledger)
 *   and `AuthModal` (Google OAuth / HttpOnly Session Cookie).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import type {
  ApiEnvelope,
  ArtifactRecord,
  PlatformConversation,
  PlatformCreditPlan,
  PlatformLedgerEntry,
  PlatformMessage,
  PlatformUser,
  SpecialistAgentName,
  UploadedFileRecord,
} from './types/index.js';
import type { AgentSelectorPillSpec } from './components/slide-deck-and-markdown.js';
import { ArtifactPanel } from './components/artifacts/ArtifactPanel.js';
import { AuthModal } from './components/auth/AuthModal.js';
import { BillingDrawer } from './components/billing/BillingDrawer.js';
import { ChatArea } from './components/chat/ChatArea.js';
import { ChatInput } from './components/chat/ChatInput.js';
import { Nav } from './components/layout/Nav.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { StepFileDownloads } from './components/common/StepFileDownloads.js';

function createClientIdempotencyKey(): string {
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const GUEST_ID_STORAGE_KEY = 'kartik_ai_guest_workspace_id';
let fallbackMemoryGuestId: string | null = null;

function getOrCreateClientGuestId(): string {
  if (fallbackMemoryGuestId) {
    return fallbackMemoryGuestId;
  }
  try {
    const existing =
      window.sessionStorage.getItem(GUEST_ID_STORAGE_KEY) ??
      window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (existing && /^gst_[A-Za-z0-9_-]{12,44}$/.test(existing)) {
      fallbackMemoryGuestId = existing;
      return existing;
    }
  } catch {
    // Storage may be unavailable in restricted sandboxes
  }

  let randomHex = '';
  try {
    const bytes = new Uint8Array(12);
    window.crypto.getRandomValues(bytes);
    randomHex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    randomHex = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`.slice(0, 24);
  }
  const created = `gst_${randomHex}`;
  fallbackMemoryGuestId = created;
  try {
    window.sessionStorage.setItem(GUEST_ID_STORAGE_KEY, created);
    window.localStorage.setItem(GUEST_ID_STORAGE_KEY, created);
  } catch {
    // Ignore storage quota / sandbox restrictions
  }
  return created;
}

function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? undefined);
  if (!headers.has('X-Kartik-Guest-Id')) {
    headers.set('X-Kartik-Guest-Id', getOrCreateClientGuestId());
  }
  return fetch(input, {
    ...init,
    credentials: 'include',
    headers,
  });
}

export function App() {
  // Layout & Drawer State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isArtifactPanelOpen, setIsArtifactPanelOpen] = useState(false);
  const [isBillingDrawerOpen, setIsBillingDrawerOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFixDownloadsOpen, setIsFixDownloadsOpen] = useState(false);

  // Domain State from `/api/v1/*`
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [demoReadOnly, setDemoReadOnly] = useState(false);
  const [availableCredits, setAvailableCredits] = useState(250);
  const [plans, setPlans] = useState<readonly PlatformCreditPlan[]>([]);
  const [ledger, setLedger] = useState<readonly PlatformLedgerEntry[]>([]);
  const [conversations, setConversations] = useState<
    readonly PlatformConversation[]
  >([]);
  const [activeConversationId, setActiveConversationId] =
    useState<string>('conv_welcome_01');
  const [messages, setMessages] = useState<readonly PlatformMessage[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<
    readonly UploadedFileRecord[]
  >([]);

  // Turn Composer & Replay State
  const [selectedAgent, setSelectedAgent] =
    useState<AgentSelectorPillSpec['id']>('auto');
  const [attachedTurnFiles, setAttachedTurnFiles] = useState<
    readonly UploadedFileRecord[]
  >([]);
  const [activeCodeArtifact, setActiveCodeArtifact] =
    useState<ArtifactRecord | null>(null);
  const [isTurnLoading, setIsTurnLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [statusBanner, setStatusBanner] = useState<string | null>(null);
  const [lastTurnReplayPayload, setLastTurnReplayPayload] = useState<{
    readonly conversationId: string;
    readonly requestId: string;
    readonly prompt: string;
    readonly preferredAgent?: SpecialistAgentName;
    readonly attachmentFileIds?: string[];
  } | null>(null);

  const activeConversationIdRef = useRef<string>(activeConversationId);
  const messagesLoadSeqRef = useRef(0);
  const hasBootstrappedRef = useRef(false);

  const setActiveConversationIdSafe = useCallback((convId: string) => {
    activeConversationIdRef.current = convId;
    setActiveConversationId(convId);
  }, []);

  const refreshBillingAndAuth = useCallback(async () => {
    try {
      const [authRes, billingRes, filesRes] = await Promise.all([
        apiFetch('/api/v1/auth/me'),
        apiFetch('/api/v1/billing/balance'),
        apiFetch('/api/v1/files'),
      ]);

      const authJson = (await authRes.json()) as ApiEnvelope<{
        isAuthenticated: boolean;
        user: PlatformUser | null;
        demoReadOnly: boolean;
      }>;
      if (authJson.ok) {
        setUser(authJson.data.user);
        setDemoReadOnly(authJson.data.demoReadOnly);
      }

      const billingJson = (await billingRes.json()) as ApiEnvelope<{
        availableCredits: number;
        plans: readonly PlatformCreditPlan[];
        ledger: readonly PlatformLedgerEntry[];
      }>;
      if (billingJson.ok) {
        setAvailableCredits(billingJson.data.availableCredits);
        setPlans(billingJson.data.plans ?? []);
        setLedger(billingJson.data.ledger ?? []);
      }

      const filesJson = (await filesRes.json()) as ApiEnvelope<{
        files?: readonly UploadedFileRecord[];
        items?: readonly UploadedFileRecord[];
      }>;
      if (filesJson.ok) {
        setUploadedFiles(filesJson.data.files ?? filesJson.data.items ?? []);
      }
    } catch {
      // Non-fatal background sync error
    }
  }, []);

  const loadConversationMessages = useCallback(async (convId: string) => {
    const seq = ++messagesLoadSeqRef.current;
    try {
      const res = await apiFetch(
        `/api/v1/conversations/${encodeURIComponent(convId)}/messages`,
      );
      const json = (await res.json()) as ApiEnvelope<{
        conversation: PlatformConversation;
        messages?: readonly PlatformMessage[];
        items?: readonly PlatformMessage[];
      }>;
      if (seq !== messagesLoadSeqRef.current) {
        return;
      }
      if (json.ok) {
        const loadedMessages = json.data.messages ?? json.data.items ?? [];
        setMessages(loadedMessages);
        const latestCodeArt = [...loadedMessages]
          .reverse()
          .flatMap((m) => m.artifacts ?? [])
          .find((a) => a.artifactType === 'code_bundle');
        setActiveCodeArtifact(latestCodeArt ?? null);
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const refreshConversations = useCallback(
    async (
      preferredConvId?: string,
      options?: { readonly skipMessageReload?: boolean },
    ) => {
      try {
        const res = await apiFetch('/api/v1/conversations');
        const json = (await res.json()) as ApiEnvelope<{
          conversations?: readonly PlatformConversation[];
          items?: readonly PlatformConversation[];
        }>;
        if (json.ok) {
          const list = json.data.conversations ?? json.data.items ?? [];
          setConversations(list);
          const currentActive = activeConversationIdRef.current;
          const targetId =
            (preferredConvId &&
            list.some((c) => c.conversationId === preferredConvId)
              ? preferredConvId
              : undefined) ??
            (list.some((c) => c.conversationId === currentActive)
              ? currentActive
              : list[0]?.conversationId);
          if (targetId) {
            setActiveConversationIdSafe(targetId);
            if (!options?.skipMessageReload) {
              await loadConversationMessages(targetId);
            }
          }
        }
      } catch {
        // Non-fatal
      }
    },
    [loadConversationMessages, setActiveConversationIdSafe],
  );

  useEffect(() => {
    if (hasBootstrappedRef.current) {
      return;
    }
    hasBootstrappedRef.current = true;
    void refreshBillingAndAuth();
    void refreshConversations();
  }, [refreshBillingAndAuth, refreshConversations]);

  const handleSelectConversation = async (conversationId: string) => {
    setActiveConversationIdSafe(conversationId);
    setErrorBanner(null);
    await loadConversationMessages(conversationId);
  };

  const handleCreateConversation = async () => {
    setErrorBanner(null);
    try {
      const res = await apiFetch('/api/v1/conversations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createClientIdempotencyKey(),
        },
        body: JSON.stringify({ title: 'New Multi-Agent Session' }),
      });
      const json = (await res.json()) as ApiEnvelope<PlatformConversation>;
      if (!json.ok) {
        setErrorBanner(`${json.error.code}: ${json.error.message}`);
        return;
      }
      messagesLoadSeqRef.current += 1;
      setMessages([]);
      setActiveCodeArtifact(null);
      setIsArtifactPanelOpen(false);
      setActiveConversationIdSafe(json.data.conversationId);
      await refreshConversations(json.data.conversationId, {
        skipMessageReload: true,
      });
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to create conversation.',
      );
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    setErrorBanner(null);
    try {
      const res = await apiFetch(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: 'DELETE',
          headers: {
            'Idempotency-Key': createClientIdempotencyKey(),
          },
        },
      );
      const json = (await res.json()) as ApiEnvelope<{
        conversationId: string;
        deletionState: string;
        purgedSummary: {
          purgedVectorChunks: number;
          purgedStorageKeys: readonly string[];
        };
      }>;
      if (!json.ok) {
        setErrorBanner(`${json.error.code}: ${json.error.message}`);
        return;
      }
      setStatusBanner(
        `Cascade deleted conversation (${json.data.purgedSummary.purgedVectorChunks} vector chunks & ${json.data.purgedSummary.purgedStorageKeys.length} private objects purged).`,
      );
      await refreshConversations();
      await refreshBillingAndAuth();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to delete conversation.',
      );
    }
  };

  // Send or replay a Multi-Agent Turn
  const executeTurnRequest = async (input: {
    readonly conversationId: string;
    readonly requestId: string;
    readonly prompt: string;
    readonly preferredAgent?: SpecialistAgentName;
    readonly attachmentFileIds?: string[];
  }) => {
    setIsTurnLoading(true);
    setErrorBanner(null);
    setStatusBanner(null);

    try {
      const targetConvId = input.conversationId || 'conv_welcome_01';
      const res = await apiFetch(
        `/api/v1/conversations/${encodeURIComponent(targetConvId)}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': input.requestId,
          },
          body: JSON.stringify({
            prompt: input.prompt,
            preferredAgent: input.preferredAgent,
            attachmentFileIds: input.attachmentFileIds,
          }),
        },
      );

      const json = (await res.json()) as ApiEnvelope<{
        conversationId: string;
        requestId: string;
        traceId: string;
        remainingCredits: number;
        creditsCharged: number;
        idempotentReplay: boolean;
        userMessage: PlatformMessage;
        assistantMessage: PlatformMessage;
      }>;

      if (!json.ok) {
        setErrorBanner(`${json.error.code}: ${json.error.message}`);
        return;
      }

      const resolvedConvId = json.data.conversationId || targetConvId;
      setLastTurnReplayPayload({
        ...input,
        conversationId: resolvedConvId,
      });
      setAvailableCredits(json.data.remainingCredits);
      setAttachedTurnFiles([]);

      if (json.data.idempotentReplay) {
        setStatusBanner(
          `Idempotent replay verified (requestId: ${json.data.requestId}) — 0 credits deducted.`,
        );
      }

      const newCodeArtifact = json.data.assistantMessage.artifacts?.find(
        (a) => a.artifactType === 'code_bundle',
      );
      if (newCodeArtifact) {
        setActiveCodeArtifact(newCodeArtifact);
        setIsArtifactPanelOpen(true);
      }

      // Bump load sequence so any stale in-flight GET /messages response cannot clobber this turn
      messagesLoadSeqRef.current += 1;
      setActiveConversationIdSafe(resolvedConvId);
      setMessages((prev) => {
        const exists = prev.some(
          (m) => m.messageId === json.data.assistantMessage.messageId,
        );
        if (exists) {
          return prev;
        }
        return [...prev, json.data.userMessage, json.data.assistantMessage];
      });

      await Promise.all([
        refreshConversations(resolvedConvId, { skipMessageReload: true }),
        refreshBillingAndAuth(),
      ]);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to execute agent turn.',
      );
    } finally {
      setIsTurnLoading(false);
    }
  };

  const handleSendMessage = async (
    prompt: string,
    preferredAgent?: SpecialistAgentName,
  ) => {
    await executeTurnRequest({
      conversationId: activeConversationIdRef.current || 'conv_welcome_01',
      requestId: createClientIdempotencyKey(),
      prompt,
      preferredAgent,
      attachmentFileIds: attachedTurnFiles.map((f) => f.fileId),
    });
  };

  const handleReplayLastTurn = async () => {
    if (!lastTurnReplayPayload) {
      return;
    }
    await executeTurnRequest(lastTurnReplayPayload);
  };

  const handleQuickPromptSelect = async (
    prompt: string,
    agent: SpecialistAgentName,
  ) => {
    setSelectedAgent(agent);
    await handleSendMessage(prompt, agent);
  };

  // Upload PDF or Image for RAG / Multimodal Vision
  const handleUploadFile = async (file: {
    readonly originalFilename: string;
    readonly declaredMimeType: string;
    readonly contentBase64: string;
  }): Promise<void> => {
    setErrorBanner(null);

    try {
      const res = await apiFetch('/api/v1/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createClientIdempotencyKey(),
        },
        body: JSON.stringify({
          conversationId: activeConversationIdRef.current || 'conv_welcome_01',
          originalFilename: file.originalFilename,
          declaredMimeType: file.declaredMimeType,
          contentBase64: file.contentBase64,
        }),
      });

      const json = (await res.json()) as ApiEnvelope<{
        file: UploadedFileRecord;
        chunkCount: number;
      }>;
      if (!json.ok) {
        setErrorBanner(`${json.error.code}: ${json.error.message}`);
        return;
      }

      setAttachedTurnFiles((prev) => [...prev, json.data.file]);
      setStatusBanner(
        `Indexed "${json.data.file.originalFilename}" (${json.data.chunkCount} vector chunks stored in Qdrant user namespace).`,
      );
      await refreshBillingAndAuth();
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'File upload failed.',
      );
    }
  };

  const handleRemoveAttachedFile = (fileId: string) => {
    setAttachedTurnFiles((prev) => prev.filter((f) => f.fileId !== fileId));
  };

  // Toggle DEMO_READ_ONLY kill switch
  const handleToggleDemoReadOnly = async () => {
    setErrorBanner(null);
    try {
      const res = await apiFetch('/api/v1/demo/toggle-read-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !demoReadOnly }),
      });
      const json = (await res.json()) as ApiEnvelope<{ demoReadOnly: boolean }>;
      if (json.ok) {
        setDemoReadOnly(json.data.demoReadOnly);
        setStatusBanner(
          json.data.demoReadOnly
            ? 'DEMO_READ_ONLY activated — mutating endpoints now return HTTP 403.'
            : 'DEMO_READ_ONLY disabled — workspace mutations and specialist runs enabled.',
        );
      }
    } catch {
      // Ignore
    }
  };

  // Billing Order & Razorpay Signature Verification
  const handleCreateOrder = async (planId: string) => {
    const res = await apiFetch('/api/v1/billing/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createClientIdempotencyKey(),
      },
      body: JSON.stringify({ planId }),
    });
    const json = (await res.json()) as ApiEnvelope<{
      orderId: string;
      razorpayKeyId: string;
      liveRazorpayOrder?: boolean;
      plan: PlatformCreditPlan;
      amountPaise: number;
      currency: 'INR';
    }>;
    if (!json.ok) {
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    return {
      orderId: json.data.orderId,
      razorpayKeyId: json.data.razorpayKeyId,
      liveRazorpayOrder: Boolean(json.data.liveRazorpayOrder),
      planName: json.data.plan.name,
      amountPaise: json.data.amountPaise,
      amountInrLabel: json.data.plan.amountInrLabel,
      creditsGranted: json.data.plan.creditsGranted,
    };
  };

  const handleVerifyPayment = async (
    orderId: string,
    paymentDetails?: {
      readonly paymentId?: string;
      readonly signature?: string;
    },
  ) => {
    const res = await apiFetch('/api/v1/billing/verify', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createClientIdempotencyKey(),
      },
      body: JSON.stringify({
        orderId,
        paymentId: paymentDetails?.paymentId,
        signature: paymentDetails?.signature,
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentDetails?.paymentId,
        razorpaySignature: paymentDetails?.signature,
      }),
    });
    const json = (await res.json()) as {
      readonly ok?: boolean;
      readonly data?: {
        readonly verified?: boolean;
        readonly orderId?: string;
        readonly paymentId?: string;
        readonly signature?: string;
        readonly availableCredits?: number;
        readonly balanceAfter?: number;
        readonly creditsAdded?: number;
        readonly planId?: string;
        readonly order?: {
          readonly id?: string;
          readonly razorpayPaymentId?: string | null;
          readonly creditsGranted?: number;
          readonly planId?: string;
        };
      } | null;
      readonly error?: {
        readonly code?: string;
        readonly message?: string;
      } | null;
    };

    const isSuccess =
      (json.ok === true || (res.ok && !json.error)) && Boolean(json.data);
    if (!isSuccess || !json.data) {
      throw new Error(
        `${json.error?.code ?? 'PAYMENT_VERIFICATION_FAILED'}: ${
          json.error?.message ?? 'Payment verification failed'
        }`,
      );
    }

    const updatedBalance =
      json.data.availableCredits ?? json.data.balanceAfter ?? availableCredits;
    const creditsAdded =
      json.data.creditsAdded ?? json.data.order?.creditsGranted ?? 0;
    const verifiedPaymentId =
      json.data.paymentId ??
      json.data.order?.razorpayPaymentId ??
      paymentDetails?.paymentId ??
      orderId;

    setAvailableCredits(updatedBalance);
    setStatusBanner(
      `Razorpay HMAC-SHA256 verified (${verifiedPaymentId}) — +${creditsAdded} credits added to ledger.`,
    );
    await refreshBillingAndAuth();
  };

  // Google Session Login & Logout
  const handleLoginWithGoogle = async (input: {
    readonly uid?: string;
    readonly email: string;
    readonly displayName: string;
    readonly avatarUrl?: string | null;
    readonly idToken?: string;
  }) => {
    const resolvedIdToken = input.idToken?.trim() ?? '';
    if (!resolvedIdToken) {
      const msg = 'Verified Firebase ID token is required to sign in.';
      setErrorBanner(msg);
      throw new Error(msg);
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolvedIdToken}`,
    };
    const res = await apiFetch('/api/v1/auth/google', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        idToken: resolvedIdToken,
      }),
    });
    const json = (await res.json()) as {
      readonly ok?: boolean;
      readonly data?: {
        readonly sessionId?: string;
        readonly sessionExpiresAt?: string;
        readonly expiresAt?: string;
        readonly user?: PlatformUser & { readonly id?: string };
      } | null;
      readonly error?: {
        readonly code?: string;
        readonly message?: string;
      } | null;
    };

    const isSuccess =
      (json.ok === true || (res.ok && !json.error)) && Boolean(json.data?.user);

    if (!isSuccess || !json.data?.user) {
      const errMsg =
        json.error?.message ?? `Google sign-in failed (HTTP ${res.status})`;
      setErrorBanner(errMsg);
      throw new Error(errMsg);
    }

    const rawUser = json.data.user;
    const normalizedUser: PlatformUser = {
      userId: rawUser.userId ?? rawUser.id ?? 'usr_authenticated',
      email: rawUser.email,
      displayName: rawUser.displayName,
      avatarUrl: rawUser.avatarUrl ?? null,
      planId: rawUser.planId ?? 'plan_free',
    };
    setUser(normalizedUser);
    setErrorBanner(null);
    const sessionTag = (
      json.data.sessionId ??
      json.data.sessionExpiresAt ??
      'active'
    ).slice(0, 12);
    setStatusBanner(
      `Signed in as ${normalizedUser.displayName} (${normalizedUser.email} · session ${sessionTag}…).`,
    );
    await Promise.all([
      refreshBillingAndAuth(),
      refreshConversations(`conv_welcome_${normalizedUser.userId}`),
    ]);
  };

  const handleLogout = async () => {
    const res = await apiFetch('/api/v1/auth/logout', {
      method: 'POST',
    });
    const json = (await res.json()) as {
      readonly ok?: boolean;
      readonly error?: unknown;
    };
    if (json.ok === true || (res.ok && !json.error)) {
      setUser(null);
      setActiveCodeArtifact(null);
      setStatusBanner(
        'Signed out of Google session. Continuing in ready-to-use workspace.',
      );
      await Promise.all([refreshBillingAndAuth(), refreshConversations()]);
    }
  };

  const activeConversation = conversations.find(
    (c) => c.conversationId === activeConversationId,
  );

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#060911] text-slate-100 select-none">
      {/* Main 3-Pane Workspace Row */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Pane: Multi-Agent Sidebar */}
        <Sidebar
          isOpen={isSidebarOpen}
          conversations={conversations}
          activeConversationId={activeConversationId}
          uploadedFiles={uploadedFiles}
          user={user}
          availableCredits={availableCredits}
          onSelectConversation={(id) => void handleSelectConversation(id)}
          onCreateConversation={() => void handleCreateConversation()}
          onDeleteConversation={(id) => void handleDeleteConversation(id)}
          onOpenBilling={() => setIsBillingDrawerOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onLogout={() => void handleLogout()}
        />

        {/* Center Pane: Top Nav + Error/Status Toast + Scrollable Chat Thread + Multi-Agent Composer */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <Nav
            conversationTitle={
              activeConversation?.title ?? 'Kartik.ai Multi-Agent Workspace'
            }
            availableCredits={availableCredits}
            demoReadOnly={demoReadOnly}
            hasActiveArtifact={Boolean(activeCodeArtifact)}
            isArtifactPanelOpen={isArtifactPanelOpen}
            canReplayLastTurn={Boolean(lastTurnReplayPayload)}
            onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
            onToggleDemoReadOnly={() => void handleToggleDemoReadOnly()}
            onReplayLastTurn={() => void handleReplayLastTurn()}
            onToggleArtifactPanel={() =>
              setIsArtifactPanelOpen((prev) => !prev)
            }
            onOpenBillingDrawer={() => setIsBillingDrawerOpen(true)}
            onOpenFixDownloads={
              import.meta.env.DEV ? () => setIsFixDownloadsOpen(true) : undefined
            }
          />

          {/* Status / Error Banner */}
          {(errorBanner || statusBanner) && (
            <div
              className={`shrink-0 px-4 py-2 border-b flex items-center justify-between gap-3 text-xs ${
                errorBanner
                  ? 'bg-rose-950/70 border-rose-500/40 text-rose-200'
                  : 'bg-emerald-950/60 border-emerald-500/30 text-emerald-200'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {errorBanner ? (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span className="truncate font-medium">
                  {errorBanner ?? statusBanner}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setErrorBanner(null);
                  setStatusBanner(null);
                }}
                className="p-1 rounded hover:bg-slate-800/60 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Chat Thread + Composer */}
          <ChatArea
            messages={messages}
            isLoading={isTurnLoading}
            activeAgent={selectedAgent === 'auto' ? undefined : selectedAgent}
            onQuickPromptSelect={(prompt, agent) =>
              void handleQuickPromptSelect(prompt, agent)
            }
            onOpenCodeArtifact={(artifact) => {
              setActiveCodeArtifact(artifact);
              setIsArtifactPanelOpen(true);
            }}
          >
            <ChatInput
              selectedAgent={selectedAgent}
              onSelectAgent={setSelectedAgent}
              attachedFiles={attachedTurnFiles}
              onRemoveAttachedFile={handleRemoveAttachedFile}
              onUploadFile={handleUploadFile}
              onSendMessage={handleSendMessage}
              isLoading={isTurnLoading}
              demoReadOnly={demoReadOnly}
            />
          </ChatArea>
        </div>

        {/* Right Pane: Collapsible Code & Sandboxed Live Preview Panel */}
        <ArtifactPanel
          artifact={activeCodeArtifact}
          isOpen={isArtifactPanelOpen && Boolean(activeCodeArtifact)}
          isTurnLoading={isTurnLoading}
          onClose={() => setIsArtifactPanelOpen(false)}
          onAskAiToFix={(fixPrompt) =>
            void handleQuickPromptSelect(fixPrompt, 'coding')
          }
        />
      </div>

      {/* Billing & Credits Drawer (Starter ₹199 / Pro ₹499 + Razorpay Checkout + Ledger) */}
      <BillingDrawer
        isOpen={isBillingDrawerOpen}
        onClose={() => setIsBillingDrawerOpen(false)}
        availableCredits={availableCredits}
        activePlanId={user?.planId ?? 'plan_free'}
        plans={plans}
        ledger={ledger}
        demoReadOnly={demoReadOnly}
        onCreateOrder={handleCreateOrder}
        onVerifyPayment={handleVerifyPayment}
      />

      {/* Google OAuth & Session Cookie Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onGoogleSignIn={handleLoginWithGoogle}
      />

      {/* Fix & Changed Files Download Modal (Dev-only) */}
      {import.meta.env.DEV && isFixDownloadsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setIsFixDownloadsOpen(false)}
        >
          <div
            className="max-w-4xl w-full max-h-[88vh] flex flex-col bg-[#090d18] border border-slate-700/90 rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-950/80">
              <div>
                <h2 className="text-sm sm:text-base font-bold text-white">
                  Updated &amp; Changed Files + Git Commit Messages
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Download full fix ZIP packages or individual changed files with repo-relative paths
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsFixDownloadsOpen(false)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto">
              <StepFileDownloads />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
