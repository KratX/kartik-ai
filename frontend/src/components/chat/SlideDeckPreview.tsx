import React, { useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  LayoutGrid,
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
  readonly primaryButton: string;
}

const DECK_THEME_TOKENS: Readonly<Record<ParsedPptDeckTheme, ThemeVisualTokens>> = {
  pitch_deck: {
    label: 'Investor Pitch Deck',
    canvasBg: 'bg-[#0b1020]',
    surfaceBg: 'bg-[#141b33]',
    surfaceAltBg: 'bg-[#1a2342]',
    border: 'border-[#2c3966]',
    accentBar: 'bg-indigo-500',
    accentText: 'text-indigo-300',
    accentBorder: 'border-indigo-400/50',
    primaryButton: 'bg-indigo-500 hover:bg-indigo-400 text-white',
  },
  technical_architecture: {
    label: 'Technical Architecture',
    canvasBg: 'bg-[#09111e]',
    surfaceBg: 'bg-[#111d30]',
    surfaceAltBg: 'bg-[#162640]',
    border: 'border-[#233b59]',
    accentBar: 'bg-sky-500',
    accentText: 'text-sky-300',
    accentBorder: 'border-sky-400/50',
    primaryButton: 'bg-sky-500 hover:bg-sky-400 text-slate-950',
  },
  product_launch: {
    label: 'Product Launch Keynote',
    canvasBg: 'bg-[#081414]',
    surfaceBg: 'bg-[#102222]',
    surfaceAltBg: 'bg-[#152e2d]',
    border: 'border-[#214744]',
    accentBar: 'bg-emerald-500',
    accentText: 'text-emerald-300',
    accentBorder: 'border-emerald-400/50',
    primaryButton: 'bg-emerald-500 hover:bg-emerald-400 text-slate-950',
  },
  executive_briefing: {
    label: 'Executive Briefing',
    canvasBg: 'bg-[#101218]',
    surfaceBg: 'bg-[#181c26]',
    surfaceAltBg: 'bg-[#212635]',
    border: 'border-[#353d52]',
    accentBar: 'bg-amber-500',
    accentText: 'text-amber-300',
    accentBorder: 'border-amber-400/50',
    primaryButton: 'bg-amber-500 hover:bg-amber-400 text-slate-950',
  },
  workshop_training: {
    label: 'Workshop & Training',
    canvasBg: 'bg-[#100d1e]',
    surfaceBg: 'bg-[#1a1530]',
    surfaceAltBg: 'bg-[#231c40]',
    border: 'border-[#3a2e63]',
    accentBar: 'bg-purple-500',
    accentText: 'text-purple-300',
    accentBorder: 'border-purple-400/50',
    primaryButton: 'bg-purple-500 hover:bg-purple-400 text-white',
  },
  case_study: {
    label: 'Case Study & Benchmark',
    canvasBg: 'bg-[#140d14]',
    surfaceBg: 'bg-[#211521]',
    surfaceAltBg: 'bg-[#2b1c2b]',
    border: 'border-[#4a2e4a]',
    accentBar: 'bg-rose-500',
    accentText: 'text-rose-300',
    accentBorder: 'border-rose-400/50',
    primaryButton: 'bg-rose-500 hover:bg-rose-400 text-white',
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
        <div className={`text-xs font-medium tracking-wide ${tokens.accentText}`}>
          {tokens.label}
        </div>
        <h3 className="mt-2.5 text-2xl sm:text-3xl font-bold text-slate-50 tracking-tight leading-tight text-balance max-w-2xl">
          {slide.title}
        </h3>
        {slide.subtitle && (
          <p className="mt-2.5 text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
            {slide.subtitle}
          </p>
        )}
        <div className={`mt-6 h-1 w-16 rounded-full ${tokens.accentBar}`} />
        <div className="mt-5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400 tabular-nums">
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
        className={`my-auto rounded-lg border ${tokens.border} ${tokens.surfaceBg} p-6 sm:p-8 text-center`}
      >
        <div className={`text-xs font-medium tracking-wide ${tokens.accentText}`}>
          Closing Summary
        </div>
        <h3 className="mt-2 text-2xl sm:text-3xl font-bold text-slate-50 tracking-tight text-balance">
          {slide.title}
        </h3>
        {slide.subtitle && (
          <p className="mt-2 text-sm text-slate-300 max-w-xl mx-auto">
            {slide.subtitle}
          </p>
        )}
        <div className="mt-5 space-y-1.5 text-xs text-slate-400">
          {slide.bullets.map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </div>
      </div>
    );
  }

  // Content Slide Layouts
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
              className={`rounded-lg border ${tokens.border} ${tokens.surfaceBg} p-3.5 flex flex-col justify-between`}
            >
              <span className="text-[11px] font-medium text-slate-400 line-clamp-2 leading-tight">
                {m.label}
              </span>
              <span
                className={`mt-2 text-xl sm:text-2xl font-bold tabular-nums tracking-tight ${tokens.accentText}`}
              >
                {m.value}
              </span>
              {m.delta && (
                <span className="mt-1 text-[11px] text-slate-300 tabular-nums line-clamp-1">
                  {m.delta}
                </span>
              )}
            </div>
          ))}
        </div>
        {slide.bullets.length > 0 && (
          <div className={`rounded-lg border ${tokens.border} ${tokens.surfaceAltBg} p-3.5`}>
            <ul className="space-y-1.5">
              {slide.bullets.slice(0, 3).map((b, i) => (
                <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200">
                  <span className={`w-1.5 h-1.5 rounded-xs mt-1.5 shrink-0 ${tokens.accentBar}`} />
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
              className={`rounded-lg border p-4 flex flex-col ${
                idx === 1
                  ? `${tokens.accentBorder} ${tokens.surfaceAltBg}`
                  : `${tokens.border} ${tokens.surfaceBg}`
              }`}
            >
              <h4
                className={`text-sm font-semibold pb-2 border-b ${tokens.border} ${
                  idx === 1 ? tokens.accentText : 'text-slate-100'
                }`}
              >
                {col.heading}
              </h4>
              <ul className="mt-2.5 space-y-2">
                {col.points.map((pt, pIdx) => (
                  <li key={pIdx} className="flex items-start gap-2 text-xs text-slate-200 leading-relaxed">
                    <span className={`w-1.5 h-1.5 rounded-xs mt-1.5 shrink-0 ${tokens.accentBar}`} />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {slide.callout && (
          <div className={`rounded-lg border ${tokens.accentBorder} ${tokens.surfaceBg} px-3.5 py-2.5 text-xs text-slate-100`}>
            <span className={`font-semibold ${tokens.accentText}`}>Key Takeaway: </span>
            <span>{slide.callout}</span>
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
              className={`rounded-lg border ${tokens.border} ${tokens.surfaceBg} p-3.5 flex flex-col`}
            >
              <span className={`text-xs font-mono font-semibold tabular-nums ${tokens.accentText}`}>
                {st.step}
              </span>
              <h4 className="mt-1.5 text-xs sm:text-sm font-semibold text-slate-100 leading-snug">
                {st.title}
              </h4>
              <p className="mt-1.5 text-[11px] sm:text-xs text-slate-300 leading-relaxed">
                {st.detail}
              </p>
            </div>
          ))}
        </div>
        {slide.callout && (
          <div className={`rounded-lg border ${tokens.accentBorder} ${tokens.surfaceAltBg} px-3.5 py-2.5 text-xs text-slate-100`}>
            <span className={`font-semibold ${tokens.accentText}`}>Outcome: </span>
            <span>{slide.callout}</span>
          </div>
        )}
      </div>
    );
  }

  if (slide.layout === 'spotlight' && slide.callout) {
    return (
      <div className="my-auto grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-stretch py-2">
        <div
          className={`sm:col-span-5 rounded-lg border ${tokens.accentBorder} ${tokens.surfaceAltBg} p-4 flex flex-col justify-center`}
        >
          <span className={`text-[11px] font-medium ${tokens.accentText}`}>
            Core Thesis
          </span>
          <p className="mt-2 text-sm sm:text-base font-semibold text-slate-50 leading-snug text-balance">
            “{slide.callout}”
          </p>
        </div>
        <div
          className={`sm:col-span-7 rounded-lg border ${tokens.border} ${tokens.surfaceBg} p-4 flex flex-col justify-center`}
        >
          <span className="text-[11px] font-medium text-slate-400">
            Supporting Evidence
          </span>
          <ul className="mt-2.5 space-y-2.5">
            {slide.bullets.slice(0, 4).map((b, i) => (
              <li key={i} className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200 leading-relaxed">
                <span className={`w-1.5 h-1.5 rounded-xs mt-1.5 shrink-0 ${tokens.accentBar}`} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  // Editorial Bullets Layout
  return (
    <div className="my-auto space-y-3 py-2">
      <div className={`rounded-lg border ${tokens.border} ${tokens.surfaceBg} p-4`}>
        <ul className="space-y-2.5">
          {slide.bullets.slice(0, 6).map((bullet, idx) => (
            <li
              key={idx}
              className="flex items-start gap-3 text-xs sm:text-sm text-slate-100 leading-relaxed"
            >
              <span
                className={`text-xs font-mono font-semibold tabular-nums mt-0.5 shrink-0 ${tokens.accentText}`}
              >
                {String(idx + 1).padStart(2, '0')}
              </span>
              <span>{bullet}</span>
            </li>
          ))}
        </ul>
      </div>
      {slide.callout && (
        <div className={`rounded-lg border ${tokens.accentBorder} ${tokens.surfaceAltBg} px-3.5 py-2.5 text-xs text-slate-100`}>
          <span className={`font-semibold ${tokens.accentText}`}>Key Takeaway: </span>
          <span>{slide.callout}</span>
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

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={`Presentation Studio: ${deck.deckTitle}`}
      className="mt-3 rounded-xl border border-slate-700/80 bg-[#0b1020] overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
    >
      {/* Top Studio Bar (Clean 2-row full-width header — prevents title squeezing) */}
      <div className="px-4 py-3 bg-slate-900/95 border-b border-slate-800 space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="flex items-center gap-2 min-w-0">
            <Presentation className={`w-4 h-4 shrink-0 ${tokens.accentText}`} />
            <span className="text-sm font-semibold text-slate-100 truncate">
              {deck.deckTitle}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-slate-400 tabular-nums shrink-0">
            <span className={tokens.accentText}>{tokens.label}</span>
            <span aria-hidden="true">·</span>
            <span>{deck.slides.length} Slides</span>
            <span aria-hidden="true">·</span>
            <span>16:9 OpenXML</span>
            <span aria-hidden="true">·</span>
            <span>{Math.max(1, Math.round(artifact.sizeBytes / 1024))} KB</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Segmented View Switcher */}
          <div
            role="tablist"
            aria-label="Presentation view mode"
            className="inline-flex items-center p-0.5 rounded-lg bg-slate-950 border border-slate-800"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'stage'}
              onClick={() => setViewMode('stage')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'stage'
                  ? 'bg-slate-800 text-slate-50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MonitorPlay className="w-3.5 h-3.5" />
              Stage View
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-slate-800 text-slate-50'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Grid Overview
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              aria-expanded={showNotes}
              onClick={() => setShowNotes((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                showNotes
                  ? `${tokens.accentBorder} bg-slate-800 text-slate-100`
                  : 'border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Speaker Notes
            </button>

            <button
              type="button"
              onClick={handleCopyMarkdown}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedMd ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copiedMd ? 'Copied MD' : 'Copy MD'}
            </button>

            <a
              href={downloadUrl}
              download={`${safeFilename}.pptx`}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${tokens.primaryButton}`}
            >
              <Download className="w-3.5 h-3.5" />
              Download .PPTX
            </a>
          </div>
        </div>
      </div>

      {/* Body: Stage View OR Grid Overview */}
      {viewMode === 'grid' ? (
        <div className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                  className={`group text-left rounded-lg border overflow-hidden transition-colors cursor-pointer ${
                    isSelected
                      ? `${tokens.accentBorder} ${tokens.surfaceAltBg}`
                      : `${tokens.border} ${tokens.surfaceBg} hover:border-slate-500`
                  }`}
                >
                  <div className={`h-1 w-full ${tokens.accentBar}`} />
                  <div className="p-3 flex flex-col h-36 justify-between">
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-400 tabular-nums">
                        <span className={`font-medium ${tokens.accentText}`}>
                          {layoutTag}
                        </span>
                        <span className="font-mono">
                          {String(slide.slideNumber).padStart(2, '0')} / {String(deck.slides.length).padStart(2, '0')}
                        </span>
                      </div>
                      <div className="mt-1.5 text-xs font-semibold text-slate-100 line-clamp-2 leading-snug">
                        {slide.title}
                      </div>
                      {slide.subtitle && (
                        <div className="mt-1 text-[11px] text-slate-400 line-clamp-2">
                          {slide.subtitle}
                        </div>
                      )}
                    </div>
                    <div className="pt-2 border-t border-slate-800/80 text-[10px] text-slate-400 truncate">
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
          {/* 16:9 Slide Stage Canvas */}
          <div
            className={`relative min-h-[340px] sm:aspect-video w-full rounded-lg border ${tokens.border} ${tokens.canvasBg} overflow-hidden flex flex-col justify-between`}
          >
            {/* Top Hairline Accent Strip */}
            <div className={`h-1.5 w-full shrink-0 ${tokens.accentBar}`} />

            <div className="flex-1 flex flex-col justify-between px-5 sm:px-7 py-4 sm:py-5">
              {/* Slide Header (Content slides show kicker + title + slide counter) */}
              {currentSlide.kind === 'content' && (
                <div className={`pb-3 border-b ${tokens.border}`}>
                  <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                    <span className={`font-medium truncate ${tokens.accentText}`}>
                      {currentSlide.kicker ||
                        `${tokens.label} · Module ${String(currentSlide.slideNumber - 1).padStart(2, '0')}`}
                    </span>
                    <span className="font-mono text-slate-400 shrink-0">
                      {LAYOUT_SHORT_LABELS[currentSlide.layout] ?? 'Slide'} ·{' '}
                      {String(currentSlide.slideNumber).padStart(2, '0')} /{' '}
                      {String(currentSlide.totalSlides).padStart(2, '0')}
                    </span>
                  </div>
                  <h3 className="mt-1.5 text-lg sm:text-xl font-bold text-slate-50 tracking-tight leading-snug text-balance">
                    {currentSlide.title}
                  </h3>
                  {currentSlide.subtitle && (
                    <p className="mt-0.5 text-xs text-slate-300 leading-normal">
                      {currentSlide.subtitle}
                    </p>
                  )}
                </div>
              )}

              {/* Active Slide Visual Layout Body */}
              <SlideStageBody
                slide={currentSlide}
                tokens={tokens}
                deckAuthor={deck.author}
                deckDate={deck.generatedDate}
              />

              {/* Slide Footer Strip */}
              <div
                className={`flex items-center justify-between pt-2.5 border-t ${tokens.border} text-[11px] text-slate-400 tabular-nums`}
              >
                <span className="truncate">{currentSlide.footer}</span>
                <span className="font-mono shrink-0">
                  Slide {currentSlide.slideNumber} of {currentSlide.totalSlides}
                </span>
              </div>
            </div>
          </div>

          {/* Expandable Presenter Speaker Notes */}
          {showNotes && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/90 px-4 py-3">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="font-semibold text-slate-200">
                  Presenter Speaker Notes · Slide {currentSlide.slideNumber}
                </span>
                <span className="font-mono">Embedded in notesSlide{currentSlide.slideNumber}.xml</span>
              </div>
              <p className="mt-1.5 text-xs text-slate-300 leading-relaxed">
                {currentSlide.speakerNotes ||
                  `Walk the audience through "${currentSlide.title}" and highlight the primary takeaway before advancing to the next slide.`}
              </p>
            </div>
          )}

          {/* Navigation Controls + Interactive Slide Filmstrip */}
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
              disabled={safeIndex === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>

            <div className="text-xs font-mono text-slate-400 tabular-nums">
              Slide {safeIndex + 1} / {deck.slides.length}
            </div>

            <button
              type="button"
              onClick={() =>
                setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1))
              }
              disabled={safeIndex === deck.slides.length - 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-800 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap shrink-0 cursor-pointer"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Clickable Filmstrip Strip */}
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
                  className={`w-36 shrink-0 rounded-lg border px-2.5 py-2 text-left transition-colors cursor-pointer ${
                    active
                      ? `${tokens.accentBorder} ${tokens.surfaceAltBg}`
                      : 'border-slate-800 bg-slate-900/70 hover:border-slate-600'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] tabular-nums">
                    <span className={`font-mono font-semibold ${active ? tokens.accentText : 'text-slate-400'}`}>
                      {String(s.slideNumber).padStart(2, '0')}
                    </span>
                    <span className="text-slate-400 truncate">{layoutTag}</span>
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-slate-200 line-clamp-2 leading-tight">
                    {s.title}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
