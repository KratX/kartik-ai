import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  Code2,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  Presentation,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type {
  ArtifactRecord,
  PlatformMessage,
  SpecialistAgentName,
} from '../../types/index.js';
import { getTimeOfDayGreeting } from '../workspace-ux-helpers.js';
import {
  BackgroundBeams,
  ObsidianBrandMark,
  SpotlightCard,
} from '../motion/primitives.js';
import { MessageList } from './MessageList.js';

const HERO_STARTER_PROMPTS: ReadonlyArray<{
  readonly agent: SpecialistAgentName;
  readonly label: string;
  readonly subtitle: string;
  readonly tag: string;
  readonly prompt: string;
  readonly icon: React.ReactNode;
}> = [
  {
    agent: 'coding',
    label: 'Build Interactive App',
    subtitle: '3-file HTML/CSS/JS live sandbox preview',
    tag: 'Code',
    prompt:
      'Build an interactive calculator app in HTML, CSS, and JavaScript',
    icon: <Code2 className="w-4 h-4 text-zinc-200" />,
  },
  {
    agent: 'ppt',
    label: 'Design Keynote Deck',
    subtitle: '16:9 interactive slides + .pptx download',
    tag: 'Slides',
    prompt:
      'Create a 6-slide presentation on Zero-Trust Cloud Microservices Architecture',
    icon: <Presentation className="w-4 h-4 text-zinc-200" />,
  },
  {
    agent: 'pdf',
    label: 'Compile PDF Report',
    subtitle: 'Editorial %PDF-1.4 document with KPIs',
    tag: 'PDF',
    prompt:
      'Generate a PDF technical report on Distributed Consensus & Raft Quorum Safety',
    icon: <FileText className="w-4 h-4 text-zinc-200" />,
  },
  {
    agent: 'search',
    label: 'Live Web Research',
    subtitle: 'Cited synthesis with verified sources',
    tag: 'Search',
    prompt:
      'Search the web for PostgreSQL MVCC concurrency control benchmarks and cite sources',
    icon: <Globe className="w-4 h-4 text-zinc-200" />,
  },
  {
    agent: 'image',
    label: 'Create Studio Artwork',
    subtitle: 'Art-directed visuals + prompt inspector',
    tag: 'Image',
    prompt:
      'Create a 16:9 widescreen architectural minimalist monochrome concrete pavilion at dusk with volumetric skylight',
    icon: <ImageIcon className="w-4 h-4 text-zinc-200" />,
  },
  {
    agent: 'chat',
    label: 'Deep Technical Brief',
    subtitle: '5-mode reasoning with follow-ups & handoffs',
    tag: 'Chat',
    prompt:
      'Explain PostgreSQL MVCC vs optimistic locking in TypeScript services with an actionable checklist',
    icon: <Sparkles className="w-4 h-4 text-zinc-200" />,
  },
];

export interface ChatAreaProps {
  readonly messages: readonly PlatformMessage[];
  readonly isLoading: boolean;
  readonly activeAgent?: SpecialistAgentName;
  readonly userDisplayName?: string | null;
  readonly activeCanvasArtifactId?: string | null;
  readonly isCanvasOpen?: boolean;
  readonly heroComposer?: React.ReactNode;
  readonly onQuickPromptSelect?: (
    prompt: string,
    agent: SpecialistAgentName,
  ) => void;
  readonly onRegenerate?: (message: PlatformMessage) => void;
  readonly onHandoffToSpecialist?: (
    target: 'pdf' | 'ppt' | 'search',
    message: PlatformMessage,
  ) => void;
  readonly onOpenArtifact?: (artifact: ArtifactRecord) => void;
  readonly onDropUploadFile?: (file: {
    readonly originalFilename: string;
    readonly declaredMimeType: string;
    readonly contentBase64: string;
  }) => Promise<void>;
  readonly lightboxImage?: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  } | null;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
  readonly onCloseLightboxImage?: () => void;
  readonly children?: React.ReactNode;
}

