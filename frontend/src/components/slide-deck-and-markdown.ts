/**
 * @file frontend/src/components/slide-deck-and-markdown.ts
 * @description Pure TypeScript parsers and view-models for 16:9 Slide Deck Previews,
 * Rich Markdown Block Tokenization (GFM tables, fenced code blocks, headings, lists),
 * and Binary Artifact Download URLs (Micro-step 9.4.a).
 */

export type ParsedPptDeckTheme =
  | 'editorial_story'
  | 'educational_explainer'
  | 'creative_showcase'
  | 'pitch_deck'
  | 'technical_architecture'
  | 'product_launch'
  | 'executive_briefing'
  | 'workshop_training'
  | 'case_study';

export type ParsedPptSlideLayout =
  | 'bullets'
  | 'metrics'
  | 'two_column'
  | 'process'
  | 'spotlight';

export interface ParsedPptMetric {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
}

export interface ParsedPptColumn {
  readonly heading: string;
  readonly points: readonly string[];
}

export interface ParsedPptProcessStep {
  readonly step: string;
  readonly title: string;
  readonly detail: string;
}

export type ParsedPptSurfaceMode = 'dark' | 'light';

export interface ParsedVectorChartBar {
  readonly label: string;
  readonly value: number;
  readonly displayValue?: string;
}

export interface ParsedVectorChart {
  readonly title?: string;
  readonly unit?: string;
  readonly bars: readonly ParsedVectorChartBar[];
}

export function parseVectorChart(raw: unknown): ParsedVectorChart | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const obj = raw as { title?: unknown; unit?: unknown; bars?: unknown };
  if (!Array.isArray(obj.bars)) {
    return undefined;
  }
  const bars: ParsedVectorChartBar[] = [];
  for (const item of obj.bars.slice(0, 6)) {
    if (!item || typeof item !== 'object') continue;
    const b = item as { label?: unknown; value?: unknown; displayValue?: unknown };
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    const num =
      typeof b.value === 'number'
        ? b.value
        : typeof b.value === 'string'
          ? Number.parseFloat(b.value)
          : NaN;
    if (!label || !Number.isFinite(num) || num < 0) continue;
    const displayValue =
      typeof b.displayValue === 'string' && b.displayValue.trim()
        ? b.displayValue.trim()
        : undefined;
    bars.push(
      Object.freeze({
        label,
        value: num,
        ...(displayValue ? { displayValue } : {}),
      }),
    );
  }
  if (bars.length < 2) {
    return undefined;
  }
  const title =
    typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : undefined;
  const unit =
    typeof obj.unit === 'string' && obj.unit.trim() ? obj.unit.trim() : undefined;
  return Object.freeze({
    ...(title ? { title } : {}),
    ...(unit ? { unit } : {}),
    bars: Object.freeze(bars),
  });
}

export interface InteractiveSlideViewModel {
  readonly slideNumber: number;
  readonly totalSlides: number;
  readonly kind: 'cover' | 'content' | 'closing';
  readonly layout: ParsedPptSlideLayout;
  readonly kicker?: string;
  readonly title: string;
  readonly subtitle: string;
  readonly bullets: readonly string[];
  readonly metrics?: readonly ParsedPptMetric[];
  readonly columns?: readonly ParsedPptColumn[];
  readonly steps?: readonly ParsedPptProcessStep[];
  readonly chart?: ParsedVectorChart;
  readonly callout?: string;
  readonly speakerNotes?: string;
  readonly footer: string;
}

export interface ParsedSlideDeckViewModel {
  readonly deckTitle: string;
  readonly deckSubtitle: string;
  readonly theme: ParsedPptDeckTheme;
  readonly surfaceMode: ParsedPptSurfaceMode;
  readonly author?: string;
  readonly generatedDate?: string;
  readonly slides: readonly InteractiveSlideViewModel[];
}

const VALID_PPT_THEMES: ReadonlySet<string> = new Set([
  'editorial_story',
  'educational_explainer',
  'creative_showcase',
  'pitch_deck',
  'technical_architecture',
  'product_launch',
  'executive_briefing',
  'workshop_training',
  'case_study',
]);

const VALID_PPT_LAYOUTS: ReadonlySet<string> = new Set([
  'bullets',
  'metrics',
  'two_column',
  'process',
  'spotlight',
]);

interface RawSlideInput {
  readonly kind?: string;
  readonly layout?: string;
  readonly kicker?: string;
  readonly title?: string;
  readonly subtitle?: string;
  readonly bullets?: unknown[];
  readonly metrics?: Array<{ label?: string; value?: string; delta?: string }>;
  readonly columns?: Array<{ heading?: string; points?: unknown[]; bullets?: unknown[] }>;
  readonly steps?: Array<{ step?: string; title?: string; detail?: string; description?: string }>;
  readonly callout?: string;
  readonly chart?: unknown;
  readonly speakerNotes?: string;
}

