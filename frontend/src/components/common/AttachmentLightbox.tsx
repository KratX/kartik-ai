import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, ExternalLink, FileText, Image as ImageIcon, X } from 'lucide-react';
import {
  buildUploadedFileRawUrl,
  formatImageFileBadge,
} from '../slide-deck-and-markdown.js';
import type { UploadedFileRecord } from '../../types/index.js';

export interface AttachmentLightboxProps {
  readonly file: UploadedFileRecord | null;
  readonly onClose: () => void;
}

export function AttachmentLightbox({ file, onClose }: AttachmentLightboxProps) {
  useEffect(() => {
    if (!file) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [file, onClose]);

  const isImage = file?.mimeType.startsWith('image/') ?? false;
  const rawUrl = file ? buildUploadedFileRawUrl(file.fileId) : '';

  return (
    <AnimatePresence>
      {file && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          role="dialog"
          aria-modal="true"
          aria-label={`Attachment preview: ${file.originalFilename}`}
          data-attachment-lightbox="true"
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6 }}
            transition={{ type: 'spring', stiffness: 440, damping: 34 }}
            className="w-full max-w-3xl rounded-2xl bg-[#111114] border border-white/[0.12] overflow-hidden shadow-[0_28px_70px_-14px_rgba(0,0,0,0.92)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 bg-[#0c0c0f] border-b border-white/[0.08] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-white shrink-0">
                  {isImage ? (
                    <ImageIcon className="w-4 h-4" />
                  ) : (
                    <FileText className="w-4 h-4 text-emerald-400" />
                  )}
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold text-white truncate">
                    {file.originalFilename}
                  </h4>
                  <div className="text-[11px] font-mono text-zinc-400 tabular-nums">
                    {isImage
                      ? `${formatImageFileBadge(file.mimeType, file.sizeBytes)} · Multimodal Vision Ready`
                      : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB · ${
                          file.pageCount ? `${file.pageCount} pages · ` : ''
                        }${file.chunkCount} indexed RAG chunks`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <a
                  href={rawUrl}
                  download={file.originalFilename}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-zinc-200 text-zinc-950 text-xs font-semibold transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download</span>
                </a>
                <button
                  type="button"
                  aria-label="Close attachment preview"
                  onClick={onClose}
                  className="p-1.5 rounded-lg bg-[#18181c] hover:bg-white/[0.12] text-zinc-300 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {isImage ? (
              <div className="p-4 bg-[#09090b] flex items-center justify-center">
                <img
                  src={rawUrl}
                  alt={file.originalFilename}
                  className="max-h-[70vh] w-auto max-w-full rounded-xl border border-white/[0.08] object-contain"
                />
              </div>
            ) : (
              <div className="p-6 bg-[#09090b] space-y-4">
                <div className="rounded-xl bg-[#111114] border border-white/[0.08] p-4 grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-[11px] text-zinc-500">MIME Type</div>
                    <div className="font-mono text-zinc-200 mt-0.5 truncate">
                      {file.mimeType}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500">Document Size</div>
                    <div className="font-mono text-zinc-200 mt-0.5 tabular-nums">
                      {Math.max(1, Math.round(file.sizeBytes / 1024))} KB
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-zinc-500">Vector Index</div>
                    <div className="font-mono text-emerald-400 mt-0.5 tabular-nums">
                      {file.chunkCount > 0 ? `${file.chunkCount} chunks` : 'Indexed'}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs text-zinc-400">
                  <span>
                    Ask questions about this file directly in Unified Chat or PDF RAG.
                  </span>
                  <a
                    href={`${rawUrl}?inline=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-white hover:underline underline-offset-4 whitespace-nowrap shrink-0"
                  >
                    <span>Open Raw File</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