export function ChatArea({
  messages,
  isLoading,
  activeAgent,
  userDisplayName,
  activeCanvasArtifactId,
  isCanvasOpen = false,
  heroComposer,
  onQuickPromptSelect,
  onRegenerate,
  onHandoffToSpecialist,
  onOpenArtifact,
  onDropUploadFile,
  lightboxImage: controlledLightbox,
  onOpenLightboxImage,
  onCloseLightboxImage,
  children,
}: ChatAreaProps) {
  const [internalLightbox, setInternalLightbox] = useState<{
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showScrollToBottom, setShowScrollToBottom] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragDepthRef = useRef(0);

  const lightboxImage =
    controlledLightbox !== undefined ? controlledLightbox : internalLightbox;

  const openLightbox = (img: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => {
    if (onOpenLightboxImage) {
      onOpenLightboxImage(img);
    } else {
      setInternalLightbox(img);
    }
  };

  const closeLightbox = () => {
    if (onCloseLightboxImage) {
      onCloseLightboxImage();
    } else {
      setInternalLightbox(null);
    }
  };

  useEffect(() => {
    if (!lightboxImage) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeLightbox();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowScrollToBottom(distanceFromBottom > 320);
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      handleScroll();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [messages.length, isLoading]);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  };

  const handleDragEnter = (event: React.DragEvent) => {
    if (!onDropUploadFile) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!onDropUploadFile) return;
    event.preventDefault();
  };

  const handleDragLeave = (event: React.DragEvent) => {
    if (!onDropUploadFile) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragOver(false);
    }
  };

  const handleDrop = async (event: React.DragEvent) => {
    if (!onDropUploadFile) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]!);
      }
      await onDropUploadFile({
        originalFilename: file.name,
        declaredMimeType: file.type || 'application/pdf',
        contentBase64: btoa(binary),
      });
    } catch {
      // Errors surfaced via parent handler
    }
  };

  const isEmptyHero = messages.length === 0 && !isLoading;
  const greeting = getTimeOfDayGreeting(new Date().getHours(), userDisplayName);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleDrop(e)}
      className="relative flex-1 flex flex-col min-w-0 h-full overflow-hidden bg-[#09090b]"
    >
      {/* Full-Canvas Drag-and-Drop Overlay */}
      <AnimatePresence>
        {isDragOver && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-3 z-40 rounded-2xl bg-[#09090b]/90 backdrop-blur-md border border-dashed border-white/35 flex flex-col items-center justify-center gap-3 pointer-events-none"
          >
            <div className="w-12 h-12 rounded-2xl bg-white/[0.08] border border-white/15 flex items-center justify-center text-white">
              <Upload className="w-5 h-5" />
            </div>
            <div className="text-sm font-semibold text-white">
              Drop PDF or Image to attach
            </div>
            <div className="text-xs text-zinc-400">
              Automatically indexes PDFs for RAG or prepares images for Vision OCR
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isEmptyHero ? (
        /* ── 21st.dev Centered Hero Empty State ── */
        <div
          data-hero-empty-state="true"
          className="relative flex-1 overflow-y-auto flex flex-col items-center justify-center px-4 sm:px-6 py-10"
        >
          <BackgroundBeams />

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-3xl mx-auto flex flex-col items-center"
          >
            <div className="mb-5">
              <ObsidianBrandMark size="lg" />
            </div>

            <h2
              className="text-2xl sm:text-4xl font-semibold tracking-tight text-white text-center"
              style={{ textWrap: 'balance' }}
            >
              {greeting}. What are we building?
            </h2>

            <p className="mt-2.5 text-sm text-zinc-400 text-center max-w-xl leading-relaxed">
              Ask anything in Unified Chat — it adapts depth automatically and
              smart-routes builds, PDFs, slide decks, live research, and visuals
              to your split-screen Canvas.
            </p>

            {/* Centered Floating BorderBeam Composer */}
            <div className="w-full mt-7">
              {heroComposer ?? children}
            </div>

            {/* 6 Mouse-Tracking 21st.dev SpotlightCard Quick Starters */}
            <div
              data-hero-starters="true"
              className="w-full grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 mt-6"
            >
              {HERO_STARTER_PROMPTS.map((item, idx) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    duration: 0.24,
                    delay: 0.04 * idx,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                >
                  <SpotlightCard
                    asButton
                    onClick={() => onQuickPromptSelect?.(item.prompt, item.agent)}
                    className="h-full"
                  >
                    <div className="p-3.5 flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.08] flex items-center justify-center shrink-0 mt-0.5">
                        {item.icon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-zinc-100 group-hover:text-white truncate">
                            {item.label}
                          </span>
                          <span className="text-[10px] font-mono text-zinc-500 shrink-0">
                            {item.tag}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 line-clamp-2 leading-snug mt-1">
                          {item.subtitle}
                        </p>
                      </div>
                    </div>
                  </SpotlightCard>
                </motion.div>
              ))}
            </div>
          </motion.div>
        </div>
      ) : (
        /* ── Active Editorial Conversation Stream + Docked Floating Composer ── */
        <>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto px-4 sm:px-6 pt-6 pb-10"
          >
            <MessageList
              messages={messages}
              isLoading={isLoading}
              activeAgent={activeAgent}
              activeCanvasArtifactId={activeCanvasArtifactId}
              isCanvasOpen={isCanvasOpen}
              onFollowUpSearch={(query, agent) =>
                onQuickPromptSelect?.(query, agent ?? 'chat')
              }
              onRegenerate={onRegenerate}
              onHandoffToSpecialist={onHandoffToSpecialist}
              onOpenArtifact={onOpenArtifact}
              onOpenLightboxImage={openLightbox}
            />
          </div>

          {/* Floating Scroll-to-Bottom Pill */}
          <AnimatePresence>
            {showScrollToBottom && (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: 8, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.94 }}
                transition={{ duration: 0.16 }}
                onClick={scrollToBottom}
                aria-label="Scroll to bottom"
                className="absolute bottom-36 left-1/2 -translate-x-1/2 z-20 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#18181c]/95 hover:bg-[#232329] border border-white/[0.14] text-xs font-medium text-zinc-100 shadow-xl backdrop-blur-md cursor-pointer"
              >
                <ArrowDown className="w-3.5 h-3.5" />
                <span>Jump to latest</span>
              </motion.button>
            )}
          </AnimatePresence>

          {/* Bottom Floating Composer Slot */}
          {children}
        </>
      )}

      {/* Fullscreen Obsidian Image Lightbox Modal */}
      <AnimatePresence>
        {lightboxImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label={`Fullscreen preview: ${lightboxImage.title}`}
            data-image-lightbox="true"
            className="fixed inset-0 z-50 bg-black/88 backdrop-blur-md flex items-center justify-center p-4"
            onClick={closeLightbox}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              className="max-w-4xl w-full bg-[#111114] border border-white/[0.12] rounded-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.08]">
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate">
                    {lightboxImage.title}
                  </h4>
                  {lightboxImage.sourceUrl && (
                    <a
                      href={lightboxImage.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-white underline underline-offset-2 mt-0.5"
                    >
                      <span>Open Verified Reference Source</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Close image lightbox"
                  onClick={closeLightbox}
                  className="p-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-4 bg-[#09090b] flex items-center justify-center">
                <img
                  src={lightboxImage.imageUrl}
                  alt={lightboxImage.title}
                  referrerPolicy="no-referrer"
                  className="max-h-[72vh] w-auto rounded-xl border border-white/[0.08]"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