function normalizeParsedSlideFields(s: RawSlideInput): {
  readonly layout: ParsedPptSlideLayout;
  readonly kicker?: string;
  readonly title: string;
  readonly subtitle: string;
  readonly bullets: readonly string[];
  readonly metrics?: readonly ParsedPptMetric[];
  readonly columns?: readonly ParsedPptColumn[];
  readonly steps?: readonly ParsedPptProcessStep[];
  readonly chart?: ParsedVectorChart;
  readonly callout?: string;
  readonly speakerNotes?: string;
} {
  const bullets = Array.isArray(s.bullets)
    ? s.bullets.map((b) => String(b).trim()).filter(Boolean)
    : [];

  const metrics: ParsedPptMetric[] | undefined = Array.isArray(s.metrics)
    ? s.metrics
        .filter(
          (m) =>
            m &&
            typeof m.label === 'string' &&
            m.label.trim() &&
            typeof m.value === 'string' &&
            m.value.trim(),
        )
        .slice(0, 4)
        .map((m) =>
          Object.freeze({
            label: String(m.label).trim(),
            value: String(m.value).trim(),
            ...(typeof m.delta === 'string' && m.delta.trim()
              ? { delta: m.delta.trim() }
              : {}),
          }),
        )
    : undefined;

  const columns: ParsedPptColumn[] | undefined = Array.isArray(s.columns)
    ? s.columns
        .slice(0, 2)
        .map((c) => {
          const pts = Array.isArray(c?.points)
            ? c.points
            : Array.isArray(c?.bullets)
              ? c.bullets
              : [];
          const cleanPts = pts.map((p) => String(p).trim()).filter(Boolean);
          const heading = typeof c?.heading === 'string' ? c.heading.trim() : '';
          return heading && cleanPts.length > 0
            ? Object.freeze({ heading, points: Object.freeze(cleanPts) })
            : null;
        })
        .filter((c): c is ParsedPptColumn => c !== null)
    : undefined;

  const steps: ParsedPptProcessStep[] | undefined = Array.isArray(s.steps)
    ? s.steps
        .slice(0, 4)
        .map((st, idx) => {
          const stTitle = typeof st?.title === 'string' ? st.title.trim() : '';
          const stDetail =
            typeof st?.detail === 'string'
              ? st.detail.trim()
              : typeof st?.description === 'string'
                ? st.description.trim()
                : '';
          const stNum =
            typeof st?.step === 'string' && st.step.trim()
              ? st.step.trim()
              : String(idx + 1).padStart(2, '0');
          return stTitle && stDetail
            ? Object.freeze({ step: stNum, title: stTitle, detail: stDetail })
            : null;
        })
        .filter((st): st is ParsedPptProcessStep => st !== null)
    : undefined;

  const callout =
    typeof s.callout === 'string' && s.callout.trim() ? s.callout.trim() : undefined;
  const kicker =
    typeof s.kicker === 'string' && s.kicker.trim() ? s.kicker.trim() : undefined;
  const speakerNotes =
    typeof s.speakerNotes === 'string' && s.speakerNotes.trim()
      ? s.speakerNotes.trim()
      : undefined;

  const validMetrics = metrics && metrics.length >= 2 ? Object.freeze(metrics) : undefined;
  const validColumns = columns && columns.length === 2 ? Object.freeze(columns) : undefined;
  const validSteps = steps && steps.length >= 2 ? Object.freeze(steps) : undefined;

  let layout: ParsedPptSlideLayout =
    typeof s.layout === 'string' && VALID_PPT_LAYOUTS.has(s.layout)
      ? (s.layout as ParsedPptSlideLayout)
      : 'bullets';

  if (layout === 'metrics' && !validMetrics) layout = 'bullets';
  if (layout === 'two_column' && !validColumns) layout = 'bullets';
  if (layout === 'process' && !validSteps) layout = 'bullets';
  if (layout === 'spotlight' && !callout) layout = 'bullets';
  if (layout === 'bullets') {
    if (validMetrics && !s.layout) layout = 'metrics';
    else if (validColumns && !s.layout) layout = 'two_column';
    else if (validSteps && !s.layout) layout = 'process';
  }

  const chart = parseVectorChart(s.chart);

  return {
    layout,
    ...(kicker ? { kicker } : {}),
    title: typeof s.title === 'string' ? s.title.trim() : '',
    subtitle: typeof s.subtitle === 'string' ? s.subtitle.trim() : '',
    bullets: Object.freeze(bullets),
    ...(validMetrics ? { metrics: validMetrics } : {}),
    ...(validColumns ? { columns: validColumns } : {}),
    ...(validSteps ? { steps: validSteps } : {}),
    ...(chart ? { chart } : {}),
    ...(callout ? { callout } : {}),
    ...(speakerNotes ? { speakerNotes } : {}),
  };
}

/**
 * Parses the `slides-spec.json` manifest content of a `ppt_presentation` artifact into an
 * 8-slide 16:9 interactive deck (Cover + Content Slides + Closing Slide).
 * Handles both already-wrapped backend specs (`kind: 'cover' | 'content' | 'thank_you'`)
 * without double-wrapping AND legacy content-only slide arrays.
 */
