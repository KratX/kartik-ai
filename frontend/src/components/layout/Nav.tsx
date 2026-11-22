import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Command,
  FolderArchive,
  Layers,
  Lock,
  PanelLeft,
  Pencil,
  RotateCcw,
  ShieldCheck,
  Unlock,
  Wrench,
  Zap,
} from 'lucide-react';
import { MorphingPopover } from '../motion/primitives.js';

export interface NavProps {
  readonly conversationTitle: string;
  readonly isHeroMode?: boolean;
  readonly availableCredits: number;
  readonly demoReadOnly: boolean;
  readonly artifactCount: number;
  readonly isArtifactPanelOpen: boolean;
  readonly canReplayLastTurn: boolean;
  readonly onToggleSidebar: () => void;
  readonly onRenameConversation?: (newTitle: string) => void;
  readonly onOpenCommandPalette: () => void;
  readonly onToggleDemoReadOnly: () => void;
  readonly onReplayLastTurn: () => void;
  readonly onToggleArtifactPanel: () => void;
  readonly onOpenBillingDrawer: () => void;
  readonly onOpenFixDownloads?: () => void;
}

export function Nav({
  conversationTitle,
  isHeroMode = false,
  availableCredits,
  demoReadOnly,
  artifactCount,
  isArtifactPanelOpen,
  canReplayLastTurn,
  onToggleSidebar,
  onRenameConversation,
  onOpenCommandPalette,
  onToggleDemoReadOnly,
  onReplayLastTurn,
  onToggleArtifactPanel,
  onOpenBillingDrawer,
  onOpenFixDownloads,
}: NavProps) {
  const [isDevToolsOpen, setIsDevToolsOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversationTitle);
  const devToolsBtnRef = useRef<HTMLButtonElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDraftTitle(conversationTitle);
    setIsEditingTitle(false);
  }, [conversationTitle]);

  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const commitTitleRename = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== conversationTitle) {
      onRenameConversation?.(trimmed);
    } else {
      setDraftTitle(conversationTitle);
    }
    setIsEditingTitle(false);
  };

  return (
    <header className="h-13 shrink-0 px-3 sm:px-5 bg-[#09090b]/95 border-b border-white/[0.07] flex items-center justify-between gap-3 relative z-30">
      {/* Left: Sidebar Toggle & Inline-Editable Thread Title */}
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <button
          type="button"
          onClick={onToggleSidebar}
          title="Toggle Sidebar"
          aria-label="Toggle Sidebar"
          data-toggle-sidebar="true"
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <div className="min-w-0 flex-1 flex items-center gap-2">
          {isEditingTitle && !isHeroMode && onRenameConversation ? (
            <div className="flex items-center gap-1.5 max-w-md w-full">
              <input
                ref={titleInputRef}
                type="text"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onBlur={commitTitleRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitTitleRename();
                  } else if (e.key === 'Escape') {
                    setDraftTitle(conversationTitle);
                    setIsEditingTitle(false);
                  }
                }}
                data-nav-title-input="true"
                className="w-full px-2.5 py-1 rounded-md bg-[#16161b] border border-white/25 text-sm font-medium text-white focus:outline-none"
              />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={commitTitleRename}
                aria-label="Save title"
                className="p-1.5 rounded-md bg-white text-zinc-950 hover:bg-zinc-200 cursor-pointer shrink-0"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isHeroMode || !onRenameConversation}
              onClick={() => {
                if (!isHeroMode && onRenameConversation) {
                  setIsEditingTitle(true);
                }
              }}
              data-nav-title-edit="true"
              title={
                isHeroMode
                  ? 'Kartik.ai'
                  : 'Click to rename conversation'
              }
              className={`group flex items-center gap-2 min-w-0 text-left ${
                !isHeroMode && onRenameConversation
                  ? 'cursor-pointer hover:text-white'
                  : 'cursor-default'
              }`}
            >
              <h1 className="text-sm font-medium text-zinc-100 truncate">
                {isHeroMode ? 'Kartik.ai' : conversationTitle}
              </h1>
              {!isHeroMode && onRenameConversation && (
                <Pencil className="w-3 h-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Right: Clean Minimal Controls + Developer Tools MorphingPopover */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Global Cmd+K Command Palette Trigger */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          data-open-command-palette="true"
          title="Open Command Palette (⌘K)"
          aria-label="Open Command Palette"
          className="hidden sm:inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[#111114] hover:bg-[#18181c] border border-white/[0.08] hover:border-white/[0.16] text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Command className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Command</span>
          <kbd className="text-[10px] font-mono text-zinc-500">⌘K</kbd>
        </button>

        {/* Universal Artifact Canvas Toggle */}
        {artifactCount > 0 && (
          <button
            type="button"
            onClick={onToggleArtifactPanel}
            data-toggle-canvas="true"
            title="Toggle Universal Artifact Canvas"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isArtifactPanelOpen
                ? 'bg-white text-zinc-950 border-white'
                : 'bg-[#111114] hover:bg-[#18181c] text-zinc-200 border-white/[0.12] hover:border-white/25'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Canvas</span>
            <span
              className={`text-[10px] font-mono tabular-nums ${
                isArtifactPanelOpen ? 'text-zinc-700' : 'text-zinc-400'
              }`}
            >
              {artifactCount}
            </span>
          </button>
        )}

        {/* Credit Balance Trigger */}
        <button
          type="button"
          onClick={onOpenBillingDrawer}
          data-open-billing="true"
          title="Credits & Billing Ledger"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#111114] hover:bg-[#18181c] border border-white/[0.08] hover:border-white/[0.18] text-xs font-mono font-medium tabular-nums text-zinc-100 transition-colors cursor-pointer whitespace-nowrap shrink-0"
        >
          <Zap className="w-3.5 h-3.5 text-emerald-400" />
          <span>{availableCredits} cr</span>
        </button>

        {/* Developer Tools MorphingPopover (Houses Idempotency Replay, Read-Only, Ed25519 & Fix ZIPs) */}
        <div className="relative">
          <button
            ref={devToolsBtnRef}
            type="button"
            onClick={() => setIsDevToolsOpen((prev) => !prev)}
            data-dev-tools-trigger="true"
            aria-expanded={isDevToolsOpen}
            aria-label="Developer Tools"
            title="Developer Tools & Diagnostics"
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              demoReadOnly
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : isDevToolsOpen
                  ? 'bg-white/[0.1] border-white/20 text-white'
                  : 'bg-[#111114] hover:bg-[#18181c] border-white/[0.08] text-zinc-300 hover:text-white'
            }`}
          >
            <Wrench className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Tools</span>
          </button>

          <MorphingPopover
            isOpen={isDevToolsOpen}
            onClose={() => setIsDevToolsOpen(false)}
            align="right"
            side="bottom"
            triggerRef={devToolsBtnRef}
            className="w-72 p-2"
          >
            <div data-dev-tools-menu="true" className="space-y-1">
              {/* Live Architecture Session Metadata (quiet unboxed text) */}
              <div className="px-2.5 py-2 border-b border-white/[0.07] mb-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Gateway Session Active</span>
                </div>
                <div className="text-[10px] font-mono text-zinc-500 mt-1">
                  /api/v1/* · Ed25519 Verified
                </div>
              </div>

              {/* Replay Idempotency-Key */}
              <button
                type="button"
                disabled={!canReplayLastTurn}
                onClick={() => {
                  setIsDevToolsOpen(false);
                  onReplayLastTurn();
                }}
                data-dev-replay-button="true"
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:bg-white/[0.07] disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer text-left"
              >
                <span className="flex items-center gap-2 min-w-0">
                  <RotateCcw className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="truncate">Replay Idempotency-Key</span>
                </span>
                <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                  0 cr
                </span>
              </button>

              {/* Read-Only Kill Switch */}
              <button
                type="button"
                onClick={() => {
                  setIsDevToolsOpen(false);
                  onToggleDemoReadOnly();
                }}
                data-dev-readonly-button="true"
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:bg-white/[0.07] transition-colors cursor-pointer text-left"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {demoReadOnly ? (
                    <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  ) : (
                    <Unlock className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  )}
                  <span className="truncate">
                    {demoReadOnly ? 'DEMO_READ_ONLY: ON' : 'Workspace: READ_WRITE'}
                  </span>
                </span>
                <span
                  className={`text-[10px] font-mono shrink-0 ${
                    demoReadOnly ? 'text-amber-400' : 'text-zinc-500'
                  }`}
                >
                  {demoReadOnly ? 'Frozen' : 'Live'}
                </span>
              </button>

              {/* Fix & ZIP Downloads (Dev-only) */}
              {onOpenFixDownloads && (
                <button
                  type="button"
                  onClick={() => {
                    setIsDevToolsOpen(false);
                    onOpenFixDownloads();
                  }}
                  data-dev-downloads-button="true"
                  className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs text-zinc-200 hover:bg-white/[0.07] transition-colors cursor-pointer text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <FolderArchive className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="truncate">Fix &amp; ZIP Downloads</span>
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                    Exports
                  </span>
                </button>
              )}
            </div>
          </MorphingPopover>
        </div>
      </div>
    </header>
  );
}
