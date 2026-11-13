import React, { useState } from 'react';
import {
  Code2,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  MessageSquare,
  Presentation,
  Sparkles,
  X,
} from 'lucide-react';
import type { ArtifactRecord } from '../../../backend/services/agent/src/index.js';
import type { SpecialistAgentName } from '../../../backend/shared/contracts/index.js';
import type { PlatformMessage } from '../../server/platform-api-runtime.js';
import { MessageList } from './MessageList.js';

const QUICK_LAUNCH_PROMPTS: ReadonlyArray<{
  readonly agent: SpecialistAgentName;
  readonly label: string;
  readonly subtitle: string;
  readonly prompt: string;
  readonly icon: React.ReactNode;
}> = [
  {
    agent: 'coding',
    label: 'Build Sandboxed Calculator App',
    subtitle: '3-file HTML/CSS/JS bundle + live preview',
    prompt: 'Build an interactive calculator app in HTML, CSS, and JavaScript',
    icon: <Code2 className="w-4 h-4 text-sky-400" />,
  },
  {
    agent: 'ppt',
    label: 'Generate 6-Slide PPTX Deck',
    subtitle: 'Interactive 16:9 preview + .pptx download',
    prompt: 'Create a 6-slide presentation on Zero-Trust Cloud Microservices Architecture',
    icon: <Presentation className="w-4 h-4 text-indigo-400" />,
  },
  {
    agent: 'pdf',
    label: 'Compile Multi-Page PDF Report',
    subtitle: 'Real %PDF-1.4 binary + page numbers',
    prompt: 'Generate a PDF technical report on Distributed Consensus & Raft Quorum Safety',
    icon: <FileText className="w-4 h-4 text-emerald-400" />,
  },
  {
    agent: 'search',
    label: 'Web Search + Visual Gallery',
    subtitle: 'Cited sources + 4-image Lightbox',
    prompt: 'Search the web for PostgreSQL MVCC concurrency control benchmarks and cite sources',
    icon: <Globe className="w-4 h-4 text-amber-400" />,
  },
  {
    agent: 'coding',
    label: 'Build StreamFlix Movie UI Clone',
    subtitle: 'Watchlist state + category filters',
    prompt: 'Build a Netflix movie discovery UI clone with category filters and watchlist',
    icon: <Sparkles className="w-4 h-4 text-pink-400" />,
  },
  {
    agent: 'image',
    label: 'Generate Enhanced Artwork',
    subtitle: 'Prompt enhancement + PNG download',
    prompt: 'Create an image of a futuristic quantum data center with neon fiber optics',
    icon: <ImageIcon className="w-4 h-4 text-purple-400" />,
  },
];

export interface ChatAreaProps {
  readonly messages: readonly PlatformMessage[];
  readonly isLoading: boolean;
  readonly activeAgent?: SpecialistAgentName;
  readonly onQuickPromptSelect?: (
    prompt: string,
    agent: SpecialistAgentName,
  ) => void;
  readonly onOpenCodeArtifact?: (artifact: ArtifactRecord) => void;
  readonly children?: React.ReactNode;
}

export function ChatArea({
  messages,
  isLoading,
  activeAgent,
  onQuickPromptSelect,
  onOpenCodeArtifact,
  children,
}: ChatAreaProps) {
  const [lightboxImage, setLightboxImage] = useState<{
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  } | null>(null);

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#070b14]">
      {/* Scrollable Thread Container */}
      <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6">
        {/* Quick-Launch Specialist Prompt Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {QUICK_LAUNCH_PROMPTS.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => onQuickPromptSelect?.(item.prompt, item.agent)}
              className="flex items-start gap-3 p-3 rounded-xl bg-slate-900/75 hover:bg-slate-900 border border-slate-800/90 hover:border-sky-500/40 text-left transition-all cursor-pointer group"
            >
              <div className="w-8 h-8 rounded-lg bg-slate-800/90 border border-slate-700/70 flex items-center justify-center shrink-0 mt-0.5">
                {item.icon}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-semibold text-slate-100 group-hover:text-sky-300 truncate">
                    {item.label}
                  </span>
                  <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    {item.agent}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 truncate mt-0.5">
                  {item.subtitle}
                </p>
              </div>
            </button>
          ))}
        </div>

        {/* Messages Thread */}
        {messages.length === 0 ? (
          <div className="py-16 text-center">
            <MessageSquare className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-300">
              Start a Multi-Agent Turn
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
              Choose one of the quick-launch cards above or type a prompt below to route across Chat, Search, Coding, PDF, PPT, RAG, Vision, and Image agents.
            </p>
          </div>
        ) : (
          <MessageList
            messages={messages}
            isLoading={isLoading}
            activeAgent={activeAgent}
            onOpenCodeArtifact={onOpenCodeArtifact}
            onOpenLightboxImage={(img) => setLightboxImage(img)}
          />
        )}
      </div>

      {/* Bottom Chat Input Slot */}
      {children}

      {/* Fullscreen Image Lightbox Modal */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setLightboxImage(null)}
        >
          <div
            className="max-w-4xl w-full bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800">
              <div>
                <h4 className="text-sm font-semibold text-white">
                  {lightboxImage.title}
                </h4>
                {lightboxImage.sourceUrl && (
                  <a
                    href={lightboxImage.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline mt-0.5"
                  >
                    <span>Open Verified Reference Source</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 bg-slate-950 flex items-center justify-center">
              <img
                src={lightboxImage.imageUrl}
                alt={lightboxImage.title}
                className="max-h-[70vh] w-auto rounded-lg border border-slate-800"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
