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

export const PDF_DOCUMENT_TYPES = [
  'technical_report',
  'executive_brief',
  'proposal',
  'research_paper',
  'playbook',
  'resume',
] as const;

export type PdfDocumentType = (typeof PDF_DOCUMENT_TYPES)[number];

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

export interface PptSlideSpec {
  readonly slideNumber: number;
  readonly kind: 'cover' | 'content' | 'thank_you';
  readonly title: string;
  readonly subtitle?: string;
  readonly bullets: readonly string[];
  readonly speakerNotes?: string;
}

export interface PptPresentationSpec {
  readonly title: string;
  readonly subtitle: string;
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
    'Comprehensive Technical Reference & Architecture Guide';

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
        content: content || 'Key details and operational considerations for this section.',
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

/**
 * Validates and normalizes untrusted PPT presentation JSON or object input into a safe `PptPresentationSpec`
 * including Cover Slide, Content Slides, and Thank You Slide (Tutorial Part 2 & Blueprint Phase 10).
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
    'Executive Briefing & Architecture Presentation';

  if (!Array.isArray(obj.slides) || obj.slides.length === 0) {
    throw new AppError(
      'ARTIFACT_INVALID',
      'PPT specification requires a non-empty slides array',
    );
  }

  const contentSlides: PptSlideSpec[] = [];
  for (const rawSlide of obj.slides.slice(0, MAX_PPT_SLIDES)) {
    if (rawSlide === null || typeof rawSlide !== 'object' || Array.isArray(rawSlide)) {
      continue;
    }
    const s = rawSlide as Record<string, unknown>;
    const kindRaw = typeof s.kind === 'string' ? s.kind : 'content';
    if (kindRaw === 'cover' || kindRaw === 'thank_you') {
      continue;
    }

    const slideTitle = sanitizePrintableText(s.title, MAX_PPT_TITLE_CHARS);
    const slideSubtitle = sanitizePrintableText(s.subtitle, MAX_PPT_SUBTITLE_CHARS);
    const rawBullets = Array.isArray(s.bullets)
      ? s.bullets
      : Array.isArray(s.content)
        ? s.content
        : [];
    const bullets = rawBullets
      .slice(0, MAX_PPT_BULLETS_PER_SLIDE)
      .map((b) => sanitizePrintableText(b, MAX_PPT_BULLET_CHARS))
      .filter((b) => b.length > 0);

    if (!slideTitle && bullets.length === 0) {
      continue;
    }

    contentSlides.push(
      Object.freeze({
        slideNumber: contentSlides.length + 2,
        kind: 'content' as const,
        title: slideTitle || `Slide ${contentSlides.length + 1}`,
        ...(slideSubtitle ? { subtitle: slideSubtitle } : {}),
        bullets: Object.freeze(
          bullets.length > 0
            ? bullets
            : ['Core architectural insight and implementation takeaway.'],
        ),
        ...(typeof s.speakerNotes === 'string'
          ? { speakerNotes: sanitizePrintableText(s.speakerNotes, 400) }
          : {}),
      }),
    );
  }

  if (contentSlides.length === 0) {
    throw new AppError(
      'ARTIFACT_INVALID',
      'PPT specification contained no valid content slides',
    );
  }

  const coverSlide: PptSlideSpec = Object.freeze({
    slideNumber: 1,
    kind: 'cover',
    title,
    subtitle,
    bullets: Object.freeze(['Generated by Kartik.ai Multi-Agent Workspace']),
  });

  const thankYouSlide: PptSlideSpec = Object.freeze({
    slideNumber: contentSlides.length + 2,
    kind: 'thank_you',
    title: 'Thank You',
    subtitle: 'Questions & Discussion',
    bullets: Object.freeze([`Presentation: ${title}`, 'Generated by Kartik.ai']),
  });

  const allSlides = Object.freeze([coverSlide, ...contentSlides, thankYouSlide]);

  return Object.freeze({
    title,
    subtitle,
    slides: allSlides,
  });
}
