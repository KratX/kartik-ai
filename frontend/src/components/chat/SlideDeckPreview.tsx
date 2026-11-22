import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  LayoutGrid,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Presentation,
} from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  parsePptArtifactSlideDeck,
  pptDeckSpecToMarkdown,
  type InteractiveSlideViewModel,
  type ParsedPptDeckTheme,
} from '../slide-deck-and-markdown.js';
import type { ArtifactRecord } from '../../types/index.js';

export interface SlideDeckPreviewProps {
  readonly artifact: ArtifactRecord;
}

interface ThemeVisualTokens {
  readonly label: string;
  readonly canvasBg: string;
  readonly surfaceBg: string;
  readonly surfaceAltBg: string;
  readonly border: string;
  readonly accentBar: string;
  readonly accentText: string;
  readonly accentBorder: string;
}

const DECK_THEME_TOKENS: Readonly<Record<ParsedPptDeckTheme, ThemeVisualTokens>> = {
  pitch_deck: {
    label: 'Investor Pitch Deck',
    canvasBg: 'bg-[#09090c]',
    surfaceBg: 'bg-[#121216]',
    surfaceAltBg: 'bg-[#18181e]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-white',
    accentText: 'text-zinc-200',
    accentBorder: 'border-white/25',
  },
  technical_architecture: {
    label: 'Technical Architecture',
    canvasBg: 'bg-[#09090c]',
    surfaceBg: 'bg-[#111216]',
    surfaceAltBg: 'bg-[#171920]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-white',
    accentText: 'text-zinc-200',
    accentBorder: 'border-white/25',
  },
  product_launch: {
    label: 'Product Launch Keynote',
    canvasBg: 'bg-[#090b0b]',
    surfaceBg: 'bg-[#111514]',
    surfaceAltBg: 'bg-[#161c1a]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-emerald-400',
    accentText: 'text-emerald-300',
    accentBorder: 'border-emerald-400/35',
  },
  executive_briefing: {
    label: 'Executive Briefing',
    canvasBg: 'bg-[#0a0a0c]',
    surfaceBg: 'bg-[#131317]',
    surfaceAltBg: 'bg-[#19191f]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-zinc-200',
    accentText: 'text-zinc-200',
    accentBorder: 'border-white/25',
  },
  workshop_training: {
    label: 'Workshop & Training',
    canvasBg: 'bg-[#09090c]',
    surfaceBg: 'bg-[#121217]',
    surfaceAltBg: 'bg-[#181820]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-white',
    accentText: 'text-zinc-200',
    accentBorder: 'border-white/25',
  },
  case_study: {
    label: 'Case Study & Benchmark',
    canvasBg: 'bg-[#0a090c]',
    surfaceBg: 'bg-[#131217]',
    surfaceAltBg: 'bg-[#191820]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-white',
    accentText: 'text-zinc-200',
    accentBorder: 'border-white/25',
  },
};

const LAYOUT_SHORT_LABELS: Readonly<Record<string, string>> = {
  cover: 'Cover',
  closing: 'Closing',
  metrics: 'KPI Grid',
  two_column: 'Comparison',
  process: 'Process',
  spotlight: 'Spotlight',
  bullets: 'Editorial',
};