export function parsePptArtifactSlideDeck(
  rawSpecJson: string | undefined,
  fallbackTitle: string = 'Kartik.ai Presentation Deck',
): ParsedSlideDeckViewModel {
  let title = fallbackTitle;
  let subtitle = 'Structured Visual Presentation';
  let theme: ParsedPptDeckTheme = 'editorial_story';
  let surfaceMode: ParsedPptSurfaceMode = 'dark';
  let author: string | undefined;
  let generatedDate: string | undefined;
  let footer = 'Generated by Kartik.ai';
  let coverSlideInput: RawSlideInput | undefined;
  let closingSlideInput: RawSlideInput | undefined;
  let contentSlides: Array<ReturnType<typeof normalizeParsedSlideFields>> = [];

  if (rawSpecJson && rawSpecJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawSpecJson) as {
        theme?: string;
        surfaceMode?: string;
        spec?: {
          title?: string;
          subtitle?: string;
          theme?: string;
          surfaceMode?: string;
          author?: string;
          generatedDate?: string;
          footer?: string;
          slides?: RawSlideInput[];
        };
      };
      const spec = parsed.spec;
      const rawTheme = spec?.theme ?? parsed.theme;
      if (typeof rawTheme === 'string' && VALID_PPT_THEMES.has(rawTheme)) {
        theme = rawTheme as ParsedPptDeckTheme;
      }
      const rawSurface = spec?.surfaceMode ?? parsed.surfaceMode;
      if (rawSurface === 'light' || rawSurface === 'dark') {
        surfaceMode = rawSurface;
      }

      if (spec) {
        if (typeof spec.title === 'string' && spec.title.trim()) {
          title = spec.title.trim();
        }
        if (typeof spec.subtitle === 'string' && spec.subtitle.trim()) {
          subtitle = spec.subtitle.trim();
        }
        if (typeof spec.author === 'string' && spec.author.trim()) {
          author = spec.author.trim();
        }
        if (typeof spec.generatedDate === 'string' && spec.generatedDate.trim()) {
          generatedDate = spec.generatedDate.trim();
        }
        if (typeof spec.footer === 'string' && spec.footer.trim()) {
          footer = spec.footer.trim();
        }
        if (Array.isArray(spec.slides)) {
          for (const rawSlide of spec.slides) {
            if (!rawSlide || typeof rawSlide !== 'object') continue;
            if (rawSlide.kind === 'cover') {
              coverSlideInput = rawSlide;
              continue;
            }
            if (rawSlide.kind === 'thank_you' || rawSlide.kind === 'closing') {
              closingSlideInput = rawSlide;
              continue;
            }
            if (typeof rawSlide.title === 'string' && rawSlide.title.trim()) {
              contentSlides.push(normalizeParsedSlideFields(rawSlide));
            }
          }
        }
      }
    } catch {
      // Fall through to default slide structure
    }
  }

  if (contentSlides.length === 0) {
    contentSlides = [
      normalizeParsedSlideFields({
        layout: 'bullets',
        title: 'Executive Overview',
        subtitle: 'Core Objectives & Scope',
        bullets: [
          'Deterministic multi-agent routing across 7 specialist domains',
          'Strict PostgreSQL schema isolation & Ed25519 user assertions',
          'Zero double-charge idempotency guarantees',
        ],
      }),
    ];
  }

  const totalSlides = contentSlides.length + 2;
  const slides: InteractiveSlideViewModel[] = [];

  const coverNorm = coverSlideInput ? normalizeParsedSlideFields(coverSlideInput) : null;
  slides.push(
    Object.freeze({
      slideNumber: 1,
      totalSlides,
      kind: 'cover',
      layout: 'bullets',
      title: coverNorm?.title || title,
      subtitle: coverNorm?.subtitle || subtitle,
      bullets: Object.freeze(
        coverNorm && coverNorm.bullets.length > 0
          ? [...coverNorm.bullets]
          : [`${contentSlides.length} Structured Presentation Modules`, footer],
      ),
      ...(coverNorm?.speakerNotes ? { speakerNotes: coverNorm.speakerNotes } : {}),
      footer,
    }),
  );

  contentSlides.forEach((s, idx) => {
    slides.push(
      Object.freeze({
        slideNumber: idx + 2,
        totalSlides,
        kind: 'content',
        layout: s.layout,
        ...(s.kicker ? { kicker: s.kicker } : {}),
        title: s.title,
        subtitle: s.subtitle || `Module ${idx + 1} of ${contentSlides.length}`,
        bullets: s.bullets,
        ...(s.metrics ? { metrics: s.metrics } : {}),
        ...(s.columns ? { columns: s.columns } : {}),
        ...(s.steps ? { steps: s.steps } : {}),
        ...(s.chart ? { chart: s.chart } : {}),
        ...(s.callout ? { callout: s.callout } : {}),
        ...(s.speakerNotes ? { speakerNotes: s.speakerNotes } : {}),
        footer,
      }),
    );
  });

  const closingNorm = closingSlideInput
    ? normalizeParsedSlideFields(closingSlideInput)
    : null;
  slides.push(
    Object.freeze({
      slideNumber: totalSlides,
      totalSlides,
      kind: 'closing',
      layout: 'bullets',
      title: closingNorm?.title || 'Thank You & Q&A',
      subtitle: closingNorm?.subtitle || title,
      bullets: Object.freeze(
        closingNorm && closingNorm.bullets.length > 0
          ? [...closingNorm.bullets]
          : [
              'Download the OpenXML .pptx file to edit in PowerPoint, Keynote, or Google Slides',
              footer,
            ],
      ),
      ...(closingNorm?.speakerNotes ? { speakerNotes: closingNorm.speakerNotes } : {}),
      footer,
    }),
  );

  return Object.freeze({
    deckTitle: title,
    deckSubtitle: subtitle,
    theme,
    surfaceMode,
    ...(author ? { author } : {}),
    ...(generatedDate ? { generatedDate } : {}),
    slides: Object.freeze(slides),
  });
}

/**
 * Exports a parsed presentation deck (including layouts, KPIs, comparisons, process steps,
 * callouts, and speaker notes) to clean GitHub-Flavored Markdown.
 */
export function pptDeckSpecToMarkdown(deck: ParsedSlideDeckViewModel): string {
  const lines: string[] = [`# ${deck.deckTitle}`, `*${deck.deckSubtitle}*`, ''];
  const meta = [deck.author, deck.generatedDate, `${deck.slides.length} slides (16:9)`]
    .filter(Boolean)
    .join(' · ');
  if (meta) {
    lines.push(`> ${meta}`, '');
  }

  for (const slide of deck.slides) {
    lines.push(`## Slide ${slide.slideNumber}: ${slide.title}`);
    if (slide.subtitle) {
      lines.push(`*${slide.subtitle}*`);
    }
    lines.push('');

    if (slide.metrics && slide.metrics.length > 0) {
      lines.push('| Metric | Value | Note |');
      lines.push('| --- | --- | --- |');
      for (const m of slide.metrics) {
        lines.push(`| ${m.label} | **${m.value}** | ${m.delta ?? ''} |`);
      }
      lines.push('');
    }

    if (slide.columns && slide.columns.length === 2) {
      for (const col of slide.columns) {
        lines.push(`### ${col.heading}`);
        for (const pt of col.points) {
          lines.push(`- ${pt}`);
        }
        lines.push('');
      }
    }

    if (slide.steps && slide.steps.length > 0) {
      for (const st of slide.steps) {
        lines.push(`- **Step ${st.step} — ${st.title}:** ${st.detail}`);
      }
      lines.push('');
    }

    if (slide.bullets.length > 0 && !slide.columns && !slide.steps) {
      for (const b of slide.bullets) {
        lines.push(`- ${b}`);
      }
      lines.push('');
    }

    if (slide.chart && slide.chart.bars.length > 0) {
      if (slide.chart.title) {
        lines.push(`*${slide.chart.title}*`, '');
      }
      lines.push('| Label | Value |');
      lines.push('| --- | --- |');
      for (const bar of slide.chart.bars) {
        const val =
          bar.displayValue ??
          `${bar.value}${slide.chart.unit ? ` ${slide.chart.unit}` : ''}`;
        lines.push(`| ${bar.label} | ${val} |`);
      }
      lines.push('');
    }

    if (slide.callout) {
      lines.push(`> **Takeaway:** ${slide.callout}`, '');
    }

    if (slide.speakerNotes) {
      lines.push(`*Speaker Notes:* ${slide.speakerNotes}`, '');
    }
  }

  return lines.join('\n').trim();
}

/**
 * Converts an interactive (possibly user-edited) `ParsedSlideDeckViewModel` back into a
 * `PptPresentationSpec` payload for `POST /api/v1/artifacts/recompile`.
 */
