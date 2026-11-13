import React from 'react';
import {
  Bot,
  Code2,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Paperclip,
  ShieldCheck,
  User,
} from 'lucide-react';
import { buildArtifactRawDownloadUrl } from '../../../frontend/src/components/slide-deck-and-markdown.js';
import type {
  ArtifactRecord,
  SearchImageGalleryItem,
} from '../../../backend/services/agent/src/index.js';
import type { PlatformMessage } from '../../server/platform-api-runtime.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { SlideDeckPreview } from './SlideDeckPreview.js';

export interface MessageBubbleProps {
  readonly message: PlatformMessage;
  readonly onOpenCodeArtifact?: (artifact: ArtifactRecord) => void;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
}

export function MessageBubble({
  message,
  onOpenCodeArtifact,
  onOpenLightboxImage,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';

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

        {/* Markdown Message Content */}
        <MarkdownRenderer content={message.content} />

        {/* Web Search 4-Image Lightbox Gallery */}
        {message.searchImages && message.searchImages.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">
                Verified Visual References (Click to Open Lightbox)
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {message.searchImages.length} visuals
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {message.searchImages.map((img: SearchImageGalleryItem) => (
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
                  className="group relative rounded-lg overflow-hidden border border-slate-800 hover:border-sky-500/60 bg-slate-950 text-left transition-all cursor-pointer"
                >
                  <img
                    src={img.imageUrl}
                    alt={img.title}
                    className="w-full h-24 object-cover group-hover:scale-105 transition-transform"
                  />
                  <div className="p-2 flex items-center justify-between gap-1 bg-slate-900/95">
                    <span className="text-[11px] text-slate-200 truncate font-medium">
                      {img.title}
                    </span>
                    <Maximize2 className="w-3 h-3 text-sky-400 shrink-0" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Grounded Citations (Search URLs & PDF RAG Page Citations) */}
        {message.citations && message.citations.length > 0 && (
          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Grounded Citations &amp; Sources ({message.citations.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {message.citations.map((cit) => {
                const isWebUrl = /^https?:\/\//i.test(cit.urlOrPage);
                return isWebUrl ? (
                  <a
                    key={cit.sourceId}
                    href={cit.urlOrPage}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-xs text-sky-300 transition-colors"
                  >
                    <span className="font-mono text-[10px] text-slate-400">
                      [{cit.sourceId}]
                    </span>
                    <span className="truncate max-w-[220px]">{cit.title}</span>
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                ) : (
                  <span
                    key={cit.sourceId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300"
                  >
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="font-medium">{cit.title}</span>
                    <span className="font-mono text-[11px] text-emerald-400">
                      ({cit.urlOrPage})
                    </span>
                  </span>
                );
              })}
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
                return (
                  <div
                    key={art.artifactId}
                    className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900/90 border border-emerald-500/30"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                        <FileText className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-100 truncate">
                          {art.title}.pdf
                        </div>
                        <div className="text-[11px] font-mono text-slate-400">
                          Standards-Compliant %PDF-1.4 Binary ·{' '}
                          {Math.max(1, Math.round(art.sizeBytes / 1024))} KB
                        </div>
                      </div>
                    </div>

                    <a
                      href={rawDownloadUrl}
                      download={`${art.title.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()}.pdf`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg transition-colors shrink-0"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download .PDF
                    </a>
                  </div>
                );
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
              return (
                <div
                  key={art.artifactId}
                  className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-900/90 border border-purple-500/30"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
                      <ImageIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-100 truncate">
                        {art.title}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400">
                        PNG Artwork · {art.sizeBytes} bytes
                      </div>
                    </div>
                  </div>

                  <a
                    href={rawDownloadUrl}
                    download="kartik-generated-image.png"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold bg-purple-500 hover:bg-purple-400 text-white rounded-lg transition-colors shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Download .PNG
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
