import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FolderArchive,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  ArtifactRecord,
  UploadedFileRecord,
} from '../backend/services/agent/src/index.js';
import type { SpecialistAgentName } from '../backend/shared/contracts/index.js';
import type {
  PlatformConversation,
  PlatformCreditPlan,
  PlatformLedgerEntry,
  PlatformMessage,
  PlatformUser,
} from './server/platform-api-runtime.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { Nav } from './components/layout/Nav.js';
import { ChatArea } from './components/chat/ChatArea.js';
import { ChatInput } from './components/chat/ChatInput.js';
import { ArtifactPanel } from './components/artifacts/ArtifactPanel.js';
import { BillingDrawer } from './components/billing/BillingDrawer.js';
import { AuthModal } from './components/auth/AuthModal.js';
import { StepFileDownloads } from './dev-exports/StepFileDownloads.js';

interface ApiSuccessEnvelope<T> {
  readonly ok: true;
  readonly traceId: string;
  readonly requestId?: string;
  readonly data: T;
}

interface ApiErrorEnvelope {
  readonly ok: false;
  readonly traceId: string;
  readonly requestId?: string;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope;

const ARCHITECTURAL_INVARIANTS_SUMMARY = [
  '1–6. Strict 4-Service Boundaries (Auth, Chat, Agent, Billing) via Gateway (/api/v1/*)',
  '7–10. Private Storage & Qdrant User-Scoped Vector Isolation (404 on foreign IDs)',
  '11–12. Opaque-Origin <iframe sandbox="allow-scripts"> & Schema-Validated PDF 1.4 / PPTX',
  '15. Client-Owned Idempotency-Key -> requestId 0-Charge Replay Protection',
  '17–18. Integer Paise Accounting & Ordered Cascade Deletion (Vectors -> Objects -> DB)',
];

function createClientIdempotencyKey(): string {
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `idem_${Date.now().toString(36)}_${randomPart}`;
}

export function App() {
  // Layout & Drawer State
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isArtifactPanelOpen, setIsArtifactPanelOpen] = useState(true);
  const [isBillingDrawerOpen, setIsBillingDrawerOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isDevExportsDrawerOpen, setIsDevExportsDrawerOpen] = useState(false);
  const [showTopZipBar, setShowTopZipBar] = useState(true);

  // Platform State from `/api/v1/*`
  const [user, setUser] = useState<PlatformUser | null>({
    userId: 'usr_kartik_owner_01',
    email: 'kartikrawat9@gmail.com',
    displayName: 'Kartik Rawat',
    avatarUrl: null,
    planId: 'plan_free',
  });
  const [demoReadOnly, setDemoReadOnly] = useState(false);
  const [availableCredits, setAvailableCredits] = useState(250);
  const [plans, setPlans] = useState<readonly PlatformCreditPlan[]>([]);
  const [ledger, setLedger] = useState<readonly PlatformLedgerEntry[]>([]);

