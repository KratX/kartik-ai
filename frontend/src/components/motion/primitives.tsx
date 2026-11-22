/**
 * @file frontend/src/components/motion/primitives.tsx
 * @description 21st.dev-inspired Obsidian & Pure White motion primitives built natively
 * with `motion/react` v12 and GPU-composited CSS keyframes:
 *  - `BorderBeam`: Luminous platinum comet orbiting container perimeters
 *  - `SpotlightCard`: 60fps pointer-tracking radial specular illumination card
 *  - `BackgroundBeams`: Subtle architectural Hero backdrop beams + micro-dot grid
 *  - `TextShimmer`: Metallic sweeping shimmer typography for active agent states
 *  - `MorphingPopover`: Spring-scale popover with outside-click & Escape dismiss
 *  - `ObsidianBrandMark`: Geometric monochrome Kartik.ai emblem
 */

import React, { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';

export interface BorderBeamProps {
  readonly durationSec?: number;
  readonly intensity?: 'idle' | 'focus' | 'thinking';
  readonly className?: string;
}

/**
 * Traveling platinum specular BorderBeam masked strictly to a crisp 1px perimeter.
 * Uses pure CSS transform rotation for 60fps zero-layout-thrash performance.
 */
export function BorderBeam({
  durationSec = 7,
  intensity = 'idle',
  className = '',
}: BorderBeamProps) {
  const effectiveDuration =
    intensity === 'thinking'
      ? Math.max(2.1, durationSec * 0.36)
      : intensity === 'focus'
        ? Math.max(3.8, durationSec * 0.62)
        : durationSec;

  const opacityClass =
    intensity === 'thinking'
      ? 'opacity-100'
      : intensity === 'focus'
        ? 'opacity-95'
        : 'opacity-75';

  return (
    <div
      aria-hidden="true"
      data-border-beam="true"
      data-beam-intensity={intensity}
      className={`pointer-events-none absolute inset-0 rounded-[inherit] p-[1.5px] overflow-hidden transition-opacity duration-300 ${opacityClass} ${className}`}
      style={{
        mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        maskComposite: 'exclude',
        WebkitMaskComposite: 'xor',
      }}
    >
      <div
        className="kartik-border-beam-spinner absolute left-1/2 top-1/2 w-[220%] aspect-square"
        style={
          {
            '--beam-duration': `${effectiveDuration}s`,
            background:
              intensity === 'thinking'
                ? 'conic-gradient(from 0deg, transparent 0deg, transparent 210deg, rgba(255,255,255,0.34) 270deg, rgba(255,255,255,1) 315deg, rgba(228,228,231,0.5) 345deg, transparent 360deg)'
                : 'conic-gradient(from 0deg, transparent 0deg, transparent 240deg, rgba(255,255,255,0.22) 290deg, rgba(255,255,255,0.95) 328deg, rgba(228,228,231,0.25) 350deg, transparent 360deg)',
          } as React.CSSProperties
        }
      />
    </div>
  );
}

export interface SpotlightCardProps {
  readonly children: React.ReactNode;
  readonly onClick?: () => void;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly asButton?: boolean;
  readonly active?: boolean;
  readonly dataTestId?: string;
}

/**
 * 21st.dev pointer-tracking SpotlightCard.
 * Updates CSS custom properties directly on the DOM node (zero React re-renders per mouse move).
 */
export function SpotlightCard({
  children,
  onClick,
  className = '',
  disabled = false,
  asButton = false,
  active = false,
  dataTestId,
}: SpotlightCardProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleMouseMove = (event: React.MouseEvent<HTMLElement>) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    el.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  };

  const baseClasses = `group relative overflow-hidden rounded-xl border transition-colors duration-200 ${
    active
      ? 'bg-[#16161b] border-white/25'
      : 'bg-[#111114] border-white/[0.08] hover:border-white/[0.18] hover:bg-[#141418]'
  } ${className}`;

  const spotlightOverlays = (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-px rounded-[inherit] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background:
            'radial-gradient(240px circle at var(--spot-x, 50%) var(--spot-y, 50%), rgba(255, 255, 255, 0.085), transparent 72%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      />
    </>
  );

  if (asButton) {
    return (
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        data-spotlight-card="true"
        data-testid={dataTestId}
        className={baseClasses}
      >
        {spotlightOverlays}
        <button
          type="button"
          disabled={disabled}
          onClick={onClick}
          className="relative z-10 w-full h-full text-left cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-[inherit]"
        >
          {children}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      data-spotlight-card="true"
      data-testid={dataTestId}
      className={baseClasses}
    >
      {spotlightOverlays}
      <div className="relative z-10">{children}</div>
    </div>
  );
}

/**
 * Monochrome architectural BackgroundBeams + fading radial micro-dot field
 * exclusively framing the empty Hero state so active long-form reading stays calm.
 */
export function BackgroundBeams() {
  return (
    <div
      aria-hidden="true"
      data-background-beams="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      {/* Fading radial micro-dot grid */}
      <div className="kartik-hero-dot-grid absolute inset-0 opacity-65" />

      {/* Top ambient platinum crown glow */}
      <div
        className="kartik-beam-drift absolute -top-36 left-1/2 -translate-x-1/2 w-[780px] h-[340px] rounded-full blur-3xl"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(255,255,255,0.095) 0%, rgba(255,255,255,0.03) 45%, transparent 72%)',
        }}
      />

      {/* Crisp geometric SVG light arcs */}
      <svg
        viewBox="0 0 1200 540"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="absolute inset-x-0 top-0 w-full h-[460px] opacity-40"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="kartikBeamA" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="kartikBeamB" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#e4e4e7" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#e4e4e7" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M-80 280 C 260 110, 560 90, 1280 240"
          stroke="url(#kartikBeamA)"
          strokeWidth="1"
        />
        <path
          d="M-60 350 C 320 190, 740 160, 1260 310"
          stroke="url(#kartikBeamB)"
          strokeWidth="1"
        />
        <path
          d="M120 0 C 390 190, 810 190, 1080 0"
          stroke="url(#kartikBeamB)"
          strokeWidth="1"
        />
      </svg>
    </div>
  );
}

