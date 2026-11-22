/**
 * @kartik/agent/schemas — Structured PDF & PPTX Output Schemas & Validators
 * (Blueprint §4.1, §7.2 Phase 10, §10 & Invariant #12).
 *
 * Enforces:
 * - "All model output is untrusted input. Validate JSON, filenames, MIME types, URLs and artifact manifests."
 * - "A long input is truncated predictably rather than producing a corrupt file."
 */

import { AppError } from '@kartik/shared/errors';

export const MAX_PDF_TITLE_CHARS = 140;
export const MAX_PDF_SUBTITLE_CHARS = 220;
export const MAX_PDF_SECTIONS = 12;
export const MAX_PDF_HEADING_CHARS = 120;
export const MAX_PDF_PARAGRAPH_CHARS = 1600;
export const MAX_PDF_BULLETS_PER_SECTION = 10;
export const MAX_PDF_BULLET_CHARS = 240;
export const MAX_PDF_SUMMARY_CHARS = 650;
export const MAX_PDF_CALLOUT_CHARS = 360;
export const MAX_PDF_KEY_METRICS = 4;
export const MAX_PDF_TABLE_COLS = 5;
export const MAX_PDF_TABLE_ROWS = 10;
export const MAX_PDF_TABLE_CELL_CHARS = 90;

export const MAX_PPT_TITLE_CHARS = 120;
export const MAX_PPT_SUBTITLE_CHARS = 180;
export const TARGET_PPT_CONTENT_SLIDES = 6;
export const MAX_PPT_SLIDES = 12;
export const MAX_PPT_BULLETS_PER_SLIDE = 6;
export const MAX_PPT_BULLET_CHARS = 180;
export const MAX_PPT_CALLOUT_CHARS = 260;
export const MAX_PPT_SPEAKER_NOTES_CHARS = 500;
export const MAX_PPT_METRICS_PER_SLIDE = 4;
export const MAX_PPT_STEPS_PER_SLIDE = 4;
export const MAX_PPT_COLUMN_POINTS = 4;

export const PDF_DOCUMENT_TYPES = [
  'general_guide',
  'educational_explainer',
  'creative_editorial',
  'technical_report',
  'executive_brief',
  'proposal',
  'research_paper',
  'playbook',
  'resume',
] as const;

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPES)[number];

export const PPT_DECK_THEMES = [
  'editorial_story',
  'educational_explainer',
  'creative_showcase',
  'pitch_deck',
  'technical_architecture',
  'product_launch',
  'executive_briefing',
  'workshop_training',
  'case_study',
] as const;

export type PptDeckTheme = (typeof PPT_DECK_THEMES)[number];

export const PPT_SLIDE_LAYOUTS = [
  'bullets',
  'metrics',
  'two_column',
  'process',
  'spotlight',
] as const;

export type PptSlideLayout = (typeof PPT_SLIDE_LAYOUTS)[number];

export interface PdfMetricSpec {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
}

export interface PdfTableSpec {
  readonly caption?: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface PdfSectionSpec {
  readonly heading: string;
  readonly content: string;
  readonly bullets: readonly string[];
  readonly callout?: string;
  readonly table?: PdfTableSpec;
}

export interface PdfDocumentSpec {
  readonly title: string;
  readonly subtitle: string;
  readonly documentType?: PdfDocumentType;
  readonly author?: string;
  readonly generatedDate?: string;
  readonly executiveSummary?: string;
  readonly keyMetrics?: readonly PdfMetricSpec[];
  readonly sections: readonly PdfSectionSpec[];
  readonly footer: string;
}

export interface PptMetricSpec {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
}

export interface PptColumnSpec {
  readonly heading: string;
  readonly points: readonly string[];
}

export interface PptProcessStepSpec {
  readonly step: string;
  readonly title: string;
  readonly detail: string;
}

export interface PptSlideSpec {
  readonly slideNumber: number;
  readonly kind: 'cover' | 'content' | 'thank_you';
  readonly layout?: PptSlideLayout;
  readonly kicker?: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly bullets: readonly string[];
  readonly metrics?: readonly PptMetricSpec[];
  readonly columns?: readonly PptColumnSpec[];
  readonly steps?: readonly PptProcessStepSpec[];
  readonly callout?: string;
  readonly speakerNotes?: string;
}

export interface PptPresentationSpec {
  readonly title: string;
  readonly subtitle: string;
  readonly theme?: PptDeckTheme;
  readonly author?: string;
  readonly generatedDate?: string;
  readonly footer?: string;
  readonly slides: readonly PptSlideSpec[];
}

function sanitizePrintableText(raw: unknown, maxChars: number): string {
  if (typeof raw !== 'string') {
    return '';
  }
  const cleaned = raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= maxChars) {
    return cleaned;
  }
  return `${cleaned.slice(0, Math.max(1, maxChars - 3)).trimEnd()}...`;
}