export function pptViewModelToCompileSpec(deck: ParsedSlideDeckViewModel) {
  return {
    title: deck.deckTitle,
    subtitle: deck.deckSubtitle,
    theme: deck.theme,
    surfaceMode: deck.surfaceMode,
    ...(deck.author ? { author: deck.author } : {}),
    ...(deck.generatedDate ? { generatedDate: deck.generatedDate } : {}),
    footer: deck.slides[0]?.footer || 'Generated by Kartik.ai',
    slides: deck.slides.map((s) => ({
      kind: s.kind === 'closing' ? 'thank_you' : s.kind,
      layout: s.layout,
      ...(s.kicker ? { kicker: s.kicker } : {}),
      title: s.title,
      ...(s.subtitle ? { subtitle: s.subtitle } : {}),
      bullets: [...s.bullets],
      ...(s.metrics ? { metrics: s.metrics.map((m) => ({ ...m })) } : {}),
      ...(s.columns
        ? { columns: s.columns.map((c) => ({ heading: c.heading, points: [...c.points] })) }
        : {}),
      ...(s.steps ? { steps: s.steps.map((st) => ({ ...st })) } : {}),
      ...(s.chart
        ? {
            chart: {
              ...(s.chart.title ? { title: s.chart.title } : {}),
              ...(s.chart.unit ? { unit: s.chart.unit } : {}),
              bars: s.chart.bars.map((b) => ({ ...b })),
            },
          }
        : {}),
      ...(s.callout ? { callout: s.callout } : {}),
      ...(s.speakerNotes ? { speakerNotes: s.speakerNotes } : {}),
    })),
  };
}

export type MarkdownBlock =
  | { readonly type: 'heading'; readonly level: 1 | 2 | 3 | 4; readonly text: string }
  | { readonly type: 'code'; readonly language: string; readonly code: string }
  | {
      readonly type: 'table';
      readonly headers: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | { readonly type: 'list'; readonly ordered: boolean; readonly items: readonly string[] }
  | { readonly type: 'blockquote'; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string };

/**
 * Tokenizes a Markdown string into structured blocks (`heading`, `code`, `table`, `list`,
 * `blockquote`, `paragraph`) for safe, XSS-free React rendering without external parsers.
 */
export function tokenizeMarkdownBlocks(markdown: string): readonly MarkdownBlock[] {
  const normalized = (markdown ?? '').replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return Object.freeze([]);
  }

  const lines = normalized.split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const rawLine = lines[i] ?? '';
    const trimmed = rawLine.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. Fenced code block (```lang ... ```)
    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || 'text';
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !(lines[i] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[i] ?? '');
        i += 1;
      }
      if (i < lines.length) {
        i += 1; // skip closing ```
      }
      blocks.push({
        type: 'code',
        language,
        code: codeLines.join('\n'),
      });
      continue;
    }

    // 2. Heading (# .. ####)
    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      const level = Math.min(4, Math.max(1, headingMatch[1]!.length)) as 1 | 2 | 3 | 4;
      blocks.push({
        type: 'heading',
        level,
        text: headingMatch[2]!.trim(),
      });
      i += 1;
      continue;
    }

    // 3. GFM Table (| Col1 | Col2 | followed by | --- | --- |)
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\|\s*[:\-| ]+\|\s*$/.test((lines[i + 1] ?? '').trim())
    ) {
      const parseRow = (rowLine: string) =>
        rowLine
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());

      const headers = parseRow(trimmed);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('|')) {
        rows.push(parseRow(lines[i]!));
        i += 1;
      }
      blocks.push({
        type: 'table',
        headers: Object.freeze(headers),
        rows: Object.freeze(rows.map((r) => Object.freeze(r))),
      });
      continue;
    }

    // 4. Blockquote (> ...)
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim().startsWith('>')) {
        quoteLines.push((lines[i] ?? '').trim().replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({
        type: 'blockquote',
        text: quoteLines.join(' '),
      });
      continue;
    }

    // 5. Unordered or Ordered List
    const isUnordered = /^[-*•]\s+/.test(trimmed);
    const isOrdered = /^\d+\.\s+/.test(trimmed);
    if (isUnordered || isOrdered) {
      const items: string[] = [];
      while (i < lines.length) {
        const lineTrim = (lines[i] ?? '').trim();
        if (isUnordered && /^[-*•]\s+/.test(lineTrim)) {
          items.push(lineTrim.replace(/^[-*•]\s+/, '').trim());
          i += 1;
        } else if (isOrdered && /^\d+\.\s+/.test(lineTrim)) {
          items.push(lineTrim.replace(/^\d+\.\s+/, '').trim());
          i += 1;
        } else {
          break;
        }
      }
      blocks.push({
        type: 'list',
        ordered: isOrdered,
        items: Object.freeze(items),
      });
      continue;
    }

    // 6. Paragraph
    const paraLines: string[] = [];
    while (i < lines.length) {
      const cur = (lines[i] ?? '').trim();
      if (
        !cur ||
        cur.startsWith('```') ||
        /^#{1,4}\s+/.test(cur) ||
        cur.startsWith('|') ||
        cur.startsWith('>') ||
        /^[-*•]\s+/.test(cur) ||
        /^\d+\.\s+/.test(cur)
      ) {
        break;
      }
      paraLines.push(cur);
      i += 1;
    }
    blocks.push({
      type: 'paragraph',
      text: paraLines.join(' '),
    });
  }

  return Object.freeze(blocks);
}

export type MarkdownInlineToken =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'code'; readonly text: string }
  | { readonly type: 'bold'; readonly text: string }
  | { readonly type: 'italic'; readonly text: string }
  | { readonly type: 'link'; readonly label: string; readonly url: string }
  | { readonly type: 'citation'; readonly index: number; readonly raw: string };

const INLINE_TOKEN_PATTERN =
  /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\[(?:src_)?\d+(?:\s*,\s*(?:src_)?\d+)*\])/g;

/**
 * Pure, XSS-safe inline Markdown tokenizer supporting inline code, bold, italic,
 * `http(s)` links, and numeric citation markers (`[1]`, `[src_1]`, `[1, 2]`).
 */
