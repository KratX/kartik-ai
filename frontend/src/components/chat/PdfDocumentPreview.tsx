import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  parsePdfArtifactDocument,
  pdfDocumentSpecToMarkdown,
  pdfViewModelToCompileSpec,
  type ParsedPdfDocumentType,
  type ParsedPdfDocumentViewModel,
  type ParsedVectorChart,
} from '../slide-deck-and-markdown.js';
import type { ArtifactRecord } from '../../types/index.js';

export interface PdfDocumentPreviewProps {
  readonly artifact: ArtifactRecord;
}

function PdfVectorBarChart({
  chart,
  accentBarClass,
}: {
  readonly chart: ParsedVectorChart;
  readonly accentBarClass: string;
}) {
  const maxVal = Math.max(1, ...chart.bars.map((b) => b.value));
  return (
    <div
      data-pdf-vector-chart="true"
      className="rounded-lg border border-zinc-200 bg-zinc-50/75 p-3 space-y-2"
    >
      {chart.title && (
        <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-zinc-800">
          <span>{chart.title}</span>
          {chart.unit && (
            <span className="text-[10px] font-mono text-zinc-500">{chart.unit}</span>
          )}
        </div>
      )}
      <div className="space-y-1.5">
        {chart.bars.map((bar, idx) => {
          const pct = Math.max(4, Math.min(100, (bar.value / maxVal) * 100));
          const display =
            bar.displayValue ??
            `${bar.value}${chart.unit ? ` ${chart.unit}` : ''}`;
          return (
            <div key={`${bar.label}-${idx}`} className="space-y-0.5">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-zinc-700 truncate">{bar.label}</span>
                <span className="font-mono tabular-nums font-semibold text-zinc-900 shrink-0">
                  {display}
                </span>
              </div>
              <div className="h-2 w-full rounded bg-zinc-200/90 overflow-hidden">
                <div
                  className={`h-full rounded ${accentBarClass}`}
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

interface PdfArchetypeStyle {
  readonly badge: string;
  readonly summaryLabel: string;
  readonly bannerClass: string;
  readonly accentBorderClass: string;
  readonly accentTextClass: string;
  readonly tintBgClass: string;
}

const ARCHETYPE_STYLES: Readonly<Record<ParsedPdfDocumentType, PdfArchetypeStyle>> = {
  general_guide: {
    badge: 'EDITORIAL GUIDE',
    summaryLabel: 'Overview',
    bannerClass: 'bg-[#0b0c10] border-l-4 border-zinc-200',
    accentBorderClass: 'border-zinc-800',
    accentTextClass: 'text-zinc-800',
    tintBgClass: 'bg-zinc-50 border-zinc-200',
  },
  educational_explainer: {
    badge: 'STUDY GUIDE',
    summaryLabel: 'At a Glance',
    bannerClass: 'bg-[#091214] border-l-4 border-teal-400',
    accentBorderClass: 'border-teal-700',
    accentTextClass: 'text-teal-800',
    tintBgClass: 'bg-teal-50/70 border-teal-200',
  },
  creative_editorial: {
    badge: 'FEATURED ESSAY',
    summaryLabel: 'Synopsis',
    bannerClass: 'bg-[#120d0c] border-l-4 border-amber-300',
    accentBorderClass: 'border-amber-700',
    accentTextClass: 'text-amber-900',
    tintBgClass: 'bg-amber-50/70 border-amber-200',
  },
  technical_report: {
    badge: 'TECHNICAL REPORT',
    summaryLabel: 'Executive Summary',
    bannerClass: 'bg-[#0b0b0f] border-l-4 border-zinc-200',
    accentBorderClass: 'border-zinc-800',
    accentTextClass: 'text-zinc-800',
    tintBgClass: 'bg-zinc-50 border-zinc-200',
  },
  executive_brief: {
    badge: 'EXECUTIVE BRIEF',
    summaryLabel: 'Executive Summary',
    bannerClass: 'bg-[#0d0d12] border-l-4 border-zinc-300',
    accentBorderClass: 'border-zinc-800',
    accentTextClass: 'text-zinc-800',
    tintBgClass: 'bg-zinc-50 border-zinc-200',
  },
  proposal: {
    badge: 'PROJECT PROPOSAL',
    summaryLabel: 'Executive Summary',
    bannerClass: 'bg-[#091210] border-l-4 border-emerald-400',
    accentBorderClass: 'border-emerald-700',
    accentTextClass: 'text-emerald-800',
    tintBgClass: 'bg-emerald-50/70 border-emerald-200',
  },
  research_paper: {
    badge: 'RESEARCH BRIEF',
    summaryLabel: 'Abstract',
    bannerClass: 'bg-[#0d0d10] border-l-4 border-zinc-300',
    accentBorderClass: 'border-zinc-700',
    accentTextClass: 'text-zinc-800',
    tintBgClass: 'bg-zinc-50 border-zinc-200',
  },
  playbook: {
    badge: 'STEP-BY-STEP PLAYBOOK',
    summaryLabel: 'Overview',
    bannerClass: 'bg-[#0c0c10] border-l-4 border-zinc-300',
    accentBorderClass: 'border-zinc-800',
    accentTextClass: 'text-zinc-800',
    tintBgClass: 'bg-zinc-50 border-zinc-200',
  },
  resume: {
    badge: 'EXECUTIVE PROFILE',
    summaryLabel: 'Profile Summary',
    bannerClass: 'bg-[#0b0b0d] border-l-4 border-zinc-300',
    accentBorderClass: 'border-zinc-700',
    accentTextClass: 'text-zinc-800',
    tintBgClass: 'bg-zinc-50 border-zinc-200',
  },
};

const ZOOM_STEPS = [90, 100, 112] as const;

export function PdfDocumentPreview({ artifact }: PdfDocumentPreviewProps) {
  const specFile = artifact.filesManifest.find(
    (f) => f.path === 'document-spec.json',
  );
  const parsedDoc = useMemo(
    () => parsePdfArtifactDocument(specFile?.content, artifact.title),
    [specFile?.content, artifact.title],
  );

  const [editedDoc, setEditedDoc] = useState<ParsedPdfDocumentViewModel | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isRecompiling, setIsRecompiling] = useState(false);
  const [recompileError, setRecompileError] = useState<string | null>(null);

  useEffect(() => {
    setEditedDoc(null);
    setIsEditing(false);
    setRecompileError(null);
  }, [artifact.artifactId]);

  const doc = editedDoc ?? parsedDoc;
  const hasEdits = editedDoc !== null;
  const style = ARCHETYPE_STYLES[doc.documentType] ?? ARCHETYPE_STYLES.general_guide;

  const [viewMode, setViewMode] = useState<'reader' | 'pages'>('reader');
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number | null>(null);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  const zoomPct = ZOOM_STEPS[zoomIdx] ?? 100;

  const updateDoc = (
    updater: (prev: ParsedPdfDocumentViewModel) => ParsedPdfDocumentViewModel,
  ) => {
    setEditedDoc((prev) => updater(prev ?? parsedDoc));
  };

  const a4Pages = useMemo(() => {
    const pages: Array<{
      readonly pageNumber: number;
      readonly isCoverPage: boolean;
      readonly sections: typeof doc.sections;
    }> = [];
    const firstPageCap =
      doc.executiveSummary || doc.keyMetrics.length > 0 ? 1 : 2;
    pages.push({
      pageNumber: 1,
      isCoverPage: true,
      sections: doc.sections.slice(0, firstPageCap),
    });
    let offset = firstPageCap;
    while (offset < doc.sections.length) {
      pages.push({
        pageNumber: pages.length + 1,
        isCoverPage: false,
        sections: doc.sections.slice(offset, offset + 2),
      });
      offset += 2;
    }
    return pages;
  }, [doc]);

  const downloadUrl = buildArtifactRawDownloadUrl(artifact.artifactId);
  const inlinePdfUrl = `${downloadUrl}?inline=1`;
  const safeFilename =
    doc.title
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'kartik-document';
  const sizeKb = Math.max(1, Math.round(artifact.sizeBytes / 1024));

  const visibleSections =
    selectedSectionIdx === null
      ? doc.sections
      : doc.sections.slice(selectedSectionIdx, selectedSectionIdx + 1);

  const handleCopyMarkdown = async () => {
    try {
      const md = pdfDocumentSpecToMarkdown(doc);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md);
      }
      setCopiedMarkdown(true);
      setTimeout(() => setCopiedMarkdown(false), 1800);
    } catch {
      setCopiedMarkdown(true);
      setTimeout(() => setCopiedMarkdown(false), 1800);
    }
  };

  const handleRecompilePdf = async () => {
    setIsRecompiling(true);
    setRecompileError(null);
    try {
      const res = await fetch('/api/v1/artifacts/recompile', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'pdf',
          filename: safeFilename,
          spec: pdfViewModelToCompileSpec(doc),
        }),
      });
      if (!res.ok) {
        throw new Error(`Re-compile failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${safeFilename}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setRecompileError(
        err instanceof Error ? err.message : 'Failed to re-compile PDF',
      );
    } finally {
      setIsRecompiling(false);
    }
  };

  return (
    <div
      data-pdf-studio="true"
      className="rounded-xl border border-white/[0.09] bg-[#0b0b0e] overflow-hidden"
    >
      {/* Obsidian Studio Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-3 bg-[#111114] border-b border-white/[0.07]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-white shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">
              {doc.title}
            </div>
            <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5 flex-wrap tabular-nums">
              <span className="text-zinc-200">{style.badge}</span>
              <span>·</span>
              <span>
                {doc.pageCount} {doc.pageCount === 1 ? 'Page' : 'Pages'}
              </span>
              <span>·</span>
              <span>{doc.sections.length} Sections</span>
              <span>·</span>
              <span>{sizeKb} KB</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Spring Segmented View Switcher */}
          <div className="inline-flex items-center bg-[#09090b] p-0.5 rounded-lg border border-white/[0.08]">
            {(
              [
                { id: 'reader', label: 'Reader', icon: BookOpen },
                { id: 'pages', label: `A4 Sheets (${a4Pages.length})`, icon: Layers },
              ] as const
            ).map((tab) => {
              const active = viewMode === tab.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewMode(tab.id)}
                  className="group relative isolate inline-flex items-center justify-center px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap cursor-pointer"
                >
                  {active && (
                    <motion.span
                      layoutId={`pdf-studio-view-${artifact.artifactId}`}
                      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                      className="absolute inset-0 z-0 rounded-md bg-white"
                    />
                  )}
                  <span
                    className={`relative z-10 inline-flex items-center gap-1 ${
                      active
                        ? 'text-[#09090b] font-semibold'
                        : 'text-zinc-400 group-hover:text-zinc-100'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{tab.label}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Zoom Controls */}
          <div className="inline-flex items-center rounded-lg bg-[#16161b] border border-white/[0.08] overflow-hidden">
            <button
              type="button"
              aria-label="Zoom out"
              disabled={zoomIdx === 0}
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-35 cursor-pointer"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="px-1.5 text-[10px] font-mono tabular-nums text-zinc-300">
              {zoomPct}%
            </span>
            <button
              type="button"
              aria-label="Zoom in"
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
              onClick={() =>
                setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))
              }
              className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-35 cursor-pointer"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>

          <button
            type="button"
            data-pdf-edit-toggle="true"
            aria-pressed={isEditing}
            onClick={() => {
              setViewMode('reader');
              setIsEditing((prev) => !prev);
            }}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium border rounded-lg transition-colors cursor-pointer ${
              isEditing
                ? 'bg-white text-zinc-950 border-white font-semibold'
                : 'bg-[#16161b] hover:bg-white/[0.1] border-white/[0.08] text-zinc-200'
            }`}
          >
            <Pencil className="w-3 h-3" />
            <span>{isEditing ? 'Done' : 'Edit'}</span>
          </button>

          {hasEdits && (
            <button
              type="button"
              onClick={() => {
                setEditedDoc(null);
                setRecompileError(null);
              }}
              title="Reset edits to original document"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium bg-[#16161b] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-300 rounded-lg transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleCopyMarkdown()}
            title="Copy structured document as Markdown"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-[#16161b] hover:bg-white/[0.1] border border-white/[0.08] text-zinc-200 rounded-lg transition-colors cursor-pointer"
          >
            {copiedMarkdown ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy MD</span>
              </>
            )}
          </button>

          {hasEdits ? (
            <button
              type="button"
              data-pdf-recompile-btn="true"
              disabled={isRecompiling}
              onClick={() => void handleRecompilePdf()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-zinc-200 disabled:opacity-60 text-zinc-950 rounded-lg transition-colors shrink-0 cursor-pointer"
            >
              {isRecompiling ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              <span>{isRecompiling ? 'Compiling…' : 'Re-compile .PDF'}</span>
            </button>
          ) : (
            <a
              href={downloadUrl}
              download={`${safeFilename}.pdf`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-zinc-200 text-zinc-950 rounded-lg transition-colors shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>.PDF</span>
            </a>
          )}
        </div>
      </div>

      {recompileError && (
        <div className="px-4 py-2 bg-rose-950/50 border-b border-rose-500/30 text-xs text-rose-200">
          {recompileError}
        </div>
      )}

      {viewMode === 'pages' ? (
        <div className="p-4 bg-[#09090b] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono text-zinc-500">
            <span>
              A4 Print Layout · {doc.pageCount}{' '}
              {doc.pageCount === 1 ? 'Page' : 'Pages'} · {sizeKb} KB %PDF-1.4
            </span>
            <a
              href={inlinePdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-zinc-200 hover:text-white underline underline-offset-4"
            >
              <span>Open Raw .PDF</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="max-h-[560px] overflow-y-auto space-y-5 pr-1">
            {a4Pages.map((sheet) => (
              <div
                key={sheet.pageNumber}
                style={{ fontSize: `${zoomPct}%` }}
                className="mx-auto max-w-[680px] rounded-lg bg-white text-zinc-900 shadow-2xl border border-white/15 overflow-hidden flex flex-col justify-between min-h-[420px]"
              >
                <div>
                  {sheet.isCoverPage ? (
                    <div className={`px-6 py-4 text-white ${style.bannerClass}`}>
                      <div className="text-[9px] font-mono font-bold tracking-widest text-zinc-400 uppercase">
                        {style.badge}
                      </div>
                      <h3 className="text-base sm:text-lg font-bold tracking-tight mt-0.5 text-white">
                        {doc.title}
                      </h3>
                      <p className="text-xs italic text-zinc-300 mt-0.5">
                        {doc.subtitle}
                      </p>
                      <div className="mt-2 pt-2 border-t border-white/15 flex flex-wrap items-center gap-x-3 text-[10px] font-mono text-zinc-400">
                        {doc.generatedDate && <span>{doc.generatedDate}</span>}
                        <span>{doc.author}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="px-6 py-2.5 bg-zinc-50 border-b border-zinc-200 flex items-center justify-between text-[10px] font-mono text-zinc-500">
                      <span className="font-semibold text-zinc-700 truncate">
                        {doc.title}
                      </span>
                      <span className={style.accentTextClass}>{style.badge}</span>
                    </div>
                  )}

                  <div className="p-5 sm:p-6 space-y-4">
                    {sheet.isCoverPage && doc.executiveSummary && (
                      <div
                        className={`rounded-md border p-3.5 border-l-4 ${style.tintBgClass} ${style.accentBorderClass}`}
                      >
                        <div
                          className={`text-[9px] font-mono font-bold uppercase tracking-wider mb-1 ${style.accentTextClass}`}
                        >
                          {style.summaryLabel}
                        </div>
                        <p className="text-xs text-zinc-800 leading-relaxed">
                          {doc.executiveSummary}
                        </p>
                      </div>
                    )}

                    {sheet.isCoverPage && doc.keyMetrics.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {doc.keyMetrics.map((metric, mIdx) => (
                          <div
                            key={`${metric.label}-${mIdx}`}
                            className={`rounded-md border border-zinc-200 bg-zinc-50/80 p-2.5 border-t-2 ${style.accentBorderClass}`}
                          >
                            <div className="text-[9px] font-semibold uppercase tracking-wide text-zinc-500 line-clamp-2 leading-tight">
                              {metric.label}
                            </div>
                            <div className="text-sm font-bold text-zinc-900 mt-1">
                              {metric.value}
                            </div>
                            {metric.delta && (
                              <div
                                className={`text-[9px] font-medium mt-0.5 truncate ${style.accentTextClass}`}
                              >
                                {metric.delta}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {sheet.sections.map((sec) => (
                      <section key={sec.sectionNumber} className="space-y-2">
                        <div className="border-b border-zinc-200 pb-1">
                          <h4 className="text-sm font-bold text-zinc-900">
                            {sec.sectionNumber}. {sec.heading}
                          </h4>
                        </div>
                        {sec.content && (
                          <p className="text-xs text-zinc-700 leading-relaxed">
                            {sec.content}
                          </p>
                        )}
                        {sec.bullets.length > 0 && (
                          <ul className="space-y-1 pl-1">
                            {sec.bullets.map((b, bIdx) => (
                              <li
                                key={bIdx}
                                className="flex items-start gap-2 text-xs text-zinc-700"
                              >
                                <span className="w-1.5 h-1.5 rounded-[2px] bg-zinc-800 mt-1.5 shrink-0" />
                                <span>{b}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {sec.callout && (
                          <div
                            className={`rounded-md border p-2.5 border-l-4 ${style.tintBgClass} ${style.accentBorderClass}`}
                          >
                            <div
                              className={`text-[9px] font-mono font-bold uppercase tracking-wider mb-0.5 ${style.accentTextClass}`}
                            >
                              Key Takeaway
                            </div>
                            <p className="text-[11px] italic text-zinc-800 leading-relaxed">
                              {sec.callout}
                            </p>
                          </div>
                        )}
                        {sec.table && (
                          <div className="overflow-x-auto rounded border border-zinc-200">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="bg-zinc-950 text-white">
                                  {sec.table.headers.map((hdr, hIdx) => (
                                    <th key={hIdx} className="px-2.5 py-1.5 font-semibold">
                                      {hdr}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {sec.table.rows.map((row, rIdx) => (
                                  <tr
                                    key={rIdx}
                                    className={
                                      rIdx % 2 === 1
                                        ? 'bg-zinc-50 border-t border-zinc-200'
                                        : 'bg-white border-t border-zinc-200'
                                    }
                                  >
                                    {row.map((cell, cIdx) => (
                                      <td
                                        key={cIdx}
                                        className={`px-2.5 py-1.5 ${
                                          cIdx === 0
                                            ? 'font-semibold text-zinc-900'
                                            : 'text-zinc-700'
                                        }`}
                                      >
                                        {cell}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {sec.chart && (
                          <PdfVectorBarChart
                            chart={sec.chart}
                            accentBarClass="bg-zinc-900"
                          />
                        )}
                      </section>
                    ))}
                  </div>
                </div>

                <div className="px-6 py-2.5 bg-zinc-50 border-t border-zinc-200 flex items-center justify-between text-[10px] font-mono text-zinc-500">
                  <span>
                    {doc.footer} | Sheet {sheet.pageNumber} of {a4Pages.length}
                  </span>
                  <span>{doc.generatedDate ?? '%PDF-1.4'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-3.5 sm:p-4 space-y-3 bg-[#09090b]">
          {/* Section Outline Quick-Jump Bar */}
          {doc.sections.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
              <button
                type="button"
                onClick={() => setSelectedSectionIdx(null)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border whitespace-nowrap transition-colors cursor-pointer ${
                  selectedSectionIdx === null
                    ? 'bg-white text-zinc-950 border-white font-semibold'
                    : 'bg-[#141418] text-zinc-400 border-white/[0.08] hover:text-zinc-100'
                }`}
              >
                Full Report ({doc.sections.length})
              </button>
              {doc.sections.map((sec, idx) => (
                <button
                  key={sec.sectionNumber}
                  type="button"
                  onClick={() => setSelectedSectionIdx(idx)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border whitespace-nowrap transition-colors cursor-pointer ${
                    selectedSectionIdx === idx
                      ? 'bg-white text-zinc-950 border-white font-semibold'
                      : 'bg-[#141418] text-zinc-400 border-white/[0.08] hover:text-zinc-100'
                  }`}
                >
                  {sec.sectionNumber}. {sec.heading.slice(0, 26)}
                  {sec.heading.length > 26 ? '…' : ''}
                </button>
              ))}
            </div>
          )}

          {/* Crisp Editorial Paper Sheet Preview Framed in Obsidian Chrome */}
          {isEditing ? (
            <div
              data-pdf-inline-editor="true"
              className="rounded-xl bg-[#111114] border border-white/[0.1] p-4 space-y-4 max-h-[560px] overflow-y-auto"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/[0.08]">
                <span className="text-xs font-semibold text-white">
                  Inline Document Editor · Click Re-compile .PDF to export changes
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-zinc-400 tabular-nums">
                    {doc.sections.length} Sections
                  </span>
                  <button
                    type="button"
                    data-pdf-add-section-btn="true"
                    onClick={() =>
                      updateDoc((prev) => {
                        const nextSections = [
                          ...prev.sections,
                          {
                            sectionNumber: prev.sections.length + 1,
                            heading: `Section ${prev.sections.length + 1}`,
                            content: 'Add structured analysis or supporting narrative here.',
                            bullets: ['Key takeaway or concrete detail'],
                          },
                        ];
                        return { ...prev, sections: nextSections };
                      })
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.08] hover:bg-white/[0.15] text-[11px] font-medium text-white cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    <span>Add Section</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2.5">
                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-zinc-400">Document Title</span>
                  <input
                    type="text"
                    data-pdf-edit-title="true"
                    value={doc.title}
                    onChange={(e) =>
                      updateDoc((prev) => ({ ...prev, title: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-sm text-white focus:outline-none focus:border-white/30"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-zinc-400">Subtitle</span>
                  <input
                    type="text"
                    value={doc.subtitle}
                    onChange={(e) =>
                      updateDoc((prev) => ({ ...prev, subtitle: e.target.value }))
                    }
                    className="w-full px-3 py-1.5 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-200 focus:outline-none focus:border-white/30"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] font-medium text-zinc-400">
                    {style.summaryLabel}
                  </span>
                  <textarea
                    rows={3}
                    value={doc.executiveSummary ?? ''}
                    onChange={(e) =>
                      updateDoc((prev) => ({
                        ...prev,
                        executiveSummary: e.target.value,
                      }))
                    }
                    className="w-full px-3 py-2 rounded-lg bg-[#09090b] border border-white/[0.1] text-xs text-zinc-200 leading-relaxed focus:outline-none focus:border-white/30"
                  />
                </label>
              </div>

              <div className="space-y-3">
                {doc.sections.map((sec, sIdx) => (
                  <div
                    key={`${sec.sectionNumber}-${sIdx}`}
                    className="rounded-lg border border-white/[0.08] bg-[#0b0b0e] p-3 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-zinc-500">
                        Section {sec.sectionNumber}
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={sIdx === 0}
                          onClick={() =>
                            updateDoc((prev) => {
                              const next = [...prev.sections];
                              const [moved] = next.splice(sIdx, 1);
                              if (!moved) return prev;
                              next.splice(sIdx - 1, 0, moved);
                              return {
                                ...prev,
                                sections: next.map((item, idx) => ({
                                  ...item,
                                  sectionNumber: idx + 1,
                                })),
                              };
                            })
                          }
                          title="Move section up"
                          className="p-1 rounded bg-[#16161b] hover:bg-white/[0.1] text-zinc-300 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={sIdx === doc.sections.length - 1}
                          onClick={() =>
                            updateDoc((prev) => {
                              const next = [...prev.sections];
                              const [moved] = next.splice(sIdx, 1);
                              if (!moved) return prev;
                              next.splice(sIdx + 1, 0, moved);
                              return {
                                ...prev,
                                sections: next.map((item, idx) => ({
                                  ...item,
                                  sectionNumber: idx + 1,
                                })),
                              };
                            })
                          }
                          title="Move section down"
                          className="p-1 rounded bg-[#16161b] hover:bg-white/[0.1] text-zinc-300 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={doc.sections.length <= 1}
                          onClick={() =>
                            updateDoc((prev) => {
                              if (prev.sections.length <= 1) return prev;
                              const next = prev.sections
                                .filter((_, idx) => idx !== sIdx)
                                .map((item, idx) => ({
                                  ...item,
                                  sectionNumber: idx + 1,
                                }));
                              return { ...prev, sections: next };
                            })
                          }
                          title="Delete section"
                          className="p-1 rounded bg-[#16161b] hover:bg-rose-500/20 text-zinc-300 hover:text-rose-300 disabled:opacity-30 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={sec.heading}
                      onChange={(e) =>
                        updateDoc((prev) => ({
                          ...prev,
                          sections: prev.sections.map((item, idx) =>
                            idx === sIdx ? { ...item, heading: e.target.value } : item,
                          ),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-md bg-[#111114] border border-white/[0.1] text-xs font-semibold text-white focus:outline-none focus:border-white/30"
                    />
                    <textarea
                      rows={3}
                      value={sec.content}
                      onChange={(e) =>
                        updateDoc((prev) => ({
                          ...prev,
                          sections: prev.sections.map((item, idx) =>
                            idx === sIdx ? { ...item, content: e.target.value } : item,
                          ),
                        }))
                      }
                      className="w-full px-2.5 py-1.5 rounded-md bg-[#111114] border border-white/[0.1] text-xs text-zinc-200 leading-relaxed focus:outline-none focus:border-white/30"
                    />
                    <label className="block space-y-1">
                      <span className="text-[10px] text-zinc-500">
                        Bullets (one per line)
                      </span>
                      <textarea
                        rows={Math.max(2, Math.min(5, sec.bullets.length || 2))}
                        value={sec.bullets.join('\n')}
                        onChange={(e) => {
                          const nextBullets = e.target.value
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean);
                          updateDoc((prev) => ({
                            ...prev,
                            sections: prev.sections.map((item, idx) =>
                              idx === sIdx ? { ...item, bullets: nextBullets } : item,
                            ),
                          }));
                        }}
                        className="w-full px-2.5 py-1.5 rounded-md bg-[#111114] border border-white/[0.1] text-xs text-zinc-300 font-mono focus:outline-none focus:border-white/30"
                      />
                    </label>

                    {/* Per-Section Inline Chart Bar Editor */}
                    <div className="rounded-md border border-white/[0.07] bg-[#111114] p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-zinc-300">
                          <BarChart3 className="w-3 h-3 text-zinc-400" />
                          <span>Section Bar Chart</span>
                        </span>
                        {sec.chart ? (
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateDoc((prev) => ({
                                  ...prev,
                                  sections: prev.sections.map((item, idx) =>
                                    idx === sIdx && item.chart
                                      ? {
                                          ...item,
                                          chart: {
                                            ...item.chart,
                                            bars: [
                                              ...item.chart.bars,
                                              {
                                                label: `Series ${item.chart.bars.length + 1}`,
                                                value: 40,
                                              },
                                            ],
                                          },
                                        }
                                      : item,
                                  ),
                                }))
                              }
                              className="px-1.5 py-0.5 rounded bg-white/[0.08] hover:bg-white/[0.15] text-[10px] text-white cursor-pointer"
                            >
                              + Bar
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                updateDoc((prev) => ({
                                  ...prev,
                                  sections: prev.sections.map((item, idx) =>
                                    idx === sIdx
                                      ? { ...item, chart: undefined }
                                      : item,
                                  ),
                                }))
                              }
                              className="px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 text-[10px] text-rose-300 cursor-pointer"
                            >
                              Remove
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              updateDoc((prev) => ({
                                ...prev,
                                sections: prev.sections.map((item, idx) =>
                                  idx === sIdx
                                    ? {
                                        ...item,
                                        chart: {
                                          title: `${item.heading} Comparison`,
                                          unit: '%',
                                          bars: [
                                            { label: 'Option A', value: 72 },
                                            { label: 'Option B', value: 58 },
                                            { label: 'Option C', value: 89 },
                                          ],
                                        },
                                      }
                                    : item,
                                ),
                              }))
                            }
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.08] hover:bg-white/[0.15] text-[10px] text-white cursor-pointer"
                          >
                            <Plus className="w-2.5 h-2.5" />
                            <span>Add Chart</span>
                          </button>
                        )}
                      </div>
                      {sec.chart && (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-3 gap-1.5">
                            <input
                              type="text"
                              value={sec.chart.title ?? ''}
                              placeholder="Chart title"
                              onChange={(e) =>
                                updateDoc((prev) => ({
                                  ...prev,
                                  sections: prev.sections.map((item, idx) =>
                                    idx === sIdx && item.chart
                                      ? {
                                          ...item,
                                          chart: {
                                            ...item.chart,
                                            title: e.target.value,
                                          },
                                        }
                                      : item,
                                  ),
                                }))
                              }
                              className="col-span-2 px-2 py-1 rounded bg-[#09090b] border border-white/[0.09] text-[11px] text-zinc-200 focus:outline-none"
                            />
                            <input
                              type="text"
                              value={sec.chart.unit ?? ''}
                              placeholder="Unit"
                              onChange={(e) =>
                                updateDoc((prev) => ({
                                  ...prev,
                                  sections: prev.sections.map((item, idx) =>
                                    idx === sIdx && item.chart
                                      ? {
                                          ...item,
                                          chart: {
                                            ...item.chart,
                                            unit: e.target.value || undefined,
                                          },
                                        }
                                      : item,
                                  ),
                                }))
                              }
                              className="px-2 py-1 rounded bg-[#09090b] border border-white/[0.09] text-[11px] font-mono text-zinc-200 focus:outline-none"
                            />
                          </div>
                          {sec.chart.bars.map((bar, bIdx) => (
                            <div key={bIdx} className="flex items-center gap-1.5">
                              <input
                                type="text"
                                value={bar.label}
                                onChange={(e) =>
                                  updateDoc((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((item, idx) =>
                                      idx === sIdx && item.chart
                                        ? {
                                            ...item,
                                            chart: {
                                              ...item.chart,
                                              bars: item.chart.bars.map((b, bi) =>
                                                bi === bIdx
                                                  ? { ...b, label: e.target.value }
                                                  : b,
                                              ),
                                            },
                                          }
                                        : item,
                                    ),
                                  }))
                                }
                                className="flex-1 px-2 py-1 rounded bg-[#09090b] border border-white/[0.09] text-[11px] text-zinc-200 focus:outline-none"
                              />
                              <input
                                type="number"
                                value={bar.value}
                                onChange={(e) => {
                                  const num = Number(e.target.value);
                                  updateDoc((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((item, idx) =>
                                      idx === sIdx && item.chart
                                        ? {
                                            ...item,
                                            chart: {
                                              ...item.chart,
                                              bars: item.chart.bars.map((b, bi) =>
                                                bi === bIdx
                                                  ? {
                                                      ...b,
                                                      value: Number.isFinite(num)
                                                        ? num
                                                        : 0,
                                                    }
                                                  : b,
                                              ),
                                            },
                                          }
                                        : item,
                                    ),
                                  }));
                                }}
                                className="w-20 px-2 py-1 rounded bg-[#09090b] border border-white/[0.09] text-[11px] font-mono tabular-nums text-white focus:outline-none"
                              />
                              <button
                                type="button"
                                disabled={sec.chart!.bars.length <= 2}
                                onClick={() =>
                                  updateDoc((prev) => ({
                                    ...prev,
                                    sections: prev.sections.map((item, idx) =>
                                      idx === sIdx && item.chart
                                        ? {
                                            ...item,
                                            chart: {
                                              ...item.chart,
                                              bars: item.chart.bars.filter(
                                                (_, bi) => bi !== bIdx,
                                              ),
                                            },
                                          }
                                        : item,
                                    ),
                                  }))
                                }
                                className="p-1 text-zinc-500 hover:text-rose-300 disabled:opacity-30 cursor-pointer"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
          <div
            style={{ fontSize: `${zoomPct}%` }}
            className="rounded-xl bg-white text-zinc-900 shadow-2xl overflow-hidden border border-white/15 max-h-[560px] overflow-y-auto"
          >
            <div className={`px-6 py-5 text-white ${style.bannerClass}`}>
              <div className="text-[10px] font-mono font-bold tracking-widest text-zinc-400 uppercase">
                {style.badge}
              </div>
              <h3 className="text-lg sm:text-xl font-bold tracking-tight mt-1 text-white leading-snug">
                {doc.title}
              </h3>
              <p className="text-xs sm:text-sm italic text-zinc-300 mt-1">
                {doc.subtitle}
              </p>
              <div className="mt-3 pt-2.5 border-t border-white/15 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-zinc-400">
                {doc.generatedDate && <span>{doc.generatedDate}</span>}
                <span>{doc.author}</span>
                <span>
                  {doc.sections.length} Sections · {doc.pageCount}{' '}
                  {doc.pageCount === 1 ? 'Page' : 'Pages'}
                </span>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {selectedSectionIdx === null && doc.executiveSummary && (
                <div
                  className={`rounded-lg border p-4 border-l-4 ${style.tintBgClass} ${style.accentBorderClass}`}
                >
                  <div
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider mb-1 ${style.accentTextClass}`}
                  >
                    {style.summaryLabel}
                  </div>
                  <p className="text-xs sm:text-sm text-zinc-800 leading-relaxed">
                    {doc.executiveSummary}
                  </p>
                </div>
              )}

              {selectedSectionIdx === null && doc.keyMetrics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {doc.keyMetrics.map((metric, mIdx) => (
                    <div
                      key={`${metric.label}-${mIdx}`}
                      className={`rounded-lg border border-zinc-200 bg-zinc-50/80 p-3 border-t-2 ${style.accentBorderClass}`}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 line-clamp-2 leading-tight">
                        {metric.label}
                      </div>
                      <div className="text-base font-bold text-zinc-900 mt-1 truncate">
                        {metric.value}
                      </div>
                      {metric.delta && (
                        <div
                          className={`text-[10px] font-medium mt-0.5 truncate ${style.accentTextClass}`}
                        >
                          {metric.delta}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {visibleSections.map((sec) => (
                <section key={sec.sectionNumber} className="space-y-2.5">
                  <div className="border-b border-zinc-200 pb-1.5">
                    <h4 className="text-sm sm:text-base font-bold text-zinc-900">
                      {sec.sectionNumber}. {sec.heading}
                    </h4>
                  </div>

                  {sec.content && (
                    <p className="text-xs sm:text-[13px] text-zinc-700 leading-relaxed">
                      {sec.content}
                    </p>
                  )}

                  {sec.bullets.length > 0 && (
                    <ul className="space-y-1.5 pl-1">
                      {sec.bullets.map((b, bIdx) => (
                        <li
                          key={bIdx}
                          className="flex items-start gap-2 text-xs sm:text-[13px] text-zinc-700"
                        >
                          <span className="w-1.5 h-1.5 rounded-[2px] bg-zinc-800 mt-1.5 shrink-0" />
                          <span>{b}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {sec.callout && (
                    <div
                      className={`rounded-lg border p-3 border-l-4 ${style.tintBgClass} ${style.accentBorderClass}`}
                    >
                      <div
                        className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold uppercase tracking-wider mb-0.5 ${style.accentTextClass}`}
                      >
                        <Sparkles className="w-3 h-3" />
                        Key Takeaway
                      </div>
                      <p className="text-xs italic text-zinc-800 leading-relaxed">
                        {sec.callout}
                      </p>
                    </div>
                  )}

                  {sec.table && (
                    <div className="pt-1">
                      {sec.table.caption && (
                        <div className="text-[11px] font-semibold text-zinc-600 mb-1.5">
                          {sec.table.caption}
                        </div>
                      )}
                      <div className="overflow-x-auto rounded-lg border border-zinc-200">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-zinc-950 text-white">
                              {sec.table.headers.map((hdr, hIdx) => (
                                <th
                                  key={hIdx}
                                  className="px-3 py-2 font-semibold text-[11px] whitespace-nowrap"
                                >
                                  {hdr}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sec.table.rows.map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className={
                                  rIdx % 2 === 1
                                    ? 'bg-zinc-50 border-t border-zinc-200'
                                    : 'bg-white border-t border-zinc-200'
                                }
                              >
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className={`px-3 py-2 text-[11px] ${
                                      cIdx === 0
                                        ? 'font-semibold text-zinc-900'
                                        : 'text-zinc-700'
                                    }`}
                                  >
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {sec.chart && (
                    <PdfVectorBarChart
                      chart={sec.chart}
                      accentBarClass="bg-zinc-900"
                    />
                  )}
                </section>
              ))}

              <div className="pt-3 border-t border-zinc-200 flex items-center justify-between text-[10px] font-mono text-zinc-500">
                <span>
                  {doc.footer} · {doc.pageCount}{' '}
                  {doc.pageCount === 1 ? 'Page' : 'Pages'}
                </span>
                <span>Standards-Compliant %PDF-1.4</span>
              </div>
            </div>
          </div>
          )}

          {selectedSectionIdx !== null && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setSelectedSectionIdx((i) => Math.max(0, (i ?? 0) - 1))
                }
                disabled={selectedSectionIdx === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#141418] border border-white/[0.08] text-zinc-200 hover:bg-white/[0.08] disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Previous Section</span>
              </button>
              <span className="text-[11px] font-mono text-zinc-500">
                Section {selectedSectionIdx + 1} of {doc.sections.length}
              </span>
              <button
                type="button"
                onClick={() =>
                  setSelectedSectionIdx((i) =>
                    Math.min(doc.sections.length - 1, (i ?? 0) + 1),
                  )
                }
                disabled={selectedSectionIdx === doc.sections.length - 1}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-[#141418] border border-white/[0.08] text-zinc-200 hover:bg-white/[0.08] disabled:opacity-35 disabled:pointer-events-none cursor-pointer"
              >
                <span>Next Section</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
