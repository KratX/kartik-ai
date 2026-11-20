import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Paperclip,
  ShieldCheck,
  User,
} from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  formatCitationRelevancePercent,
  summarizeDocumentCitations,
} from '../slide-deck-and-markdown.js';
import type {
  ArtifactRecord,
  MessageCitation,
  PlatformMessage,
  SearchImageGalleryItem,
} from '../../types/index.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { PdfDocumentPreview } from './PdfDocumentPreview.js';
import { SlideDeckPreview } from './SlideDeckPreview.js';

function resolveCitationDomain(citation: MessageCitation): string {
  if (citation.domain && citation.domain.trim()) {
    return citation.domain.trim();
  }
  try {
    return new URL(citation.urlOrPage).hostname.replace(/^www\./i, '');
  } catch {
    return citation.urlOrPage;
  }
}

function getDistinctCitationSnippet(citation: MessageCitation): string | null {
  const snippet = citation.snippet?.trim();
  if (!snippet) {
    return null;
  }
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  const normTitle = normalize(citation.title);
  const normSnippet = normalize(snippet);
  // Skip snippets that merely echo "Publisher · Date: Headline" when title + meta already display both
  const headlinePrefix = normTitle.slice(0, Math.min(48, normTitle.length));
  if (
    headlinePrefix.length >= 16 &&
    normSnippet.includes(headlinePrefix) &&
    normSnippet.length <= normTitle.length + 45
  ) {
    return null;
  }
  return snippet;
}

export interface MessageBubbleProps {
  readonly message: PlatformMessage;
  readonly isLoading?: boolean;
  readonly onFollowUpSearch?: (
    query: string,
    agent?: PlatformMessage['agentUsed'],
  ) => void;
  readonly onOpenCodeArtifact?: (artifact: ArtifactRecord) => void;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
}