function sanitizePdfDocumentType(raw: unknown): PdfDocumentType | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (PDF_DOCUMENT_TYPES as readonly string[]).includes(normalized)
    ? (normalized as PdfDocumentType)
    : undefined;
}

function sanitizePdfTable(raw: unknown): PdfTableSpec | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const tbl = raw as Record<string, unknown>;
  if (!Array.isArray(tbl.headers) || !Array.isArray(tbl.rows)) {
    return undefined;
  }
  const headers = tbl.headers
    .slice(0, MAX_PDF_TABLE_COLS)
    .map((h) => sanitizePrintableText(h, 42))
    .filter((h) => h.length > 0);
  if (headers.length < 2) {
    return undefined;
  }
  const colCount = headers.length;
  const rows: (readonly string[])[] = [];
  for (const rawRow of tbl.rows.slice(0, MAX_PDF_TABLE_ROWS)) {
    if (!Array.isArray(rawRow)) {
      continue;
    }
    const cells = Array.from({ length: colCount }, (_, cIdx) =>
      sanitizePrintableText(rawRow[cIdx] ?? '', MAX_PDF_TABLE_CELL_CHARS),
    );
    if (cells.some((c) => c.length > 0)) {
      rows.push(Object.freeze(cells));
    }
  }
  if (rows.length === 0) {
    return undefined;
  }
  const caption = sanitizePrintableText(tbl.caption, 100);
  return Object.freeze({
    ...(caption ? { caption } : {}),
    headers: Object.freeze(headers),
    rows: Object.freeze(rows),
  });
}

function sanitizePdfMetrics(raw: unknown): readonly PdfMetricSpec[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const metrics: PdfMetricSpec[] = [];
  for (const item of raw.slice(0, MAX_PDF_KEY_METRICS)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const m = item as Record<string, unknown>;
    const label = sanitizePrintableText(m.label, 40);
    const value = sanitizePrintableText(m.value, 28);
    const delta = sanitizePrintableText(m.delta, 36);
    if (!label || !value) {
      continue;
    }
    metrics.push(
      Object.freeze({
        label,
        value,
        ...(delta ? { delta } : {}),
      }),
    );
  }
  return metrics.length > 0 ? Object.freeze(metrics) : undefined;
}

/**
 * Strips optional ```json ... ``` markdown fences emitted by LLMs before JSON parsing.
 */
export function stripMarkdownJsonFences(rawText: string): string {
  const trimmed = rawText.trim();
  const fencedMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fencedMatch ? fencedMatch[1]!.trim() : trimmed;
}

/**
 * Validates and normalizes untrusted PDF document JSON or object input into a safe `PdfDocumentSpec`.
 * Throws `AppError('ARTIFACT_INVALID', ...)` if the structure is missing required fields.
 */