function SlideStageBody({
  slide,
  tokens,
  deckAuthor,
  deckDate,
}: {
  readonly slide: InteractiveSlideViewModel;
  readonly tokens: ThemeVisualTokens;
  readonly deckAuthor?: string;
  readonly deckDate?: string;
}) {
  if (slide.kind === 'cover') {
    return (
      <div className="my-auto flex flex-col justify-center py-4">
        <div className={`text-xs font-mono tracking-wide ${tokens.accentText}`}>
          {tokens.label}
        </div>
        <h3 className="mt-2.5 text-2xl sm:text-3xl font-semibold text-white tracking-tight leading-tight text-balance max-w-2xl">
          {slide.title}
        </h3>
        {slide.subtitle && (
          <p className="mt-2.5 text-sm sm:text-base text-zinc-300 max-w-2xl leading-relaxed">
            {slide.subtitle}
          </p>
        )}
        <div className={`mt-6 h-0.5 w-16 rounded-full ${tokens.accentBar}`} />
        <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-zinc-400 tabular-nums">
          <span>{slide.totalSlides} Slides</span>
          <span aria-hidden="true">·</span>
          <span>16:9 Widescreen</span>
          {deckAuthor && (
            <>
              <span aria-hidden="true">·</span>
              <span>{deckAuthor}</span>
            </>
          )}
          {deckDate && (
            <>
              <span aria-hidden="true">·</span>
              <span>{deckDate}</span>
            </>
          )}
        </div>
      </div>
    );
  }

  if (slide.kind === 'closing') {
    return (
      <div
        className={`my-auto rounded-xl border ${tokens.border} ${tokens.surfaceBg} p-6 sm:p-8 text-center`}
      >
        <div className={`text-xs font-mono tracking-wide ${tokens.accentText}`}>
          Closing Summary
        </div>
        <h3 className="mt-2 text-2xl sm:text-3xl font-semibold text-white tracking-tight text-balance">
          {slide.title}
        </h3>
        {slide.subtitle && (
          <p className="mt-2 text-sm text-zinc-300 max-w-xl mx-auto">
            {slide.subtitle}
          </p>
        )}
        <div className="mt-5 space-y-1.5 text-xs text-zinc-400">
          {slide.bullets.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
    );
  }

  if (slide.layout === 'metrics' && slide.metrics && slide.metrics.length >= 2) {
    const colClass =
      slide.metrics.length === 2
        ? 'grid-cols-2'
        : slide.metrics.length === 3
          ? 'grid-cols-1 sm:grid-cols-3'
          : 'grid-cols-2 sm:grid-cols-4';
    return (
      <div className="my-auto space-y-4 py-2">
        <div className={`grid ${colClass} gap-3`}>
          {slide.metrics.map((m, i) => (
            <div
              key={i}
              className={`rounded-xl border ${tokens.border} ${tokens.surfaceBg} p-3.5 flex flex-col justify-between`}
            >
              <span className="text-[11px] font-medium text-zinc-400 line-clamp-2 leading-tight">
                {m.label}
              </span>
              <span className="mt-2 text-xl sm:text-2xl font-semibold font-mono tabular-nums tracking-tight text-white">
                {m.value}
              </span>
              {m.delta && (
                <span className="mt-1 text-[11px] text-emerald-400 font-mono tabular-nums line-clamp-1">
                  {m.delta}
                </span>
              )}
            </div>
          ))}
        </div>
        {slide.bullets.length > 0 && (
          <div className={`rounded-xl border ${tokens.border} ${tokens.surfaceAltBg} p-3.5`}>
            <ul className="space-y-1.5">
              {slide.bullets.slice(0, 3).map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-zinc-200">
                  <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${tokens.accentBar}`} />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (slide.layout === 'two_column' && slide.columns && slide.columns.length === 2) {
    return (
      <div className="my-auto space-y-3 py-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-stretch">
          {slide.columns.map((col, idx) => (
            <div
              key={idx}
              className={`rounded-xl border p-4 flex flex-col ${
                idx === 1
                  ? `${tokens.accentBorder} ${tokens.surfaceAltBg}`
                  : `${tokens.border} ${tokens.surfaceBg}`
              }`}
            >
              <h4
                className={`text-sm font-semibold pb-2 border-b ${tokens.border} ${
                  idx === 1 ? 'text-white' : 'text-zinc-200'
                }`}
              >
                {col.heading}
              </h4>
              <ul className="mt-2.5 space-y-2">
                {col.points.map((pt, pIdx) => (
                  <li key={pIdx} className="flex items-start gap-2 text-xs text-zinc-300 leading-relaxed">
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${tokens.accentBar}`} />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {slide.callout && (
          <div className={`rounded-xl border ${tokens.accentBorder} ${tokens.surfaceBg} px-3.5 py-2.5 text-xs text-zinc-100`}>
            <span className="font-semibold text-white">Key Takeaway: </span>
            <span className="text-zinc-300">{slide.callout}</span>
          </div>
        )}
      </div>
    );
  }

  if (slide.layout === 'process' && slide.steps && slide.steps.length >= 2) {
    const stepGrid =
      slide.steps.length === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : slide.steps.length === 3
          ? 'grid-cols-1 sm:grid-cols-3'
          : 'grid-cols-2 sm:grid-cols-4';
    return (
      <div className="my-auto space-y-3 py-2">
        <div className={`grid ${stepGrid} gap-2.5 items-stretch`}>
          {slide.steps.map((st, idx) => (
            <div
              key={idx}
              className={`rounded-xl border ${tokens.border} ${tokens.surfaceBg} p-3.5 flex flex-col`}
            >
              <span className="text-xs font-mono font-semibold tabular-nums text-zinc-400">
                {st.step}
              </span>
              <h4 className="mt-1.5 text-xs sm:text-sm font-semibold text-white leading-snug">
                {st.title}
              </h4>
              <p className="mt-1.5 text-[11px] sm:text-xs text-zinc-400 leading-relaxed">
                {st.detail}
              </p>
            </div>
          ))}
        </div>
        {slide.callout && (
          <div className={`rounded-xl border ${tokens.accentBorder} ${tokens.surfaceAltBg} px-3.5 py-2.5 text-xs text-zinc-100`}>
            <span className="font-semibold text-white">Outcome: </span>
            <span className="text-zinc-300">{slide.callout}</span>
          </div>
        )}
      </div>
    );
  }

  if (slide.layout === 'spotlight' && slide.callout) {
    return (
      <div className="my-auto grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-stretch py-2">
        <div
          className={`sm:col-span-5 rounded-xl border ${tokens.accentBorder} ${tokens.surfaceAltBg} p-4 flex flex-col justify-center`}
        >
          <span className="text-[11px] font-mono text-zinc-400">Core Thesis</span>
          <p className="mt-2 text-sm sm:text-base font-semibold text-white leading-snug text-balance">
            &ldquo;{slide.callout}&rdquo;
          </p>
        </div>
        <div
          className={`sm:col-span-7 rounded-xl border ${tokens.border} ${tokens.surfaceBg} p-4 flex flex-col justify-center`}
        >
          <span className="text-[11px] font-mono text-zinc-500">
            Supporting Evidence
          </span>
          <ul className="mt-2.5 space-y-2.5">
            {slide.bullets.slice(0, 4).map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-zinc-200 leading-relaxed">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${tokens.accentBar}`} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return (
    <div className="my-auto space-y-3 py-2">
      <div className={`rounded-xl border ${tokens.border} ${tokens.surfaceBg} p-4`}>
        <ul className="space-y-2.5">
          {slide.bullets.slice(0, 6).map((bullet, idx) => (
            <li
              key={idx}
              className="flex items-start gap-3 text-xs sm:text-sm text-zinc-200 leading-relaxed"
            >
              <span className="text-xs font-mono font-semibold tabular-nums mt-0.5 shrink-0 text-zinc-500">
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
      {slide.callout && (
        <div className={`rounded-xl border ${tokens.accentBorder} ${tokens.surfaceAltBg} px-3.5 py-2.5 text-xs text-zinc-100`}>
          <span className="font-semibold text-white">Key Takeaway: </span>
          <span className="text-zinc-300">{slide.callout}</span>
        </div>
      )}
    </div>
  );
}

export function SlideDeckPreview({ artifact }: SlideDeckPreviewProps) {
  const specFile = artifact.filesManifest.find((f) => f.path === 'slides-spec.json');
  const deck = useMemo(
    () => parsePptArtifactSlideDeck(specFile?.content, artifact.title),
    [specFile?.content, artifact.title],
  );
  const tokens = DECK_THEME_TOKENS[deck.theme] ?? DECK_THEME_TOKENS.technical_architecture;

  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'stage' | 'grid'>('stage');
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);

  const safeIndex = Math.min(activeIndex, Math.max(0, deck.slides.length - 1));
  const currentSlide = deck.slides[safeIndex] ?? deck.slides[0]!;
  const downloadUrl = buildArtifactRawDownloadUrl(artifact.artifactId);
  const safeFilename =
    artifact.title
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'kartik-presentation';

  useEffect(() => {
    if (!isFullscreen) return;
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsFullscreen(false);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, [isFullscreen, deck.slides.length]);

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(pptDeckSpecToMarkdown(deck));
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      // Clipboard unavailable in restricted sandbox
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (viewMode !== 'stage') return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    }
  };

  const renderStageCanvas = (expanded = false) => (
    <div
      className={`relative ${
        expanded ? 'w-full max-w-5xl aspect-video' : 'min-h-[340px] sm:aspect-video w-full'
      } rounded-xl border ${tokens.border} ${tokens.canvasBg} overflow-hidden flex flex-col justify-between shadow-2xl`}
    >
      <div className="h-[2px] w-full shrink-0 bg-gradient-to-r from-transparent via-white/55 to-transparent" />
      <div className="flex-1 flex flex-col justify-between px-5 sm:px-8 py-4 sm:py-6 overflow-y-auto">
        {currentSlide.kind === 'content' && (
          <div className={`pb-3 border-b ${tokens.border}`}>
            <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
              <span className="font-mono text-zinc-400 truncate">
                {currentSlide.kicker ||
                  `${tokens.label} · Module ${String(currentSlide.slideNumber - 1).padStart(2, '0')}`}
              </span>
              <span className="font-mono text-zinc-500 shrink-0">
                {LAYOUT_SHORT_LABELS[currentSlide.layout] ?? 'Slide'} ·{' '}
                {String(currentSlide.slideNumber).padStart(2, '0')} /{' '}
                {String(currentSlide.totalSlides).padStart(2, '0')}
              </span>
            </div>
            <h3 className="mt-1.5 text-lg sm:text-xl font-semibold text-white tracking-tight leading-snug text-balance">
              {currentSlide.title}
            </h3>
            {currentSlide.subtitle && (
              <p className="mt-0.5 text-xs text-zinc-400 leading-normal">
                {currentSlide.subtitle}
              </p>
            )}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide.slideNumber}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex flex-col justify-center"
          >
            <SlideStageBody
              slide={currentSlide}
              tokens={tokens}
              deckAuthor={deck.author}
              deckDate={deck.generatedDate}
            />
          </motion.div>
        </AnimatePresence>

        <div
          className={`flex items-center justify-between pt-2.5 border-t ${tokens.border} text-[11px] text-zinc-500 tabular-nums`}
        >
          <span className="truncate">{currentSlide.footer}</span>
          <span className="font-mono shrink-0">
            Slide {currentSlide.slideNumber} of {currentSlide.totalSlides}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div
        tabIndex={0}
        onKeyDown={handleKeyDown}
        data-slide-studio="true"
        aria-label={`Presentation Studio: ${deck.deckTitle}`}
        className="rounded-xl border border-white/[0.09] bg-[#0b0b0e] overflow-hidden focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
      >
        {/* Top Obsidian Studio Bar */}
        <div className="px-4 py-3 bg-[#111114] border-b border-white/[0.07] space-y-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div className="flex items-center gap-2 min-w-0">
              <Presentation className="w-4 h-4 shrink-0 text-white" />
              <span className="text-sm font-semibold text-white truncate">
                {deck.deckTitle}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] font-mono text-zinc-500 tabular-nums shrink-0">
              <span className="text-zinc-300">{tokens.label}</span>
              <span aria-hidden="true">·</span>
              <span>{deck.slides.length} Slides</span>
              <span aria-hidden="true">·</span>
              <span>16:9</span>
              <span aria-hidden="true">·</span>
              <span>{Math.max(1, Math.round(artifact.sizeBytes / 1024))} KB</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {/* Spring Segmented View Switcher */}
            <div
              role="tablist"
              aria-label="Presentation view mode"
              className="inline-flex items-center p-0.5 rounded-lg bg-[#09090b] border border-white/[0.08]"
            >
              {(
                [
                  { id: 'stage', label: 'Stage', icon: MonitorPlay },
                  { id: 'grid', label: 'Grid', icon: LayoutGrid },
                ] as const
              ).map((tab) => {
                const active = viewMode === tab.id;
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setViewMode(tab.id)}
                    className="group relative isolate inline-flex items-center justify-center px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer"
                  >
                    {active && (
                      <motion.span
                        layoutId={`ppt-studio-view-${artifact.artifactId}`}
                        transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                        className="absolute inset-0 z-0 rounded-md bg-white"
                      />
                    )}
                    <span
                      className={`relative z-10 inline-flex items-center gap-1.5 ${
                        active
                          ? 'text-[#09090b] font-semibold'
                          : 'text-zinc-400 group-hover:text-zinc-100'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{tab.label}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-expanded={showNotes}
                onClick={() => setShowNotes((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  showNotes
                    ? 'border-white/25 bg-white/[0.1] text-white'
                    : 'border-white/[0.08] bg-[#16161b] text-zinc-300 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Notes</span>
              </button>

              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                data-slide-fullscreen-btn="true"
                title="Present fullscreen (← / → to navigate)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/[0.08] bg-[#16161b] text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Present</span>
              </button>

              <button
                type="button"
                onClick={() => void handleCopyMarkdown()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/[0.08] bg-[#16161b] text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedMd ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copiedMd ? 'Copied' : 'Copy MD'}</span>
              </button>

              <a
                href={downloadUrl}
                download={`${safeFilename}.pptx`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>.PPTX</span>
              </a>
            </div>
          </div>
        </div>

        {/* Body: Stage View OR Grid Overview */}
        {viewMode === 'grid' ? (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {deck.slides.map((slide, idx) => {
                const isSelected = idx === safeIndex;
                const layoutTag =
                  slide.kind === 'content'
                    ? LAYOUT_SHORT_LABELS[slide.layout] ?? 'Content'
                    : LAYOUT_SHORT_LABELS[slide.kind] ?? 'Slide';
                return (
                  <button
                    key={slide.slideNumber}
                    type="button"
                    onClick={() => {
                      setActiveIndex(idx);
                      setViewMode('stage');
                    }}
                    className={`group text-left rounded-xl border overflow-hidden transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-white/30 bg-[#18181d]'
                        : 'border-white/[0.08] bg-[#111114] hover:border-white/20'
                    }`}
                  >
                    <div className="p-3.5 flex flex-col h-36 justify-between">
                      <div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 tabular-nums">
                          <span className={isSelected ? 'text-white' : 'text-zinc-400'}>
                            {layoutTag}
                          </span>
                          <span>
                            {String(slide.slideNumber).padStart(2, '0')} / {String(deck.slides.length).padStart(2, '0')}
                          </span>
                        </div>
                        <div className="mt-1.5 text-xs font-semibold text-white line-clamp-2 leading-snug">
                          {slide.title}
                        </div>
                        {slide.subtitle && (
                          <div className="mt-1 text-[11px] text-zinc-400 line-clamp-2">
                            {slide.subtitle}
                          </div>
                        )}
                      </div>
                      <div className="pt-2 border-t border-white/[0.06] text-[10px] text-zinc-500 truncate">
                        {slide.metrics
                          ? `${slide.metrics.length} KPI metrics`
                          : slide.columns
                            ? '2-column comparison'
                            : slide.steps
                              ? `${slide.steps.length}-step process`
                              : slide.bullets.length === 1
                                ? '1 key point'
                                : `${slide.bullets.length} key points`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            {renderStageCanvas(false)}

            {/* Collapsible Presenter Speaker Notes */}
            <AnimatePresence>
              {showNotes && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.16 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-xl border border-white/[0.08] bg-[#111114] px-4 py-3">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500">
                      <span className="font-semibold text-zinc-200">
                        Speaker Notes · Slide {currentSlide.slideNumber}
                      </span>
                      <span className="font-mono">notesSlide{currentSlide.slideNumber}.xml</span>
                    </div>
                    <p className="mt-1.5 text-xs text-zinc-300 leading-relaxed">
                      {currentSlide.speakerNotes ||
                        `Walk the audience through "${currentSlide.title}" and highlight the primary takeaway before advancing.`}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Navigation Controls */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                disabled={safeIndex === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/[0.08] bg-[#141418] text-zinc-200 hover:bg-white/[0.08] disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous</span>
              </button>

              <div className="text-xs font-mono text-zinc-400 tabular-nums">
                Slide {safeIndex + 1} / {deck.slides.length}
              </div>

              <button
                type="button"
                onClick={() =>
                  setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1))
                }
                disabled={safeIndex === deck.slides.length - 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-white/[0.08] bg-[#141418] text-zinc-200 hover:bg-white/[0.08] disabled:opacity-35 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Interactive Monochrome Filmstrip */}
            <div
              role="navigation"
              aria-label="Slide filmstrip"
              className="flex items-stretch gap-2 overflow-x-auto pb-1"
            >
              {deck.slides.map((s, idx) => {
                const active = idx === safeIndex;
                const layoutTag =
                  s.kind === 'content'
                    ? LAYOUT_SHORT_LABELS[s.layout] ?? 'Slide'
                    : LAYOUT_SHORT_LABELS[s.kind] ?? 'Slide';
                return (
                  <button
                    key={s.slideNumber}
                    type="button"
                    aria-label={`Go to slide ${s.slideNumber}: ${s.title}`}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => setActiveIndex(idx)}
                    className={`w-36 shrink-0 rounded-xl border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-white/30 bg-[#1a1a20]'
                        : 'border-white/[0.07] bg-[#111114] hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono tabular-nums">
                      <span className={active ? 'text-white font-semibold' : 'text-zinc-500'}>
                        {String(s.slideNumber).padStart(2, '0')}
                      </span>
                      <span className="text-zinc-500 truncate">{layoutTag}</span>
                    </div>
                    <div className="mt-1 text-[11px] font-medium text-zinc-200 line-clamp-2 leading-tight">
                      {s.title}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Presenter Mode Overlay */}
      <AnimatePresence>
        {isFullscreen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label={`Fullscreen presentation: ${deck.deckTitle}`}
            data-slide-fullscreen-overlay="true"
            className="fixed inset-0 z-[70] bg-[#050507]/96 backdrop-blur-xl flex flex-col items-center justify-between p-4 sm:p-8"
          >
            <div className="w-full max-w-5xl flex items-center justify-between gap-3">
              <div className="text-xs font-mono text-zinc-400 truncate">
                {deck.deckTitle} · Slide {safeIndex + 1} / {deck.slides.length}
              </div>
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#16161b] hover:bg-white/[0.12] border border-white/[0.1] text-xs text-zinc-200 cursor-pointer"
              >
                <Minimize2 className="w-3.5 h-3.5" />
                <span>Exit Present (Esc)</span>
              </button>
            </div>

            <div className="flex-1 w-full flex items-center justify-center py-4">
              {renderStageCanvas(true)}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
                disabled={safeIndex === 0}
                className="px-3.5 py-1.5 rounded-lg bg-[#16161b] hover:bg-white/[0.12] border border-white/[0.1] text-xs text-zinc-200 disabled:opacity-35 cursor-pointer"
              >
                ← Previous
              </button>
              <span className="text-xs font-mono text-zinc-500 tabular-nums">
                Use ← / → arrow keys
              </span>
              <button
                type="button"
                onClick={() =>
                  setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1))
                }
                disabled={safeIndex === deck.slides.length - 1}
                className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs disabled:opacity-35 cursor-pointer"
              >
                Next →
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
