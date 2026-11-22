import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Command,
  Keyboard,
  Layers,
  PanelLeft,
  Pencil,
  Zap,
} from 'lucide-react';
import { AnimatedBrandLogo } from '../motion/primitives.js';

export interface NavProps {
  readonly conversationTitle: string;
  readonly isHeroMode?: boolean;
  readonly availableCredits: number;
  readonly artifactCount: number;
  readonly isArtifactPanelOpen: boolean;
  readonly onGoHome: () => void;
  readonly onToggleSidebar: () => void;
  readonly onRenameConversation?: (newTitle: string) => void;
  readonly onOpenCommandPalette: () => void;
  readonly onOpenShortcuts?: () => void;
  readonly onToggleArtifactPanel: () => void;
  readonly onOpenBillingDrawer: () => void;
}

export function Nav({
  conversationTitle,
  isHeroMode = false,
  availableCredits,
  artifactCount,
  isArtifactPanelOpen,
  onGoHome,
  onToggleSidebar,
  onRenameConversation,
  onOpenCommandPalette,
  onOpenShortcuts,
  onToggleArtifactPanel,
  onOpenBillingDrawer,
}: NavProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(conversationTitle);
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
      {/* Left: Sidebar Toggle, Clickable Animated Kartik.ai Brand & Inline-Editable Thread Title */}
      <div className="flex items-center gap-2 min-w-0 flex-1 overflow-hidden">
        <button
          type="button"
          onClick={onToggleSidebar}
          title="Toggle Sidebar (⌘B)"
          aria-label="Toggle Sidebar"
          data-toggle-sidebar="true"
          className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors shrink-0 cursor-pointer"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <div className="min-w-0 flex-1 flex items-center gap-2 overflow-hidden">
          {/* Always-clickable 21st.dev Animated Kartik.ai Home Brand */}
          <div className="shrink-0">
            <AnimatedBrandLogo
              size="sm"
              onClick={onGoHome}
              title="Kartik.ai — Return to fresh homepage"
              dataTestAttr="nav"
            />
          </div>

          {!isHeroMode && (
            <>
              <span
                aria-hidden="true"
                className="text-zinc-700 text-xs font-mono shrink-0 hidden sm:inline"
              >
                /
              </span>
              {isEditingTitle && onRenameConversation ? (
                <div className="flex items-center gap-1.5 max-w-md w-full min-w-0">
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
                  disabled={!onRenameConversation}
                  onClick={() => {
                    if (onRenameConversation) {
                      setIsEditingTitle(true);
                    }
                  }}
                  data-nav-title-edit="true"
                  title="Click to rename conversation"
                  className={`group hidden sm:flex items-center gap-2 min-w-0 text-left ${
                    onRenameConversation
                      ? 'cursor-pointer hover:text-white'
                      : 'cursor-default'
                  }`}
                >
                  <h1 className="text-sm font-medium text-zinc-300 group-hover:text-white truncate transition-colors">
                    {conversationTitle}
                  </h1>
                  {onRenameConversation && (
                    <Pencil className="w-3 h-3 text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  )}
                </button>
              )}
            </>
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
          className={`hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-[#111114] hover:bg-[#18181c] border border-white/[0.08] hover:border-white/[0.16] text-xs text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
            isArtifactPanelOpen ? 'px-2 py-1.5' : 'px-2.5 py-1.5'
          }`}
        >
          <Command className="w-3.5 h-3.5" />
          {!isArtifactPanelOpen && <span className="hidden lg:inline">Command</span>}
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
            {!isArtifactPanelOpen && <span className="hidden sm:inline">Canvas</span>}
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

        {/* Keyboard Shortcuts Trigger (?) */}
        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            data-open-shortcuts="true"
            aria-label="Keyboard Shortcuts"
            title="Keyboard Shortcuts (?)"
            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#111114] hover:bg-[#18181c] border border-white/[0.08] hover:border-white/[0.18] text-zinc-400 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <Keyboard className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </header>
  );
}