export function tokenizeInlineMarkdown(text: string): readonly MarkdownInlineToken[] {
  if (!text) {
    return Object.freeze([]);
  }

  const parts = text.split(INLINE_TOKEN_PATTERN);
  const tokens: MarkdownInlineToken[] = [];

  for (const part of parts) {
    if (!part) continue;

    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      tokens.push({ type: 'code', text: part.slice(1, -1) });
      continue;
    }

    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      tokens.push({ type: 'bold', text: part.slice(2, -2) });
      continue;
    }

    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      tokens.push({ type: 'italic', text: part.slice(1, -1) });
      continue;
    }

    const linkMatch = /^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(part);
    if (linkMatch) {
      tokens.push({
        type: 'link',
        label: linkMatch[1]!,
        url: linkMatch[2]!,
      });
      continue;
    }

    const citationMatch = /^\[((?:src_)?\d+(?:\s*,\s*(?:src_)?\d+)*)\]$/.exec(part);
    if (citationMatch) {
      const nums = citationMatch[1]!
        .split(',')
        .map((chunk) => Number.parseInt(chunk.replace(/^src_/i, '').trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 99);
      if (nums.length > 0) {
        for (const num of nums) {
          tokens.push({ type: 'citation', index: num, raw: `[${num}]` });
        }
        continue;
      }
    }

    tokens.push({ type: 'text', text: part });
  }

  return Object.freeze(tokens);
}

/**
 * Builds the canonical direct binary download path for a generated PDF, PPTX, or PNG artifact.
 */
export function buildArtifactRawDownloadUrl(artifactId: string): string {
  const cleanId = encodeURIComponent(artifactId.trim());
  return `/api/v1/artifacts/${cleanId}/raw`;
}

export interface AgentSelectorPillSpec {
  readonly id: 'chat' | 'search' | 'coding' | 'pdf' | 'ppt' | 'rag' | 'vision' | 'image';
  readonly label: string;
  readonly creditCostLabel: string;
  readonly placeholder: string;
}

export const AGENT_SELECTOR_PILLS: readonly AgentSelectorPillSpec[] = Object.freeze([
  {
    id: 'chat',
    label: 'Chat',
    creditCostLabel: '1 cr+',
    placeholder:
      'Ask anything — Chat answers directly or smart-routes to Search, Coding, PDF, PPT, RAG, Vision & Image...',
  },
  {
    id: 'search',
    label: 'Web Search',
    creditCostLabel: '2 cr',
    placeholder: 'Search the live web with inline citations, source cards & follow-ups...',
  },
  {
    id: 'coding',
    label: 'Coding',
    creditCostLabel: '5 cr',
    placeholder: 'Build an interactive HTML/CSS/JS app or ask for a code review...',
  },
  {
    id: 'pdf',
    label: 'PDF Gen',
    creditCostLabel: '5 cr',
    placeholder: 'Describe any multi-section PDF guide, brief, or report to generate (%PDF-1.4)...',
  },
  {
    id: 'ppt',
    label: 'PPT Gen',
    creditCostLabel: '8 cr',
    placeholder: 'Describe any presentation deck (3–10 slides, light or dark theme, .pptx)...',
  },
  {
    id: 'rag',
    label: 'PDF RAG',
    creditCostLabel: '2 cr',
    placeholder: 'Upload a .PDF and ask for grounded facts, tables, comparisons, or summaries...',
  },
  {
    id: 'vision',
    label: 'Vision OCR',
    creditCostLabel: '3 cr',
    placeholder: 'Attach an image (PNG/JPEG/WebP) to extract OCR text, tables, diagrams, or audit UI...',
  },
  {
    id: 'image',
    label: 'Image Gen',
    creditCostLabel: '10 cr',
    placeholder: 'Describe the artwork, logo, diagram, or aspect ratio (16:9, 9:16, 4:3) to generate...',
  },
]);

export interface ChatResponseDepthOption {
  readonly id: 'concise' | 'balanced' | 'deep';
  readonly label: string;
  readonly description: string;
}

export const CHAT_RESPONSE_DEPTH_OPTIONS: readonly ChatResponseDepthOption[] = Object.freeze([
  {
    id: 'concise',
    label: 'Concise',
    description: 'Short, high-signal takeaways',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Structured answer with examples',
  },
  {
    id: 'deep',
    label: 'Deep',
    description: 'Senior deep dive, edge cases & checklists',
  },
]);

const SPECIALIST_DISPLAY_LABELS: Readonly<Record<AgentSelectorPillSpec['id'], string>> =
  Object.freeze({
    chat: 'Chat',
    search: 'Web Search',
    coding: 'Coding',
    pdf: 'PDF Gen',
    ppt: 'PPT Gen',
    rag: 'PDF RAG',
    vision: 'Vision OCR',
    image: 'Image Gen',
  });

const CHAT_MODE_DISPLAY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  direct_concise: 'Direct Answer',
  technical_architecture: 'Technical & Architecture',
  writing_editorial: 'Writing & Editorial',
  strategy_brainstorm: 'Strategy & Trade-Offs',
  step_by_step_mentor: 'Guided Mentor',
});

const CHAT_DEPTH_DISPLAY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  concise: 'Concise',
  balanced: 'Balanced',
  deep: 'Deep',
});

/**
 * Formats a quiet, unboxed routing attribution line when unified Chat smart-delegates
 * a turn to a specialist (e.g., `Routed via Chat → Web Search · Live web lookup`).
 */
export function formatRoutingAttribution(
  agent: AgentSelectorPillSpec['id'] | undefined,
  routedFromChat?: boolean,
  routingReason?: string,
): string | null {
  if (!routedFromChat || !agent || agent === 'chat') {
    return null;
  }
  const targetLabel = SPECIALIST_DISPLAY_LABELS[agent] ?? agent.toUpperCase();
  const reason = routingReason?.trim();
  return reason
    ? `Routed via Chat → ${targetLabel} · ${reason}`
    : `Routed via Chat → ${targetLabel}`;
}

/**
 * Formats quiet inline Chat mode & response depth metadata (e.g. `Technical & Architecture · Deep`).
 */
