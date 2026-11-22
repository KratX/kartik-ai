import React, { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Code2,
  Command,
  FileText,
  Image as ImageIcon,
  LogOut,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Presentation,
  Search,
  Trash2,
  UserCheck,
  X,
  Zap,
} from 'lucide-react';
import type {
  ArtifactRecord,
  PlatformConversation,
  PlatformUser,
  UploadedFileRecord,
} from '../../types/index.js';
import {
  groupConversationsByDate,
  inferConversationArtifactKind,
} from '../workspace-ux-helpers.js';
import {
  AnimatedBrandLogo,
  ObsidianBrandMark,
} from '../motion/primitives.js';

export interface SidebarProps {
  readonly isCollapsed: boolean;
  readonly isMobileOpen: boolean;
  readonly onCloseMobile: () => void;
  readonly conversations: readonly PlatformConversation[];
  readonly activeConversationId: string | null;
  readonly pinnedIds: ReadonlySet<string>;
  readonly titleOverrides: Readonly<Record<string, string>>;
  readonly threadArtifactTypes?: Readonly<
    Record<string, ArtifactRecord['artifactType']>
  >;
  readonly uploadedFiles: readonly UploadedFileRecord[];
  readonly user: PlatformUser | null;
  readonly availableCredits: number;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: () => void;
  readonly onDeleteConversation: (conversationId: string) => void;
  readonly onTogglePinConversation: (conversationId: string) => void;
  readonly onRenameConversation: (conversationId: string, newTitle: string) => void;
  readonly onOpenCommandPalette: () => void;
  readonly onOpenBilling: () => void;
  readonly onOpenAuthModal: () => void;
  readonly onLogout: () => void;
}

function renderThreadIcon(
  isPinned: boolean,
  isActive: boolean,
  title: string,
  recordedType?: ArtifactRecord['artifactType'],
) {
  if (isPinned) {
    return <Pin className="w-3 h-3 text-zinc-300 shrink-0" />;
  }
  const kind = inferConversationArtifactKind(title, recordedType);
  const colorClass = isActive ? 'text-white' : 'text-zinc-500';
  switch (kind) {
    case 'code_bundle':
      return <Code2 className={`w-3.5 h-3.5 shrink-0 ${colorClass}`} />;
    case 'pdf_document':
      return <FileText className={`w-3.5 h-3.5 shrink-0 ${colorClass}`} />;
    case 'ppt_presentation':
      return <Presentation className={`w-3.5 h-3.5 shrink-0 ${colorClass}`} />;
    case 'generated_image':
      return <ImageIcon className={`w-3.5 h-3.5 shrink-0 ${colorClass}`} />;
    default:
      return (
        <MessageSquare
          className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-zinc-600'}`}
        />
      );
  }
}