  // Conversations, Messages, Files & Active Code Artifact
  const [conversations, setConversations] = useState<
    readonly PlatformConversation[]
  >([]);
  const [activeConversationId, setActiveConversationId] =
    useState<string>('conv_welcome_01');
  const [messages, setMessages] = useState<readonly PlatformMessage[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<
    readonly UploadedFileRecord[]
  >([]);
  const [attachedTurnFiles, setAttachedTurnFiles] = useState<
    readonly UploadedFileRecord[]
  >([]);
  const [activeCodeArtifact, setActiveCodeArtifact] =
    useState<ArtifactRecord | null>(null);

  // Turn Execution & Replay State
  const [selectedAgent, setSelectedAgent] = useState<
    SpecialistAgentName | 'auto'
  >('auto');
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

  // Fetch initial workspace state from Port 3000 `/api/v1/*`
  const refreshBillingAndAuth = useCallback(async () => {
    try {
      const [authRes, billingRes, filesRes] = await Promise.all([
        fetch('/api/v1/auth/me'),
        fetch('/api/v1/billing/balance'),
        fetch('/api/v1/files'),
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
        setPlans(billingJson.data.plans);
        setLedger(billingJson.data.ledger);
      }

      const filesJson = (await filesRes.json()) as ApiEnvelope<{
        files: readonly UploadedFileRecord[];
      }>;
      if (filesJson.ok) {
        setUploadedFiles(filesJson.data.files);
      }
    } catch {
      // Non-fatal during initial mount
    }
  }, []);

  const loadConversationMessages = useCallback(async (convId: string) => {
    try {
      const res = await fetch(
        `/api/v1/conversations/${encodeURIComponent(convId)}/messages`,
      );
      const json = (await res.json()) as ApiEnvelope<{
        conversation: PlatformConversation;
        messages: readonly PlatformMessage[];
      }>;
      if (json.ok) {
        setMessages(json.data.messages);
        for (let i = json.data.messages.length - 1; i >= 0; i -= 1) {
          const msg = json.data.messages[i];
          const codeArt = msg?.artifacts?.find(
            (a) => a.artifactType === 'code_bundle',
          );
          if (codeArt) {
            setActiveCodeArtifact(codeArt);
            break;
          }
        }
      }
    } catch {
      // Ignore network hiccup
    }
  }, []);

  const refreshConversations = useCallback(
    async (targetConversationId?: string) => {
      try {
        const res = await fetch('/api/v1/conversations');
        const json = (await res.json()) as ApiEnvelope<{
          conversations: readonly PlatformConversation[];
        }>;
        if (json.ok) {
          setConversations(json.data.conversations);
          const chosenId =
            targetConversationId ??
            json.data.conversations[0]?.conversationId ??
            'conv_welcome_01';
          setActiveConversationId(chosenId);
          await loadConversationMessages(chosenId);
        }
      } catch {
        // Ignore network hiccup
      }
    },
    [loadConversationMessages],
  );

  useEffect(() => {
    void refreshBillingAndAuth();
    void refreshConversations('conv_welcome_01');
  }, [refreshBillingAndAuth, refreshConversations]);

  // Conversation selection, creation & cascade deletion
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
        headers: { 'Content-Type': 'application/json' },
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

      await loadConversationMessages(input.conversationId);
      await refreshConversations(input.conversationId);
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
        headers: { 'Content-Type': 'application/json' },
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
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createClientIdempotencyKey(),
      },
      body: JSON.stringify({ planId }),
    });
    const json = (await res.json()) as ApiEnvelope<{
      orderId: string;
      razorpayKeyId: string;
      plan: PlatformCreditPlan;
      amountPaise: number;
      currency: 'INR';
    }>;
    if (!json.ok) {
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    return {
      orderId: json.data.orderId,
      planName: json.data.plan.name,
      amountPaise: json.data.amountPaise,
      amountInrLabel: json.data.plan.amountInrLabel,
      creditsGranted: json.data.plan.creditsGranted,
    };
  };

  const handleVerifyPayment = async (orderId: string) => {
    const res = await fetch('/api/v1/billing/verify-checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createClientIdempotencyKey(),
      },
      body: JSON.stringify({ orderId }),
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
    readonly email: string;
    readonly displayName: string;
  }) => {
    const res = await fetch('/api/v1/auth/google', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
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
    }
  };

  const handleLogout = async () => {
    const res = await fetch('/api/v1/auth/logout', { method: 'POST' });
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
      {/* Top Collapsible Micro-Step ZIP Export Bar */}
      {showTopZipBar && (
        <div className="shrink-0 bg-slate-950 border-b border-emerald-500/30 px-4 py-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="px-2 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/40 text-[10px] font-mono font-semibold text-emerald-300 uppercase shrink-0">
              Step 9.5.a Ready
            </span>
            <span className="text-xs text-slate-300 truncate">
              Phase 15 Multi-Agent Platform UI Complete — 7 Agent Selector Pills, Live Sandbox, Voice Mic, Starter ₹199 / Pro ₹499 Billing &amp; Auth
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href="/__downloads/step-9.5.a.zip"
              download="step-9.5.a.zip"
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs transition-colors"
            >
              <FolderArchive className="w-3.5 h-3.5" />
              Download step-9.5.a.zip
            </a>
            <button
              type="button"
              onClick={() => setIsDevExportsDrawerOpen(true)}
              className="px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs cursor-pointer"
            >
              All Step ZIPs
            </button>
            <button
              type="button"
              onClick={() => setShowTopZipBar(false)}
              title="Dismiss top bar (accessible anytime via Dev & ZIPs in Nav)"
              className="p-1 rounded text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

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
            onOpenDevExportsDrawer={() => setIsDevExportsDrawerOpen(true)}
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

      {/* Dev & ZIP Exports Drawer (StepFileDownloads + 20 Blueprint Invariants) */}
      {isDevExportsDrawerOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex justify-end"
          onClick={() => setIsDevExportsDrawerOpen(false)}
        >
          <div
            className="w-full max-w-2xl h-full bg-[#090d18] border-l border-slate-800 flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FolderArchive className="w-5 h-5 text-emerald-400" />
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Kartik.ai Developer Inspector &amp; Step ZIP Exports
                  </h2>
                  <p className="text-xs text-slate-400">
                    Download micro-step bundles and inspect Blueprint v4.3 compliance
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsDevExportsDrawerOpen(false)}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-emerald-400 mb-3">
                  Micro-Step ZIP Archives (Preserves Exact Repo Paths)
                </h3>
                <StepFileDownloads />
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-sky-300">
                  <ShieldCheck className="w-4 h-4 text-sky-400" />
                  Verified Blueprint v4.3 Architectural Invariants
                </div>
                <ul className="space-y-1.5 text-xs text-slate-300">
                  {ARCHITECTURAL_INVARIANTS_SUMMARY.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