export function formatChatModeAndDepthMeta(
  chatMode?: string,
  responseDepth?: string,
): string | null {
  const modeLabel = chatMode ? CHAT_MODE_DISPLAY_LABELS[chatMode] : undefined;
  const depthLabel = responseDepth ? CHAT_DEPTH_DISPLAY_LABELS[responseDepth] : undefined;
  const parts = [modeLabel, depthLabel].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function trimAtWordBoundary(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  const sliced = clean.slice(0, maxChars);
  const lastSpace = sliced.lastIndexOf(' ');
  return (lastSpace > Math.floor(maxChars * 0.5) ? sliced.slice(0, lastSpace) : sliced)
    .replace(/[\s,.;:!?-]+$/, '')
    .trim();
}

/**
 * Builds a clean, focused specialist handoff prompt from a Chat reply (PDF, PPT, or Web Search).
 */
export function buildChatHandoffPrompt(
  target: 'pdf' | 'ppt' | 'search',
  answerMarkdown: string,
  userPrompt?: string,
): string {
  const plainSummary = answerMarkdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const topic = trimAtWordBoundary(userPrompt?.trim() || plainSummary, 90) || 'this topic';
  const digest = trimAtWordBoundary(plainSummary, 260);

  if (target === 'pdf') {
    return `Generate a comprehensive multi-section PDF report on "${topic}" incorporating these key points: ${digest}`;
  }
  if (target === 'ppt') {
    return `Create a 6-slide presentation deck on "${topic}" covering these key points: ${digest}`;
  }
  return `Search the web to verify and cite current sources for: ${topic}`;
}

/**
 * Combines a multi-file `code_bundle` (`index.html`, `styles.css`, `app.js`) into a single
 * self-contained HTML document for an isolated `<iframe sandbox="allow-scripts">` preview
 * (Invariant #11: never `allow-same-origin`).
 */
export function assembleMultiFileHtmlPreview(
  files: ReadonlyArray<{ readonly path: string; readonly content?: string }>,
): {
  readonly sandboxAttribute: 'allow-scripts';
  readonly srcDoc: string;
} {
  const htmlFile =
    files.find((f) => f.path.endsWith('.html'))?.content ??
    '<div id="app">Preview Ready</div>';
  const cssContent = files
    .filter((f) => f.path.endsWith('.css'))
    .map((f) => f.content ?? '')
    .join('\n');
  const jsContent = files
    .filter((f) => f.path.endsWith('.js'))
    .map((f) => (f.content ?? '').replace(/<\/script>/gi, '<\\/script>'))
    .join('\n');

  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(htmlFile);
  const bodyInner = bodyMatch ? bodyMatch[1]! : htmlFile;

  const srcDoc = [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<style>${cssContent}</style>`,
    '</head>',
    '<body>',
    bodyInner,
    `<script>${jsContent}</script>`,
    '</body>',
    '</html>',
  ].join('\n');

  return Object.freeze({
    sandboxAttribute: 'allow-scripts',
    srcDoc,
  });
}

export type ParsedPdfDocumentType =
  | 'general_guide'
  | 'educational_explainer'
  | 'creative_editorial'
  | 'technical_report'
  | 'executive_brief'
  | 'proposal'
  | 'research_paper'
  | 'playbook'
  | 'resume';

export interface ParsedPdfMetric {
  readonly label: string;
  readonly value: string;
  readonly delta?: string;
}

export interface ParsedPdfTable {
  readonly caption?: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface ParsedPdfSectionViewModel {
  readonly sectionNumber: number;
  readonly heading: string;
  readonly content: string;
  readonly bullets: readonly string[];
  readonly callout?: string;
  readonly table?: ParsedPdfTable;
  readonly chart?: ParsedVectorChart;
}

export interface ParsedPdfDocumentViewModel {
  readonly title: string;
  readonly subtitle: string;
  readonly documentType: ParsedPdfDocumentType;
  readonly author: string;
  readonly generatedDate?: string;
  readonly executiveSummary?: string;
  readonly keyMetrics: readonly ParsedPdfMetric[];
  readonly sections: readonly ParsedPdfSectionViewModel[];
  readonly pageCount: number;
  readonly footer: string;
}

const VALID_PDF_DOC_TYPES: ReadonlySet<string> = new Set([
  'general_guide',
  'educational_explainer',
  'creative_editorial',
  'technical_report',
  'executive_brief',
  'proposal',
  'research_paper',
  'playbook',
  'resume',
]);

/**
 * Parses the `document-spec.json` manifest content of a `pdf_document` artifact into a structured
 * view-model for interactive in-chat document reading and Markdown export.
 */
export function parsePdfArtifactDocument(
  rawSpecJson: string | undefined,
  fallbackTitle: string = 'Kartik.ai PDF Guide',
): ParsedPdfDocumentViewModel {
  let title = fallbackTitle;
  let subtitle = 'Structured Guide & Editorial Reference';
  let documentType: ParsedPdfDocumentType = 'general_guide';
  let author = 'Kartik.ai Editorial Engine';
  let generatedDate: string | undefined;
  let executiveSummary: string | undefined;
  let keyMetrics: ParsedPdfMetric[] = [];
  let sections: ParsedPdfSectionViewModel[] = [];
  let pageCount = 1;
  let footer = 'Generated by Kartik.ai';

  if (rawSpecJson && rawSpecJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawSpecJson) as {
        pageCount?: number;
        documentType?: string;
        spec?: {
          title?: string;
          subtitle?: string;
          documentType?: string;
          author?: string;
          generatedDate?: string;
          executiveSummary?: string;
          keyMetrics?: Array<{
            label?: string;
            value?: string;
            delta?: string;
          }>;
          footer?: string;
          sections?: Array<{
            heading?: string;
            content?: string;
            bullets?: string[];
            callout?: string;
            table?: {
              caption?: string;
              headers?: string[];
              rows?: string[][];
            };
            chart?: unknown;
          }>;
        };
      };

      if (typeof parsed.pageCount === 'number' && parsed.pageCount >= 1) {
        pageCount = Math.floor(parsed.pageCount);
      }

      const spec = parsed.spec;
      const rawType = spec?.documentType ?? parsed.documentType;
      if (typeof rawType === 'string' && VALID_PDF_DOC_TYPES.has(rawType)) {
        documentType = rawType as ParsedPdfDocumentType;
      }

      if (spec) {
        if (typeof spec.title === 'string' && spec.title.trim()) {
          title = spec.title.trim();
        }
        if (typeof spec.subtitle === 'string' && spec.subtitle.trim()) {
          subtitle = spec.subtitle.trim();
        }
        if (typeof spec.author === 'string' && spec.author.trim()) {
          author = spec.author.trim();
        }
        if (typeof spec.generatedDate === 'string' && spec.generatedDate.trim()) {
          generatedDate = spec.generatedDate.trim();
        }
        if (
          typeof spec.executiveSummary === 'string' &&
          spec.executiveSummary.trim()
        ) {
          executiveSummary = spec.executiveSummary.trim();
        }
        if (typeof spec.footer === 'string' && spec.footer.trim()) {
          footer = spec.footer.trim();
        }
        if (Array.isArray(spec.keyMetrics)) {
          keyMetrics = spec.keyMetrics
            .filter(
              (m) =>
                m &&
                typeof m.label === 'string' &&
                m.label.trim() &&
                typeof m.value === 'string' &&
                m.value.trim(),
            )
            .slice(0, 4)
            .map((m) =>
              Object.freeze({
                label: String(m.label).trim(),
                value: String(m.value).trim(),
                ...(typeof m.delta === 'string' && m.delta.trim()
                  ? { delta: m.delta.trim() }
                  : {}),
              }),
            );
        }
        if (Array.isArray(spec.sections)) {
          sections = spec.sections
            .filter((s) => s && (typeof s.heading === 'string' || typeof s.content === 'string'))
            .map((s, idx) => {
              const rawTable = s.table;
              let table: ParsedPdfTable | undefined;
              if (
                rawTable &&
                Array.isArray(rawTable.headers) &&
                rawTable.headers.length >= 2 &&
                Array.isArray(rawTable.rows) &&
                rawTable.rows.length > 0
              ) {
                const headers = rawTable.headers
                  .map((h) => String(h ?? '').trim())
                  .filter(Boolean);
                const rows = rawTable.rows
                  .filter((r) => Array.isArray(r))
                  .map((r) =>
                    Object.freeze(
                      Array.from({ length: headers.length }, (_, cIdx) =>
                        String(r[cIdx] ?? '').trim(),
                      ),
                    ),
                  );
                if (headers.length >= 2 && rows.length > 0) {
                  table = Object.freeze({
                    ...(typeof rawTable.caption === 'string' && rawTable.caption.trim()
                      ? { caption: rawTable.caption.trim() }
                      : {}),
                    headers: Object.freeze(headers),
                    rows: Object.freeze(rows),
                  });
                }
              }

              const chart = parseVectorChart(s.chart);

              return Object.freeze({
                sectionNumber: idx + 1,
                heading:
                  typeof s.heading === 'string' && s.heading.trim()
                    ? s.heading.trim()
                    : `Section ${idx + 1}`,
                content: typeof s.content === 'string' ? s.content.trim() : '',
                bullets: Object.freeze(
                  Array.isArray(s.bullets)
                    ? s.bullets.map((b) => String(b).trim()).filter(Boolean)
                    : [],
                ),
                ...(typeof s.callout === 'string' && s.callout.trim()
                  ? { callout: s.callout.trim() }
                  : {}),
                ...(table ? { table } : {}),
                ...(chart ? { chart } : {}),
              });
            });
        }
      }
    } catch {
      // Fall through to clean minimal document fallback
    }
  }

  if (sections.length === 0) {
    sections = [
      Object.freeze({
        sectionNumber: 1,
        heading: 'Document Ready for Download',
        content:
          'Your compiled %PDF-1.4 document binary is ready to inspect in Native PDF view or download directly.',
        bullets: Object.freeze([]),
      }),
    ];
  }

  return Object.freeze({
    title,
    subtitle,
    documentType,
    author,
    ...(generatedDate ? { generatedDate } : {}),
    ...(executiveSummary ? { executiveSummary } : {}),
    keyMetrics: Object.freeze(keyMetrics),
    sections: Object.freeze(sections),
    pageCount,
    footer,
  });
}

/**
 * Converts a parsed PDF document view-model into clean, copyable GitHub-Flavored Markdown
 * (including Executive Summary, KPI table, sections, bullets, callouts, and GFM tables).
 */
export function pdfDocumentSpecToMarkdown(doc: ParsedPdfDocumentViewModel): string {
  const lines: string[] = [`# ${doc.title}`, `*${doc.subtitle}*`, ''];

  const metaLine = [doc.author, doc.generatedDate, `${doc.pageCount} page(s)`]
    .filter(Boolean)
    .join(' · ');
  if (metaLine) {
    lines.push(`> ${metaLine}`, '');
  }

  if (doc.executiveSummary) {
    lines.push('## Executive Summary', '', doc.executiveSummary, '');
  }

  if (doc.keyMetrics.length > 0) {
    lines.push('## Key Metrics', '');
    lines.push('| Metric | Value | Note |');
    lines.push('| --- | --- | --- |');
    for (const m of doc.keyMetrics) {
      lines.push(`| ${m.label} | **${m.value}** | ${m.delta ?? ''} |`);
    }
    lines.push('');
  }

  for (const sec of doc.sections) {
    lines.push(`## ${sec.sectionNumber}. ${sec.heading}`, '');
    if (sec.content) {
      lines.push(sec.content, '');
    }
    if (sec.bullets.length > 0) {
      for (const b of sec.bullets) {
        lines.push(`- ${b}`);
      }
      lines.push('');
    }
    if (sec.callout) {
      lines.push(`> **Key Takeaway:** ${sec.callout}`, '');
    }
    if (sec.table) {
      if (sec.table.caption) {
        lines.push(`*${sec.table.caption}*`, '');
      }
      lines.push(`| ${sec.table.headers.join(' | ')} |`);
      lines.push(`| ${sec.table.headers.map(() => '---').join(' | ')} |`);
      for (const row of sec.table.rows) {
        lines.push(`| ${row.join(' | ')} |`);
      }
      lines.push('');
    }
    if (sec.chart && sec.chart.bars.length > 0) {
      if (sec.chart.title) {
        lines.push(`*${sec.chart.title}*`, '');
      }
      lines.push('| Label | Value |');
      lines.push('| --- | --- |');
      for (const bar of sec.chart.bars) {
        const val =
          bar.displayValue ??
          `${bar.value}${sec.chart.unit ? ` ${sec.chart.unit}` : ''}`;
        lines.push(`| ${bar.label} | ${val} |`);
      }
      lines.push('');
    }
  }

  lines.push(`---`, `*${doc.footer}*`);
  return lines.join('\n').trim();
}

/**
 * Converts an interactive (possibly user-edited) `ParsedPdfDocumentViewModel` back into a
 * `PdfDocumentSpec` payload for `POST /api/v1/artifacts/recompile`.
 */
export function pdfViewModelToCompileSpec(doc: ParsedPdfDocumentViewModel) {
  return {
    title: doc.title,
    subtitle: doc.subtitle,
    documentType: doc.documentType,
    author: doc.author,
    ...(doc.generatedDate ? { generatedDate: doc.generatedDate } : {}),
    ...(doc.executiveSummary ? { executiveSummary: doc.executiveSummary } : {}),
    ...(doc.keyMetrics.length > 0
      ? { keyMetrics: doc.keyMetrics.map((m) => ({ ...m })) }
      : {}),
    sections: doc.sections.map((sec) => ({
      heading: sec.heading,
      content: sec.content,
      bullets: [...sec.bullets],
      ...(sec.callout ? { callout: sec.callout } : {}),
      ...(sec.table
        ? {
            table: {
              ...(sec.table.caption ? { caption: sec.table.caption } : {}),
              headers: [...sec.table.headers],
              rows: sec.table.rows.map((r) => [...r]),
            },
          }
        : {}),
      ...(sec.chart
        ? {
            chart: {
              ...(sec.chart.title ? { title: sec.chart.title } : {}),
              ...(sec.chart.unit ? { unit: sec.chart.unit } : {}),
              bars: sec.chart.bars.map((b) => ({ ...b })),
            },
          }
        : {}),
    })),
    footer: doc.footer,
  };
}

export interface DocumentEvidenceSummary {
  readonly passageCount: number;
  readonly documentCount: number;
  readonly uniqueTitles: readonly string[];
  readonly label: string;
}

/**
 * Formats a hybrid RAG relevance score (`0..1`) as an integer match percentage (`0..100`),
 * returning `null` when score is absent or invalid.
 */
export function formatCitationRelevancePercent(score: number | undefined): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) {
    return null;
  }
  return Math.max(1, Math.min(100, Math.round(score * 100)));
}

