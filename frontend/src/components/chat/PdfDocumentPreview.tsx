import React, { useMemo, useState } from 'react';
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
  readonly bannerClass: string;
  readonly accentBorderClass: string;
  readonly accentTextClass: string;
  readonly tintBgClass: string;
  readonly pillActiveClass: string;
}

const ARCHETYPE_STYLES: Readonly<Record<ParsedPdfDocumentType, PdfArchetypeStyle>> = {
  technical_report: {
    badge: 'TECHNICAL REPORT',
    bannerClass: 'bg-[#0f1c38] border-l-4 border-sky-400',
    accentBorderClass: 'border-sky-500',
    accentTextClass: 'text-sky-700',
    tintBgClass: 'bg-sky-50/90 border-sky-200',
    pillActiveClass: 'bg-sky-500/20 text-sky-300 border-sky-500/45',
  },
  executive_brief: {
    badge: 'EXECUTIVE BRIEF',
    bannerClass: 'bg-[#1a1740] border-l-4 border-indigo-400',
    accentBorderClass: 'border-indigo-500',
    accentTextClass: 'text-indigo-700',
    tintBgClass: 'bg-indigo-50/90 border-indigo-200',
    pillActiveClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/45',
  },
  proposal: {
    badge: 'PROJECT PROPOSAL',
    bannerClass: 'bg-[#0a2e29] border-l-4 border-emerald-400',
    accentBorderClass: 'border-emerald-600',
    accentTextClass: 'text-emerald-700',
    tintBgClass: 'bg-emerald-50/90 border-emerald-200',
    pillActiveClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/45',
  },
  research_paper: {
    badge: 'RESEARCH BRIEF',
    bannerClass: 'bg-[#241f29] border-l-4 border-amber-400',
    accentBorderClass: 'border-amber-600',
    accentTextClass: 'text-amber-800',
    tintBgClass: 'bg-amber-50/90 border-amber-200',
    pillActiveClass: 'bg-amber-500/20 text-amber-300 border-amber-500/45',
  },
  playbook: {
    badge: 'OPERATIONAL PLAYBOOK',
    bannerClass: 'bg-[#24143d] border-l-4 border-violet-400',
    accentBorderClass: 'border-violet-600',
    accentTextClass: 'text-violet-700',
    tintBgClass: 'bg-violet-50/90 border-violet-200',
    pillActiveClass: 'bg-violet-500/20 text-violet-300 border-violet-500/45',
  },
  resume: {
    badge: 'EXECUTIVE PROFILE',
    bannerClass: 'bg-[#1c242e] border-l-4 border-slate-300',
    accentBorderClass: 'border-slate-600',
    accentTextClass: 'text-slate-700',
    tintBgClass: 'bg-slate-100/90 border-slate-300',
    pillActiveClass: 'bg-slate-500/20 text-slate-200 border-slate-500/45',
  },
};