export function validatePdfDocumentSpec(rawInput: unknown): PdfDocumentSpec {
  let parsed: unknown = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(stripMarkdownJsonFences(rawInput));
    } catch {
      throw new AppError(
        'ARTIFACT_INVALID',
        'PDF generator returned malformed JSON that could not be parsed',
      );
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('ARTIFACT_INVALID', 'PDF specification must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  const title = sanitizePrintableText(obj.title, MAX_PDF_TITLE_CHARS);
  if (!title) {
    throw new AppError('ARTIFACT_INVALID', 'PDF specification requires a non-empty title');
  }

  const subtitle =
    sanitizePrintableText(obj.subtitle, MAX_PDF_SUBTITLE_CHARS) ||
    'Structured Guide & Editorial Reference';

  if (!Array.isArray(obj.sections) || obj.sections.length === 0) {
    throw new AppError(
      'ARTIFACT_INVALID',
      'PDF specification requires a non-empty sections array',
    );
  }

  const sections: PdfSectionSpec[] = [];
  for (const rawSection of obj.sections.slice(0, MAX_PDF_SECTIONS)) {
    if (rawSection === null || typeof rawSection !== 'object' || Array.isArray(rawSection)) {
      continue;
    }
    const sec = rawSection as Record<string, unknown>;
    const heading = sanitizePrintableText(sec.heading, MAX_PDF_HEADING_CHARS);
    const content = sanitizePrintableText(sec.content, MAX_PDF_PARAGRAPH_CHARS);
    const rawBullets = Array.isArray(sec.bullets) ? sec.bullets : [];
    const bullets = rawBullets
      .slice(0, MAX_PDF_BULLETS_PER_SECTION)
      .map((b) => sanitizePrintableText(b, MAX_PDF_BULLET_CHARS))
      .filter((b) => b.length > 0);
    const callout = sanitizePrintableText(sec.callout, MAX_PDF_CALLOUT_CHARS);
    const table = sanitizePdfTable(sec.table);

    if (!heading && !content && bullets.length === 0) {
      continue;
    }

    sections.push(
      Object.freeze({
        heading: heading || `Section ${sections.length + 1}`,
        content: content || 'Key details, context, and takeaways for this section.',
        bullets: Object.freeze(bullets),
        ...(callout ? { callout } : {}),
        ...(table ? { table } : {}),
      }),
    );
  }

  if (sections.length === 0) {
    throw new AppError(
      'ARTIFACT_INVALID',
      'PDF specification contained no valid sections after sanitization',
    );
  }

  const documentType = sanitizePdfDocumentType(obj.documentType);
  const author = sanitizePrintableText(obj.author, 80);
  const generatedDate = sanitizePrintableText(obj.generatedDate, 32);
  const executiveSummary = sanitizePrintableText(
    obj.executiveSummary,
    MAX_PDF_SUMMARY_CHARS,
  );
  const keyMetrics = sanitizePdfMetrics(obj.keyMetrics);
  const footer =
    sanitizePrintableText(obj.footer, 100) || 'Generated by Kartik.ai';

  return Object.freeze({
    title,
    subtitle,
    ...(documentType ? { documentType } : {}),
    ...(author ? { author } : {}),
    ...(generatedDate ? { generatedDate } : {}),
    ...(executiveSummary ? { executiveSummary } : {}),
    ...(keyMetrics ? { keyMetrics } : {}),
    sections: Object.freeze(sections),
    footer,
  });
}

function sanitizePptDeckTheme(raw: unknown): PptDeckTheme | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (PPT_DECK_THEMES as readonly string[]).includes(normalized)
    ? (normalized as PptDeckTheme)
    : undefined;
}

function sanitizePptSlideLayout(raw: unknown): PptSlideLayout | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return (PPT_SLIDE_LAYOUTS as readonly string[]).includes(normalized)
    ? (normalized as PptSlideLayout)
    : undefined;
}

function sanitizePptMetrics(raw: unknown): readonly PptMetricSpec[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) {
    return undefined;
  }
  const metrics: PptMetricSpec[] = [];
  for (const item of raw.slice(0, MAX_PPT_METRICS_PER_SLIDE)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const m = item as Record<string, unknown>;
    const label = sanitizePrintableText(m.label, 44);
    const value = sanitizePrintableText(m.value, 28);
    const delta = sanitizePrintableText(m.delta, 36);
    if (!label || !value) {
      continue;
    }
    metrics.push(
      Object.freeze({
        label,
        value,
        ...(delta ? { delta } : {}),
      }),
    );
  }
  return metrics.length >= 2 ? Object.freeze(metrics) : undefined;
}

function sanitizePptColumns(raw: unknown): readonly PptColumnSpec[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) {
    return undefined;
  }
  const columns: PptColumnSpec[] = [];
  for (const item of raw.slice(0, 2)) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const col = item as Record<string, unknown>;
    const heading = sanitizePrintableText(col.heading, 64);
    const rawPoints = Array.isArray(col.points)
      ? col.points
      : Array.isArray(col.bullets)
        ? col.bullets
        : [];
    const points = rawPoints
      .slice(0, MAX_PPT_COLUMN_POINTS)
      .map((p) => sanitizePrintableText(p, MAX_PPT_BULLET_CHARS))
      .filter((p) => p.length > 0);
    if (!heading || points.length === 0) {
      continue;
    }
    columns.push(
      Object.freeze({
        heading,
        points: Object.freeze(points),
      }),
    );
  }
  return columns.length === 2 ? Object.freeze(columns) : undefined;
}

