import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Code2,
  CreditCard,
  Eye,
  FileSearch,
  FileText,
  FolderArchive,
  Globe,
  Image as ImageIcon,
  Layers,
  Lock,
  MessageSquare,
  Plus,
  Presentation,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Unlock,
  X,
} from 'lucide-react';
import type {
  ChatResponseDepth,
  PlatformConversation,
  SpecialistAgentName,
} from '../../types/index.js';
import {
  AGENT_SELECTOR_PILLS,
  CHAT_RESPONSE_DEPTH_OPTIONS,
} from '../slide-deck-and-markdown.js';
import {
  filterCommandPaletteItems,
  type CommandPaletteSearchable,
} from '../workspace-ux-helpers.js';
import { BorderBeam } from '../motion/primitives.js';

export interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly conversations: readonly PlatformConversation[];
  readonly titleOverrides: Readonly<Record<string, string>>;
  readonly selectedAgent: SpecialistAgentName;
  readonly responseDepth: ChatResponseDepth;
  readonly demoReadOnly: boolean;
  readonly canReplayLastTurn: boolean;
  readonly hasArtifacts: boolean;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: () => void;
  readonly onSelectAgent: (agent: SpecialistAgentName) => void;
  readonly onSelectResponseDepth: (depth: ChatResponseDepth) => void;
  readonly onOpenBilling: () => void;
  readonly onToggleArtifactCanvas: () => void;
  readonly onToggleDemoReadOnly: () => void;
  readonly onReplayLastTurn: () => void;
  readonly onOpenFixDownloads?: () => void;
}

interface PaletteEntry extends CommandPaletteSearchable {
  readonly section: 'Quick Actions' | 'Switch Specialist' | 'Chat Depth' | 'Conversations';
  readonly icon: React.ReactNode;
  readonly shortcut?: string;
  readonly badge?: string;
  readonly isActive?: boolean;
  readonly onSelect: () => void;
}

function getAgentIcon(agent: SpecialistAgentName): React.ReactNode {
  switch (agent) {
    case 'chat':
      return <Sparkles className="w-4 h-4" />;
    case 'search':
      return <Globe className="w-4 h-4" />;
    case 'coding':
      return <Code2 className="w-4 h-4" />;
    case 'pdf':
      return <FileText className="w-4 h-4" />;
    case 'ppt':
      return <Presentation className="w-4 h-4" />;
    case 'rag':
      return <FileSearch className="w-4 h-4" />;
    case 'vision':
      return <Eye className="w-4 h-4" />;
    case 'image':
      return <ImageIcon className="w-4 h-4" />;
  }
}