export function PdfDocumentPreview({ artifact }: PdfDocumentPreviewProps) {
  const specFile = artifact.filesManifest.find(
    (f) => f.path === 'document-spec.json',
  );
  const doc = useMemo(
    () => parsePdfArtifactDocument(specFile?.content, artifact.title),
    [specFile?.content, artifact.title],
  );
  const style = ARCHETYPE_STYLES[doc.documentType];

  const [viewMode, setViewMode] = useState<'reader' | 'pages'>('reader');
  // null = show full document stream; number = focus a single section index
  const [selectedSectionIdx, setSelectedSectionIdx] = useState<number | null>(null);
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);

  // Split sections into realistic A4 page sheets for Print/Page Preview (Page 1 has masthead + summary + KPIs + first 1-2 sections; continuation pages carry 2 sections each)
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
    <div className="mt-3 rounded-xl border border-emerald-500/30 bg-[#0b1020] overflow-hidden shadow-lg">
      {/* Header Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-900/95 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <FileText className="w-3.5 h-3.5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-100 truncate">
              {doc.title}
            </div>
            <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5 flex-wrap">
              <span className="text-emerald-400">{style.badge}</span>
              <span>·</span>
              <span>
                {doc.pageCount} {doc.pageCount === 1 ? 'Page' : 'Pages'}
              </span>
              <span>·</span>
              <span>{doc.sections.length} Sections</span>
              <span>·</span>
              <span>{sizeKb} KB %PDF-1.4</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Reader vs A4 Page Preview Toggle */}
          <div className="inline-flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => setViewMode('reader')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                viewMode === 'reader'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-3 h-3" />
              Document View
            </button>
            <button
              type="button"
              onClick={() => setViewMode('pages')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer ${
                viewMode === 'pages'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3 h-3" />
              A4 Print Sheets ({a4Pages.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleCopyMarkdown()}
            title="Copy structured document as Markdown"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md transition-colors cursor-pointer"
          >
            {copiedMarkdown ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied MD</span>
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-md transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Download .PDF
          </a>
        </div>
      </div>

      {viewMode === 'pages' ? (
        <div className="p-4 bg-slate-950/90 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] font-mono text-slate-400">
            <span>
              A4 Print Layout · {doc.pageCount} Compiled PDF{' '}
              {doc.pageCount === 1 ? 'Page' : 'Pages'} · {sizeKb} KB %PDF-1.4 Binary Verified
            </span>
            <a
              href={inlinePdfUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-emerald-400 hover:text-emerald-300 underline"
            >
              <span>Open Raw .PDF</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          <div className="max-h-[540px] overflow-y-auto space-y-5 pr-1">
            {a4Pages.map((sheet) => (
              <div
                key={sheet.pageNumber}
                className="mx-auto max-w-[680px] rounded-lg bg-white text-slate-900 shadow-2xl border border-slate-700/70 overflow-hidden flex flex-col justify-between min-h-[420px]"
              >
                <div>
                  {sheet.isCoverPage ? (
                    <div className={`px-6 py-4 text-white ${style.bannerClass}`}>
                      <div className="text-[9px] font-mono font-bold tracking-widest text-sky-300/95 uppercase">
                        {style.badge}
                      </div>
                      <h3 className="text-base sm:text-lg font-bold tracking-tight mt-0.5 text-white">
                        {doc.title}
                      </h3>
                      <p className="text-xs italic text-slate-300 mt-0.5">
                        {doc.subtitle}
                      </p>
                      <div className="mt-2 pt-2 border-t border-white/15 flex flex-wrap items-center gap-x-3 text-[10px] font-mono text-slate-300">
                        {doc.generatedDate && <span>{doc.generatedDate}</span>}
                        <span>{doc.author}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[10px] font-mono text-slate-500">
                      <span className="font-semibold text-slate-700 truncate">
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
                          Executive Summary
                        </div>
                        <p className="text-xs text-slate-800 leading-relaxed">
                          {doc.executiveSummary}
                        </p>
                      </div>
                    )}

                    {sheet.isCoverPage && doc.keyMetrics.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {doc.keyMetrics.map((metric, mIdx) => (
                          <div
                            key={`${metric.label}-${mIdx}`}
                            className={`rounded-md border border-slate-200 bg-slate-50/80 p-2.5 border-t-2 ${style.accentBorderClass}`}
                          >
                            <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-500 line-clamp-2 leading-tight">
                              {metric.label}
                            </div>
                            <div className="text-sm font-bold text-slate-900 mt-1">
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
                        <div className="border-b border-slate-200 pb-1">
                          <h4 className="text-sm font-bold text-slate-900">
                            {sec.sectionNumber}. {sec.heading}
                          </h4>
                        </div>
                        {sec.content && (
                          <p className="text-xs text-slate-700 leading-relaxed">
                            {sec.content}
                          </p>
                        )}
                        {sec.bullets.length > 0 && (
                          <ul className="space-y-1 pl-1">
                            {sec.bullets.map((b, bIdx) => (
                              <li
                                key={bIdx}
                                className="flex items-start gap-2 text-xs text-slate-700"
                              >
                                <span className="w-1.5 h-1.5 rounded-[2px] bg-slate-700 mt-1.5 shrink-0" />
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
                            <p className="text-[11px] italic text-slate-800 leading-relaxed">
                              {sec.callout}
                            </p>
                          </div>
                        )}
                        {sec.table && (
                          <div className="overflow-x-auto rounded border border-slate-200">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="bg-slate-900 text-white">
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
                                        ? 'bg-slate-50 border-t border-slate-200'
                                        : 'bg-white border-t border-slate-200'
                                    }
                                  >
                                    {row.map((cell, cIdx) => (
                                      <td
                                        key={cIdx}
                                        className={`px-2.5 py-1.5 ${
                                          cIdx === 0
                                            ? 'font-semibold text-slate-900'
                                            : 'text-slate-700'
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

                <div className="px-6 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[10px] font-mono text-slate-500">
                  <span>
                    {doc.footer}  |  Sheet {sheet.pageNumber} of {a4Pages.length}
                  </span>
                  <span>{doc.generatedDate ?? '%PDF-1.4'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="p-3.5 sm:p-4 space-y-3">
          {/* Interactive Section Navigator Bar */}
          {doc.sections.length > 1 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => setSelectedSectionIdx(null)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-medium border whitespace-nowrap transition-colors cursor-pointer ${
                  selectedSectionIdx === null
                    ? style.pillActiveClass
                    : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                Full Report ({doc.sections.length})
              </button>
              {doc.sections.map((sec, idx) => (
                <button
                  key={sec.sectionNumber}
                  type="button"
                  onClick={() => setSelectedSectionIdx(idx)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border whitespace-nowrap transition-colors cursor-pointer ${
                    selectedSectionIdx === idx
                      ? style.pillActiveClass
                      : 'bg-slate-900/80 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {sec.sectionNumber}. {sec.heading.slice(0, 26)}
                  {sec.heading.length > 26 ? '…' : ''}
                </button>
              ))}
            </div>
          )}

          {/* Editorial Paper Sheet Preview (mirrors compiled %PDF-1.4 layout) */}
          <div className="rounded-xl bg-white text-slate-900 shadow-xl overflow-hidden border border-slate-700/60 max-h-[540px] overflow-y-auto">
            {/* Executive Masthead */}
            <div className={`px-6 py-5 text-white ${style.bannerClass}`}>
              <div className="text-[10px] font-mono font-bold tracking-widest text-sky-300/95 uppercase">
                {style.badge}
              </div>
              <h3 className="text-lg sm:text-xl font-bold tracking-tight mt-1 text-white leading-snug">
                {doc.title}
              </h3>
              <p className="text-xs sm:text-sm italic text-slate-300 mt-1">
                {doc.subtitle}
              </p>
              <div className="mt-3 pt-2.5 border-t border-white/15 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-mono text-slate-300">
                {doc.generatedDate && <span>{doc.generatedDate}</span>}
                <span>{doc.author}</span>
                <span>
                  {doc.sections.length} Sections · {doc.pageCount}{' '}
                  {doc.pageCount === 1 ? 'Page' : 'Pages'}
                </span>
              </div>
            </div>

            <div className="p-5 sm:p-6 space-y-5">
              {/* Executive Summary */}
              {selectedSectionIdx === null && doc.executiveSummary && (
                <div
                  className={`rounded-lg border p-4 border-l-4 ${style.tintBgClass} ${style.accentBorderClass}`}
                >
                  <div
                    className={`text-[10px] font-mono font-bold uppercase tracking-wider mb-1 ${style.accentTextClass}`}
                  >
                    Executive Summary
                  </div>
                  <p className="text-xs sm:text-sm text-slate-800 leading-relaxed">
                    {doc.executiveSummary}
                  </p>
                </div>
              )}

              {/* KPI Metrics Strip */}
              {selectedSectionIdx === null && doc.keyMetrics.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {doc.keyMetrics.map((metric, mIdx) => (
                    <div
                      key={`${metric.label}-${mIdx}`}
                      className={`rounded-lg border border-slate-200 bg-slate-50/80 p-3 border-t-2 ${style.accentBorderClass}`}
                    >
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 line-clamp-2 leading-tight">
                        {metric.label}
                      </div>
                      <div className="text-base font-bold text-slate-900 mt-1 truncate">
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

              {/* Sections */}
              {visibleSections.map((sec) => (
                <section key={sec.sectionNumber} className="space-y-2.5">
                  <div className="border-b border-slate-200 pb-1.5">
                    <h4 className="text-sm sm:text-base font-bold text-slate-900">
                      {sec.sectionNumber}. {sec.heading}
                    </h4>
                  </div>

                  {sec.content && (
                    <p className="text-xs sm:text-[13px] text-slate-700 leading-relaxed">
                      {sec.content}
                    </p>
                  )}

                  {sec.bullets.length > 0 && (
                    <ul className="space-y-1.5 pl-1">
                      {sec.bullets.map((b, bIdx) => (
                        <li
                          key={bIdx}
                          className="flex items-start gap-2 text-xs sm:text-[13px] text-slate-700"
                        >
                          <span className="w-1.5 h-1.5 rounded-[2px] bg-slate-700 mt-1.5 shrink-0" />
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
                      <p className="text-xs italic text-slate-800 leading-relaxed">
                        {sec.callout}
                      </p>
                    </div>
                  )}

                  {sec.table && (
                    <div className="pt-1">
                      {sec.table.caption && (
                        <div className="text-[11px] font-semibold text-slate-600 mb-1.5">
                          {sec.table.caption}
                        </div>
                      )}
                      <div className="overflow-x-auto rounded-lg border border-slate-200">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-900 text-white">
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
                                    ? 'bg-slate-50 border-t border-slate-200'
                                    : 'bg-white border-t border-slate-200'
                                }
                              >
                                {row.map((cell, cIdx) => (
                                  <td
                                    key={cIdx}
                                    className={`px-3 py-2 text-[11px] ${
                                      cIdx === 0
                                        ? 'font-semibold text-slate-900'
                                        : 'text-slate-700'
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

              {/* Paper Footer */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>
                  {doc.footer} · {doc.pageCount}{' '}
                  {doc.pageCount === 1 ? 'Page' : 'Pages'}
                </span>
                <span>Standards-Compliant %PDF-1.4</span>
              </div>
            </div>
          </div>

          {/* Section Pager when focused on a single section */}
          {selectedSectionIdx !== null && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() =>
                  setSelectedSectionIdx((i) => Math.max(0, (i ?? 0) - 1))
                }
                disabled={selectedSectionIdx === 0}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Previous Section
              </button>
              <span className="text-[11px] font-mono text-slate-400">
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
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
              >
                Next Section
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
