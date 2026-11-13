import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Presentation } from 'lucide-react';
import {
  buildArtifactRawDownloadUrl,
  parsePptArtifactSlideDeck,
} from '../../../frontend/src/components/slide-deck-and-markdown.js';
import type { ArtifactRecord } from '../../../backend/services/agent/src/index.js';

export interface SlideDeckPreviewProps {
  readonly artifact: ArtifactRecord;
}

export function SlideDeckPreview({ artifact }: SlideDeckPreviewProps) {
  const specFile = artifact.filesManifest.find((f) => f.path === 'slides-spec.json');
  const deck = parsePptArtifactSlideDeck(specFile?.content, artifact.title);
  const [activeIndex, setActiveIndex] = useState(0);

  const currentSlide = deck.slides[activeIndex] ?? deck.slides[0]!;
  const downloadUrl = buildArtifactRawDownloadUrl(artifact.artifactId);

  return (
    <div className="mt-3 rounded-xl border border-indigo-500/30 bg-[#0b1020] overflow-hidden shadow-lg">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-900/90 border-b border-slate-800">
        <div className="flex items-center gap-2 min-w-0">
          <Presentation className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-xs font-semibold text-slate-100 truncate">
            {deck.deckTitle}
          </span>
          <span className="text-[11px] font-mono text-indigo-300 bg-indigo-500/15 border border-indigo-500/30 px-2 py-0.5 rounded">
            16:9 Interactive Deck · {deck.slides.length} Slides
          </span>
        </div>

        <a
          href={downloadUrl}
          download={`${artifact.title.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()}.pptx`}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-indigo-500 hover:bg-indigo-400 text-white rounded-md transition-colors shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Download .PPTX ({Math.max(1, Math.round(artifact.sizeBytes / 1024))} KB)
        </a>
      </div>

      {/* 16:9 Slide Canvas */}
      <div className="p-4">
        <div className="relative aspect-video w-full rounded-xl border border-slate-700/80 bg-gradient-to-br from-[#0f172a] via-[#131c36] to-[#1e1b4b] p-6 sm:p-8 flex flex-col justify-between shadow-inner">
          {/* Top Accent Strip */}
          <div className="flex items-center justify-between border-b border-slate-700/60 pb-3">
            <span className="text-[11px] font-mono uppercase tracking-widest text-sky-400 font-semibold">
              {currentSlide.kind === 'cover'
                ? 'EXECUTIVE COVER SLIDE'
                : currentSlide.kind === 'closing'
                  ? 'CLOSING SUMMARY'
                  : `CONTENT SLIDE ${currentSlide.slideNumber - 1} OF ${deck.slides.length - 2}`}
            </span>
            <span className="text-xs font-mono text-slate-400">
              Slide {currentSlide.slideNumber} / {currentSlide.totalSlides}
            </span>
          </div>

          {/* Center Slide Content */}
          <div className="my-auto py-3">
            <h3
              className={`font-bold text-white tracking-tight ${
                currentSlide.kind === 'cover' || currentSlide.kind === 'closing'
                  ? 'text-xl sm:text-2xl'
                  : 'text-lg sm:text-xl'
              }`}
            >
              {currentSlide.title}
            </h3>
            {currentSlide.subtitle && (
              <p className="text-xs sm:text-sm text-sky-300/90 font-medium mt-1">
                {currentSlide.subtitle}
              </p>
            )}

            <ul className="mt-4 space-y-2">
              {currentSlide.bullets.map((bullet, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2.5 text-xs sm:text-sm text-slate-200"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 mt-2 shrink-0" />
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Slide Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-[11px] text-slate-400 font-mono">
            <span>{currentSlide.footer}</span>
            <span>OpenXML .PPTX Compatible</span>
          </div>
        </div>

        {/* Slide Controls */}
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setActiveIndex((i) => Math.max(0, i - 1))}
            disabled={activeIndex === 0}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Previous Slide
          </button>

          <div className="flex items-center gap-1.5">
            {deck.slides.map((s, idx) => (
              <button
                key={s.slideNumber}
                type="button"
                aria-label={`Go to slide ${s.slideNumber}`}
                onClick={() => setActiveIndex(idx)}
                className={`h-2 rounded-full transition-all cursor-pointer ${
                  idx === activeIndex
                    ? 'w-6 bg-indigo-400'
                    : 'w-2 bg-slate-700 hover:bg-slate-500'
                }`}
              />
            ))}
          </div>

          <button
            type="button"
            onClick={() =>
              setActiveIndex((i) => Math.min(deck.slides.length - 1, i + 1))
            }
            disabled={activeIndex === deck.slides.length - 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
          >
            Next Slide
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