export interface TextShimmerProps {
  readonly children: React.ReactNode;
  readonly className?: string;
}

/**
 * 21st.dev metallic sweeping TextShimmer for active thinking / orchestration labels.
 */
export function TextShimmer({ children, className = '' }: TextShimmerProps) {
  return (
    <span
      data-text-shimmer="true"
      className={`kartik-text-shimmer inline-block font-medium ${className}`}
    >
      {children}
    </span>
  );
}

export interface MorphingPopoverProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly align?: 'left' | 'right';
  readonly side?: 'top' | 'bottom';
  readonly className?: string;
  readonly children: React.ReactNode;
  readonly triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Spring-animated MorphingPopover with click-outside and Escape dismissal.
 */
export function MorphingPopover({
  isOpen,
  onClose,
  align = 'left',
  side = 'bottom',
  className = '',
  children,
  triggerRef,
}: MorphingPopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef?.current?.contains(target)) return;
      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose, triggerRef]);

  const positionClass = `${side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'} ${
    align === 'right' ? 'right-0' : 'left-0'
  }`;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          initial={{ opacity: 0, scale: 0.96, y: side === 'top' ? 6 : -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: side === 'top' ? 4 : -4 }}
          transition={{ type: 'spring', stiffness: 460, damping: 32, mass: 0.7 }}
          className={`absolute z-50 ${positionClass} rounded-xl bg-[#111114]/98 backdrop-blur-xl border border-white/[0.12] shadow-[0_20px_50px_-12px_rgba(0,0,0,0.85)] ${className}`}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Geometric monochrome Kartik.ai emblem (pure white on obsidian).
 */