export function CommandPalette({
  isOpen,
  onClose,
  conversations,
  titleOverrides,
  selectedAgent,
  responseDepth,
  demoReadOnly,
  canReplayLastTurn,
  hasArtifacts,
  onSelectConversation,
  onCreateConversation,
  onSelectAgent,
  onSelectResponseDepth,
  onOpenBilling,
  onToggleArtifactCanvas,
  onToggleDemoReadOnly,
  onReplayLastTurn,
  onOpenFixDownloads,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setActiveIndex(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const allEntries = useMemo<readonly PaletteEntry[]>(() => {
    const entries: PaletteEntry[] = [
      {
        id: 'action:new-chat',
        section: 'Quick Actions',
        label: 'New Chat',
        subtitle: 'Start a fresh session in Unified Chat',
        keywords: ['new', 'create', 'conversation', 'hero', 'fresh'],
        icon: <Plus className="w-4 h-4" />,
        shortcut: 'N',
        onSelect: () => {
          onCreateConversation();
          onClose();
        },
      },
      {
        id: 'action:billing',
        section: 'Quick Actions',
        label: 'Credits & Billing Ledger',
        subtitle: 'View credit balance, plans, and Razorpay history',
        keywords: ['credits', 'billing', 'top up', 'razorpay', 'ledger'],
        icon: <CreditCard className="w-4 h-4" />,
        onSelect: () => {
          onOpenBilling();
          onClose();
        },
      },
    ];

    if (hasArtifacts) {
      entries.push({
        id: 'action:canvas',
        section: 'Quick Actions',
        label: 'Toggle Artifact Canvas',
        subtitle: 'Open or close the side-by-side Code, PDF, PPT & Image stage',
        keywords: ['canvas', 'artifact', 'sandbox', 'preview', 'split'],
        icon: <Layers className="w-4 h-4" />,
        onSelect: () => {
          onToggleArtifactCanvas();
          onClose();
        },
      });
    }

    if (canReplayLastTurn) {
      entries.push({
        id: 'action:replay',
        section: 'Quick Actions',
        label: 'Replay Last Idempotency-Key',
        subtitle: 'Verify 0-credit deduplication with identical requestId',
        keywords: ['replay', 'idempotency', 'dev', 'verify'],
        icon: <RotateCcw className="w-4 h-4" />,
        onSelect: () => {
          onReplayLastTurn();
          onClose();
        },
      });
    }

    entries.push({
      id: 'action:readonly',
      section: 'Quick Actions',
      label: demoReadOnly ? 'Disable Read-Only Freeze' : 'Enable Read-Only Freeze',
      subtitle: demoReadOnly
        ? 'Restore mutations across /api/v1/*'
        : 'Simulate DEMO_READ_ONLY 403 protection',
      keywords: ['read only', 'freeze', 'demo', 'lock', 'dev'],
      icon: demoReadOnly ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />,
      onSelect: () => {
        onToggleDemoReadOnly();
        onClose();
      },
    });

    if (onOpenFixDownloads) {
      entries.push({
        id: 'action:downloads',
        section: 'Quick Actions',
        label: 'Fix & ZIP Downloads',
        subtitle: 'Download changed file archives & Git commit messages',
        keywords: ['zip', 'download', 'fix', 'git', 'export'],
        icon: <FolderArchive className="w-4 h-4" />,
        onSelect: () => {
          onOpenFixDownloads();
          onClose();
        },
      });
    }

    for (const pill of AGENT_SELECTOR_PILLS) {
      entries.push({
        id: `agent:${pill.id}`,
        section: 'Switch Specialist',
        label: pill.label,
        subtitle: pill.placeholder,
        keywords: [pill.id, `/${pill.id}`, 'agent', 'specialist', pill.creditCostLabel],
        icon: getAgentIcon(pill.id),
        badge: pill.creditCostLabel,
        shortcut: `/${pill.id === 'coding' ? 'code' : pill.id}`,
        isActive: selectedAgent === pill.id,
        onSelect: () => {
          onSelectAgent(pill.id);
          onClose();
        },
      });
    }

    for (const opt of CHAT_RESPONSE_DEPTH_OPTIONS) {
      entries.push({
        id: `depth:${opt.id}`,
        section: 'Chat Depth',
        label: `${opt.label} Reasoning`,
        subtitle: opt.description,
        keywords: ['depth', opt.id, `/${opt.id}`, 'chat'],
        icon: <SlidersHorizontal className="w-4 h-4" />,
        shortcut: `/${opt.id}`,
        isActive: responseDepth === opt.id,
        onSelect: () => {
          onSelectAgent('chat');
          onSelectResponseDepth(opt.id);
          onClose();
        },
      });
    }

    for (const conv of conversations.slice(0, 12)) {
      const displayTitle =
        titleOverrides[conv.conversationId]?.trim() || conv.title;
      entries.push({
        id: `conv:${conv.conversationId}`,
        section: 'Conversations',
        label: displayTitle,
        subtitle: `Jump to thread`,
        keywords: ['thread', 'chat', 'history', displayTitle],
        icon: <MessageSquare className="w-4 h-4" />,
        onSelect: () => {
          onSelectConversation(conv.conversationId);
          onClose();
        },
      });
    }

    return entries;
  }, [
    canReplayLastTurn,
    conversations,
    demoReadOnly,
    hasArtifacts,
    onClose,
    onCreateConversation,
    onOpenBilling,
    onOpenFixDownloads,
    onReplayLastTurn,
    onSelectAgent,
    onSelectConversation,
    onSelectResponseDepth,
    onToggleArtifactCanvas,
    onToggleDemoReadOnly,
    responseDepth,
    selectedAgent,
    titleOverrides,
  ]);

  const filtered = useMemo(
    () => filterCommandPaletteItems(allEntries, query),
    [allEntries, query],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (filtered.length === 0) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((prev) => (prev + 1) % filtered.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        filtered[activeIndex]?.onSelect();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, filtered, isOpen, onClose]);

  const sections = useMemo(() => {
    const map = new Map<PaletteEntry['section'], Array<{ entry: PaletteEntry; flatIdx: number }>>();
    filtered.forEach((entry, flatIdx) => {
      const list = map.get(entry.section) ?? [];
      list.push({ entry, flatIdx });
      map.set(entry.section, list);
    });
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
          data-command-palette="true"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -6 }}
            transition={{ type: 'spring', stiffness: 450, damping: 34 }}
            className="relative w-full max-w-xl rounded-2xl bg-[#111114] border border-white/[0.12] shadow-[0_28px_70px_-14px_rgba(0,0,0,0.92)] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <BorderBeam durationSec={6} intensity="focus" />

            {/* Search Input Header */}
            <div className="relative z-10 flex items-center gap-3 px-4 py-3.5 border-b border-white/[0.08]">
              <Search className="w-4 h-4 text-zinc-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type a command, switch specialist, or jump to a thread…"
                data-command-palette-input="true"
                className="flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close command palette"
                className="p-1 rounded-md text-zinc-400 hover:text-white hover:bg-white/[0.07] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results List */}
            <div className="relative z-10 max-h-[54vh] overflow-y-auto p-2 space-y-3">
              {sections.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-500">
                  No matching commands or threads for &ldquo;{query}&rdquo;
                </div>
              ) : (
                sections.map(([sectionTitle, rows]) => (
                  <div key={sectionTitle}>
                    <div className="px-2.5 py-1 text-[11px] font-medium text-zinc-500">
                      {sectionTitle}
                    </div>
                    <div className="space-y-0.5">
                      {rows.map(({ entry, flatIdx }) => {
                        const highlighted = flatIdx === activeIndex;
                        return (
                          <button
                            key={entry.id}
                            type="button"
                            data-command-item={entry.id}
                            onMouseEnter={() => setActiveIndex(flatIdx)}
                            onClick={entry.onSelect}
                            className={`relative w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                              highlighted ? 'text-white' : 'text-zinc-300'
                            }`}
                          >
                            {highlighted && (
                              <motion.span
                                layoutId="cmd-palette-active-row"
                                transition={{
                                  type: 'spring',
                                  stiffness: 500,
                                  damping: 36,
                                }}
                                className="absolute inset-0 rounded-xl bg-white/[0.08] border border-white/[0.08]"
                              />
                            )}
                            <div className="relative z-10 flex items-center gap-3 min-w-0">
                              <span
                                className={`shrink-0 ${
                                  highlighted ? 'text-white' : 'text-zinc-400'
                                }`}
                              >
                                {entry.icon}
                              </span>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-xs font-medium truncate">
                                  <span className="truncate">{entry.label}</span>
                                  {entry.isActive && (
                                    <span className="text-[10px] font-mono text-emerald-400">
                                      Active
                                    </span>
                                  )}
                                </div>
                                {entry.subtitle && (
                                  <div className="text-[11px] text-zinc-500 truncate mt-0.5">
                                    {entry.subtitle}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="relative z-10 flex items-center gap-2 shrink-0">
                              {entry.badge && (
                                <span className="text-[11px] font-mono tabular-nums text-zinc-400">
                                  {entry.badge}
                                </span>
                              )}
                              {entry.shortcut && (
                                <kbd className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.08] text-[10px] font-mono text-zinc-400">
                                  {entry.shortcut}
                                </kbd>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Footer Hints */}
            <div className="relative z-10 px-4 py-2.5 border-t border-white/[0.06] bg-[#0c0c0f] flex items-center justify-between text-[11px] text-zinc-500">
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 rounded bg-white/[0.06] font-mono text-[10px] text-zinc-400">
                    ↑↓
                  </kbd>
                  Navigate
                </span>
                <span className="inline-flex items-center gap-1">
                  <kbd className="px-1 py-0.5 rounded bg-white/[0.06] font-mono text-[10px] text-zinc-400">
                    ↵
                  </kbd>
                  Select
                </span>
              </div>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-white/[0.06] font-mono text-[10px] text-zinc-400">
                  Esc
                </kbd>
                Close
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