export function Sidebar({
  isCollapsed,
  isMobileOpen,
  onCloseMobile,
  conversations,
  activeConversationId,
  pinnedIds,
  titleOverrides,
  threadArtifactTypes,
  uploadedFiles,
  user,
  availableCredits,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onTogglePinConversation,
  onRenameConversation,
  onOpenCommandPalette,
  onOpenBilling,
  onOpenAuthModal,
  onLogout,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [editingConvId, setEditingConvId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const filteredConversations = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const display = (titleOverrides[c.conversationId] || c.title).toLowerCase();
      return display.includes(q);
    });
  }, [conversations, searchQuery, titleOverrides]);

  const dateGroups = useMemo(
    () =>
      groupConversationsByDate(
        filteredConversations,
        pinnedIds,
        titleOverrides,
      ),
    [filteredConversations, pinnedIds, titleOverrides],
  );

  const commitInlineRename = (convId: string) => {
    const trimmed = editDraft.trim();
    if (trimmed) {
      onRenameConversation(convId, trimmed);
    }
    setEditingConvId(null);
    setEditDraft('');
  };

  const renderExpandedContent = (isMobileDrawer = false) => (
    <div className="flex flex-col h-full justify-between">
      {/* Top Brand, Pure White New Chat CTA & Filter */}
      <div className="p-3.5 space-y-3 border-b border-white/[0.07]">
        <div className="flex items-center justify-between px-1">
          <AnimatedBrandLogo
            size="md"
            subtitle="Multi-Agent Workspace"
            onClick={() => {
              onCreateConversation();
              if (isMobileDrawer) onCloseMobile();
            }}
            title="Kartik.ai — Return to fresh homepage"
            dataTestAttr={isMobileDrawer ? 'sidebar-mobile' : 'sidebar'}
          />

          {isMobileDrawer && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close sidebar"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/[0.06] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            onCreateConversation();
            if (isMobileDrawer) onCloseMobile();
          }}
          data-new-chat-button="true"
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs transition-colors cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Chat</span>
        </button>

        {/* Filter Conversations + Quick Cmd+K Trigger */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter threads…"
            className="w-full pl-8 pr-11 py-1.5 text-xs bg-[#16161b] border border-white/[0.08] rounded-lg text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-white/25 transition-colors"
          />
          <button
            type="button"
            onClick={onOpenCommandPalette}
            title="Open Command Palette (⌘K)"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.07] text-[10px] font-mono text-zinc-400 cursor-pointer"
          >
            ⌘K
          </button>
        </div>
      </div>

      {/* Middle: Date-Grouped Conversations & Indexed Files */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
        {dateGroups.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-zinc-500">
            No matching conversations
          </div>
        ) : (
          dateGroups.map((group) => (
            <div key={group.key} data-sidebar-group={group.key}>
              <div className="px-2.5 mb-1.5 flex items-center justify-between text-[11px] font-medium text-zinc-500">
                <span>{group.label}</span>
                <span className="font-mono text-[10px] tabular-nums text-zinc-600">
                  {group.items.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {group.items.map((conv) => {
                  const isActive = conv.conversationId === activeConversationId;
                  const isEditing = editingConvId === conv.conversationId;

                  return (
                    <div
                      key={conv.conversationId}
                      data-sidebar-thread={conv.conversationId}
                      data-thread-pinned={conv.isPinned ? 'true' : 'false'}
                      className={`group relative flex items-center justify-between gap-1.5 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                        isActive
                          ? 'text-white font-medium'
                          : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]'
                      }`}
                    >
                      {isActive && (
                        <motion.span
                          layoutId={
                            isMobileDrawer
                              ? 'active-sidebar-thread-mobile'
                              : 'active-sidebar-thread'
                          }
                          transition={{
                            type: 'spring',
                            stiffness: 460,
                            damping: 35,
                          }}
                          className="absolute inset-0 rounded-lg bg-white/[0.09] border border-white/[0.1]"
                        />
                      )}

                      {isEditing ? (
                        <div className="relative z-10 flex items-center gap-1 flex-1 min-w-0">
                          <input
                            type="text"
                            autoFocus
                            value={editDraft}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onBlur={() => commitInlineRename(conv.conversationId)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                commitInlineRename(conv.conversationId);
                              } else if (e.key === 'Escape') {
                                setEditingConvId(null);
                              }
                            }}
                            data-sidebar-rename-input="true"
                            className="w-full px-2 py-0.5 rounded bg-[#09090b] border border-white/25 text-xs text-white focus:outline-none"
                          />
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => commitInlineRename(conv.conversationId)}
                            aria-label="Save thread title"
                            className="p-1 rounded bg-white text-zinc-950 cursor-pointer shrink-0"
                          >
                            <Check className="w-3 h-3" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectConversation(conv.conversationId);
                              if (isMobileDrawer) onCloseMobile();
                            }}
                            className="relative z-10 flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                          >
                            {renderThreadIcon(
                              conv.isPinned,
                              isActive,
                              conv.displayTitle,
                              threadArtifactTypes?.[conv.conversationId],
                            )}
                            <span className="truncate">{conv.displayTitle}</span>
                          </button>

                          <div className="relative z-10 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                            <button
                              type="button"
                              data-thread-pin-btn={conv.conversationId}
                              title={conv.isPinned ? 'Unpin thread' : 'Pin thread'}
                              aria-label={conv.isPinned ? 'Unpin thread' : 'Pin thread'}
                              onClick={() => onTogglePinConversation(conv.conversationId)}
                              className="p-1 rounded hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                            >
                              {conv.isPinned ? (
                                <PinOff className="w-3 h-3" />
                              ) : (
                                <Pin className="w-3 h-3" />
                              )}
                            </button>
                            <button
                              type="button"
                              data-thread-rename-btn={conv.conversationId}
                              title="Rename thread"
                              aria-label="Rename thread"
                              onClick={() => {
                                setEditingConvId(conv.conversationId);
                                setEditDraft(conv.displayTitle);
                              }}
                              className="p-1 rounded hover:bg-white/[0.1] text-zinc-400 hover:text-white transition-colors cursor-pointer"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            {conversations.length > 1 && (
                              <button
                                type="button"
                                title="Delete conversation"
                                aria-label="Delete conversation"
                                onClick={() => onDeleteConversation(conv.conversationId)}
                                className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {/* Indexed RAG & Vision Files */}
        {uploadedFiles.length > 0 && (
          <div className="pt-3 border-t border-white/[0.07]">
            <div className="px-2.5 mb-1.5 flex items-center justify-between text-[11px] font-medium text-zinc-500">
              <span>Thread Files</span>
              <span className="font-mono text-[10px] tabular-nums text-zinc-600">
                {uploadedFiles.length}
              </span>
            </div>
            <div className="space-y-1">
              {uploadedFiles.map((file) => (
                <div
                  key={file.fileId}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-[#141418] border border-white/[0.06] text-[11px] text-zinc-300"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="truncate">{file.originalFilename}</span>
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-zinc-500 shrink-0">
                    {file.chunkCount > 0 ? `${file.chunkCount} ch` : 'ready'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer: Clean Monochrome Credits + User Identity */}
      <div className="p-3 border-t border-white/[0.07] space-y-2 bg-[#0c0c0f]">
        <div className="px-3 py-2.5 rounded-xl bg-[#111114] border border-white/[0.08] flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] text-zinc-500">Available Credits</div>
            <div className="text-sm font-semibold text-white font-mono tabular-nums flex items-center gap-1.5 mt-0.5">
              <Zap className="w-3.5 h-3.5 text-emerald-400" />
              <span>{availableCredits}</span>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenBilling}
            className="px-2.5 py-1.5 rounded-lg bg-white/[0.07] hover:bg-white/[0.14] border border-white/[0.1] text-zinc-100 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap"
          >
            Top Up
          </button>
        </div>

        {user ? (
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl bg-[#111114] border border-white/[0.07]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-full bg-white text-zinc-950 flex items-center justify-center text-xs font-bold shrink-0">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-medium text-zinc-100 truncate">
                  {user.displayName}
                </div>
                <div className="text-[10px] font-mono text-zinc-500 truncate">
                  {user.email}
                </div>
              </div>
            </div>
            <button
              type="button"
              title="Sign out"
              aria-label="Sign out"
              onClick={onLogout}
              className="p-1.5 rounded-lg hover:bg-white/[0.07] text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-[#16161b] hover:bg-[#1f1f25] border border-white/[0.08] text-zinc-200 text-xs font-medium transition-colors cursor-pointer"
          >
            <UserCheck className="w-3.5 h-3.5 text-zinc-300" />
            <span>Sign in with Google</span>
          </button>
        )}
      </div>
    </div>
  );

  const renderCollapsedRail = () => (
    <div
      data-sidebar-rail="true"
      className="flex flex-col h-full items-center justify-between py-3.5 px-2"
    >
      <div className="flex flex-col items-center gap-2.5">
        <button
          type="button"
          onClick={onCreateConversation}
          title="Kartik.ai — Return to fresh homepage"
          aria-label="Kartik.ai Home"
          data-brand-home="rail"
          className="rounded-xl transition-transform hover:scale-105 active:scale-95 cursor-pointer"
        >
          <ObsidianBrandMark size="md" />
        </button>
        <button
          type="button"
          onClick={onCreateConversation}
          title="New Chat"
          aria-label="New Chat"
          className="w-9 h-9 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 flex items-center justify-center transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="Command Palette (⌘K)"
          aria-label="Command Palette"
          className="w-9 h-9 rounded-xl bg-[#16161b] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
        >
          <Command className="w-4 h-4" />
        </button>
      </div>

      {/* Quick Recent Thread Icons */}
      <div className="flex-1 my-4 flex flex-col items-center gap-1.5 overflow-y-auto no-scrollbar w-full">
        {conversations.slice(0, 6).map((conv) => {
          const isActive = conv.conversationId === activeConversationId;
          const display = titleOverrides[conv.conversationId] || conv.title;
          return (
            <button
              key={conv.conversationId}
              type="button"
              title={display}
              aria-label={display}
              onClick={() => onSelectConversation(conv.conversationId)}
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                isActive
                  ? 'bg-white/[0.14] text-white border border-white/20'
                  : 'text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.06] border border-transparent'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onOpenBilling}
          title={`${availableCredits} Credits — Top Up`}
          aria-label="Credits & Billing"
          className="w-9 h-9 rounded-xl bg-[#16161b] hover:bg-white/[0.1] border border-white/[0.08] text-emerald-400 flex items-center justify-center transition-colors cursor-pointer"
        >
          <Zap className="w-4 h-4" />
        </button>
        {user ? (
          <button
            type="button"
            onClick={onLogout}
            title={`${user.displayName} — Sign out`}
            aria-label="Sign out"
            className="w-8 h-8 rounded-full bg-white text-zinc-950 font-bold text-xs flex items-center justify-center cursor-pointer"
          >
            {user.displayName.charAt(0).toUpperCase()}
          </button>
        ) : (
          <button
            type="button"
            onClick={onOpenAuthModal}
            title="Sign in with Google"
            aria-label="Sign in with Google"
            className="w-9 h-9 rounded-xl bg-[#16161b] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 flex items-center justify-center cursor-pointer"
          >
            <UserCheck className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Spring-Animated Collapsible Sidebar / Slim Icon Rail */}
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? 64 : 268 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        data-sidebar-desktop="true"
        data-sidebar-collapsed={isCollapsed ? 'true' : 'false'}
        className="hidden md:flex flex-col shrink-0 h-full bg-[#0c0c0f] border-r border-white/[0.07] overflow-hidden select-none"
      >
        {isCollapsed ? renderCollapsedRail() : renderExpandedContent(false)}
      </motion.aside>

      {/* Mobile Slide-Over Drawer */}
      <AnimatePresence>
        {isMobileOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="fixed inset-0 bg-black/75 backdrop-blur-sm"
              onClick={onCloseMobile}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
              data-sidebar-mobile-drawer="true"
              className="relative z-10 w-[276px] max-w-[85vw] h-full bg-[#0c0c0f] border-r border-white/[0.1] shadow-2xl"
            >
              {renderExpandedContent(true)}
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
