import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Image as ImageIcon,
  Maximize2,
  SlidersHorizontal,
} from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  formatImageFileBadge,
  parseImageArtifactSpec,
} from '../slide-deck-and-markdown.js';
import type { ArtifactRecord } from '../../types/index.js';

export interface ImageArtifactCardProps {
  readonly artifact: ArtifactRecord;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
}

export function ImageArtifactCard({
  artifact,
  onOpenLightboxImage,
}: ImageArtifactCardProps) {
  const [showPromptDetails, setShowPromptDetails] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const rawDownloadUrl = buildArtifactRawDownloadUrl(artifact.artifactId);
  const inlineImageUrl = `${rawDownloadUrl}?inline=1`;
  const imageExt =
    artifact.mimeType === 'image/jpeg'
      ? '.jpg'
      : artifact.mimeType === 'image/webp'
        ? '.webp'
        : '.png';

  const safeImageFilename =
    artifact.title
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 48) || 'kartik-generated-image';

  const specManifestEntry = artifact.filesManifest?.find(
    (f) => f.path === 'image-spec.json',
  );
  const imageSpec = parseImageArtifactSpec(
    specManifestEntry?.content,
    artifact.title,
  );

  const metaParts = [
    formatImageFileBadge(artifact.mimeType, artifact.sizeBytes),
    imageSpec?.resolutionLabel ?? null,
    imageSpec?.aspectRatio ?? null,
    imageSpec?.styleLabel ?? null,
  ].filter(Boolean);

  const promptToCopy = imageSpec?.enhancedPrompt ?? artifact.title;

  const handleCopyPrompt = () => {
    const clip = navigator.clipboard?.writeText(promptToCopy);
    if (clip && typeof clip.catch === 'function') {
      clip.catch(() => {});
    }
    setCopiedPrompt(true);
    if (copyTimerRef.current) {
      clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = setTimeout(() => {
      setCopiedPrompt(false);
    }, 1600);
  };

  return (
    <div
      data-generated-image-card="true"
      className="overflow-hidden rounded-xl bg-slate-900/95 border border-slate-800 hover:border-purple-500/45 transition-colors"
    >
      {/* Clickable Full-Bleed Artwork Stage -> Opens Fullscreen Lightbox */}
      <button
        type="button"
        onClick={() =>
          onOpenLightboxImage?.({
            title: artifact.title,
            imageUrl: inlineImageUrl,
          })
        }
        aria-label={`Inspect ${artifact.title} fullscreen`}
        className="group relative block w-full bg-slate-950 border-b border-slate-800/90 cursor-pointer text-left"
      >
        <div className="flex items-center justify-center p-2.5 sm:p-3">
          <img
            src={inlineImageUrl}
            alt={artifact.title}
            loading="lazy"
            className="max-h-[460px] w-auto max-w-full rounded-lg object-contain shadow-lg group-hover:scale-[1.005] transition-transform"
          />
        </div>
        <span className="absolute top-3 right-3 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-950/85 border border-slate-700/80 text-[11px] font-medium text-slate-200 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
          <Maximize2 className="w-3 h-3 text-purple-400" />
          <span>Inspect</span>
        </span>
      </button>

      {/* Studio Metadata & Action Bar */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-slate-100 truncate">
              {artifact.title}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5 break-words">
              {metaParts.join(' · ')}
              {imageSpec?.isEdit && imageSpec.referenceFilename
                ? ` · Restyled from ${imageSpec.referenceFilename}`
                : ''}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/70">
          <div className="flex flex-wrap items-center gap-1.5">
          {imageSpec && (
            <button
              type="button"
              onClick={() => setShowPromptDetails((prev) => !prev)}
              aria-expanded={showPromptDetails}
              aria-label={showPromptDetails ? 'Hide art-directed prompt' : 'Show art-directed prompt'}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 hover:text-white transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-purple-400" />
              <span>Prompt</span>
              {showPromptDetails ? (
                <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyPrompt}
            aria-label="Copy art-directed prompt"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 hover:text-white transition-colors cursor-pointer"
          >
            {copiedPrompt ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-300">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Copy Prompt</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() =>
              onOpenLightboxImage?.({
                title: artifact.title,
                imageUrl: inlineImageUrl,
              })
            }
            aria-label="Open generated artwork in fullscreen lightbox"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800/90 hover:bg-slate-800 border border-slate-700/80 text-slate-200 hover:text-white transition-colors cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5 text-purple-400" />
            <span>Fullscreen</span>
          </button>
          </div>

          <a
            href={rawDownloadUrl}
            download={`${safeImageFilename}${imageExt}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-purple-500 hover:bg-purple-400 text-white rounded-lg transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download {imageExt.slice(1).toUpperCase()}</span>
          </a>
        </div>
      </div>

      {/* Collapsible Art-Directed Prompt Inspector */}
      {imageSpec && showPromptDetails && (
        <div
          data-image-prompt-drawer="true"
          className="px-4 py-3 border-t border-slate-800/90 bg-slate-950/75 space-y-2 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-400">
            <span>
              Style: <strong className="text-slate-200">{imageSpec.styleLabel}</strong> · Frame:{' '}
              <strong className="text-slate-200">{imageSpec.aspectRatio}</strong>
              {imageSpec.resolutionLabel ? ` · ${imageSpec.resolutionLabel} px` : ''}
            </span>
            <span>Model: {imageSpec.model}</span>
          </div>
          <p className="text-slate-300 leading-relaxed">{imageSpec.enhancedPrompt}</p>
        </div>
      )}
    </div>
  );
}