export function ObsidianBrandMark({
  size = 'md',
}: {
  readonly size?: 'sm' | 'md' | 'lg';
}) {
  const dim =
    size === 'sm' ? 'w-7 h-7 rounded-lg' : size === 'lg' ? 'w-11 h-11 rounded-2xl' : 'w-8 h-8 rounded-xl';
  const svgDim = size === 'sm' ? 'w-3.5 h-3.5' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';

  return (
    <div
      className={`${dim} bg-white text-zinc-950 flex items-center justify-center shrink-0 shadow-[0_0_24px_rgba(255,255,255,0.16)]`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={svgDim}
        aria-hidden="true"
      >
        <path
          d="M5 4.5V19.5M5 12L15.5 4.5M9.5 9L18.5 19.5"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="18.5" cy="5.5" r="2" fill="currentColor" />
      </svg>
    </div>
  );
}

export interface AnimatedBrandLogoProps {
  readonly size?: 'sm' | 'md';
  readonly subtitle?: string;
  readonly onClick?: () => void;
  readonly title?: string;
  readonly dataTestAttr?: string;
}

/**
 * 21st.dev interactive Kartik.ai brand lockup:
 * Spring-tilting Obsidian emblem + metallic sheen-sweeping "Kartik.ai" wordmark.
 */
export function AnimatedBrandLogo({
  size = 'sm',
  subtitle,
  onClick,
  title = 'Return to Kartik.ai Home',
  dataTestAttr = 'true',
}: AnimatedBrandLogoProps) {
  const inner = (
    <span className="inline-flex items-center gap-2.5 min-w-0">
      <motion.span
        whileHover={{ rotate: -6, scale: 1.06 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: 'spring', stiffness: 460, damping: 24 }}
        className="inline-flex shrink-0"
      >
        <ObsidianBrandMark size={size} />
      </motion.span>
      <span className="min-w-0 text-left">
        <span
          className={`kartik-brand-wordmark block font-semibold tracking-tight truncate ${
            size === 'md' ? 'text-sm' : 'text-[13.5px]'
          }`}
        >
          Kartik.ai
        </span>
        {subtitle && (
          <span className="block text-[11px] text-zinc-500 truncate leading-tight">
            {subtitle}
          </span>
        )}
      </span>
    </span>
  );

  if (!onClick) {
    return (
      <div data-brand-logo={dataTestAttr} className="inline-flex items-center min-w-0">
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      data-brand-home={dataTestAttr}
      className="group inline-flex items-center min-w-0 rounded-xl px-1.5 py-1 -mx-1.5 hover:bg-white/[0.05] transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-white/35"
    >
      {inner}
    </button>
  );
}

export interface MotionScrambleTextProps {
  readonly lines: readonly string[];
  readonly intervalMs?: number;
  readonly scrambleDurationMs?: number;
  readonly className?: string;
}

/**
 * 21st.dev-inspired rotating MotionScrambleText (`@motiondotdev/components/motion-scramble-text`).
 * Cycles smoothly through curated lines with crisp left-to-right glyph settling.
 */
export function MotionScrambleText({
  lines,
  intervalMs = 4200,
  scrambleDurationMs = 780,
  className = '',
}: MotionScrambleTextProps) {
  const safeLines = lines.length > 0 ? lines : ['Kartik.ai'];
  const [lineIndex, setLineIndex] = React.useState(0);
  const [displayText, setDisplayText] = React.useState(safeLines[0] ?? '');

  useEffect(() => {
    if (safeLines.length <= 1) return;
    const timer = window.setInterval(() => {
      setLineIndex((prev) => (prev + 1) % safeLines.length);
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, safeLines.length]);

  useEffect(() => {
    const target = safeLines[lineIndex] ?? '';
    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setDisplayText(target);
      return;
    }

    let frameId = 0;
    let tick = 0;
    const startTime = performance.now();
    const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789·/—';

    const step = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / scrambleDurationMs);
      tick += 1;

      if (progress >= 1) {
        setDisplayText(target);
        return;
      }

      const settled = Math.floor(progress * target.length);
      const chars = Array.from(target);
      for (let i = settled; i < chars.length; i += 1) {
        const ch = chars[i] ?? '';
        if (ch === ' ' || ch === '.' || ch === ',' || ch === '&' || ch === '—') {
          continue;
        }
        const idx = Math.abs((i * 17 + tick * 31 + settled * 7) % CHARSET.length);
        chars[i] = CHARSET[idx] ?? ch;
      }
      setDisplayText(chars.join(''));
      frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frameId);
  }, [lineIndex, safeLines, scrambleDurationMs]);

  return (
    <div
      data-motion-scramble-text="true"
      data-scramble-index={lineIndex}
      className={`min-h-[2.75rem] sm:min-h-[1.75rem] flex items-center justify-center ${className}`}
    >
      <span className="font-mono text-xs sm:text-[13.5px] tracking-[0.01em] text-zinc-400 text-center leading-relaxed">
        {displayText}
      </span>
    </div>
  );
}

