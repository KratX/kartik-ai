import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Image as ImageIcon,
  Maximize2,
  RefreshCw,
  SlidersHorizontal,
  Wand2,
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
  readonly onRemixImage?: (artifact: ArtifactRecord) => void;
  readonly onVariationImage?: (artifact: ArtifactRecord) => void;
}

export function ImageArtifactCard({
  artifact,
  onOpenLightboxImage,
  onRemixImage,
  onVariationImage,
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
      data-image-studio="true"
      className="overflow-hidden rounded-xl bg-[#111114] border border-white/[0.09] hover:border-white/[0.18] transition-colors"
    >
      {/* Obsidian Darkroom Artwork Stage -> Opens Fullscreen Lightbox */}
      <button
        type="button"
        onClick={() =>
          onOpenLightboxImage?.({
            title: artifact.title,
            imageUrl: inlineImageUrl,
          })
        }
        aria-label={`Inspect ${artifact.title} fullscreen`}
        className="group relative block w-full bg-[#09090b] border-b border-white/[0.08] cursor-pointer text-left"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 kartik-hero-dot-grid opacity-25"
        />
        <div className="relative z-10 flex items-center justify-center p-3 sm:p-4">
          <img
            src={inlineImageUrl}
            alt={artifact.title}
            loading="lazy"
            className="max-h-[480px] w-auto max-w-full rounded-lg object-contain shadow-[0_18px_50px_rgba(0,0,0,0.85)] border border-white/[0.08] group-hover:scale-[1.008] transition-transform duration-200"
          />
        </div>
        <span className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#09090b]/90 border border-white/[0.14] text-[11px] font-medium text-zinc-100 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity backdrop-blur-md">
          <Maximize2 className="w-3 h-3 text-white" />
          <span>Inspect</span>
        </span>
      </button>

      {/* Obsidian Studio Metadata & Action Bar */}
      <div className="px-4 py-3.5 space-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-white/[0.06] border border-white/[0.1] flex items-center justify-center text-white shrink-0">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold text-white truncate">
              {artifact.title}
            </div>
            <div className="text-[11px] font-mono tabular-nums text-zinc-400 mt-0.5 break-words">
              {metaParts.join(' · ')}
              {imageSpec?.isEdit && imageSpec.referenceFilename
                ? ` · Restyled from ${imageSpec.referenceFilename}`
                : ''}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-white/[0.07]">
          <div className="flex flex-wrap items-center gap-1.5">
            {imageSpec && (
              <button
                type="button"
                onClick={() => setShowPromptDetails((prev) => !prev)}
                aria-expanded={showPromptDetails}
                aria-label={
                  showPromptDetails
                    ? 'Hide art-directed prompt'
                    : 'Show art-directed prompt'
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  showPromptDetails
                    ? 'bg-white/[0.1] border-white/25 text-white'
                    : 'bg-[#16161b] hover:bg-white/[0.08] border-white/[0.08] text-zinc-300 hover:text-white'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>Prompt</span>
                {showPromptDetails ? (
                  <ChevronUp className="w-3.5 h-3.5 text-zinc-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                )}
              </button>
            )}

            <button
              type="button"
              onClick={handleCopyPrompt}
              aria-label="Copy art-directed prompt"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#16161b] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              {copiedPrompt ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-zinc-400" />
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
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#16161b] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-300 hover:text-white transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5 text-zinc-400" />
              <span>Fullscreen</span>
            </button>

            {onRemixImage && (
              <button
                type="button"
                data-image-remix-btn="true"
                onClick={() => onRemixImage(artifact)}
                title="Attach this image as a reference to remix or restyle"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#16161b] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 hover:text-white transition-colors cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5 text-zinc-300" />
                <span>Remix / Edit</span>
              </button>
            )}

            {onVariationImage && (
              <button
                type="button"
                data-image-variation-btn="true"
                onClick={() => onVariationImage(artifact)}
                title="Generate a fresh artistic variation from this prompt"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-[#16161b] hover:bg-white/[0.08] border border-white/[0.08] text-zinc-200 hover:text-white transition-colors cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-zinc-300" />
                <span>Variation</span>
              </button>
            )}
          </div>

          <a
            href={rawDownloadUrl}
            download={`${safeImageFilename}${imageExt}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-white hover:bg-zinc-200 text-zinc-950 rounded-lg transition-colors shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download {imageExt.slice(1).toUpperCase()}</span>
          </a>
        </div>
      </div>

      {/* Collapsible Art-Directed Prompt Inspector */}
      <AnimatePresence>
        {imageSpec && showPromptDetails && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16 }}
            data-image-prompt-drawer="true"
            className="overflow-hidden border-t border-white/[0.08] bg-[#09090b]"
          >
            <div className="px-4 py-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-500">
                <span>
                  Style: <strong className="text-zinc-200">{imageSpec.styleLabel}</strong> · Frame:{' '}
                  <strong className="text-zinc-200">{imageSpec.aspectRatio}</strong>
                  {imageSpec.resolutionLabel ? ` · ${imageSpec.resolutionLabel} px` : ''}
                </span>
                <span>Model: {imageSpec.model}</span>
              </div>
              <p className="text-zinc-300 leading-relaxed">{imageSpec.enhancedPrompt}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
