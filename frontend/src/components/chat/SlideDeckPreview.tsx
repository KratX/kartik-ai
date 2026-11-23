import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  CopyPlus,
  Download,
  FileDown,
  FileText,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Moon,
  Pencil,
  Plus,
  Presentation,
  RotateCcw,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  parsePptArtifactSlideDeck,
  pptDeckSpecToMarkdown,
  pptViewModelToCompileSpec,
  type InteractiveSlideViewModel,
  type ParsedPptDeckTheme,
  type ParsedPptSurfaceMode,
  type ParsedSlideDeckViewModel,
  type ParsedVectorChart,
} from '../slide-deck-and-markdown.js';
import { slideDeckToHandoutPdfSpec } from '../studio-power-helpers.js';
import type { ArtifactRecord } from '../../types/index.js';

export interface SlideDeckPreviewProps {
  readonly artifact: ArtifactRecord;
  readonly defaultSurfaceMode?: ParsedPptSurfaceMode;
  readonly onSurfaceModeChange?: (mode: ParsedPptSurfaceMode) => void;
}

function SlideVectorBarChart({
  chart,
  isLight,
  accentBarClass,
}: {
  readonly chart: ParsedVectorChart;
  readonly isLight: boolean;
  readonly accentBarClass: string;
}) {
  const maxVal = Math.max(1, ...chart.bars.map((b) => b.value));
  return (
    <div
      data-slide-vector-chart="true"
      className={`rounded-xl border p-3.5 space-y-2 ${
        isLight
          ? 'border-zinc-200 bg-white'
          : 'border-white/[0.09] bg-black/25'
      }`}
    >
      {chart.title && (
        <div
          className={`flex items-center justify-between gap-2 text-[11px] font-semibold ${
            isLight ? 'text-zinc-800' : 'text-zinc-200'
          }`}
        >
          <span>{chart.title}</span>
          {chart.unit && (
            <span className="text-[10px] font-mono text-zinc-500">{chart.unit}</span>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        {chart.bars.map((bar, idx) => {
          const pct = Math.max(5, Math.min(100, (bar.value / maxVal) * 100));
          const display =
            bar.displayValue ??
            `${bar.value}${chart.unit ? ` ${chart.unit}` : ''}`;
          return (
            <div key={`${bar.label}-${idx}`} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span
                  className={`truncate ${isLight ? 'text-zinc-700' : 'text-zinc-300'}`}
                >
                  {bar.label}
                </span>
                <span
                  className={`font-mono tabular-nums font-semibold shrink-0 ${
                    isLight ? 'text-zinc-950' : 'text-white'
                  }`}
                >
                  {display}
                </span>
              </div>
              <div
                className={`h-2 w-full rounded overflow-hidden ${
                  isLight ? 'bg-zinc-200' : 'bg-white/[0.08]'
                }`}
              >
                <div
                  className={`h-full rounded ${isLight ? 'bg-zinc-900' : accentBarClass}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
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
  editorial_story: {
    label: 'Editorial Presentation',
    canvasBg: 'bg-[#0a0a0e]',
    surfaceBg: 'bg-[#13141b]',
    surfaceAltBg: 'bg-[#191b24]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-amber-300',
    accentText: 'text-amber-200',
    accentBorder: 'border-amber-300/35',
  },
  educational_explainer: {
    label: 'Educational Explainer',
    canvasBg: 'bg-[#081012]',
    surfaceBg: 'bg-[#0f1c20]',
    surfaceAltBg: 'bg-[#14252b]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-teal-400',
    accentText: 'text-teal-300',
    accentBorder: 'border-teal-400/35',
  },
  creative_showcase: {
    label: 'Creative & Cultural Showcase',
    canvasBg: 'bg-[#100b0d]',
    surfaceBg: 'bg-[#1a1216]',
    surfaceAltBg: 'bg-[#22181d]',
    border: 'border-white/[0.09]',
    accentBar: 'bg-rose-400',
    accentText: 'text-rose-300',
    accentBorder: 'border-rose-400/35',
  },
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
  metrics: 'Key Facts',
  two_column: 'Comparison',
  process: 'Journey',
  spotlight: 'Spotlight',
  bullets: 'Editorial',
};

function SlideStageBody({
  slide,
  tokens,
  isLight = false,
  deckAuthor,
  deckDate,
  coverImageDataUrl,
}: {
  readonly slide: InteractiveSlideViewModel;
  readonly tokens: ThemeVisualTokens;
  readonly isLight?: boolean;
  readonly deckAuthor?: string;
  readonly deckDate?: string;
  readonly coverImageDataUrl?: string | null;
}) {
  const headingText = isLight ? 'text-zinc-950' : 'text-white';
  const bodyText = isLight ? 'text-zinc-700' : 'text-zinc-200';
  const mutedText = isLight ? 'text-zinc-500' : 'text-zinc-400';
  const surfaceBg = isLight ? 'bg-white' : tokens.surfaceBg;
  const surfaceAltBg = isLight ? 'bg-zinc-100/90' : tokens.surfaceAltBg;
  const borderClass = isLight ? 'border-zinc-200' : tokens.border;
  const accentBorderClass = isLight ? 'border-zinc-300' : tokens.accentBorder;
  const accentBarClass = isLight ? 'bg-zinc-900' : tokens.accentBar;
  const accentTextClass = isLight ? 'text-zinc-700' : tokens.accentText;

  if (slide.kind === 'cover') {
    return (
      <div
        className={`my-auto py-4 ${
          coverImageDataUrl
            ? 'grid grid-cols-1 sm:grid-cols-12 gap-5 items-center'
            : 'flex flex-col justify-center'
        }`}
      >
        <div className={coverImageDataUrl ? 'sm:col-span-7 flex flex-col justify-center' : ''}>
          <div className={`text-xs font-mono tracking-wide ${accentTextClass}`}>
            {tokens.label}
          </div>
          <h3 className={`mt-2.5 text-2xl sm:text-3xl font-semibold ${headingText} tracking-tight leading-tight text-balance max-w-2xl`}>
            {slide.title}
          </h3>
          {slide.subtitle && (
            <p className={`mt-2.5 text-sm sm:text-base ${isLight ? 'text-zinc-600' : 'text-zinc-300'} max-w-2xl leading-relaxed`}>
              {slide.subtitle}
            </p>
          )}
          <div className={`mt-6 h-0.5 w-16 rounded-full ${accentBarClass}`} />
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
        {coverImageDataUrl && (
          <div className="sm:col-span-5">
            <div
              data-slide-cover-visual="true"
              className={`rounded-xl overflow-hidden border ${borderClass} shadow-xl aspect-[4/3] bg-black/20`}
            >
              <img
                src={coverImageDataUrl}
                alt="Cover visual"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        )}
      </div>
    );
  }

  if (slide.kind === 'closing') {
    return (
      <div
        className={`my-auto rounded-xl border ${borderClass} ${surfaceBg} p-6 sm:p-8 text-center`}
      >
        <div className={`text-xs font-mono tracking-wide ${accentTextClass}`}>
          Closing Summary
        </div>
        <h3 className={`mt-2 text-2xl sm:text-3xl font-semibold ${headingText} tracking-tight text-balance`}>
          {slide.title}
        </h3>
        {slide.subtitle && (
          <p className={`mt-2 text-sm ${isLight ? 'text-zinc-600' : 'text-zinc-300'} max-w-xl mx-auto`}>
            {slide.subtitle}
          </p>
        )}
        <div className={`mt-5 space-y-1.5 text-xs ${mutedText}`}>
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
              className={`rounded-xl border ${borderClass} ${surfaceBg} p-3.5 flex flex-col justify-between`}
            >
              <span className={`text-[11px] font-medium ${mutedText} line-clamp-2 leading-tight`}>
                {m.label}
              </span>
              <span className={`mt-2 text-xl sm:text-2xl font-semibold font-mono tabular-nums tracking-tight ${headingText}`}>
                {m.value}
              </span>
              {m.delta && (
                <span className={`mt-1 text-[11px] font-mono tabular-nums line-clamp-1 ${isLight ? 'text-emerald-700' : 'text-emerald-400'}`}>
                  {m.delta}
                </span>
              )}
            </div>
          ))}
        </div>
        {slide.chart ? (
          <SlideVectorBarChart
            chart={slide.chart}
            isLight={isLight}
            accentBarClass={tokens.accentBar}
          />
        ) : (
          slide.bullets.length > 0 && (
            <div className={`rounded-xl border ${borderClass} ${surfaceAltBg} p-3.5`}>
              <ul className="space-y-1.5">
                {slide.bullets.slice(0, 3).map((b, i) => (
                  <li key={i} className={`flex items-start gap-2.5 text-xs sm:text-sm ${bodyText}`}>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${accentBarClass}`} />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )
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
                  ? `${accentBorderClass} ${surfaceAltBg}`
                  : `${borderClass} ${surfaceBg}`
              }`}
            >
              <h4
                className={`text-sm font-semibold pb-2 border-b ${borderClass} ${
                  idx === 1 ? headingText : bodyText
                }`}
              >
                {col.heading}
              </h4>
              <ul className="mt-2.5 space-y-2">
                {col.points.map((pt, pIdx) => (
                  <li key={pIdx} className={`flex items-start gap-2 text-xs ${bodyText} leading-relaxed`}>
                    <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${accentBarClass}`} />
                    <span>{pt}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {slide.callout && (
          <div className={`rounded-xl border ${accentBorderClass} ${surfaceBg} px-3.5 py-2.5 text-xs`}>
            <span className={`font-semibold ${headingText}`}>Key Takeaway: </span>
            <span className={bodyText}>{slide.callout}</span>
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
              className={`rounded-xl border ${borderClass} ${surfaceBg} p-3.5 flex flex-col`}
            >
              <span className={`text-xs font-mono font-semibold tabular-nums ${mutedText}`}>
                {st.step}
              </span>
              <h4 className={`mt-1.5 text-xs sm:text-sm font-semibold ${headingText} leading-snug`}>
                {st.title}
              </h4>
              <p className={`mt-1.5 text-[11px] sm:text-xs ${mutedText} leading-relaxed`}>
                {st.detail}
              </p>
            </div>
          ))}
        </div>
        {slide.callout && (
          <div className={`rounded-xl border ${accentBorderClass} ${surfaceAltBg} px-3.5 py-2.5 text-xs`}>
            <span className={`font-semibold ${headingText}`}>Outcome: </span>
            <span className={bodyText}>{slide.callout}</span>
          </div>
        )}
      </div>
    );
  }

  if (slide.layout === 'spotlight' && slide.callout) {
    return (
      <div className="my-auto grid grid-cols-1 sm:grid-cols-12 gap-3.5 items-stretch py-2">
        <div
          className={`sm:col-span-5 rounded-xl border ${accentBorderClass} ${surfaceAltBg} p-4 flex flex-col justify-center`}
        >
          <span className={`text-[11px] font-mono ${mutedText}`}>Core Thesis</span>
          <p className={`mt-2 text-sm sm:text-base font-semibold ${headingText} leading-snug text-balance`}>
            &ldquo;{slide.callout}&rdquo;
          </p>
        </div>
        <div
          className={`sm:col-span-7 rounded-xl border ${borderClass} ${surfaceBg} p-4 flex flex-col justify-center`}
        >
          <span className={`text-[11px] font-mono ${mutedText}`}>
            Supporting Evidence
          </span>
          <ul className="mt-2.5 space-y-2.5">
            {slide.bullets.slice(0, 4).map((b, i) => (
              <li key={i} className={`flex items-start gap-2.5 text-xs sm:text-sm ${bodyText} leading-relaxed`}>
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${accentBarClass}`} />
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
      {slide.chart ? (
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-stretch">
          <div className={`sm:col-span-6 rounded-xl border ${borderClass} ${surfaceBg} p-4`}>
            <ul className="space-y-2.5">
              {slide.bullets.slice(0, 5).map((bullet, idx) => (
                <li
                  key={idx}
                  className={`flex items-start gap-2.5 text-xs sm:text-sm ${bodyText} leading-relaxed`}
                >
                  <span className={`text-xs font-mono font-semibold tabular-nums mt-0.5 shrink-0 ${mutedText}`}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="sm:col-span-6 flex flex-col justify-center">
            <SlideVectorBarChart
              chart={slide.chart}
              isLight={isLight}
              accentBarClass={tokens.accentBar}
            />
          </div>
        </div>
      ) : (
        <div className={`rounded-xl border ${borderClass} ${surfaceBg} p-4`}>
          <ul className="space-y-2.5">
            {slide.bullets.slice(0, 6).map((bullet, idx) => (
              <li
                key={idx}
                className={`flex items-start gap-3 text-xs sm:text-sm ${bodyText} leading-relaxed`}
              >
                <span className={`text-xs font-mono font-semibold tabular-nums mt-0.5 shrink-0 ${mutedText}`}>
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {slide.callout && (
        <div className={`rounded-xl border ${accentBorderClass} ${surfaceAltBg} px-3.5 py-2.5 text-xs`}>
          <span className={`font-semibold ${headingText}`}>Key Takeaway: </span>
          <span className={bodyText}>{slide.callout}</span>
        </div>
      )}
    </div>
  );
}

function renumberSlides(
  slides: readonly InteractiveSlideViewModel[],
): readonly InteractiveSlideViewModel[] {
  const total = slides.length;
  return slides.map((s, idx) => ({
    ...s,
    slideNumber: idx + 1,
    totalSlides: total,
  }));
}

async function normalizeFileToPngBase64(file: File): Promise<{
  readonly dataUrl: string;
  readonly pngBase64: string;
}> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read cover visual'));
    reader.readAsDataURL(file);
  });
  if (file.type === 'image/png' && rawDataUrl.startsWith('data:image/png;base64,')) {
    return {
      dataUrl: rawDataUrl,
      pngBase64: rawDataUrl.replace(/^data:image\/png;base64,/, ''),
    };
  }
  const pngDataUrl = await new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxW = 1280;
        const scale = img.width > maxW ? maxW / img.width : 1;
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
          return;
        }
      } catch {
        // Fallback to rawDataUrl
      }
      resolve(rawDataUrl);
    };
    img.onerror = () => resolve(rawDataUrl);
    img.src = rawDataUrl;
  });
  const base64 = pngDataUrl.includes(',')
    ? pngDataUrl.slice(pngDataUrl.indexOf(',') + 1)
    : pngDataUrl;
  return { dataUrl: pngDataUrl, pngBase64: base64 };
}

export function SlideDeckPreview({
  artifact,
  defaultSurfaceMode,
  onSurfaceModeChange,
}: SlideDeckPreviewProps) {
  const specFile = artifact.filesManifest.find((f) => f.path === 'slides-spec.json');
  const parsedDeck = useMemo(
    () => parsePptArtifactSlideDeck(specFile?.content, artifact.title),
    [specFile?.content, artifact.title],
  );

  const [editedDeck, setEditedDeck] = useState<ParsedSlideDeckViewModel | null>(null);
  const [surfaceMode, setSurfaceMode] = useState<ParsedPptSurfaceMode>(
    defaultSurfaceMode ?? parsedDeck.surfaceMode,
  );
  const [isEditingSlide, setIsEditingSlide] = useState(false);
  const [isRecompiling, setIsRecompiling] = useState(false);
  const [isExportingHandout, setIsExportingHandout] = useState(false);
  const [recompileError, setRecompileError] = useState<string | null>(null);
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null>(null);
  const [coverImageBase64, setCoverImageBase64] = useState<string | null>(null);
  const coverFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setEditedDeck(null);
    setSurfaceMode(defaultSurfaceMode ?? parsedDeck.surfaceMode);
    setIsEditingSlide(false);
    setRecompileError(null);
    setCoverImageDataUrl(null);
    setCoverImageBase64(null);
  }, [artifact.artifactId, parsedDeck.surfaceMode, defaultSurfaceMode]);

  const deck: ParsedSlideDeckViewModel = useMemo(() => {
    const base = editedDeck ?? parsedDeck;
    if (base.surfaceMode === surfaceMode) {
      return base;
    }
    return { ...base, surfaceMode };
  }, [editedDeck, parsedDeck, surfaceMode]);

  const hasModifications =
    editedDeck !== null ||
    surfaceMode !== parsedDeck.surfaceMode ||
    coverImageBase64 !== null;
  const isLight = surfaceMode === 'light';
  const tokens = DECK_THEME_TOKENS[deck.theme] ?? DECK_THEME_TOKENS.editorial_story;

  const [activeIndex, setActiveIndex] = useState(0);
  const [viewMode, setViewMode] = useState<'stage' | 'grid'>('stage');
  const [showNotes, setShowNotes] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copiedMd, setCopiedMd] = useState(false);

  const safeIndex = Math.min(activeIndex, Math.max(0, deck.slides.length - 1));
  const currentSlide = deck.slides[safeIndex] ?? deck.slides[0]!;
  const downloadUrl = buildArtifactRawDownloadUrl(artifact.artifactId);
  const safeFilename =
    deck.deckTitle
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'kartik-presentation';

  const updateCurrentSlide = (
    updater: (slide: InteractiveSlideViewModel) => InteractiveSlideViewModel,
  ) => {
    setEditedDeck((prev) => {
      const base = prev ?? parsedDeck;
      const nextSlides = base.slides.map((s, idx) =>
        idx === safeIndex ? updater(s) : s,
      );
      const nextDeckTitle =
        safeIndex === 0 && nextSlides[0]?.title
          ? nextSlides[0].title
          : base.deckTitle;
      return {
        ...base,
        deckTitle: nextDeckTitle,
        surfaceMode,
        slides: nextSlides,
      };
    });
  };

  const handleAddSlideAfterCurrent = () => {
    const insertAt = Math.min(deck.slides.length, safeIndex + 1);
    const footer = deck.slides[0]?.footer || 'Generated by Kartik.ai';
    const newSlide: InteractiveSlideViewModel = {
      slideNumber: insertAt + 1,
      totalSlides: deck.slides.length + 1,
      kind: 'content',
      layout: 'bullets',
      kicker: 'New Section',
      title: `Key Point ${insertAt}`,
      subtitle: 'Add a concise executive summary for this slide',
      bullets: [
        'Primary insight backed by concrete context',
        'Supporting detail or milestone',
        'Recommended next step',
      ],
      footer,
      speakerNotes: 'Introduce the key insight and invite discussion.',
    };
    setEditedDeck((prev) => {
      const base = prev ?? parsedDeck;
      const next = [...base.slides];
      next.splice(insertAt, 0, newSlide);
      return {
        ...base,
        surfaceMode,
        slides: renumberSlides(next),
      };
    });
    setActiveIndex(insertAt);
  };

  const handleDuplicateCurrentSlide = () => {
    const insertAt = safeIndex + 1;
    setEditedDeck((prev) => {
      const base = prev ?? parsedDeck;
      const source = base.slides[safeIndex];
      if (!source) return base;
      const clone: InteractiveSlideViewModel = {
        ...source,
        kind: source.kind === 'cover' ? 'content' : source.kind,
        title: `${source.title} (Copy)`,
        bullets: [...source.bullets],
        chart: source.chart
          ? {
              ...source.chart,
              bars: source.chart.bars.map((b) => ({ ...b })),
            }
          : undefined,
      };
      const next = [...base.slides];
      next.splice(insertAt, 0, clone);
      return {
        ...base,
        surfaceMode,
        slides: renumberSlides(next),
      };
    });
    setActiveIndex(insertAt);
  };

  const handleMoveCurrentSlide = (direction: -1 | 1) => {
    const targetIdx = safeIndex + direction;
    if (targetIdx < 0 || targetIdx >= deck.slides.length) return;
    setEditedDeck((prev) => {
      const base = prev ?? parsedDeck;
      const next = [...base.slides];
      const [moved] = next.splice(safeIndex, 1);
      if (!moved) return base;
      next.splice(targetIdx, 0, moved);
      return {
        ...base,
        surfaceMode,
        slides: renumberSlides(next),
      };
    });
    setActiveIndex(targetIdx);
  };

  const handleDeleteCurrentSlide = () => {
    if (deck.slides.length <= 2) return;
    setEditedDeck((prev) => {
      const base = prev ?? parsedDeck;
      if (base.slides.length <= 2) return base;
      const next = base.slides.filter((_, idx) => idx !== safeIndex);
      return {
        ...base,
        surfaceMode,
        slides: renumberSlides(next),
      };
    });
    setActiveIndex((idx) => Math.max(0, Math.min(idx, deck.slides.length - 2)));
  };

  const handleAttachCoverVisual = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const { dataUrl, pngBase64 } = await normalizeFileToPngBase64(file);
      setCoverImageDataUrl(dataUrl);
      setCoverImageBase64(pngBase64);
      setActiveIndex(0);
    } catch {
      setRecompileError('Failed to attach cover visual.');
    }
  };

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

  const handleRecompilePptx = async () => {
    setIsRecompiling(true);
    setRecompileError(null);
    try {
      const res = await fetch('/api/v1/artifacts/recompile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'ppt',
          filename: safeFilename,
          spec: pptViewModelToCompileSpec(deck),
          ...(coverImageBase64 ? { coverImageBase64 } : {}),
        }),
      });
      if (!res.ok) {
        throw new Error(`Re-compile failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename}.pptx`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setRecompileError(
        err instanceof Error ? err.message : 'Failed to re-compile PPTX',
      );
    } finally {
      setIsRecompiling(false);
    }
  };

  const handleExportPdfHandout = async () => {
    setIsExportingHandout(true);
    setRecompileError(null);
    try {
      const handoutSpec = slideDeckToHandoutPdfSpec(deck);
      const res = await fetch('/api/v1/artifacts/recompile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'pdf',
          filename: `${safeFilename}-handout`,
          spec: handoutSpec,
        }),
      });
      if (!res.ok) {
        throw new Error(`PDF handout export failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename}-handout.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setRecompileError(
        err instanceof Error ? err.message : 'Failed to export PDF handout',
      );
    } finally {
      setIsExportingHandout(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (viewMode !== 'stage' || isEditingSlide) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    }
  };

  const stageBorder = isLight ? 'border-zinc-200' : tokens.border;
  const stageBg = isLight ? 'bg-[#fafafa]' : tokens.canvasBg;

  const renderStageCanvas = (expanded = false) => (
    <div
      data-slide-surface={surfaceMode}
      className={`relative ${
        expanded ? 'w-full max-w-5xl aspect-video' : 'min-h-[340px] sm:aspect-video w-full'
      } rounded-xl border ${stageBorder} ${stageBg} overflow-hidden flex flex-col justify-between shadow-2xl transition-colors`}
    >
      <div
        className={`h-[2px] w-full shrink-0 bg-gradient-to-r from-transparent ${
          isLight ? 'via-zinc-900/45' : 'via-white/55'
        } to-transparent`}
      />
      <div className="flex-1 flex flex-col justify-between px-5 sm:px-8 py-4 sm:py-6 overflow-y-auto">
        {currentSlide.kind === 'content' && (
          <div className={`pb-3 border-b ${stageBorder}`}>
            <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
              <span className={`font-mono truncate ${isLight ? 'text-zinc-500' : 'text-zinc-400'}`}>
                {currentSlide.kicker ||
                  `${tokens.label} · Module ${String(currentSlide.slideNumber - 1).padStart(2, '0')}`}
              </span>
              <span className="font-mono text-zinc-500 shrink-0">
                {LAYOUT_SHORT_LABELS[currentSlide.layout] ?? 'Slide'} ·{' '}
                {String(currentSlide.slideNumber).padStart(2, '0')} /{' '}
                {String(currentSlide.totalSlides).padStart(2, '0')}
              </span>
            </div>
            <h3
              className={`mt-1.5 text-lg sm:text-xl font-semibold tracking-tight leading-snug text-balance ${
                isLight ? 'text-zinc-950' : 'text-white'
              }`}
            >
              {currentSlide.title}
            </h3>
            {currentSlide.subtitle && (
              <p
                className={`mt-0.5 text-xs leading-normal ${
                  isLight ? 'text-zinc-600' : 'text-zinc-400'
                }`}
              >
                {currentSlide.subtitle}
              </p>
            )}
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={`${currentSlide.slideNumber}-${surfaceMode}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex-1 flex flex-col justify-center"
          >
            <SlideStageBody
              slide={currentSlide}
              tokens={tokens}
              isLight={isLight}
              deckAuthor={deck.author}
              deckDate={deck.generatedDate}
              coverImageDataUrl={coverImageDataUrl}
            />
          </motion.div>
        </AnimatePresence>

        <div
          className={`flex items-center justify-between pt-2.5 border-t ${stageBorder} text-[11px] text-zinc-500 tabular-nums`}
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
              {/* Light / Dark Deck Surface Toggle */}
              <button
                type="button"
                data-slide-surface-toggle="true"
                onClick={() => {
                  const next: ParsedPptSurfaceMode =
                    surfaceMode === 'dark' ? 'light' : 'dark';
                  setSurfaceMode(next);
                  onSurfaceModeChange?.(next);
                }}
                title={isLight ? 'Switch deck to Obsidian Dark theme' : 'Switch deck to Paper & Ink Light theme'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/[0.08] bg-[#16161b] text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isLight ? (
                  <>
                    <Moon className="w-3.5 h-3.5" />
                    <span>Dark</span>
                  </>
                ) : (
                  <>
                    <Sun className="w-3.5 h-3.5" />
                    <span>Light</span>
                  </>
                )}
              </button>

              {/* Inline Slide Edit Toggle */}
              <button
                type="button"
                data-slide-edit-toggle="true"
                aria-pressed={isEditingSlide}
                onClick={() => {
                  setViewMode('stage');
                  setIsEditingSlide((v) => !v);
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  isEditingSlide
                    ? 'border-white bg-white text-zinc-950 font-semibold'
                    : 'border-white/[0.08] bg-[#16161b] text-zinc-300 hover:bg-white/[0.08] hover:text-white'
                }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>{isEditingSlide ? 'Done' : 'Edit'}</span>
              </button>

              {hasModifications && (
                <button
                  type="button"
                  onClick={() => {
                    setEditedDeck(null);
                    setSurfaceMode(parsedDeck.surfaceMode);
                    setCoverImageDataUrl(null);
                    setCoverImageBase64(null);
                    setRecompileError(null);
                  }}
                  title="Reset slide edits, cover visual & theme"
                  className="inline-flex items-center justify-center p-1.5 text-xs rounded-lg border border-white/[0.08] bg-[#16161b] text-zinc-300 hover:bg-white/[0.08] hover:text-white transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              )}

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

              <button
                type="button"
                data-slide-pdf-handout-btn="true"
                disabled={isExportingHandout}
                onClick={() => void handleExportPdfHandout()}
                title="Export this slide deck as a print-ready %PDF-1.4 handout"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-white/[0.08] bg-[#16161b] text-zinc-300 hover:bg-white/[0.08] hover:text-white disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {isExportingHandout ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <FileDown className="w-3.5 h-3.5" />
                )}
                <span>{isExportingHandout ? 'Exporting…' : 'PDF Handout'}</span>
              </button>

              {hasModifications ? (
                <button
                  type="button"
                  data-slide-recompile-btn="true"
                  disabled={isRecompiling}
                  onClick={() => void handleRecompilePptx()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-zinc-200 disabled:opacity-60 text-zinc-950 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {isRecompiling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Download className="w-3.5 h-3.5" />
                  )}
                  <span>{isRecompiling ? 'Compiling…' : 'Re-compile .PPTX'}</span>
                </button>
              ) : (
                <a
                  href={downloadUrl}
                  download={`${safeFilename}.pptx`}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 transition-colors whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>.PPTX</span>
                </a>
              )}
            </div>
          </div>
        </div>

        {recompileError && (
          <div className="px-4 py-2 bg-rose-950/50 border-b border-rose-500/30 text-xs text-rose-200">
            {recompileError}
          </div>
        )}

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

            {/* Inline Quick-Edit Drawer for Active Slide */}
            {isEditingSlide && (
              <div
                data-slide-inline-editor="true"
                className="rounded-xl border border-white/[0.1] bg-[#111114] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 pb-2 border-b border-white/[0.07]">
                  <span className="font-semibold text-white">
                    Editing Slide {currentSlide.slideNumber} of {deck.slides.length}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      data-slide-add-btn="true"
                      onClick={handleAddSlideAfterCurrent}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-[11px] text-white font-medium cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      <span>Add Slide</span>
                    </button>
                    <button
                      type="button"
                      data-slide-duplicate-btn="true"
                      onClick={handleDuplicateCurrentSlide}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#18181c] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] text-zinc-200 cursor-pointer"
                    >
                      <CopyPlus className="w-3 h-3" />
                      <span>Duplicate</span>
                    </button>
                    <button
                      type="button"
                      data-slide-move-up-btn="true"
                      disabled={safeIndex === 0}
                      onClick={() => handleMoveCurrentSlide(-1)}
                      title="Move slide earlier"
                      className="p-1 rounded-md bg-[#18181c] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      data-slide-move-down-btn="true"
                      disabled={safeIndex === deck.slides.length - 1}
                      onClick={() => handleMoveCurrentSlide(1)}
                      title="Move slide later"
                      className="p-1 rounded-md bg-[#18181c] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 disabled:opacity-35 cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      data-slide-delete-btn="true"
                      disabled={deck.slides.length <= 2}
                      onClick={handleDeleteCurrentSlide}
                      title="Delete current slide"
                      className="p-1 rounded-md bg-[#18181c] hover:bg-rose-500/20 border border-white/[0.08] text-zinc-300 hover:text-rose-300 disabled:opacity-35 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400">Slide Title</span>
                    <input
                      type="text"
                      data-slide-edit-title="true"
                      value={currentSlide.title}
                      onChange={(e) =>
                        updateCurrentSlide((s) => ({ ...s, title: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-white focus:outline-none focus:border-white/30"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400">Subtitle</span>
                    <input
                      type="text"
                      value={currentSlide.subtitle}
                      onChange={(e) =>
                        updateCurrentSlide((s) => ({ ...s, subtitle: e.target.value }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                    />
                  </label>
                </div>

                {/* Optional Cover Visual Embed (for Slide 1 Cover) */}
                {currentSlide.kind === 'cover' && (
                  <div className="rounded-lg border border-white/[0.08] bg-[#09090b] p-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] text-zinc-300">
                      <span className="font-medium text-white">Cover Visual</span>
                      <span className="text-zinc-500 ml-1.5">
                        Embeds into OpenXML `.pptx` Slide 1
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        ref={coverFileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(e) => void handleAttachCoverVisual(e)}
                        className="hidden"
                      />
                      <button
                        type="button"
                        data-slide-cover-upload-btn="true"
                        onClick={() => coverFileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-[11px] text-white font-medium cursor-pointer"
                      >
                        <ImagePlus className="w-3.5 h-3.5" />
                        <span>{coverImageDataUrl ? 'Replace Visual' : 'Attach Image'}</span>
                      </button>
                      {coverImageDataUrl && (
                        <button
                          type="button"
                          onClick={() => {
                            setCoverImageDataUrl(null);
                            setCoverImageBase64(null);
                          }}
                          className="p-1 rounded-md text-zinc-400 hover:text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                          title="Remove cover visual"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <label className="block space-y-1">
                  <span className="text-[10px] text-zinc-400">
                    Bullet Points (one per line)
                  </span>
                  <textarea
                    rows={3}
                    value={currentSlide.bullets.join('\n')}
                    onChange={(e) => {
                      const nextBullets = e.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean);
                      updateCurrentSlide((s) => ({ ...s, bullets: nextBullets }));
                    }}
                    className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-200 font-mono focus:outline-none focus:border-white/30"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400">Key Takeaway / Callout</span>
                    <input
                      type="text"
                      value={currentSlide.callout ?? ''}
                      onChange={(e) =>
                        updateCurrentSlide((s) => ({
                          ...s,
                          callout: e.target.value || undefined,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[10px] text-zinc-400">Speaker Notes</span>
                    <input
                      type="text"
                      value={currentSlide.speakerNotes ?? ''}
                      onChange={(e) =>
                        updateCurrentSlide((s) => ({
                          ...s,
                          speakerNotes: e.target.value || undefined,
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                    />
                  </label>
                </div>

                {/* Inline Vector Bar Chart Editor */}
                {currentSlide.kind === 'content' && (
                  <div
                    data-slide-chart-editor="true"
                    className="rounded-lg border border-white/[0.08] bg-[#09090b] p-3 space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-200">
                        <BarChart3 className="w-3.5 h-3.5 text-zinc-400" />
                        <span>Slide Bar Chart</span>
                      </div>
                      {currentSlide.chart ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentSlide((s) => ({
                                ...s,
                                chart: s.chart
                                  ? {
                                      ...s.chart,
                                      bars: [
                                        ...s.chart.bars,
                                        { label: `Item ${s.chart.bars.length + 1}`, value: 50 },
                                      ],
                                    }
                                  : undefined,
                              }))
                            }
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.08] hover:bg-white/[0.15] text-[10px] text-white cursor-pointer"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            <span>Add Bar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              updateCurrentSlide((s) => ({ ...s, chart: undefined }))
                            }
                            className="px-2 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-[10px] text-rose-300 cursor-pointer"
                          >
                            Remove Chart
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          data-slide-add-chart-btn="true"
                          onClick={() =>
                            updateCurrentSlide((s) => ({
                              ...s,
                              chart: {
                                title: 'Key Comparison',
                                unit: '%',
                                bars: [
                                  { label: 'Metric A', value: 78 },
                                  { label: 'Metric B', value: 54 },
                                  { label: 'Metric C', value: 92 },
                                ],
                              },
                            }))
                          }
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white/[0.08] hover:bg-white/[0.15] text-[10px] text-white cursor-pointer"
                        >
                          <Plus className="w-2.5 h-2.5" />
                          <span>Add Vector Chart</span>
                        </button>
                      )}
                    </div>

                    {currentSlide.chart && (
                      <div className="space-y-2">
                        <div className="grid grid-cols-3 gap-2">
                          <input
                            type="text"
                            placeholder="Chart title"
                            value={currentSlide.chart.title ?? ''}
                            onChange={(e) =>
                              updateCurrentSlide((s) => ({
                                ...s,
                                chart: s.chart
                                  ? { ...s.chart, title: e.target.value }
                                  : undefined,
                              }))
                            }
                            className="col-span-2 px-2 py-1 rounded bg-[#111114] border border-white/[0.1] text-[11px] text-zinc-200 focus:outline-none"
                          />
                          <input
                            type="text"
                            placeholder="Unit (e.g. %)"
                            value={currentSlide.chart.unit ?? ''}
                            onChange={(e) =>
                              updateCurrentSlide((s) => ({
                                ...s,
                                chart: s.chart
                                  ? { ...s.chart, unit: e.target.value || undefined }
                                  : undefined,
                              }))
                            }
                            className="px-2 py-1 rounded bg-[#111114] border border-white/[0.1] text-[11px] font-mono text-zinc-200 focus:outline-none"
                          />
                        </div>
                        <div className="space-y-1.5">
                          {currentSlide.chart.bars.map((bar, bIdx) => (
                            <div key={bIdx} className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={bar.label}
                                onChange={(e) =>
                                  updateCurrentSlide((s) => ({
                                    ...s,
                                    chart: s.chart
                                      ? {
                                          ...s.chart,
                                          bars: s.chart.bars.map((item, i) =>
                                            i === bIdx
                                              ? { ...item, label: e.target.value }
                                              : item,
                                          ),
                                        }
                                      : undefined,
                                  }))
                                }
                                className="flex-1 px-2 py-1 rounded bg-[#111114] border border-white/[0.1] text-[11px] text-zinc-200 focus:outline-none"
                              />
                              <input
                                type="number"
                                value={bar.value}
                                onChange={(e) => {
                                  const num = Number(e.target.value);
                                  updateCurrentSlide((s) => ({
                                    ...s,
                                    chart: s.chart
                                      ? {
                                          ...s.chart,
                                          bars: s.chart.bars.map((item, i) =>
                                            i === bIdx
                                              ? {
                                                  ...item,
                                                  value: Number.isFinite(num) ? num : 0,
                                                }
                                              : item,
                                          ),
                                        }
                                      : undefined,
                                  }));
                                }}
                                className="w-20 px-2 py-1 rounded bg-[#111114] border border-white/[0.1] text-[11px] font-mono tabular-nums text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                disabled={currentSlide.chart!.bars.length <= 2}
                                onClick={() =>
                                  updateCurrentSlide((s) => ({
                                    ...s,
                                    chart: s.chart
                                      ? {
                                          ...s.chart,
                                          bars: s.chart.bars.filter((_, i) => i !== bIdx),
                                        }
                                      : undefined,
                                  }))
                                }
                                className="p-1 rounded text-zinc-500 hover:text-rose-300 disabled:opacity-30 cursor-pointer"
                                title="Remove bar"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

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