function sanitizePptSteps(raw: unknown): readonly PptProcessStepSpec[] | undefined {
  if (!Array.isArray(raw) || raw.length < 2) {
    return undefined;
  }
  const steps: PptProcessStepSpec[] = [];
  for (const [idx, item] of raw.slice(0, MAX_PPT_STEPS_PER_SLIDE).entries()) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    const st = item as Record<string, unknown>;
    const step =
      sanitizePrintableText(st.step, 16) || String(idx + 1).padStart(2, '0');
    const title = sanitizePrintableText(st.title, 60);
    const detail = sanitizePrintableText(st.detail ?? st.description, 150);
    if (!title || !detail) {
      continue;
    }
    steps.push(Object.freeze({ step, title, detail }));
  }
  return steps.length >= 2 ? Object.freeze(steps) : undefined;
}

/**
 * Validates and normalizes untrusted PPT presentation JSON or object input into a safe `PptPresentationSpec`
 * including Cover Slide, Content Slides (with optional rich visual layouts), and Thank You Slide
 * (Tutorial Part 2, Blueprint Phase 10 & Fix #17).
 */
export function validatePptPresentationSpec(rawInput: unknown): PptPresentationSpec {
  let parsed: unknown = rawInput;
  if (typeof rawInput === 'string') {
    try {
      parsed = JSON.parse(stripMarkdownJsonFences(rawInput));
    } catch {
      throw new AppError(
        'ARTIFACT_INVALID',
        'PPT generator returned malformed JSON that could not be parsed',
      );
    }
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new AppError('ARTIFACT_INVALID', 'PPT specification must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  const title = sanitizePrintableText(obj.title, MAX_PPT_TITLE_CHARS);
  if (!title) {
    throw new AppError('ARTIFACT_INVALID', 'PPT specification requires a non-empty title');
  }

  const subtitle =
    sanitizePrintableText(obj.subtitle, MAX_PPT_SUBTITLE_CHARS) ||
    'Structured Visual Presentation';

  if (!Array.isArray(obj.slides) || obj.slides.length === 0) {
    throw new AppError(
      'ARTIFACT_INVALID',
      'PPT specification requires a non-empty slides array',
    );
  }

  const theme = sanitizePptDeckTheme(obj.theme);
  const author = sanitizePrintableText(obj.author, 80);
  const generatedDate = sanitizePrintableText(obj.generatedDate, 32);
  const footer = sanitizePrintableText(obj.footer, 100) || 'Generated by Kartik.ai';

  let customCoverNotes: string | undefined;
  let customClosingNotes: string | undefined;

  const contentSlides: PptSlideSpec[] = [];
  for (const rawSlide of obj.slides.slice(0, MAX_PPT_SLIDES)) {
    if (rawSlide === null || typeof rawSlide !== 'object' || Array.isArray(rawSlide)) {
      continue;
    }
    const s = rawSlide as Record<string, unknown>;
    const kindRaw = typeof s.kind === 'string' ? s.kind : 'content';
    if (kindRaw === 'cover') {
      if (typeof s.speakerNotes === 'string') {
        const cleaned = sanitizePrintableText(s.speakerNotes, MAX_PPT_SPEAKER_NOTES_CHARS);
        if (cleaned) customCoverNotes = cleaned;
      }
      continue;
    }
    if (kindRaw === 'thank_you' || kindRaw === 'closing') {
      if (typeof s.speakerNotes === 'string') {
        const cleaned = sanitizePrintableText(s.speakerNotes, MAX_PPT_SPEAKER_NOTES_CHARS);
        if (cleaned) customClosingNotes = cleaned;
      }
      continue;
    }

    const slideTitle = sanitizePrintableText(s.title, MAX_PPT_TITLE_CHARS);
    const slideSubtitle = sanitizePrintableText(s.subtitle, MAX_PPT_SUBTITLE_CHARS);
    const kicker = sanitizePrintableText(s.kicker, 48);
    const rawBullets = Array.isArray(s.bullets)
      ? s.bullets
      : Array.isArray(s.content)
        ? s.content
        : [];
    const bullets = rawBullets
      .slice(0, MAX_PPT_BULLETS_PER_SLIDE)
      .map((b) => sanitizePrintableText(b, MAX_PPT_BULLET_CHARS))
      .filter((b) => b.length > 0);
    const metrics = sanitizePptMetrics(s.metrics ?? s.kpis ?? s.stats);
    const columns = sanitizePptColumns(s.columns ?? s.comparison);
    const steps = sanitizePptSteps(s.steps ?? s.stages ?? s.phases ?? s.timeline);
    const callout = sanitizePrintableText(
      s.callout ?? s.quote ?? s.takeaway ?? s.highlight,
      MAX_PPT_CALLOUT_CHARS,
    );
    const speakerNotes = sanitizePrintableText(
      s.speakerNotes ?? s.notes ?? s.presenterNotes,
      MAX_PPT_SPEAKER_NOTES_CHARS,
    );

    let layout = sanitizePptSlideLayout(s.layout);
    // Ensure layout matches available structured data so slides never render empty regions
    if (layout === 'metrics' && !metrics) layout = 'bullets';
    if (layout === 'two_column' && !columns) layout = 'bullets';
    if (layout === 'process' && !steps) layout = 'bullets';
    if (layout === 'spotlight' && !callout) layout = 'bullets';
    if (!layout || layout === 'bullets') {
      if (metrics) layout = 'metrics';
      else if (columns) layout = 'two_column';
      else if (steps) layout = 'process';
      else if (!layout && callout) layout = 'spotlight';
      else layout = 'bullets';
    }

    if (!slideTitle && bullets.length === 0 && !metrics && !columns && !steps) {
      continue;
    }

    // Derive concise fallback bullets from structured blocks if bullets array was omitted
    const effectiveBullets =
      bullets.length > 0
        ? bullets
        : metrics
          ? metrics.map((m) => `${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ''}`)
          : steps
            ? steps.map((st) => `${st.step}. ${st.title} — ${st.detail}`)
            : columns
              ? columns.map((c) => `${c.heading}: ${c.points[0] ?? ''}`).filter(Boolean)
              : ['Key insight and core takeaway.'];

    contentSlides.push(
      Object.freeze({
        slideNumber: contentSlides.length + 2,
        kind: 'content' as const,
        layout,
        ...(kicker ? { kicker } : {}),
        title: slideTitle || `Slide ${contentSlides.length + 1}`,
        ...(slideSubtitle ? { subtitle: slideSubtitle } : {}),
        bullets: Object.freeze(effectiveBullets),
        ...(metrics ? { metrics } : {}),
        ...(columns ? { columns } : {}),
        ...(steps ? { steps } : {}),
        ...(callout ? { callout } : {}),
        ...(speakerNotes ? { speakerNotes } : {}),
      }),
    );
  }

  if (contentSlides.length === 0) {
    throw new AppError(
      'ARTIFACT_INVALID',
      'PPT specification contained no valid content slides',
    );
  }

  const coverMetaBullets = [
    `${contentSlides.length} Structured Presentation Modules`,
    author ? `${author}${generatedDate ? ` · ${generatedDate}` : ''}` : footer,
  ];

  const coverSlide: PptSlideSpec = Object.freeze({
    slideNumber: 1,
    kind: 'cover',
    title,
    subtitle,
    bullets: Object.freeze(coverMetaBullets),
    speakerNotes:
      customCoverNotes ??
      `Welcome everyone. Today we will walk through ${title} across ${contentSlides.length} focused modules.`,
  });

  const thankYouSlide: PptSlideSpec = Object.freeze({
    slideNumber: contentSlides.length + 2,
    kind: 'thank_you',
    title: 'Thank You',
    subtitle: 'Questions & Next Steps',
    bullets: Object.freeze([`Presentation: ${title}`, footer]),
    speakerNotes:
      customClosingNotes ??
      `Thank you for joining this briefing on ${title}. Let's open the floor for questions and next steps.`,
  });

  const allSlides = Object.freeze([coverSlide, ...contentSlides, thankYouSlide]);

  return Object.freeze({
    title,
    subtitle,
    ...(theme ? { theme } : {}),
    ...(author ? { author } : {}),
    ...(generatedDate ? { generatedDate } : {}),
    footer,
    slides: allSlides,
  });
}
