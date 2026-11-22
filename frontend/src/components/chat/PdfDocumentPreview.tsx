import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Layers,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  parsePdfArtifactDocument,
  pdfDocumentSpecToMarkdown,
  type ParsedPdfDocumentType,
} from '../slide-deck-and-markdown.js';
import type { ArtifactRecord } from '../../types/index.js';

export interface PdfDocumentPreviewProps {
  readonly artifact: ArtifactRecord;
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
  const doc = useMemo(
    () => parsePdfArtifactDocument(specFile?.content, artifact.title),
    [specFile?.content, artifact.title],
  );
  const style = ARCHETYPE_STYLES[doc.documentType] ?? ARCHETYPE_STYLES.general_guide;

  const [viewMode, setViewMode] = useState<'reader' | 'pages'>('reader');
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number | null>(null);
  const [zoomIdx, setZoomIdx] = useState(1);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  const zoomPct = ZOOM_STEPS[zoomIdx] ?? 100;

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
    artifact.title
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

          <a
            href={downloadUrl}
            download={`${safeFilename}.pdf`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-zinc-200 text-zinc-950 rounded-lg transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>.PDF</span>
          </a>
        </div>
      </div>

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
