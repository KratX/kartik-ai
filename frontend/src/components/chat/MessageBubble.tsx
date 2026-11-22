import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  Image as ImageIcon,
  Maximize2,
  PanelRightOpen,
  Paperclip,
  Pencil,
  Presentation,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  buildUploadedFileRawUrl,
  formatChatModeAndDepthMeta,
  formatCitationRelevancePercent,
  formatImageFileBadge,
  formatRoutingAttribution,
  summarizeDocumentCitations,
} from '../slide-deck-and-markdown.js';
import {
  computeStreamStepChars,
  formatArtifactMetaSummary,
} from '../workspace-ux-helpers.js';
import type {
  ArtifactRecord,
  MessageCitation,
  PlatformMessage,
  SearchImageGalleryItem,
  UploadedFileRecord,
} from '../../types/index.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { ObsidianBrandMark, SpotlightCard } from '../motion/primitives.js';

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

function getArtifactIcon(artifactType: ArtifactRecord['artifactType']) {
  switch (artifactType) {
    case 'code_bundle':
      return <Code2 className="w-4 h-4" />;
    case 'pdf_document':
      return <FileText className="w-4 h-4" />;
    case 'ppt_presentation':
      return <Presentation className="w-4 h-4" />;
    case 'generated_image':
      return <ImageIcon className="w-4 h-4" />;
  }
}

export interface MessageBubbleProps {
  readonly message: PlatformMessage;
  readonly isLoading?: boolean;
  readonly shouldStream?: boolean;
  readonly activeCanvasArtifactId?: string | null;
  readonly isCanvasOpen?: boolean;
  readonly onStreamComplete?: (messageId: string) => void;
  readonly onStreamTick?: () => void;
  readonly onFollowUpSearch?: (
    query: string,
    agent?: PlatformMessage['agentUsed'],
  ) => void;
  readonly onRegenerate?: (message: PlatformMessage) => void;
  readonly onEditPrompt?: (prompt: string) => void;
  readonly onHandoffToSpecialist?: (
    target: 'pdf' | 'ppt' | 'search',
    message: PlatformMessage,
  ) => void;
  readonly onOpenArtifact?: (artifact: ArtifactRecord) => void;
  readonly onOpenAttachment?: (file: UploadedFileRecord) => void;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
  readonly onNotify?: (message: string, tone?: 'success' | 'info') => void;
}