export function MessageBubble({
  message,
  isLoading = false,
  onFollowUpSearch,
  onOpenCodeArtifact,
  onOpenLightboxImage,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const [failedImageIds, setFailedImageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [highlightedCitationIdx, setHighlightedCitationIdx] = useState<
    number | null
  >(null);
  const [expandedDocCitations, setExpandedDocCitations] = useState<
    ReadonlySet<number>
  >(() => new Set());
  const [copiedCitationIdx, setCopiedCitationIdx] = useState<number | null>(
    null,
  );
  const citationCardRefs = useRef<Record<number, HTMLElement | null>>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCitationClick = (citationIndex: number) => {
    const target = citationCardRefs.current[citationIndex];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    setExpandedDocCitations((prev) => {
      if (prev.has(citationIndex)) return prev;
      const next = new Set(prev);
      next.add(citationIndex);
      return next;
    });
    setHighlightedCitationIdx(citationIndex);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedCitationIdx(null);
    }, 1800);
  };

  const toggleDocCitationExpanded = (citationIndex: number) => {
    setExpandedDocCitations((prev) => {
      const next = new Set(prev);
      if (next.has(citationIndex)) {
        next.delete(citationIndex);
      } else {
        next.add(citationIndex);
      }
      return next;
    });
  };

  const handleCopyDocCitation = (
    citationIndex: number,
    citation: MessageCitation,
  ) => {
    const quoteBody = citation.snippet?.trim()
      ? `"${citation.snippet.trim()}" — ${citation.title} (${citation.urlOrPage})`
      : `${citation.title} (${citation.urlOrPage})`;
    void navigator.clipboard?.writeText(quoteBody);
    setCopiedCitationIdx(citationIndex);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopiedCitationIdx(null);
    }, 1600);
  };

  // Real HTTPS image thumbnails only — prune broken images cleanly; hide strip if empty.
  const validSearchImages = (message.searchImages ?? [])
    .filter(
      (img) =>
        /^https:\/\//i.test(img.imageUrl) && !failedImageIds.has(img.id),
    )
    .slice(0, 4);

  const citations = message.citations ?? [];
  const indexedCitations = citations.map((citation, idx) => ({
    citation,
    index: idx,
    isWebUrl: /^https?:\/\//i.test(citation.urlOrPage),
  }));
  const webCitations = indexedCitations.filter((c) => c.isWebUrl);
  const docCitations = indexedCitations.filter((c) => !c.isWebUrl);
  const followUpQueries = (message.followUpQueries ?? []).slice(0, 3);

  return (
    <div
      className={`flex items-start gap-3.5 ${
        isUser ? 'flex-row-reverse' : 'flex-row'
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
          isUser
            ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
            : 'bg-sky-500/15 border-sky-500/30 text-sky-400'
        }`}
      >
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Bubble Body */}
      <div
        className={`max-w-3xl w-full rounded-xl px-5 py-4 border ${
          isUser
            ? 'bg-slate-900/90 border-slate-800 text-slate-100 sm:ml-12'
            : 'bg-[#0c1222] border-slate-800/90 text-slate-100 sm:mr-8'
        }`}
      >
        {/* Top Metadata Strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-slate-800/70">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-300">
              {isUser ? 'You' : 'Kartik.ai Specialist'}
            </span>
            {!isUser && message.agentUsed && (
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                {message.agentUsed.toUpperCase()} AGENT
              </span>
            )}
            {message.idempotentReplay && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-semibold rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                <ShieldCheck className="w-3 h-3" />
                IDEMPOTENT REPLAY · 0 CREDITS
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
            {!isUser &&
              typeof message.creditsCharged === 'number' &&
              !message.idempotentReplay && (
                <span className="text-amber-300/90">
                  -{message.creditsCharged} cr
                </span>
              )}
            {message.requestId && (
              <span title="Client-owned Idempotency-Key (requestId)">
                {message.requestId.slice(0, 18)}
              </span>
            )}
          </div>
        </div>

        {/* Attached Files on User Message */}
        {message.attachedFiles && message.attachedFiles.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.attachedFiles.map((file) => (
              <div
                key={file.fileId}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700 text-xs text-slate-200"
              >
                <Paperclip className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-medium">{file.originalFilename}</span>
                <span className="text-[11px] font-mono text-slate-400">
                  ({Math.max(1, Math.round(file.sizeBytes / 1024))} KB
                  {file.pageCount ? ` · ${file.pageCount}p` : ''})
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Markdown Message Content with Clickable Inline Citation Badges */}
        <MarkdownRenderer
          content={message.content}
          citations={citations}
          onCitationClick={handleCitationClick}
        />

        {/* Real Visual References Gallery (Hidden cleanly when none exist or load) */}
        {validSearchImages.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Visual References
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {validSearchImages.length}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {validSearchImages.map((img: SearchImageGalleryItem) => (
                <button
                  key={img.id}
                  type="button"
                  onClick={() =>
                    onOpenLightboxImage?.({
                      title: img.title,
                      imageUrl: img.imageUrl,
                      sourceUrl: img.sourceUrl,
                    })
                  }
                  className="group relative rounded-lg overflow-hidden border border-slate-800 hover:border-sky-500/60 bg-slate-950 text-left transition-colors cursor-pointer"
                >
                  <img
                    src={img.imageUrl}
                    alt={img.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setFailedImageIds((prev) => {
                        const next = new Set(prev);
                        next.add(img.id);
                        return next;
                      })
                    }
                    className="w-full h-24 object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="p-2 bg-slate-900/95">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[11px] text-slate-200 truncate font-medium">
                        {img.title}
                      </span>
                      <Maximize2 className="w-3 h-3 text-sky-400 shrink-0" />
                    </div>
                    {img.domain && (
                      <div className="text-[10px] font-mono text-slate-500 truncate mt-0.5">
                        {img.domain}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Grounded Sources (Rich Web Search Cards & Interactive PDF RAG Evidence Viewer) */}
        {citations.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {webCitations.length === 0 && docCitations.length > 0
                  ? 'Document Evidence'
                  : 'Sources'}
              </span>
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {webCitations.length === 0 && docCitations.length > 0
                  ? summarizeDocumentCitations(
                      docCitations.map((c) => c.citation),
                    ).label
                  : `${citations.length} ${citations.length === 1 ? 'source' : 'sources'}`}
              </span>
            </div>

            {webCitations.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {webCitations.map(({ citation, index }) => {
                  const isHighlighted = highlightedCitationIdx === index;
                  const domain = resolveCitationDomain(citation);
                  return (
                    <a
                      key={`${citation.sourceId}-${index}`}
                      ref={(el) => {
                        citationCardRefs.current[index] = el;
                      }}
                      href={citation.urlOrPage}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-citation-index={index + 1}
                      className={`group block rounded-lg p-3 bg-slate-900/75 hover:bg-slate-900 border transition-all ${
                        isHighlighted
                          ? 'border-sky-400/80 ring-1 ring-sky-400/50 bg-slate-900'
                          : 'border-slate-800 hover:border-sky-500/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-mono font-semibold tabular-nums rounded bg-sky-500/15 text-sky-300 border border-sky-500/30 shrink-0 mt-0.5">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-100 group-hover:text-sky-300 line-clamp-1 transition-colors">
                              {citation.title}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                              {domain}
                              {citation.publishedAt
                                ? ` · ${citation.publishedAt}`
                                : ''}
                            </div>
                          </div>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0 mt-0.5 transition-colors" />
                      </div>
                      {(() => {
                        const distinctSnippet =
                          getDistinctCitationSnippet(citation);
                        return distinctSnippet ? (
                          <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 mt-2">
                            {distinctSnippet}
                          </p>
                        ) : null;
                      })()}
                    </a>
                  );
                })}
              </div>
            )}

            {docCitations.length > 0 && (
              <div
                className={`grid grid-cols-1 ${
                  docCitations.length > 1 ? 'sm:grid-cols-2' : ''
                } gap-2.5 ${webCitations.length > 0 ? 'mt-2.5' : ''}`}
              >
                {docCitations.map(({ citation, index }) => {
                  const isHighlighted = highlightedCitationIdx === index;
                  const isExpanded = expandedDocCitations.has(index);
                  const isCopied = copiedCitationIdx === index;
                  const matchPct = formatCitationRelevancePercent(citation.score);
                  const excerpt = citation.snippet?.trim() ?? '';
                  const isLongExcerpt = excerpt.length > 140;

                  return (
                    <div
                      key={`${citation.sourceId}-${index}`}
                      ref={(el) => {
                        citationCardRefs.current[index] = el;
                      }}
                      data-citation-index={index + 1}
                      data-doc-evidence-card="true"
                      className={`rounded-lg p-3 bg-slate-900/75 border transition-all ${
                        isHighlighted
                          ? 'border-emerald-400/80 ring-1 ring-emerald-400/45 bg-slate-900'
                          : 'border-slate-800 hover:border-emerald-500/45'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-mono font-semibold tabular-nums rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 shrink-0 mt-0.5">
                            {index + 1}
                          </span>
                          <div className="min-w-0">
                            <div
                              className="flex items-center gap-1.5 text-xs font-semibold text-slate-100"
                              title={citation.title}
                            >
                              <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="truncate">{citation.title}</span>
                            </div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
                              {citation.urlOrPage}
                              {matchPct !== null ? ` · ${matchPct}% match` : ''}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleCopyDocCitation(index, citation)}
                            title="Copy grounded quote with page attribution"
                            className="p-1 rounded text-slate-400 hover:text-emerald-300 hover:bg-slate-800/90 transition-colors cursor-pointer"
                          >
                            {isCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {isLongExcerpt && (
                            <button
                              type="button"
                              onClick={() => toggleDocCitationExpanded(index)}
                              title={
                                isExpanded ? 'Collapse excerpt' : 'Expand full excerpt'
                              }
                              aria-expanded={isExpanded}
                              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800/90 transition-colors cursor-pointer"
                            >
                              {isExpanded ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronDown className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                      </div>

                      {excerpt && (
                        <div className="mt-2">
                          <p
                            className={`text-[11px] text-slate-300/90 leading-relaxed ${
                              isExpanded ? '' : 'line-clamp-3'
                            }`}
                          >
                            &ldquo;{excerpt}&rdquo;
                          </p>
                          {isLongExcerpt && (
                            <button
                              type="button"
                              onClick={() => toggleDocCitationExpanded(index)}
                              className="mt-1.5 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                            >
                              {isExpanded ? 'Show less' : 'Read full passage'}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Clickable Related Follow-Up Queries */}
        {!isUser && followUpQueries.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Related follow-ups
            </div>
            <div className="space-y-1.5">
              {followUpQueries.map((query, qIdx) => (
                <button
                  key={`${qIdx}-${query}`}
                  type="button"
                  disabled={isLoading || !onFollowUpSearch}
                  onClick={() =>
                    onFollowUpSearch?.(query, message.agentUsed ?? 'search')
                  }
                  className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-slate-900/65 hover:bg-slate-800/80 border border-slate-800 hover:border-sky-500/45 text-left text-xs text-slate-200 hover:text-sky-200 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <span className="line-clamp-1">{query}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-sky-400 shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Hydrated Artifacts (Code Bundle, PDF 1.4, PPTX Deck, Generated Image) */}
        {message.artifacts && message.artifacts.length > 0 && (
          <div className="mt-4 space-y-3">
            {message.artifacts.map((art) => {
              const rawDownloadUrl = buildArtifactRawDownloadUrl(art.artifactId);

              if (art.artifactType === 'ppt_presentation') {
                return <SlideDeckPreview key={art.artifactId} artifact={art} />;
              }

              if (art.artifactType === 'pdf_document') {
                return <PdfDocumentPreview key={art.artifactId} artifact={art} />;
              }

              if (art.artifactType === 'code_bundle') {
                return (
                  <div
                    key={art.artifactId}
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900/90 border border-sky-500/30"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                        <Code2 className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100 truncate">
                          {art.title}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {art.filesManifest.length} files (
                          {art.filesManifest.map((f) => f.path).join(', ')}) · Sandboxed Preview Ready
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenCodeArtifact?.(art)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-slate-950 rounded-lg transition-colors cursor-pointer shrink-0"
                    >
                      <Code2 className="w-3.5 h-3.5" />
                      Open Code &amp; Live Sandbox
                    </button>
                  </div>
                );
              }

              // generated_image
              const imageExt =
                art.mimeType === 'image/jpeg'
                  ? '.jpg'
                  : art.mimeType === 'image/webp'
                    ? '.webp'
                    : '.png';
              const imageFormatLabel =
                art.mimeType === 'image/jpeg'
                  ? 'JPEG'
                  : art.mimeType === 'image/webp'
                    ? 'WEBP'
                    : 'PNG';
              const inlineImageUrl = `${rawDownloadUrl}?inline=1`;
              const safeImageFilename =
                art.title
                  .replace(/[^A-Za-z0-9._-]+/g, '-')
                  .replace(/^-+|-+$/g, '')
                  .toLowerCase()
                  .slice(0, 48) || 'kartik-generated-image';

              return (
                <div
                  key={art.artifactId}
                  className="overflow-hidden rounded-xl bg-slate-900/90 border border-purple-500/30"
                >
                  <div className="bg-slate-950/90 border-b border-purple-500/20 flex items-center justify-center p-2">
                    <img
                      src={inlineImageUrl}
                      alt={art.title}
                      loading="lazy"
                      className="max-h-[420px] w-auto max-w-full rounded-lg object-contain shadow-lg"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100 truncate">
                          {art.title}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          {imageFormatLabel} Artwork · {Math.max(1, Math.round(art.sizeBytes / 1024))} KB
                        </div>
                      </div>
                    </div>

                    <a
                      href={rawDownloadUrl}
                      download={`${safeImageFilename}${imageExt}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-purple-500 hover:bg-purple-400 text-white rounded-lg transition-colors shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download {imageExt.toUpperCase()}
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
