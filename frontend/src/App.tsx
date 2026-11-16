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

import React, { useCallback, useEffect, useState } from 'react';
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

function createClientIdempotencyKey(): string {
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function App() {
  // Layout & Drawer State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isArtifactPanelOpen, setIsArtifactPanelOpen] = useState(false);
  const [isBillingDrawerOpen, setIsBillingDrawerOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

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

  const refreshBillingAndAuth = useCallback(async () => {
    try {
      const [authRes, billingRes, filesRes] = await Promise.all([
        fetch('/api/v1/auth/me', { credentials: 'include' }),
        fetch('/api/v1/billing/balance', { credentials: 'include' }),
        fetch('/api/v1/files', { credentials: 'include' }),
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
    try {
      const res = await fetch(
        `/api/v1/conversations/${encodeURIComponent(convId)}/messages`,
        { credentials: 'include' },
      );
      const json = (await res.json()) as ApiEnvelope<{
        conversation: PlatformConversation;
        messages?: readonly PlatformMessage[];
        items?: readonly PlatformMessage[];
      }>;
      if (json.ok) {
        const loadedMessages = json.data.messages ?? json.data.items ?? [];
        setMessages(loadedMessages);
        const latestCodeArt = [...loadedMessages]
          .reverse()
          .flatMap((m) => m.artifacts ?? [])
          .find((a) => a.artifactType === 'code_bundle');
        if (latestCodeArt) {
          setActiveCodeArtifact(latestCodeArt);
        }
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const refreshConversations = useCallback(
    async (preferredConvId?: string) => {
      try {
        const res = await fetch('/api/v1/conversations', {
          credentials: 'include',
        });
        const json = (await res.json()) as ApiEnvelope<{
          conversations?: readonly PlatformConversation[];
          items?: readonly PlatformConversation[];
        }>;
        if (json.ok) {
          const list = json.data.conversations ?? json.data.items ?? [];
          setConversations(list);
          const targetId =
            preferredConvId ??
            (list.some((c) => c.conversationId === activeConversationId)
              ? activeConversationId
              : list[0]?.conversationId);
          if (targetId) {
            setActiveConversationId(targetId);
            await loadConversationMessages(targetId);
          }
        }
      } catch {
        // Non-fatal
      }
    },
    [activeConversationId, loadConversationMessages],
  );

  useEffect(() => {
    void refreshBillingAndAuth();
    void refreshConversations('conv_welcome_01');
  }, [refreshBillingAndAuth, refreshConversations]);

  const handleSelectConversation = async (conversationId: string) => {
    setActiveConversationId(conversationId);
    setErrorBanner(null);
    await loadConversationMessages(conversationId);
  };

  const handleCreateConversation = async () => {
    setErrorBanner(null);
    try {
      const res = await fetch('/api/v1/conversations', {
        method: 'POST',
        credentials: 'include',
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
      await refreshConversations(json.data.conversationId);
      setActiveCodeArtifact(null);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to create conversation.',
      );
    }
  };

  const handleDeleteConversation = async (conversationId: string) => {
    setErrorBanner(null);
    try {
      const res = await fetch(
        `/api/v1/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
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
      const res = await fetch(
        `/api/v1/conversations/${encodeURIComponent(input.conversationId)}/messages`,
        {
          method: 'POST',
          credentials: 'include',
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

      setLastTurnReplayPayload(input);
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

      const resolvedConvId = json.data.conversationId || input.conversationId;
      setActiveConversationId(resolvedConvId);
      setMessages((prev) => {
        const exists = prev.some(
          (m) => m.messageId === json.data.assistantMessage.messageId,
        );
        if (exists) {
          return prev;
        }
        return [...prev, json.data.userMessage, json.data.assistantMessage];
      });

      await loadConversationMessages(resolvedConvId);
      await refreshConversations(resolvedConvId);
      await refreshBillingAndAuth();
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
      conversationId: activeConversationId,
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
      const res = await fetch('/api/v1/files/upload', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createClientIdempotencyKey(),
        },
        body: JSON.stringify({
          conversationId: activeConversationId,
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
      const res = await fetch('/api/v1/demo/toggle-read-only', {
        method: 'POST',
        credentials: 'include',
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
    const res = await fetch('/api/v1/billing/orders', {
      method: 'POST',
      credentials: 'include',
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
    const res = await fetch('/api/v1/billing/verify-checkout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createClientIdempotencyKey(),
      },
      body: JSON.stringify({
        orderId,
        paymentId: paymentDetails?.paymentId,
        signature: paymentDetails?.signature,
      }),
    });
    const json = (await res.json()) as ApiEnvelope<{
      verified: boolean;
      orderId: string;
      paymentId: string;
      signature: string;
      availableCredits: number;
      creditsAdded: number;
      planId: string;
    }>;
    if (!json.ok) {
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    setAvailableCredits(json.data.availableCredits);
    setStatusBanner(
      `Razorpay HMAC-SHA256 verified (${json.data.paymentId}) — +${json.data.creditsAdded} credits added to ledger.`,
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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (input.idToken) {
      headers['Authorization'] = `Bearer ${input.idToken}`;
    }
    const res = await fetch('/api/v1/auth/google', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({
        uid: input.uid,
        email: input.email,
        displayName: input.displayName,
        avatarUrl: input.avatarUrl,
      }),
    });
    const json = (await res.json()) as ApiEnvelope<{
      sessionId: string;
      user: PlatformUser;
      expiresAt: string;
    }>;
    if (json.ok) {
      setUser(json.data.user);
      setStatusBanner(
        `Signed in as ${json.data.user.displayName} (HttpOnly session ${json.data.sessionId.slice(0, 12)}…).`,
      );
      await refreshConversations(activeConversationId);
    }
  };

  const handleLogout = async () => {
    const res = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    const json = (await res.json()) as ApiEnvelope<{ loggedOut: boolean }>;
    if (json.ok) {
      setUser(null);
      setStatusBanner('Signed out and revoked server-side session cookie.');
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
          onClose={() => setIsArtifactPanelOpen(false)}
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
    </div>
  );
}

export default App;