/**
 * Summarizes grounded PDF RAG citations into passage count, unique document count, and compact display label.
 */
export function summarizeDocumentCitations(
  citations: ReadonlyArray<{ readonly title: string; readonly urlOrPage: string }>,
): DocumentEvidenceSummary {
  const uniqueTitles = Array.from(
    new Set(
      citations
        .map((c) => c.title.trim())
        .filter(Boolean),
    ),
  );
  const passageCount = citations.length;
  const documentCount = uniqueTitles.length;
  const passageLabel = `${passageCount} ${passageCount === 1 ? 'passage' : 'passages'}`;
  const docLabel = `${documentCount} ${documentCount === 1 ? 'document' : 'documents'}`;
  return Object.freeze({
    passageCount,
    documentCount,
    uniqueTitles: Object.freeze(uniqueTitles),
    label: `${passageLabel} · ${docLabel}`,
  });
}

/**
 * Builds the ownership-scoped raw binary streaming URL for an uploaded file
 * (`GET /api/v1/files/:fileId/raw`) used for inline image thumbnails and Lightbox inspection.
 */
export function buildUploadedFileRawUrl(fileId: string): string {
  return `/api/v1/files/${encodeURIComponent(fileId.trim())}/raw`;
}

/**
 * Formats an uploaded image's MIME type and byte size into a compact tabular metadata label
 * (e.g. `PNG · 42 KB`, `JPEG · 128 KB`, `WEBP · 64 KB`).
 */