export function MessageBubble({
  message,
  isLoading = false,
  shouldStream = false,
  activeCanvasArtifactId,
  isCanvasOpen = false,
  onStreamComplete,
  onStreamTick,
  onFollowUpSearch,
  onRegenerate,
  onEditPrompt,
  onHandoffToSpecialist,
  onOpenArtifact,
  onOpenAttachment,
  onOpenLightboxImage,
  onNotify,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isWelcomeGreeting = message.messageId.startsWith(
    'msg_welcome_assistant_',
  );

  // Full cleaned prose for assistant replies
  const fullMarkdownContent = useMemo(() => {
    if (
      !isUser &&
      message.agentUsed === 'image' &&
      message.artifacts?.some(
        (a) =>
          a.artifactType === 'generated_image' &&
          a.filesManifest?.some((f) => f.path === 'image-spec.json'),
      )
    ) {
      return message.content
        .replace(/\n*\*\*Enhanced Prompt:\*\*[\s\S]*$/i, '')
        .trim();
    }
    return message.content;
  }, [isUser, message.agentUsed, message.artifacts, message.content]);

  // Fluid character-by-character progressive streaming state for freshly generated assistant turns
  const [revealedChars, setRevealedChars] = useState<number>(() =>
    shouldStream && !isUser ? 0 : fullMarkdownContent.length,
  );
  const isActivelyStreaming =
    !isUser && shouldStream && revealedChars < fullMarkdownContent.length;

  useEffect(() => {
    if (isUser || !shouldStream) {
      setRevealedChars(fullMarkdownContent.length);
      return;
    }

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReducedMotion || fullMarkdownContent.length === 0) {
      setRevealedChars(fullMarkdownContent.length);
      onStreamComplete?.(message.messageId);
      return;
    }

    let current = 0;
    let rafId = 0;
    let lastTick = performance.now();
    let frameCounter = 0;

    const advance = (now: number) => {
      const dt = now - lastTick;
      if (dt >= 14) {
        lastTick = now;
        const remaining = fullMarkdownContent.length - current;
        const step = computeStreamStepChars(
          fullMarkdownContent.length,
          remaining,
        );
        current = Math.min(fullMarkdownContent.length, current + Math.max(1, step));
        setRevealedChars(current);
        frameCounter += 1;
        if (frameCounter % 6 === 0) {
          onStreamTick?.();
        }
      }

      if (current < fullMarkdownContent.length) {
        rafId = window.requestAnimationFrame(advance);
      } else {
        onStreamTick?.();
        onStreamComplete?.(message.messageId);
      }
    };

    rafId = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(rafId);
  }, [
    fullMarkdownContent,
    isUser,
    message.messageId,
    onStreamComplete,
    onStreamTick,
    shouldStream,
  ]);

  const handleSkipStream = () => {
    setRevealedChars(fullMarkdownContent.length);
    onStreamComplete?.(message.messageId);
  };

  // User prompt inline edit state
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editDraft, setEditDraft] = useState(message.content);
  const [copiedUserPrompt, setCopiedUserPrompt] = useState(false);

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
  const [copiedMarkdown, setCopiedMarkdown] = useState(false);
  const citationCardRefs = useRef<Record<number, HTMLElement | null>>({});
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markdownCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (markdownCopyTimerRef.current)
        clearTimeout(markdownCopyTimerRef.current);
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
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(
      () => setHighlightedCitationIdx(null),
      1800,
    );
  };

  const toggleDocCitationExpanded = (citationIndex: number) => {
    setExpandedDocCitations((prev) => {
      const next = new Set(prev);
      if (next.has(citationIndex)) next.delete(citationIndex);
      else next.add(citationIndex);
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
    const clip = navigator.clipboard?.writeText(quoteBody);
    if (clip && typeof clip.catch === 'function') clip.catch(() => {});
    setCopiedCitationIdx(citationIndex);
    onNotify?.('Copied grounded citation quote.', 'success');
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopiedCitationIdx(null), 1600);
  };

  const handleCopyMarkdown = () => {
    const clip = navigator.clipboard?.writeText(message.content);
    if (clip && typeof clip.catch === 'function') clip.catch(() => {});
    setCopiedMarkdown(true);
    onNotify?.('Copied response as Markdown.', 'success');
    if (markdownCopyTimerRef.current)
      clearTimeout(markdownCopyTimerRef.current);
    markdownCopyTimerRef.current = setTimeout(
      () => setCopiedMarkdown(false),
      1600,
    );
  };

  const handleCopyUserPrompt = () => {
    const clip = navigator.clipboard?.writeText(message.content);
    if (clip && typeof clip.catch === 'function') clip.catch(() => {});
    setCopiedUserPrompt(true);
    onNotify?.('Copied prompt to clipboard.', 'success');
    window.setTimeout(() => setCopiedUserPrompt(false), 1500);
  };

  const handleCommitPromptEdit = () => {
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    setIsEditingPrompt(false);
    onEditPrompt?.(trimmed);
  };

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

  const routingAttribution = !isUser
    ? formatRoutingAttribution(
        message.agentUsed,
        message.routedFromChat,
        message.routingReason,
      )
    : null;
  const chatModeMeta =
    !isUser && message.agentUsed === 'chat'
      ? formatChatModeAndDepthMeta(message.chatMode, message.responseDepth)
      : null;

  /* ── USER PROMPT (Compact Right-Aligned Obsidian Block + Edit & Copy Controls) ── */
  if (isUser) {
    const attachedImages = (message.attachedFiles ?? []).filter((f) =>
      f.mimeType.startsWith('image/'),
    );
    const attachedDocs = (message.attachedFiles ?? []).filter(
      (f) => !f.mimeType.startsWith('image/'),
    );

    return (
      <div
        data-message-role="user"
        className="group/user flex justify-end"
      >
        <div className="max-w-[88%] sm:max-w-[78%] space-y-2">
          {attachedImages.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {attachedImages.map((file) => {
                const imageUrl = buildUploadedFileRawUrl(file.fileId);
                return (
                  <button
                    key={file.fileId}
                    type="button"
                    data-uploaded-image-preview="true"
                    onClick={() =>
                      onOpenAttachment
                        ? onOpenAttachment(file)
                        : onOpenLightboxImage?.({
                            title: file.originalFilename,
                            imageUrl,
                          })
                    }
                    className="group overflow-hidden rounded-xl bg-[#111114] border border-white/[0.1] hover:border-white/25 transition-colors text-left cursor-pointer max-w-xs"
                  >
                    <div className="p-1.5 bg-[#09090b] flex items-center justify-center">
                      <img
                        src={imageUrl}
                        alt={file.originalFilename}
                        loading="lazy"
                        className="max-h-44 w-auto rounded-lg object-contain group-hover:scale-[1.01] transition-transform"
                      />
                    </div>
                    <div className="px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-zinc-200 truncate font-medium">
                        {file.originalFilename}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-500 shrink-0">
                        {formatImageFileBadge(file.mimeType, file.sizeBytes)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {attachedDocs.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {attachedDocs.map((file) => (
                <button
                  key={file.fileId}
                  type="button"
                  onClick={() => onOpenAttachment?.(file)}
                  data-uploaded-doc-chip="true"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#16161b] hover:bg-[#1e1e24] border border-white/[0.1] hover:border-white/20 text-xs text-zinc-200 transition-colors cursor-pointer"
                >
                  <Paperclip className="w-3 h-3 text-emerald-400" />
                  <span className="font-medium">{file.originalFilename}</span>
                  <span className="text-[10px] font-mono tabular-nums text-zinc-500">
                    {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
                  </span>
                </button>
              ))}
            </div>
          )}

          {isEditingPrompt ? (
            <div
              data-user-edit-box="true"
              className="rounded-2xl p-3 bg-[#141418] border border-white/25 space-y-2.5 min-w-[260px] sm:min-w-[380px]"
            >
              <textarea
                rows={3}
                autoFocus
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleCommitPromptEdit();
                  } else if (e.key === 'Escape') {
                    setIsEditingPrompt(false);
                    setEditDraft(message.content);
                  }
                }}
                data-user-edit-input="true"
                className="w-full bg-[#09090b] border border-white/[0.1] rounded-xl p-2.5 text-sm text-zinc-100 focus:outline-none focus:border-white/30 resize-y"
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingPrompt(false);
                    setEditDraft(message.content);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#1c1c22] hover:bg-white/[0.1] text-xs text-zinc-300 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                  <span>Cancel</span>
                </button>
                <button
                  type="button"
                  disabled={!editDraft.trim() || isLoading}
                  data-user-edit-submit="true"
                  onClick={handleCommitPromptEdit}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 font-semibold text-xs disabled:opacity-40 cursor-pointer"
                >
                  <span>Save &amp; Re-run</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="rounded-2xl rounded-tr-md px-4 py-3 bg-[#18181c] border border-white/[0.09] text-[14.5px] text-zinc-100 leading-relaxed whitespace-pre-wrap break-words">
                {message.content}
              </div>
              <div className="flex items-center justify-end gap-1 opacity-0 group-hover/user:opacity-100 focus-within:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={handleCopyUserPrompt}
                  aria-label="Copy prompt"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                >
                  {copiedUserPrompt ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                  <span>{copiedUserPrompt ? 'Copied' : 'Copy'}</span>
                </button>
                {onEditPrompt && !isLoading && (
                  <button
                    type="button"
                    data-user-edit-trigger="true"
                    onClick={() => {
                      setEditDraft(message.content);
                      setIsEditingPrompt(true);
                    }}
                    aria-label="Edit and re-run prompt"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] text-zinc-500 hover:text-zinc-100 hover:bg-white/[0.06] transition-colors cursor-pointer"
                  >
                    <Pencil className="w-3 h-3" />
                    <span>Edit</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const displayedMarkdown = isActivelyStreaming
    ? fullMarkdownContent.slice(0, revealedChars)
    : fullMarkdownContent;

  /* ── ASSISTANT REPLY (Borderless Editorial Reading Flow + Fluid Streaming Reveal) ── */
  return (
    <article
      data-message-role="assistant"
      data-agent-used={message.agentUsed ?? ''}
      data-streaming-active={isActivelyStreaming ? 'true' : 'false'}
      className="py-2 space-y-3.5"
    >
      {/* Quiet Inline Editorial Attribution Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <ObsidianBrandMark size="sm" />
          <span className="text-xs font-semibold text-white">Kartik.ai</span>

          {message.agentUsed && (
            <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400">
              {message.agentUsed === 'chat'
                ? 'Chat'
                : `${message.agentUsed} agent`}
            </span>
          )}

          {routingAttribution && (
            <span
              data-routing-attribution="true"
              className="text-[11px] text-zinc-400 truncate"
            >
              · {routingAttribution}
            </span>
          )}

          {!routingAttribution && chatModeMeta && (
            <span
              data-chat-mode-meta="true"
              className="text-[11px] text-zinc-400 truncate"
            >
              · {chatModeMeta}
            </span>
          )}

          {message.idempotentReplay && (
            <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-400">
              · <ShieldCheck className="w-3 h-3" /> 0 cr replay
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isActivelyStreaming && (
            <button
              type="button"
              onClick={handleSkipStream}
              className="text-[10px] font-mono text-zinc-400 hover:text-white px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] transition-colors cursor-pointer"
            >
              Finish now
            </button>
          )}
          {typeof message.creditsCharged === 'number' &&
            !message.idempotentReplay && (
              <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                -{message.creditsCharged} cr
              </span>
            )}
        </div>
      </div>

      {/* Main Editorial Markdown Prose */}
      <div className="pl-0 sm:pl-9 space-y-4">
        <MarkdownRenderer
          content={displayedMarkdown}
          citations={citations}
          onCitationClick={handleCitationClick}
          isStreaming={isActivelyStreaming}
        />

        {/* Post-stream enrichments glide in smoothly once text finishes flowing */}
        {!isActivelyStreaming && (
          <motion.div
            initial={shouldStream ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-4"
          >
            {/* Visual References Strip (Web Search Images) */}
            {validSearchImages.length > 0 && (
              <div className="pt-2 space-y-2">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="font-medium text-zinc-400">Visual References</span>
                  <span className="font-mono text-[11px] tabular-nums">
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
                      className="group relative rounded-xl overflow-hidden border border-white/[0.08] hover:border-white/25 bg-[#111114] text-left transition-colors cursor-pointer"
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
                        className="w-full h-24 object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                      <div className="p-2 bg-[#111114]">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] text-zinc-200 truncate font-medium">
                            {img.title}
                          </span>
                          <Maximize2 className="w-3 h-3 text-zinc-400 group-hover:text-white shrink-0" />
                        </div>
                        {img.domain && (
                          <div className="text-[10px] font-mono text-zinc-500 truncate mt-0.5">
                            {img.domain}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Grounded Web Sources & Document Evidence */}
            {citations.length > 0 && (
              <div className="pt-2 space-y-2.5">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-zinc-400">
                    {webCitations.length === 0 && docCitations.length > 0
                      ? 'Document Evidence'
                      : 'Sources'}
                  </span>
                  <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                    {webCitations.length === 0 && docCitations.length > 0
                      ? summarizeDocumentCitations(
                          docCitations.map((c) => c.citation),
                        ).label
                      : `${citations.length} ${citations.length === 1 ? 'source' : 'sources'}`}
                  </span>
                </div>

                {webCitations.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                          className={`group block rounded-xl p-3 bg-[#111114] hover:bg-[#16161b] border transition-colors ${
                            isHighlighted
                              ? 'border-white/40 ring-1 ring-white/25'
                              : 'border-white/[0.08] hover:border-white/[0.18]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono font-semibold tabular-nums rounded-md bg-white/[0.08] text-zinc-200 shrink-0 mt-0.5">
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-zinc-100 group-hover:text-white line-clamp-1">
                                  {citation.title}
                                </div>
                                <div className="text-[11px] font-mono text-zinc-500 truncate mt-0.5">
                                  {domain}
                                  {citation.publishedAt
                                    ? ` · ${citation.publishedAt}`
                                    : ''}
                                </div>
                              </div>
                            </div>
                            <ExternalLink className="w-3.5 h-3.5 text-zinc-600 group-hover:text-zinc-200 shrink-0 mt-0.5 transition-colors" />
                          </div>
                          {(() => {
                            const distinctSnippet =
                              getDistinctCitationSnippet(citation);
                            return distinctSnippet ? (
                              <p className="text-[11px] text-zinc-400 leading-relaxed line-clamp-2 mt-2">
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
                    } gap-2`}
                  >
                    {docCitations.map(({ citation, index }) => {
                      const isHighlighted = highlightedCitationIdx === index;
                      const isExpanded = expandedDocCitations.has(index);
                      const isCopied = copiedCitationIdx === index;
                      const matchPct = formatCitationRelevancePercent(
                        citation.score,
                      );
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
                          className={`rounded-xl p-3 bg-[#111114] border transition-colors ${
                            isHighlighted
                              ? 'border-emerald-400/60 ring-1 ring-emerald-400/30'
                              : 'border-white/[0.08] hover:border-white/[0.16]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2 min-w-0">
                              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-mono font-semibold tabular-nums rounded-md bg-emerald-500/15 text-emerald-300 shrink-0 mt-0.5">
                                {index + 1}
                              </span>
                              <div className="min-w-0">
                                <div
                                  className="flex items-center gap-1.5 text-xs font-medium text-zinc-100"
                                  title={citation.title}
                                >
                                  <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  <span className="truncate">{citation.title}</span>
                                </div>
                                <div className="text-[11px] font-mono tabular-nums text-zinc-500 mt-0.5">
                                  {citation.urlOrPage}
                                  {matchPct !== null ? ` · ${matchPct}% match` : ''}
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => handleCopyDocCitation(index, citation)}
                                title="Copy grounded quote"
                                className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
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
                                  aria-expanded={isExpanded}
                                  className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
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
                                className={`text-[11px] text-zinc-400 leading-relaxed ${
                                  isExpanded ? '' : 'line-clamp-3'
                                }`}
                              >
                                &ldquo;{excerpt}&rdquo;
                              </p>
                              {isLongExcerpt && (
                                <button
                                  type="button"
                                  onClick={() => toggleDocCitationExpanded(index)}
                                  className="mt-1.5 text-[11px] font-medium text-zinc-200 hover:text-white transition-colors cursor-pointer"
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

            {/* Universal 21st.dev SpotlightCard Artifact Launchers (Code, PDF, PPT, Image) */}
            {message.artifacts && message.artifacts.length > 0 && (
              <div className="space-y-2.5 pt-1">
                {message.artifacts.map((art) => {
                  const meta = formatArtifactMetaSummary(art);
                  const isViewingInCanvas =
                    isCanvasOpen && activeCanvasArtifactId === art.artifactId;
                  const isImageArtifact = art.artifactType === 'generated_image';
                  const rawImageUrl = isImageArtifact
                    ? buildArtifactRawDownloadUrl(art.artifactId)
                    : null;

                  return (
                    <SpotlightCard
                      key={art.artifactId}
                      asButton
                      active={isViewingInCanvas}
                      onClick={() => onOpenArtifact?.(art)}
                      className="w-full"
                    >
                      <div
                        data-artifact-launcher="true"
                        data-artifact-type={art.artifactType}
                        className="p-3.5 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {rawImageUrl ? (
                            <div className="w-12 h-12 rounded-lg overflow-hidden border border-white/[0.12] bg-[#09090b] shrink-0">
                              <img
                                src={rawImageUrl}
                                alt={art.title}
                                loading="lazy"
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-white shrink-0">
                              {getArtifactIcon(art.artifactType)}
                            </div>
                          )}

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-semibold text-white truncate">
                                {art.title}
                              </span>
                            </div>
                            <div className="text-[11px] text-zinc-400 flex items-center gap-1.5 mt-0.5 truncate">
                              <span>{meta.typeLabel}</span>
                              <span aria-hidden="true" className="text-zinc-600">
                                ·
                              </span>
                              <span className="font-mono tabular-nums text-zinc-500">
                                {meta.detailLabel}
                              </span>
                            </div>
                          </div>
                        </div>

                        <span
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                            isViewingInCanvas
                              ? 'bg-white text-zinc-950'
                              : 'bg-white/[0.07] text-zinc-100 group-hover:bg-white group-hover:text-zinc-950'
                          }`}
                        >
                          <PanelRightOpen className="w-3.5 h-3.5" />
                          <span>
                            {isViewingInCanvas ? 'Viewing in Canvas' : 'Open in Canvas'}
                          </span>
                        </span>
                      </div>
                    </SpotlightCard>
                  );
                })}
              </div>
            )}

            {/* Quiet Obsidian Assistant Action Bar */}
            <div
              data-message-actions="true"
              className="pt-2 border-t border-white/[0.06] flex flex-wrap items-center justify-between gap-2"
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  data-action-copy-markdown="true"
                  onClick={handleCopyMarkdown}
                  aria-label="Copy answer as Markdown"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap cursor-pointer"
                >
                  {copiedMarkdown ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Markdown</span>
                    </>
                  )}
                </button>

                {!isWelcomeGreeting && onRegenerate && (
                  <button
                    type="button"
                    data-action-regenerate="true"
                    disabled={isLoading}
                    onClick={() => onRegenerate(message)}
                    aria-label="Regenerate this response"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-zinc-400 hover:text-white hover:bg-white/[0.06] transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Regenerate</span>
                  </button>
                )}
              </div>

              {!isWelcomeGreeting &&
                message.agentUsed === 'chat' &&
                onHandoffToSpecialist && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-zinc-500 mr-1">Send to</span>
                    <button
                      type="button"
                      data-handoff-agent="pdf"
                      disabled={isLoading}
                      onClick={() => onHandoffToSpecialist('pdf', message)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#141418] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.18] text-[11px] font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <FileText className="w-3 h-3 text-zinc-400" />
                      <span>Export PDF</span>
                    </button>
                    <button
                      type="button"
                      data-handoff-agent="ppt"
                      disabled={isLoading}
                      onClick={() => onHandoffToSpecialist('ppt', message)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#141418] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.18] text-[11px] font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Presentation className="w-3 h-3 text-zinc-400" />
                      <span>Build Slides</span>
                    </button>
                    <button
                      type="button"
                      data-handoff-agent="search"
                      disabled={isLoading}
                      onClick={() => onHandoffToSpecialist('search', message)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#141418] hover:bg-white/[0.1] border border-white/[0.08] hover:border-white/[0.18] text-[11px] font-medium text-zinc-300 hover:text-white transition-colors whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Globe className="w-3 h-3 text-zinc-400" />
                      <span>Verify on Web</span>
                    </button>
                  </div>
                )}
            </div>

            {/* Clickable Related Follow-Ups */}
            {followUpQueries.length > 0 && (
              <div className="pt-1 space-y-1.5">
                <div className="text-[11px] font-medium text-zinc-500">
                  Follow-ups
                </div>
                <div className="divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-[#101013] overflow-hidden">
                  {followUpQueries.map((query, qIdx) => (
                    <button
                      key={`${qIdx}-${query}`}
                      type="button"
                      data-follow-up-chip="true"
                      disabled={isLoading || !onFollowUpSearch}
                      onClick={() =>
                        onFollowUpSearch?.(query, message.agentUsed ?? 'chat')
                      }
                      className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-white/[0.05] text-left text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed group"
                    >
                      <span className="line-clamp-1">{query}</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-zinc-600 group-hover:text-white shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </article>
  );
}
