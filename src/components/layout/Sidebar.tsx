import React, { useState } from 'react';
import {
  FileText,
  Layers,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Trash2,
  UserCheck,
  Zap,
} from 'lucide-react';
import type { UploadedFileRecord } from '../../../backend/services/agent/src/index.js';
import type {
  PlatformConversation,
  PlatformUser,
} from '../../server/platform-api-runtime.js';

export interface SidebarProps {
  readonly isOpen: boolean;
  readonly conversations: readonly PlatformConversation[];
  readonly activeConversationId: string;
  readonly uploadedFiles: readonly UploadedFileRecord[];
  readonly user: PlatformUser | null;
  readonly availableCredits: number;
  readonly onSelectConversation: (conversationId: string) => void;
  readonly onCreateConversation: () => void;
  readonly onDeleteConversation: (conversationId: string) => void;
  readonly onOpenBilling: () => void;
  readonly onOpenAuthModal: () => void;
  readonly onLogout: () => void;
}

export function Sidebar({
  isOpen,
  conversations,
  activeConversationId,
  uploadedFiles,
  user,
  availableCredits,
  onSelectConversation,
  onCreateConversation,
  onDeleteConversation,
  onOpenBilling,
  onOpenAuthModal,
  onLogout,
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  if (!isOpen) {
    return null;
  }

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase().trim()),
  );

  return (
    <aside className="w-72 shrink-0 h-full bg-[#090d18] border-r border-slate-800/90 flex flex-col justify-between select-none">
      {/* Top Brand & New Chat */}
      <div className="p-3.5 space-y-3 border-b border-slate-800/80">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white font-bold shadow">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">
                Kartik.ai
              </div>
              <div className="text-[10px] font-mono text-sky-400">
                7-AGENT PLATFORM · v4.3
              </div>
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onCreateConversation}
          className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs transition-colors shadow cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          New Multi-Agent Chat
        </button>

        {/* Search Conversations */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter conversations..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60"
          />
        </div>
      </div>

      {/* Middle Scrollable Conversation History & Indexed RAG Files */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <div className="px-2 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-slate-500 font-semibold">
            Conversations ({filteredConversations.length})
          </div>
          <div className="space-y-1">
            {filteredConversations.map((conv) => {
              const isActive = conv.conversationId === activeConversationId;
              return (
                <div
                  key={conv.conversationId}
                  className={`group flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                    isActive
                      ? 'bg-sky-500/15 border border-sky-500/30 text-white font-medium'
                      : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conv.conversationId)}
                    className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                  >
                    <MessageSquare
                      className={`w-3.5 h-3.5 shrink-0 ${
                        isActive ? 'text-sky-400' : 'text-slate-500'
                      }`}
                    />
                    <span className="truncate">{conv.title}</span>
                  </button>

                  {conversations.length > 1 && (
                    <button
                      type="button"
                      title="Cascade delete (vectors -> objects -> metadata)"
                      onClick={() => onDeleteConversation(conv.conversationId)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Indexed RAG & Vision Uploads */}
        {uploadedFiles.length > 0 && (
          <div className="pt-2 border-t border-slate-800/80">
            <div className="px-2 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-emerald-400 font-semibold">
              Indexed RAG / Vision Files ({uploadedFiles.length})
            </div>
            <div className="space-y-1">
              {uploadedFiles.map((file) => (
                <div
                  key={file.fileId}
                  className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-slate-900/70 border border-slate-800/80 text-[11px] text-slate-300"
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <FileText className="w-3 h-3 text-emerald-400 shrink-0" />
                    <span className="truncate">{file.originalFilename}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500 shrink-0">
                    {file.chunkCount > 0 ? `${file.chunkCount} chunks` : 'ready'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer: Credit Balance Card + User Identity */}
      <div className="p-3 border-t border-slate-800/90 space-y-2.5 bg-slate-950/60">
        <div className="p-3 rounded-xl bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/60 border border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-mono uppercase text-slate-400">
              Available Balance
            </div>
            <div className="text-sm font-bold text-emerald-400 font-mono flex items-center gap-1 mt-0.5">
              <Zap className="w-3.5 h-3.5" />
              {availableCredits} Credits
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenBilling}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-semibold transition-colors cursor-pointer"
          >
            Top Up
          </button>
        </div>

        {user ? (
          <div className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-slate-900/80 border border-slate-800/80">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-sky-500/20 border border-sky-500/40 flex items-center justify-center text-xs font-bold text-sky-300 shrink-0">
                {user.displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-200 truncate">
                  {user.displayName}
                </div>
                <div className="text-[10px] font-mono text-slate-400 truncate">
                  {user.email}
                </div>
              </div>
            </div>
            <button
              type="button"
              title="Sign out"
              onClick={onLogout}
              className="p-1.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onOpenAuthModal}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
          >
            <UserCheck className="w-3.5 h-3.5 text-sky-400" />
            Sign In with Google
          </button>
        )}
      </div>
    </aside>
  );
}