export function formatImageFileBadge(mimeType: string, sizeBytes: number): string {
  const lower = mimeType.toLowerCase();
  const format =
    lower === 'image/jpeg' || lower === 'image/jpg'
      ? 'JPEG'
      : lower === 'image/webp'
        ? 'WEBP'
        : lower === 'image/png'
          ? 'PNG'
          : 'IMAGE';
  const kb = Math.max(1, Math.round(Math.max(0, sizeBytes) / 1024));
  return `${format} · ${kb} KB`;
}

export interface ParsedImageArtifactSpec {
  readonly originalPrompt: string;
  readonly enhancedPrompt: string;
  readonly styleLabel: string;
  readonly aspectRatio: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly resolutionLabel: string | null;
  readonly model: string;
  readonly isEdit: boolean;
  readonly referenceFilename?: string;
}

/**
 * Parses the `image-spec.json` manifest entry attached to a `generated_image` artifact
 * into a clean Studio view-model (resolution, aspect ratio, style label, art-directed prompt).
 */
export function parseImageArtifactSpec(
  rawSpecJson: string | undefined,
  fallbackTitle: string,
): ParsedImageArtifactSpec | null {
  if (!rawSpecJson || !rawSpecJson.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawSpecJson) as {
      originalPrompt?: unknown;
      enhancedPrompt?: unknown;
      styleLabel?: unknown;
      style?: unknown;
      aspectRatio?: unknown;
      width?: unknown;
      height?: unknown;
      model?: unknown;
      isEdit?: unknown;
      referenceFilename?: unknown;
    };
    const originalPrompt =
      typeof parsed.originalPrompt === 'string' && parsed.originalPrompt.trim()
        ? parsed.originalPrompt.trim()
        : fallbackTitle;
    const enhancedPrompt =
      typeof parsed.enhancedPrompt === 'string' && parsed.enhancedPrompt.trim()
        ? parsed.enhancedPrompt.trim()
        : originalPrompt;
    const styleLabel =
      typeof parsed.styleLabel === 'string' && parsed.styleLabel.trim()
        ? parsed.styleLabel.trim()
        : typeof parsed.style === 'string' && parsed.style.trim()
          ? parsed.style.trim()
          : 'Visual Artwork';
    const aspectRatio =
      typeof parsed.aspectRatio === 'string' && parsed.aspectRatio.trim()
        ? parsed.aspectRatio.trim()
        : '1:1';
    const width =
      typeof parsed.width === 'number' && Number.isFinite(parsed.width) && parsed.width > 0
        ? Math.trunc(parsed.width)
        : null;
    const height =
      typeof parsed.height === 'number' && Number.isFinite(parsed.height) && parsed.height > 0
        ? Math.trunc(parsed.height)
        : null;
    const resolutionLabel =
      width && height && (width > 1 || height > 1) ? `${width}×${height}` : null;
    const model =
      typeof parsed.model === 'string' && parsed.model.trim()
        ? parsed.model.trim()
        : 'gemini-3.1-flash-lite-image';
    const isEdit = Boolean(parsed.isEdit);
    const referenceFilename =
      typeof parsed.referenceFilename === 'string' && parsed.referenceFilename.trim()
        ? parsed.referenceFilename.trim()
        : undefined;

    return Object.freeze({
      originalPrompt,
      enhancedPrompt,
      styleLabel,
      aspectRatio,
      width,
      height,
      resolutionLabel,
      model,
      isEdit,
      ...(referenceFilename ? { referenceFilename } : {}),
    });
  } catch {
    return null;
  }
}
