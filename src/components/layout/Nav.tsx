import React from 'react';
import {
  Code2,
  CreditCard,
  FolderArchive,
  Lock,
  PanelLeft,
  RotateCcw,
  Unlock,
  Zap,
} from 'lucide-react';

export interface NavProps {
  readonly conversationTitle: string;
  readonly availableCredits: number;
  readonly demoReadOnly: boolean;
  readonly hasActiveArtifact: boolean;
  readonly isArtifactPanelOpen: boolean;
  readonly canReplayLastTurn: boolean;
  readonly onToggleSidebar: () => void;
  readonly onToggleDemoReadOnly: () => void;
  readonly onReplayLastTurn: () => void;
  readonly onToggleArtifactPanel: () => void;
  readonly onOpenBillingDrawer: () => void;
  readonly onOpenDevExportsDrawer: () => void;
}

export function Nav({
  conversationTitle,
  availableCredits,
  demoReadOnly,
  hasActiveArtifact,
  isArtifactPanelOpen,
  canReplayLastTurn,
  onToggleSidebar,
  onToggleDemoReadOnly,
  onReplayLastTurn,
  onToggleArtifactPanel,
  onOpenBillingDrawer,
  onOpenDevExportsDrawer,
}: NavProps) {
  return (
    <header className="h-14 shrink-0 px-4 bg-[#090d18]/95 border-b border-slate-800/90 flex items-center justify-between gap-3">
      {/* Left: Sidebar Toggle & Active Conversation Title */}
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onToggleSidebar}
          title="Toggle Sidebar"
          className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 cursor-pointer"
        >
          <PanelLeft className="w-4 h-4" />
        </button>

        <div className="min-w-0">
          <h1 className="text-xs sm:text-sm font-semibold text-slate-100 truncate">
            {conversationTitle}
          </h1>
          <div className="text-[10px] font-mono text-slate-400 flex items-center gap-2">
            <span>Gateway: /api/v1/*</span>
            <span>·</span>
            <span className="text-emerald-400">Ed25519 Context Active</span>
          </div>
        </div>
      </div>

      {/* Right Action Bar */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Replay Last Idempotency-Key Button (Invariant #15 Proof) */}
        <button
          type="button"
          onClick={onReplayLastTurn}
          disabled={!canReplayLastTurn}
          title="Replay last turn with identical Idempotency-Key (proves 0-charge deduplication)"
          className="hidden md:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
          <span>Replay Idempotency-Key</span>
        </button>

        {/* DEMO_READ_ONLY Kill Switch (§12) */}
        <button
          type="button"
          onClick={onToggleDemoReadOnly}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold transition-colors cursor-pointer ${
            demoReadOnly
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300'
          }`}
        >
          {demoReadOnly ? (
            <>
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden sm:inline">DEMO_READ_ONLY: ON</span>
            </>
          ) : (
            <>
              <Unlock className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">READ_WRITE</span>
            </>
          )}
        </button>

        {/* Artifact Sandbox Toggle */}
        {hasActiveArtifact && (
          <button
            type="button"
            onClick={onToggleArtifactPanel}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
              isArtifactPanelOpen
                ? 'bg-sky-500 text-slate-950 border-sky-400'
                : 'bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sandbox Panel</span>
          </button>
        )}

        {/* Credit Balance & Billing Drawer Trigger */}
        <button
          type="button"
          onClick={onOpenBillingDrawer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-xs font-mono font-bold text-emerald-300 cursor-pointer"
        >
          <Zap className="w-3.5 h-3.5 text-emerald-400" />
          <span>{availableCredits} cr</span>
          <CreditCard className="w-3.5 h-3.5 ml-0.5 text-emerald-400/80" />
        </button>

        {/* Dev Inspector & Step ZIP Downloads Drawer Trigger */}
        <button
          type="button"
          onClick={onOpenDevExportsDrawer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/40 text-xs font-semibold text-indigo-200 cursor-pointer"
        >
          <FolderArchive className="w-3.5 h-3.5 text-indigo-300" />
          <span className="hidden sm:inline">Dev &amp; ZIP Exports</span>
        </button>
      </div>
    </header>
  );
}
