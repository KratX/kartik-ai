/**
 * @file frontend/src/App.tsx
 * @description Kartik.ai Obsidian & White 3-Pane Multi-Agent Production Workspace (`@kartik/frontend`).
 *
 * Connects exclusively to the API Gateway (`/api/v1/*`) (Blueprint Invariant #1):
 * - Left Pane: Spring-collapsible `Sidebar` (Date-grouped threads, Pin/Rename/Delete, Slim Icon Rail, Mobile Drawer, Thread Files, Balance & Auth)
 * - Center Pane: Razor-clean `Nav` (Inline title rename, ⌘K trigger, Canvas toggle, Credits, Developer Tools MorphingPopover)
 *   + `ChatArea` (21st.dev Hero Empty State with BackgroundBeams + SpotlightCard starters, Editorial Borderless Stream, Drag-and-Drop Upload, Lightbox)
 *   + Floating `BorderBeam` `ChatInput` (Slash `/` Commands, Specialist MorphingPopover, Spring Depth Toggle)
 * - Right Pane: Auto-opening Universal Split-Screen `ArtifactPanel` (Code Sandbox IDE, Editorial PDF Reader, 16:9 Slide Studio, Artwork Studio + Draggable Resize + Multi-Artifact Switcher)
 * - Global Overlays: `CommandPalette` (⌘K / Ctrl+K), `BillingDrawer`, `AuthModal`, and Dev-only `StepFileDownloads`.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type {
  ApiEnvelope,
  ArtifactRecord,
  ChatResponseDepth,
  PlatformConversation,
  PlatformCreditPlan,
  PlatformLedgerEntry,
  PlatformMessage,
  PlatformUser,
  SpecialistAgentName,
  UploadedFileRecord,
} from './types/index.js';
import {
  buildChatHandoffPrompt,
  type AgentSelectorPillSpec,
} from './components/slide-deck-and-markdown.js';
import {
  clampCanvasWidthPct,
  extractThreadArtifacts,
} from './components/workspace-ux-helpers.js';
import { ArtifactPanel } from './components/artifacts/ArtifactPanel.js';
import { AuthModal } from './components/auth/AuthModal.js';
import { BillingDrawer } from './components/billing/BillingDrawer.js';
import { ChatArea } from './components/chat/ChatArea.js';
import { ChatInput } from './components/chat/ChatInput.js';
import { AttachmentLightbox } from './components/common/AttachmentLightbox.js';
import { CommandPalette } from './components/common/CommandPalette.js';
import { ShortcutsModal } from './components/common/ShortcutsModal.js';
import {
  ToastStack,
  type WorkspaceToast,
  type WorkspaceToastTone,
} from './components/common/ToastStack.js';
import { Nav } from './components/layout/Nav.js';
import { Sidebar } from './components/layout/Sidebar.js';
import { StepFileDownloads } from './components/common/StepFileDownloads.js';

function createClientIdempotencyKey(): string {
  return `idem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const GUEST_ID_STORAGE_KEY = 'kartik_ai_guest_workspace_id';
const SIDEBAR_COLLAPSED_KEY = 'kartik_ai_sidebar_collapsed';
const CANVAS_WIDTH_PCT_KEY = 'kartik_ai_canvas_width_pct';
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

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // Ignore storage errors
  }
  return fallback;
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw !== null) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  } catch {
    // Ignore storage errors
  }
  return fallback;
}

function readWorkspacePrefs(scopeKey: string): {
  readonly pinnedIds: string[];
  readonly titleOverrides: Record<string, string>;
} {
  try {
    const raw = window.localStorage.getItem(`kartik_ai_thread_prefs_${scopeKey}`);
    if (!raw) return { pinnedIds: [], titleOverrides: {} };
    const parsed = JSON.parse(raw) as {
      pinnedIds?: unknown;
      titleOverrides?: unknown;
    };
    const pinnedIds = Array.isArray(parsed.pinnedIds)
      ? parsed.pinnedIds.filter((v): v is string => typeof v === 'string')
      : [];
    const titleOverrides: Record<string, string> = {};
    if (parsed.titleOverrides && typeof parsed.titleOverrides === 'object') {
      for (const [k, v] of Object.entries(
        parsed.titleOverrides as Record<string, unknown>,
      )) {
        if (typeof v === 'string' && v.trim()) {
          titleOverrides[k] = v.trim();
        }
      }
    }
    return { pinnedIds, titleOverrides };
  } catch {
    return { pinnedIds: [], titleOverrides: {} };
  }
}

function writeWorkspacePrefs(
  scopeKey: string,
  pinnedIds: ReadonlySet<string>,
  titleOverrides: Readonly<Record<string, string>>,
): void {
  try {
    window.localStorage.setItem(
      `kartik_ai_thread_prefs_${scopeKey}`,
      JSON.stringify({
        pinnedIds: Array.from(pinnedIds),
        titleOverrides,
      }),
    );
  } catch {
    // Ignore storage quota restrictions
  }
}

function deriveConversationTitle(seedPrompt?: string): string {
  const cleaned = (seedPrompt ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return 'New Session';
  }
  return cleaned.length > 54 ? `${cleaned.slice(0, 51)}…` : cleaned;
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
  // Layout, Sidebar, Canvas & Overlay State
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() =>
    readStoredBoolean(SIDEBAR_COLLAPSED_KEY, false),
  );
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isArtifactPanelOpen, setIsArtifactPanelOpen] = useState(false);
  const [canvasWidthPct, setCanvasWidthPct] = useState<number>(() =>
    clampCanvasWidthPct(readStoredNumber(CANVAS_WIDTH_PCT_KEY, 48)),
  );
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isBillingDrawerOpen, setIsBillingDrawerOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isFixDownloadsOpen, setIsFixDownloadsOpen] = useState(false);
  const [previewAttachment, setPreviewAttachment] =
    useState<UploadedFileRecord | null>(null);
  const [lightboxImage, setLightboxImage] = useState<{
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  } | null>(null);

  // Domain State from `/api/v1/*`
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [demoReadOnly, setDemoReadOnly] = useState(false);
  const [availableCredits, setAvailableCredits] = useState(250);
  const [plans, setPlans] = useState<readonly PlatformCreditPlan[]>([]);
  const [ledger, setLedger] = useState<readonly PlatformLedgerEntry[]>([]);
  const [conversations, setConversations] = useState<
    readonly PlatformConversation[]
  >([]);
  // Start in Hero Empty State (`null`) so first paint is calm and immediate
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<readonly PlatformMessage[]>([]);
  const [streamingMessageIds, setStreamingMessageIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [threadArtifactTypes, setThreadArtifactTypes] = useState<
    Readonly<Record<string, ArtifactRecord['artifactType']>>
  >({});
  const [uploadedFiles, setUploadedFiles] = useState<
    readonly UploadedFileRecord[]
  >([]);

  // Local Workspace Organization (Pin + Rename persisted per user/guest scope)
  const prefsScopeKey = user?.userId ?? getOrCreateClientGuestId();
  const [pinnedIds, setPinnedIds] = useState<ReadonlySet<string>>(
    () => new Set(readWorkspacePrefs(prefsScopeKey).pinnedIds),
  );
  const [titleOverrides, setTitleOverrides] = useState<
    Readonly<Record<string, string>>
  >(() => readWorkspacePrefs(prefsScopeKey).titleOverrides);

  // Turn Composer & Universal Canvas State
  const [selectedAgent, setSelectedAgent] =
    useState<AgentSelectorPillSpec['id']>('chat');
  const [responseDepth, setResponseDepth] =
    useState<ChatResponseDepth>('balanced');
  const [attachedTurnFiles, setAttachedTurnFiles] = useState<
    readonly UploadedFileRecord[]
  >([]);
  const [activeArtifact, setActiveArtifact] = useState<ArtifactRecord | null>(
    null,
  );
  const [isTurnLoading, setIsTurnLoading] = useState(false);
  const [toasts, setToasts] = useState<readonly WorkspaceToast[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());
  const [lastTurnReplayPayload, setLastTurnReplayPayload] = useState<{
    readonly conversationId: string;
    readonly requestId: string;
    readonly prompt: string;
    readonly preferredAgent?: SpecialistAgentName;
    readonly responseDepth?: ChatResponseDepth;
    readonly attachmentFileIds?: string[];
  } | null>(null);

  const activeConversationIdRef = useRef<string | null>(activeConversationId);
  const messagesLoadSeqRef = useRef(0);
  const hasBootstrappedRef = useRef(false);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (message: string, tone: WorkspaceToastTone = 'info') => {
      const id = `toast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      setToasts((prev) => [...prev.slice(-2), { id, message, tone }]);
      const durationMs = tone === 'error' ? 6000 : 3800;
      const timer = window.setTimeout(() => {
        toastTimersRef.current.delete(id);
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, durationMs);
      toastTimersRef.current.set(id, timer);
    },
    [],
  );

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  const setActiveConversationIdSafe = useCallback((convId: string | null) => {
    activeConversationIdRef.current = convId;
    setActiveConversationId(convId);
  }, []);

  const handleStreamComplete = useCallback((messageId: string) => {
    setStreamingMessageIds((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  // Re-sync persisted pins & renames when auth user switches
  useEffect(() => {
    const prefs = readWorkspacePrefs(prefsScopeKey);
    setPinnedIds(new Set(prefs.pinnedIds));
    setTitleOverrides(prefs.titleOverrides);
  }, [prefsScopeKey]);

  const threadArtifacts = useMemo(
    () => extractThreadArtifacts(messages),
    [messages],
  );

  // Keep activeArtifact aligned if thread changes and activeArtifact is null while artifacts exist
  useEffect(() => {
    if (threadArtifacts.length === 0) {
      setActiveArtifact(null);
      return;
    }
    if (
      !activeArtifact ||
      !threadArtifacts.some((a) => a.artifactId === activeArtifact.artifactId)
    ) {
      setActiveArtifact(threadArtifacts[threadArtifacts.length - 1] ?? null);
    }
  }, [threadArtifacts, activeArtifact]);

  const handleToggleSidebar = useCallback(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setIsMobileSidebarOpen((prev) => !prev);
      return;
    }
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {
        // Ignore storage restrictions
      }
      return next;
    });
  }, []);

  // Global Keyboard Shortcuts: ⌘K Command Palette, ⌘B Sidebar Rail, ? Shortcuts Sheet
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }
      if (mod && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        handleToggleSidebar();
        return;
      }
      if (event.key === '?' && !mod && !event.altKey) {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName?.toLowerCase() ?? '';
        const isEditable =
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          Boolean(target?.isContentEditable);
        if (!isEditable) {
          event.preventDefault();
          setIsShortcutsModalOpen((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleToggleSidebar]);

  const handleResizeCanvasWidthPct = useCallback((nextPct: number) => {
    const clamped = clampCanvasWidthPct(nextPct);
    setCanvasWidthPct(clamped);
    try {
      window.localStorage.setItem(CANVAS_WIDTH_PCT_KEY, String(clamped));
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const handleTogglePinConversation = useCallback(
    (conversationId: string) => {
      setPinnedIds((prev) => {
        const next = new Set(prev);
        const wasPinned = next.has(conversationId);
        if (wasPinned) {
          next.delete(conversationId);
        } else {
          next.add(conversationId);
        }
        writeWorkspacePrefs(prefsScopeKey, next, titleOverrides);
        pushToast(wasPinned ? 'Thread unpinned' : 'Thread pinned to top', 'info');
        return next;
      });
    },
    [prefsScopeKey, pushToast, titleOverrides],
  );

  const handleRenameConversation = useCallback(
    (conversationId: string, newTitle: string) => {
      const trimmed = newTitle.trim();
      if (!trimmed) return;
      setTitleOverrides((prev) => {
        const next = { ...prev, [conversationId]: trimmed };
        writeWorkspacePrefs(prefsScopeKey, pinnedIds, next);
        return next;
      });
      pushToast(`Renamed thread to "${trimmed}"`, 'success');
    },
    [prefsScopeKey, pinnedIds, pushToast],
  );

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
        setStreamingMessageIds(new Set());
        setMessages(loadedMessages);
        const extracted = extractThreadArtifacts(loadedMessages);
        const latestArtifact = extracted[extracted.length - 1] ?? null;
        setActiveArtifact(latestArtifact);
        if (latestArtifact) {
          setThreadArtifactTypes((prev) => ({
            ...prev,
            [convId]: latestArtifact.artifactType,
          }));
        }
        if (extracted.length === 0) {
          setIsArtifactPanelOpen(false);
        }
      }
    } catch {
      // Non-fatal
    }
  }, []);

  const refreshConversations = useCallback(
    async (
      preferredConvId?: string,
      options?: {
        readonly skipMessageReload?: boolean;
        readonly preserveHeroIfUnset?: boolean;
      },
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
          if (!preferredConvId && currentActive === null && options?.preserveHeroIfUnset) {
            return;
          }

          const targetId =
            (preferredConvId &&
            list.some((c) => c.conversationId === preferredConvId)
              ? preferredConvId
              : undefined) ??
            (currentActive &&
            list.some((c) => c.conversationId === currentActive)
              ? currentActive
              : null);

          if (targetId) {
            setActiveConversationIdSafe(targetId);
            if (!options?.skipMessageReload) {
              await loadConversationMessages(targetId);
            }
          } else {
            setActiveConversationIdSafe(null);
            setMessages([]);
            setActiveArtifact(null);
            setIsArtifactPanelOpen(false);
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
    void refreshConversations(undefined, { preserveHeroIfUnset: true });
  }, [refreshBillingAndAuth, refreshConversations]);

  const handleSelectConversation = async (conversationId: string) => {
    setStreamingMessageIds(new Set());
    setActiveConversationIdSafe(conversationId);
    await loadConversationMessages(conversationId);
  };

  // New Chat / Brand Home cleanly resets straight to the calm 21st.dev Hero Empty State
  const handleCreateConversation = () => {
    messagesLoadSeqRef.current += 1;
    setStreamingMessageIds(new Set());
    setActiveConversationIdSafe(null);
    setMessages([]);
    setAttachedTurnFiles([]);
    setActiveArtifact(null);
    setIsArtifactPanelOpen(false);
    setSelectedAgent('chat');
  };

  // Lazily provisions a conversation via POST /api/v1/conversations when starting from Hero Mode
  const ensureActiveConversationId = async (
    seedPrompt?: string,
  ): Promise<string> => {
    if (activeConversationIdRef.current) {
      return activeConversationIdRef.current;
    }
    const res = await apiFetch('/api/v1/conversations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': createClientIdempotencyKey(),
      },
      body: JSON.stringify({ title: deriveConversationTitle(seedPrompt) }),
    });
    const json = (await res.json()) as ApiEnvelope<PlatformConversation>;
    if (!json.ok) {
      throw new Error(`${json.error.code}: ${json.error.message}`);
    }
    setActiveConversationIdSafe(json.data.conversationId);
    setConversations((prev) => [
      json.data,
      ...prev.filter((c) => c.conversationId !== json.data.conversationId),
    ]);
    return json.data.conversationId;
  };

  const handleDeleteConversation = async (conversationId: string) => {
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
        pushToast(`${json.error.code}: ${json.error.message}`, 'error');
        return;
      }
      if (activeConversationIdRef.current === conversationId) {
        setStreamingMessageIds(new Set());
        setActiveConversationIdSafe(null);
        setMessages([]);
        setActiveArtifact(null);
        setIsArtifactPanelOpen(false);
      }
      pushToast(
        `Deleted thread (${json.data.purgedSummary.purgedVectorChunks} vector chunks & ${json.data.purgedSummary.purgedStorageKeys.length} objects purged).`,
        'success',
      );
      await refreshConversations(undefined, { preserveHeroIfUnset: true });
      await refreshBillingAndAuth();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'Failed to delete conversation.',
        'error',
      );
    }
  };

  // Send or replay a Multi-Agent Turn
  const executeTurnRequest = async (input: {
    readonly conversationId?: string | null;
    readonly requestId: string;
    readonly prompt: string;
    readonly preferredAgent?: SpecialistAgentName;
    readonly responseDepth?: ChatResponseDepth;
    readonly attachmentFileIds?: string[];
  }) => {
    setIsTurnLoading(true);

    try {
      const targetConvId =
        input.conversationId || (await ensureActiveConversationId(input.prompt));

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
            responseDepth: input.responseDepth,
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
        pushToast(`${json.error.code}: ${json.error.message}`, 'error');
        return;
      }

      const resolvedConvId = json.data.conversationId || targetConvId;
      setLastTurnReplayPayload({
        conversationId: resolvedConvId,
        requestId: input.requestId,
        prompt: input.prompt,
        preferredAgent: input.preferredAgent,
        responseDepth: input.responseDepth,
        attachmentFileIds: input.attachmentFileIds,
      });
      setAvailableCredits(json.data.remainingCredits);
      setAttachedTurnFiles([]);

      if (json.data.idempotentReplay) {
        pushToast(
          `Idempotent replay verified (${json.data.requestId}) — 0 credits deducted.`,
          'success',
        );
      }

      // Auto-open Universal Split-Screen Artifact Canvas for ANY generated artifact
      const generatedArtifacts = json.data.assistantMessage.artifacts ?? [];
      const newestArtifact = generatedArtifacts[generatedArtifacts.length - 1];
      if (newestArtifact) {
        setActiveArtifact(newestArtifact);
        setIsArtifactPanelOpen(true);
        setThreadArtifactTypes((prev) => ({
          ...prev,
          [resolvedConvId]: newestArtifact.artifactType,
        }));
      }

      messagesLoadSeqRef.current += 1;
      setActiveConversationIdSafe(resolvedConvId);

      // Stream newly generated assistant replies smoothly character-by-character
      if (!json.data.idempotentReplay) {
        setStreamingMessageIds((prev) => {
          const next = new Set(prev);
          next.add(json.data.assistantMessage.messageId);
          return next;
        });
      }

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
      pushToast(
        err instanceof Error ? err.message : 'Failed to execute agent turn.',
        'error',
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
      conversationId: activeConversationIdRef.current,
      requestId: createClientIdempotencyKey(),
      prompt,
      preferredAgent,
      responseDepth,
      attachmentFileIds: attachedTurnFiles.map((f) => f.fileId),
    });
  };

  const handleEditPrompt = async (editedPrompt: string) => {
    const trimmed = editedPrompt.trim();
    if (!trimmed || isTurnLoading || demoReadOnly) return;
    pushToast('Re-running edited prompt…', 'info');
    await handleSendMessage(
      trimmed,
      selectedAgent === 'chat' ? undefined : selectedAgent,
    );
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
    await handleSendMessage(prompt, agent === 'chat' ? undefined : agent);
  };

  const findPairedUserMessage = (
    assistantMessageId: string,
  ): PlatformMessage | undefined => {
    const idx = messages.findIndex((m) => m.messageId === assistantMessageId);
    if (idx <= 0) {
      return undefined;
    }
    for (let i = idx - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === 'user') {
        return messages[i];
      }
    }
    return undefined;
  };

  const handleRegenerateMessage = async (assistantMessage: PlatformMessage) => {
    const pairedUser = findPairedUserMessage(assistantMessage.messageId);
    if (!pairedUser || isTurnLoading || demoReadOnly) {
      return;
    }
    const preferredAgent: SpecialistAgentName | undefined =
      assistantMessage.routedFromChat || assistantMessage.agentUsed === 'chat'
        ? undefined
        : assistantMessage.agentUsed;
    await executeTurnRequest({
      conversationId: activeConversationIdRef.current,
      requestId: createClientIdempotencyKey(),
      prompt: pairedUser.content,
      preferredAgent,
      responseDepth,
      attachmentFileIds: (pairedUser.attachedFiles ?? []).map((f) => f.fileId),
    });
  };

  const handleHandoffToSpecialist = async (
    target: 'pdf' | 'ppt' | 'search',
    assistantMessage: PlatformMessage,
  ) => {
    if (isTurnLoading || demoReadOnly) {
      return;
    }
    const pairedUser = findPairedUserMessage(assistantMessage.messageId);
    const handoffPrompt = buildChatHandoffPrompt(
      target,
      assistantMessage.content,
      pairedUser?.content,
    );
    setSelectedAgent(target);
    await executeTurnRequest({
      conversationId: activeConversationIdRef.current,
      requestId: createClientIdempotencyKey(),
      prompt: handoffPrompt,
      preferredAgent: target,
      responseDepth,
      attachmentFileIds: [],
    });
  };

  // Upload PDF or Image for RAG / Multimodal Vision (works from Hero, Dock, or Drag-and-Drop)
  const handleUploadFile = async (file: {
    readonly originalFilename: string;
    readonly declaredMimeType: string;
    readonly contentBase64: string;
  }): Promise<void> => {
    try {
      const targetConvId = await ensureActiveConversationId(
        `Analyze ${file.originalFilename}`,
      );
      const res = await apiFetch('/api/v1/files/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': createClientIdempotencyKey(),
        },
        body: JSON.stringify({
          conversationId: targetConvId,
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
        pushToast(`${json.error.code}: ${json.error.message}`, 'error');
        return;
      }

      setAttachedTurnFiles((prev) => [...prev, json.data.file]);
      const uploadedFile = json.data.file;
      if (uploadedFile.mimeType.startsWith('image/')) {
        setSelectedAgent('vision');
      } else if (
        uploadedFile.mimeType === 'application/pdf' ||
        uploadedFile.originalFilename.toLowerCase().endsWith('.pdf')
      ) {
        setSelectedAgent('rag');
      }
      pushToast(
        uploadedFile.mimeType.startsWith('image/')
          ? `Attached "${uploadedFile.originalFilename}" — ready for Vision inspection.`
          : `Indexed "${uploadedFile.originalFilename}" (${json.data.chunkCount} vector chunks).`,
        'success',
      );
      await refreshBillingAndAuth();
    } catch (err) {
      pushToast(
        err instanceof Error ? err.message : 'File upload failed.',
        'error',
      );
    }
  };

  const handleRemoveAttachedFile = (fileId: string) => {
    setAttachedTurnFiles((prev) => prev.filter((f) => f.fileId !== fileId));
  };

  // Toggle DEMO_READ_ONLY kill switch
  const handleToggleDemoReadOnly = async () => {
    try {
      const res = await apiFetch('/api/v1/demo/toggle-read-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !demoReadOnly }),
      });
      const json = (await res.json()) as ApiEnvelope<{ demoReadOnly: boolean }>;
      if (json.ok) {
        setDemoReadOnly(json.data.demoReadOnly);
        pushToast(
          json.data.demoReadOnly
            ? 'DEMO_READ_ONLY activated — mutations return HTTP 403.'
            : 'DEMO_READ_ONLY disabled — workspace mutations enabled.',
          json.data.demoReadOnly ? 'warning' : 'success',
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
    pushToast(
      `Razorpay HMAC-SHA256 verified (${verifiedPaymentId}) — +${creditsAdded} credits added.`,
      'success',
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
      pushToast(msg, 'error');
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
      pushToast(errMsg, 'error');
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
    const sessionTag = (
      json.data.sessionId ??
      json.data.sessionExpiresAt ??
      'active'
    ).slice(0, 12);
    pushToast(
      `Signed in as ${normalizedUser.displayName} (${sessionTag}…).`,
      'success',
    );
    await Promise.all([
      refreshBillingAndAuth(),
      refreshConversations(undefined, { preserveHeroIfUnset: true }),
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
      setStreamingMessageIds(new Set());
      setActiveConversationIdSafe(null);
      setMessages([]);
      setActiveArtifact(null);
      setIsArtifactPanelOpen(false);
      pushToast('Signed out. Continuing in guest workspace.', 'info');
      await Promise.all([
        refreshBillingAndAuth(),
        refreshConversations(undefined, { preserveHeroIfUnset: true }),
      ]);
    }
  };

  const activeConversation = conversations.find(
    (c) => c.conversationId === activeConversationId,
  );
  const resolvedActiveTitle = activeConversation
    ? titleOverrides[activeConversation.conversationId]?.trim() ||
      activeConversation.title
    : 'Kartik.ai';
  const isHeroMode =
    activeConversationId === null && messages.length === 0 && !isTurnLoading;

  const sharedComposerProps = {
    selectedAgent,
    onSelectAgent: setSelectedAgent,
    responseDepth,
    onSelectResponseDepth: setResponseDepth,
    attachedFiles: attachedTurnFiles,
    onRemoveAttachedFile: handleRemoveAttachedFile,
    onOpenAttachment: setPreviewAttachment,
    onUploadFile: handleUploadFile,
    onSendMessage: handleSendMessage,
    isLoading: isTurnLoading,
    demoReadOnly,
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-[#09090b] text-zinc-100 select-none">
      {/* Main 3-Pane Workspace Row */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Pane: Spring-Collapsible Obsidian Sidebar + Slim Rail + Mobile Drawer */}
        <Sidebar
          isCollapsed={isSidebarCollapsed}
          isMobileOpen={isMobileSidebarOpen}
          onCloseMobile={() => setIsMobileSidebarOpen(false)}
          conversations={conversations}
          activeConversationId={activeConversationId}
          pinnedIds={pinnedIds}
          titleOverrides={titleOverrides}
          threadArtifactTypes={threadArtifactTypes}
          uploadedFiles={uploadedFiles}
          user={user}
          availableCredits={availableCredits}
          onSelectConversation={(id) => void handleSelectConversation(id)}
          onCreateConversation={handleCreateConversation}
          onDeleteConversation={(id) => void handleDeleteConversation(id)}
          onTogglePinConversation={handleTogglePinConversation}
          onRenameConversation={handleRenameConversation}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
          onOpenBilling={() => setIsBillingDrawerOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onLogout={() => void handleLogout()}
        />

        {/* Center Pane: Razor-Clean Nav + Hero/Editorial Stream + Floating Composer */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <Nav
            conversationTitle={resolvedActiveTitle}
            isHeroMode={isHeroMode}
            availableCredits={availableCredits}
            demoReadOnly={demoReadOnly}
            artifactCount={threadArtifacts.length}
            isArtifactPanelOpen={isArtifactPanelOpen && Boolean(activeArtifact)}
            canReplayLastTurn={Boolean(lastTurnReplayPayload)}
            onGoHome={handleCreateConversation}
            onToggleSidebar={handleToggleSidebar}
            onRenameConversation={
              activeConversationId
                ? (nextTitle) =>
                    handleRenameConversation(activeConversationId, nextTitle)
                : undefined
            }
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
            onToggleDemoReadOnly={() => void handleToggleDemoReadOnly()}
            onReplayLastTurn={() => void handleReplayLastTurn()}
            onToggleArtifactPanel={() => {
              if (!activeArtifact && threadArtifacts.length > 0) {
                setActiveArtifact(
                  threadArtifacts[threadArtifacts.length - 1] ?? null,
                );
                setIsArtifactPanelOpen(true);
              } else {
                setIsArtifactPanelOpen((prev) => !prev);
              }
            }}
            onOpenBillingDrawer={() => setIsBillingDrawerOpen(true)}
            onOpenFixDownloads={
              import.meta.env.DEV ? () => setIsFixDownloadsOpen(true) : undefined
            }
          />

          {/* Hero Empty State or Active Editorial Conversation Stream */}
          <ChatArea
            messages={messages}
            isLoading={isTurnLoading}
            activeAgent={selectedAgent}
            userDisplayName={user?.displayName ?? null}
            streamingMessageIds={streamingMessageIds}
            activeCanvasArtifactId={activeArtifact?.artifactId ?? null}
            isCanvasOpen={isArtifactPanelOpen && Boolean(activeArtifact)}
            heroComposer={<ChatInput variant="hero" {...sharedComposerProps} />}
            onStreamComplete={handleStreamComplete}
            onQuickPromptSelect={(prompt, agent) =>
              void handleQuickPromptSelect(prompt, agent)
            }
            onRegenerate={(msg) => void handleRegenerateMessage(msg)}
            onEditPrompt={(edited) => void handleEditPrompt(edited)}
            onHandoffToSpecialist={(target, msg) =>
              void handleHandoffToSpecialist(target, msg)
            }
            onOpenArtifact={(artifact) => {
              setActiveArtifact(artifact);
              setIsArtifactPanelOpen(true);
            }}
            onOpenAttachment={setPreviewAttachment}
            onDropUploadFile={handleUploadFile}
            lightboxImage={lightboxImage}
            onOpenLightboxImage={setLightboxImage}
            onCloseLightboxImage={() => setLightboxImage(null)}
            onNotify={(message, tone) => pushToast(message, tone ?? 'success')}
          >
            <ChatInput variant="dock" {...sharedComposerProps} />
          </ChatArea>
        </div>

        {/* Right Pane: Auto-Opening Universal Split-Screen Artifact Canvas */}
        <ArtifactPanel
          artifact={activeArtifact}
          threadArtifacts={threadArtifacts}
          isOpen={isArtifactPanelOpen && Boolean(activeArtifact)}
          isTurnLoading={isTurnLoading}
          widthPct={canvasWidthPct}
          onResizeWidthPct={handleResizeCanvasWidthPct}
          onSelectArtifact={(art) => {
            setActiveArtifact(art);
            setIsArtifactPanelOpen(true);
          }}
          onClose={() => setIsArtifactPanelOpen(false)}
          onAskAiToFix={(fixPrompt) =>
            void handleQuickPromptSelect(fixPrompt, 'coding')
          }
          onOpenLightboxImage={setLightboxImage}
        />
      </div>

      {/* Global Cmd+K / Ctrl+K Command Palette */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        conversations={conversations}
        titleOverrides={titleOverrides}
        selectedAgent={selectedAgent}
        responseDepth={responseDepth}
        demoReadOnly={demoReadOnly}
        canReplayLastTurn={Boolean(lastTurnReplayPayload)}
        hasArtifacts={threadArtifacts.length > 0}
        onSelectConversation={(id) => void handleSelectConversation(id)}
        onCreateConversation={handleCreateConversation}
        onSelectAgent={setSelectedAgent}
        onSelectResponseDepth={setResponseDepth}
        onOpenBilling={() => setIsBillingDrawerOpen(true)}
        onOpenShortcuts={() => setIsShortcutsModalOpen(true)}
        onToggleArtifactCanvas={() => {
          if (!activeArtifact && threadArtifacts.length > 0) {
            setActiveArtifact(
              threadArtifacts[threadArtifacts.length - 1] ?? null,
            );
            setIsArtifactPanelOpen(true);
          } else {
            setIsArtifactPanelOpen((prev) => !prev);
          }
        }}
        onToggleDemoReadOnly={() => void handleToggleDemoReadOnly()}
        onReplayLastTurn={() => void handleReplayLastTurn()}
        onOpenFixDownloads={
          import.meta.env.DEV ? () => setIsFixDownloadsOpen(true) : undefined
        }
      />

      {/* Keyboard Shortcuts Reference Sheet (?) */}
      <ShortcutsModal
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
      />

      {/* Uploaded Image & PDF Attachment Lightbox */}
      <AttachmentLightbox
        file={previewAttachment}
        onClose={() => setPreviewAttachment(null)}
      />

      {/* Billing & Credits Drawer */}
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

      {/* Global Spring Toast Notification Stack */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />

      {/* Fix & Changed Files Download Modal (Dev-only) */}
      {import.meta.env.DEV && isFixDownloadsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/82 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setIsFixDownloadsOpen(false)}
        >
          <div
            className="max-w-4xl w-full max-h-[88vh] flex flex-col bg-[#111114] border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] bg-[#0c0c0f]">
              <div>
                <h2 className="text-sm sm:text-base font-semibold text-white">
                  Updated &amp; Changed Files + Git Commit Messages
                </h2>
                <p className="text-xs text-zinc-400 font-mono mt-0.5">
                  Download full fix ZIP packages or individual changed files with repo-relative paths
                </p>
              </div>
              <button
                type="button"
                aria-label="Close downloads modal"
                onClick={() => setIsFixDownloadsOpen(false)}
                className="p-1.5 rounded-lg bg-[#18181c] hover:bg-white/[0.12] text-zinc-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto bg-[#09090b]">
              <StepFileDownloads />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
