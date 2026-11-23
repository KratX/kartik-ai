/**
 * @kartik/agent/agents/ppt — Keynote-Grade 16:9 OpenXML `.pptx` Compiler & Archetype Engine
 * (Blueprint §4.1, §7.2 Phase 10, Tutorial Part 2 & Fix #17).
 *
 * Generates:
 * 1. A validated 16:9 presentation deck (`Cover Slide` + `6 Layout-Varied Content Slides` + `Closing Slide`)
 *    classified across 6 presentation archetypes (`pitch_deck`, `technical_architecture`, `product_launch`,
 *    `executive_briefing`, `workshop_training`, `case_study`).
 * 2. A standards-compliant OpenXML `.pptx` ZIP archive (`PK\x03\x04`) containing:
 *    - `[Content_Types].xml`, `_rels/.rels`, `docProps/core.xml`, `docProps/app.xml`
 *    - `ppt/presentation.xml`, `ppt/_rels/presentation.xml.rels`
 *    - `ppt/theme/theme1.xml`, `ppt/slideMasters/slideMaster1.xml`, `ppt/slideLayouts/slideLayout1.xml`
 *    - Styled DrawingML slides (`ppt/slides/slide1.xml`..`slideN.xml`) with dark keynote backgrounds,
 *      archetype accent strips, KPI stat cards, two-column comparison panels, process step flows,
 *      spotlight callouts, and slide footers
 *    - Real PowerPoint Speaker Notes (`ppt/notesSlides/notesSlide1.xml`..`notesSlideN.xml`)
 * 3. Structured JSON slide metadata so the chat UI renders a 16:9 Interactive Presentation Studio.
 */

import {
  validatePptPresentationSpec,
  type PptDeckTheme,
  type PptPresentationSpec,
  type PptSlideSpec,
  type PptSurfaceMode,
  type VectorChartSpec,
} from '../../schemas/index.js';

export interface PptPresentationGenerationResult {
  readonly spec: PptPresentationSpec;
  readonly pptxBytes: Uint8Array;
  readonly slideCount: number;
  readonly summaryMarkdown: string;
  readonly tokensUsed: number;
}

export interface PptPresentationProvider {
  readonly providerName: string;
  generatePptPresentation(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
    readonly existingArtifactContext?: string;
    readonly signal?: AbortSignal;
  }): Promise<PptPresentationGenerationResult>;
}

interface PptThemePalette {
  readonly label: string;
  readonly canvasHex: string;
  readonly surfaceHex: string;
  readonly surfaceAltHex: string;
  readonly borderHex: string;
  readonly accentHex: string;
  readonly accentSoftHex: string;
  readonly textPrimaryHex: string;
  readonly textSecondaryHex: string;
  readonly textMutedHex: string;
}

const PPT_THEME_PALETTES: Readonly<Record<PptDeckTheme, PptThemePalette>> = {
  editorial_story: {
    label: 'Editorial Presentation',
    canvasHex: '0E0F14',
    surfaceHex: '171922',
    surfaceAltHex: '202330',
    borderHex: '32374A',
    accentHex: 'E2B96F',
    accentSoftHex: 'F3DBA8',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'E2E8F0',
    textMutedHex: '94A3B8',
  },
  educational_explainer: {
    label: 'Educational Explainer',
    canvasHex: '091418',
    surfaceHex: '112229',
    surfaceAltHex: '172E38',
    borderHex: '274854',
    accentHex: '14B8A6',
    accentSoftHex: '5EEAD4',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'D5F3F0',
    textMutedHex: '94A3B8',
  },
  creative_showcase: {
    label: 'Creative & Cultural Showcase',
    canvasHex: '150F12',
    surfaceHex: '21181C',
    surfaceAltHex: '2C2026',
    borderHex: '47343D',
    accentHex: 'FB7185',
    accentSoftHex: 'FDA4AF',
    textPrimaryHex: 'FDF8F6',
    textSecondaryHex: 'F1E2E5',
    textMutedHex: 'B89FA6',
  },
  pitch_deck: {
    label: 'Investor Pitch Deck',
    canvasHex: '0B1020',
    surfaceHex: '141B33',
    surfaceAltHex: '1A2342',
    borderHex: '2C3966',
    accentHex: '6366F1',
    accentSoftHex: 'A5B4FC',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'CBD5E1',
    textMutedHex: '94A3B8',
  },
  technical_architecture: {
    label: 'Technical Architecture',
    canvasHex: '09111E',
    surfaceHex: '111D30',
    surfaceAltHex: '162640',
    borderHex: '233B59',
    accentHex: '0EA5E9',
    accentSoftHex: '7DD3FC',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'CBD5E1',
    textMutedHex: '94A3B8',
  },
  product_launch: {
    label: 'Product Launch Keynote',
    canvasHex: '081414',
    surfaceHex: '102222',
    surfaceAltHex: '152E2D',
    borderHex: '214744',
    accentHex: '10B981',
    accentSoftHex: '6EE7B7',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'D1FAE5',
    textMutedHex: '94A3B8',
  },
  executive_briefing: {
    label: 'Executive Briefing',
    canvasHex: '101218',
    surfaceHex: '181C26',
    surfaceAltHex: '212635',
    borderHex: '353D52',
    accentHex: 'F59E0B',
    accentSoftHex: 'FCD34D',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'E2E8F0',
    textMutedHex: '94A3B8',
  },
  workshop_training: {
    label: 'Workshop & Training',
    canvasHex: '100D1E',
    surfaceHex: '1A1530',
    surfaceAltHex: '231C40',
    borderHex: '3A2E63',
    accentHex: 'A855F7',
    accentSoftHex: 'D8B4FE',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'E2E8F0',
    textMutedHex: '94A3B8',
  },
  case_study: {
    label: 'Case Study & Benchmark',
    canvasHex: '140D14',
    surfaceHex: '211521',
    surfaceAltHex: '2B1C2B',
    borderHex: '4A2E4A',
    accentHex: 'F43F5E',
    accentSoftHex: 'FDA4AF',
    textPrimaryHex: 'F8FAFC',
    textSecondaryHex: 'E2E8F0',
    textMutedHex: '94A3B8',
  },
};

/**
 * Classifies a user prompt into one of 9 presentation archetypes so visual themes and
 * narrative arcs match the actual domain — defaulting to domain-neutral `editorial_story`
 * instead of forcing `technical_architecture` onto non-technical subjects.
 */
export function classifyPptDeckTheme(prompt: string): PptDeckTheme {
  const lower = prompt.toLowerCase();
  if (
    /\b(pitch|startup|investor|series\s+[a-c]|seed\s+round|fundrais|venture|tam\b|sam\b|som\b|go[\s-]to[\s-]market|gtm)\b/.test(
      lower,
    )
  ) {
    return 'pitch_deck';
  }
  if (
    /\b(launch|keynote|product\s+roadmap|feature\s+release|v\d+\s+release|announcement|unveil)\b/.test(
      lower,
    )
  ) {
    return 'product_launch';
  }
  if (
    /\b(q[1-4]\b|qbr|board\s+deck|executive|strategy|quarterly|annual\s+review|financial|revenue|okr|leadership)\b/.test(
      lower,
    )
  ) {
    return 'executive_briefing';
  }
  if (
    /\b(workshop|training|tutorial|onboarding|bootcamp|handbook|hands[\s-]on)\b/.test(
      lower,
    )
  ) {
    return 'workshop_training';
  }
  if (
    /\b(case\s+study|benchmark|postmortem|retrospective|customer\s+story|research\s+findings|audit\s+results)\b/.test(
      lower,
    )
  ) {
    return 'case_study';
  }
  if (
    /\b(architecture|microservice|distributed\s+system|system\s+design|kubernetes|docker|cloud\s+infra|devops|api\s+gateway|database|postgresql|redis|backend|frontend|software\s+engineering|cybersecurity|zero[- ]trust|protocol|network\s+stack|ci\/cd|llm\s+pipeline)\b/.test(
      lower,
    )
  ) {
    return 'technical_architecture';
  }
  if (
    /\b(explain|how\s+.*\s+works|101|course|lecture|curriculum|class|school|science|physics|chemistry|biology|astronomy|space|black\s+hole|climate|psychology|neuroscience|economics|math|geography|ecology|history\s+lesson)\b/.test(
      lower,
    )
  ) {
    return 'educational_explainer';
  }
  if (
    /\b(art|cinema|film|movie|anime|ghibli|music|jazz|design|fashion|travel|city|food|coffee|cuisine|photography|literature|poetry|mythology|sports|culture|architecture\s+tour|museum|history|ancient|biography|story)\b/.test(
      lower,
    )
  ) {
    return 'creative_showcase';
  }
  return 'editorial_story';
}

/**
 * Extracts a requested content-slide count from natural language prompts
 * (e.g. "4 slides", "10-slide deck", "8 slide presentation"), clamped to [3, 10]
 * (which becomes 5..12 total slides including Cover + Closing). Defaults to 6.
 */
export function extractRequestedSlideCount(prompt: string): number {
  const match = /\b(\d{1,2})\s*[-]?\s*slides?\b/i.exec(prompt);
  if (!match) {
    return 6;
  }
  const parsed = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(parsed)) {
    return 6;
  }
  return Math.max(3, Math.min(10, parsed));
}

/**
 * Classifies whether the user requested a crisp light Paper & Ink deck surface or dark obsidian deck.
 */
export function classifyPptSurfaceMode(prompt: string): PptSurfaceMode {
  const lower = prompt.toLowerCase();
  if (
    /\b(light\s+theme|light\s+mode|minimal\s+white|paper\s+theme|white\s+background|bright\s+theme|editorial\s+light)\b/.test(
      lower,
    )
  ) {
    return 'light';
  }
  return 'dark';
}

function resolveEffectivePptPalette(
  theme: PptDeckTheme,
  surfaceMode: PptSurfaceMode = 'dark',
): PptThemePalette {
  const base = PPT_THEME_PALETTES[theme] ?? PPT_THEME_PALETTES.editorial_story;
  if (surfaceMode !== 'light') {
    return base;
  }
  return {
    label: base.label,
    canvasHex: 'FAFAFA',
    surfaceHex: 'FFFFFF',
    surfaceAltHex: 'F4F4F5',
    borderHex: 'D4D4D8',
    accentHex: base.accentHex,
    accentSoftHex: '18181B',
    textPrimaryHex: '18181B',
    textSecondaryHex: '3F3F46',
    textMutedHex: '71717A',
  };
}

/**
 * Builds a tailored system instruction for Gemini so generated slide decks follow an authentic
 * narrative arc matched to the user's real subject with layout variety, crisp copy, and speaker notes.
 */
export function buildPptSystemInstruction(
  theme: PptDeckTheme,
  todayIso: string,
  targetContentSlides: number = 6,
): string {
  const clampedSlides = Math.max(3, Math.min(10, Math.round(targetContentSlides)));
  const minDistinctLayouts = Math.min(4, Math.max(2, clampedSlides - 1));
  const themeGuides: Record<PptDeckTheme, string> = {
    editorial_story:
      'Follow a compelling, domain-authentic narrative arc tailored strictly to the user’s topic (e.g. Hook & Premise -> Essential Context/Key Facts -> Contrasting Perspectives -> Chronology/Journey -> Deeper Insights -> Memorable Takeaway). NEVER inject software engineering, cloud, or corporate buzzwords unless the topic itself is tech or business.',
    educational_explainer:
      'Follow an intuitive teaching arc: Big Question & Hook (spotlight) -> Key Numbers, Scale, or Core Facts (metrics) -> Intuitive Mental Model & Mechanics (bullets) -> Common Misconceptions vs Reality or Side-by-Side Comparison (two_column) -> Step-by-Step How It Works or Timeline (process) -> Real-World Impact & Recap.',
    creative_showcase:
      'Follow a vivid cultural/creative storytelling arc: Signature Hook & Thesis (spotlight) -> Iconic Milestones, Eras, or Notable Figures (metrics or process) -> Contrasting Styles, Influences, or Themes (two_column) -> Craft, Technique, or Evolution Journey (process) -> Standout Highlights (bullets) -> Lasting Legacy.',
    pitch_deck:
      'Follow a crisp investor narrative: Problem & Market Gap -> Product Solution -> Market Opportunity & Traction (metrics) -> Competitive Differentiation (two_column) -> Go-To-Market & Execution Plan (process) -> Financial Outlook & Ask (spotlight).',
    technical_architecture:
      'Follow a staff-engineer architecture arc: Problem & System Goals -> High-Level Architecture (bullets/spotlight) -> Performance & SLA Benchmarks (metrics) -> Trade-offs & Design Comparison (two_column) -> Request & Deployment Pipeline (process) -> Operational Guardrails & Next Steps.',
    product_launch:
      'Follow a keynote product launch arc: Customer Pain & Vision -> Introducing the Solution (spotlight) -> Key Capabilities & Impact (metrics) -> Before vs After Experience (two_column) -> Rollout Timeline (process) -> Adoption & Call to Action.',
    executive_briefing:
      'Follow a board-ready executive arc: Executive Context -> Headline KPIs & Performance (metrics) -> Strategic Trade-offs & Options (two_column) -> Execution Roadmap (process) -> Risk Controls & Governance -> Strategic Recommendation (spotlight).',
    workshop_training:
      'Follow a hands-on curriculum arc tailored strictly to the topic being taught: Learning Objectives -> Core Mental Model -> Common Pitfalls vs Best Practices (two_column) -> Step-by-Step Practice Workflow (process) -> Mastery Milestones (metrics) -> Key Takeaways & Practice Exercises (spotlight).',
    case_study:
      'Follow an evidence-first case study arc: Background & Challenge -> Measured Outcomes (metrics) -> Before vs After Comparison (two_column) -> Journey & Turning Points (process) -> Root Insight & Takeaway (spotlight) -> Lessons Learned.',
  };

  return [
    `You are Kartik.ai Presentation Director. Today's UTC date is ${todayIso}.`,
    `Presentation archetype: ${PPT_THEME_PALETTES[theme].label} (${theme}).`,
    themeGuides[theme],
    'DESIGN RULES:',
    '1. Stay 100% faithful to the user’s actual domain — NEVER force tech architecture, SaaS KPIs, or corporate rollout phases onto history, science, art, culture, lifestyle, or educational topics.',
    `2. Generate EXACTLY ${clampedSlides} content slides (Cover and Closing slides are compiled automatically — do NOT include Cover or Thank You slides in the slides array).`,
    `3. Vary slide layouts naturally across the ${clampedSlides} content slides using at least ${minDistinctLayouts} distinct layouts from: "spotlight", "metrics", "two_column", "process", "bullets".`,
    '4. Keep every slide concise and presentation-ready: 3–4 short scannable bullets (max 14 words each), never dense paragraphs.',
    '5. When layout="metrics", provide 3–4 topic-authentic stat/fact/date cards ({ label, value, delta }) — e.g. historical dates, scientific measurements, notable counts, or business KPIs depending on the topic.',
    '6. When layout="two_column", provide exactly 2 natural contrasting columns ({ heading, points[3] }) fitting the topic (e.g. two eras, two schools of thought, myths vs facts, pros vs cons, or two options).',
    '7. When layout="process", provide 3–4 ordered stages/steps/eras ({ step: "01", title, detail }) fitting the topic (e.g. chronological eras, how-to steps, lifecycle stages, or milestones).',
    '8. When layout="spotlight", provide a punchy `callout` thesis or quote plus 3 supporting `bullets`.',
    '9. On 1 slide where quantitative comparison illuminates the topic, you may include an optional `chart` ({ title, unit, bars: [{ label, value, displayValue }] } with 3–5 bars).',
    '10. Include concise, natural presenter `speakerNotes` (2–3 sentences) on EVERY content slide.',
  ].join(' ');
}

/**
 * Generates 3 contextual, domain-aware presentation follow-up prompts shown as clickable chips under the deck.
 */
export function buildPptFollowUps(
  spec: PptPresentationSpec,
  originalPrompt: string,
): readonly string[] {
  const topic = (spec.title || originalPrompt).trim().slice(0, 56);
  const theme = spec.theme ?? 'editorial_story';
  if (theme === 'pitch_deck') {
    return Object.freeze([
      `Create a 6-slide investor Q&A appendix deck addressing risks and unit economics for ${topic}`,
      `Build a product launch keynote deck showcasing customer workflows for ${topic}`,
      `Compile a 6-slide quarterly executive board update deck tracking KPIs for ${topic}`,
    ]);
  }
  if (theme === 'executive_briefing') {
    return Object.freeze([
      `Build a 6-slide execution roadmap and team workshop deck for ${topic}`,
      `Create a case study and ROI benchmark deck supporting ${topic}`,
      `Compile a concise companion executive brief PDF summarizing ${topic}`,
    ]);
  }
  if (theme === 'technical_architecture') {
    return Object.freeze([
      `Create an executive briefing deck with ROI KPIs and rollout timeline for ${topic}`,
      `Build a hands-on engineering workshop presentation teaching ${topic}`,
      `Create a case study and performance benchmark deck comparing options for ${topic}`,
    ]);
  }
  if (theme === 'educational_explainer' || theme === 'workshop_training') {
    return Object.freeze([
      `Create a 6-slide visual deep-dive with real-world examples and quiz questions for ${topic}`,
      `Compile a matching printable study guide PDF summarizing ${topic}`,
      `Build a myths-vs-facts comparison presentation exploring ${topic}`,
    ]);
  }
  if (theme === 'creative_showcase') {
    return Object.freeze([
      `Create a 6-slide chronological timeline presentation tracing the evolution of ${topic}`,
      `Build a behind-the-scenes craft and signature influences deck on ${topic}`,
      `Compile an editorial companion guide PDF expanding on ${topic}`,
    ]);
  }
  return Object.freeze([
    `Create a 6-slide deeper comparison deck exploring contrasting perspectives on ${topic}`,
    `Build a step-by-step visual timeline presentation covering key milestones of ${topic}`,
    `Compile a structured companion PDF guide expanding on ${topic}`,
  ]);
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Standard CRC-32 calculation for ZIP local and central directory headers.
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

interface ZipEntryInput {
  readonly path: string;
  readonly content: Buffer;
}

/**
 * Packs files into a standards-compliant uncompressed ZIP archive (`PK\x03\x04`)
 * used by OpenXML `.pptx` containers.
 */
function buildUncompressedZipArchive(entries: readonly ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.path, 'utf8');
    const dataBuf = entry.content;
    const crc = crc32(dataBuf);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0x5800, 10);
    localHeader.writeUInt16LE(0x5d6c, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(dataBuf.length, 18);
    localHeader.writeUInt32LE(dataBuf.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0x5800, 12);
    centralHeader.writeUInt16LE(0x5d6c, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

interface ParagraphSpec {
  readonly text: string;
  readonly sizePt: number;
  readonly colorHex: string;
  readonly bold?: boolean;
  readonly italic?: boolean;
  readonly align?: 'l' | 'ctr' | 'r';
  readonly spaceAfterPt?: number;
}

function buildParagraphXml(p: ParagraphSpec): string {
  const sz = Math.round(p.sizePt * 100);
  const attrs = [
    'lang="en-US"',
    `sz="${sz}"`,
    p.bold ? 'b="1"' : '',
    p.italic ? 'i="1"' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const pPrParts: string[] = [];
  if (p.align) {
    pPrParts.push(`algn="${p.align}"`);
  }
  const spcAftXml =
    typeof p.spaceAfterPt === 'number' && p.spaceAfterPt > 0
      ? `<a:spcAft><a:spcPts val="${Math.round(p.spaceAfterPt * 100)}"/></a:spcAft>`
      : '';
  const pPrXml =
    pPrParts.length > 0 || spcAftXml
      ? `<a:pPr${pPrParts.length > 0 ? ` ${pPrParts.join(' ')}` : ''}>${spcAftXml}</a:pPr>`
      : '';

  return `<a:p>${pPrXml}<a:r><a:rPr ${attrs}><a:solidFill><a:srgbClr val="${p.colorHex}"/></a:solidFill><a:latin typeface="Calibri"/></a:rPr><a:t>${escapeXml(p.text)}</a:t></a:r></a:p>`;
}

interface ShapeBoxSpec {
  readonly id: number;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly cx: number;
  readonly cy: number;
  readonly preset?: 'rect' | 'roundRect';
  readonly fillHex?: string;
  readonly borderHex?: string;
  readonly borderWidthEmu?: number;
  readonly anchor?: 't' | 'ctr' | 'b';
  readonly padX?: number;
  readonly padY?: number;
  readonly paragraphs?: readonly ParagraphSpec[];
}

function buildShapeXml(box: ShapeBoxSpec): string {
  const fillXml = box.fillHex
    ? `<a:solidFill><a:srgbClr val="${box.fillHex}"/></a:solidFill>`
    : '<a:noFill/>';
  const lineXml = box.borderHex
    ? `<a:ln w="${box.borderWidthEmu ?? 12700}"><a:solidFill><a:srgbClr val="${box.borderHex}"/></a:solidFill></a:ln>`
    : '<a:ln><a:noFill/></a:ln>';
  const prst = box.preset ?? 'rect';
  const hasText = Boolean(box.paragraphs && box.paragraphs.length > 0);
  const padX = box.padX ?? 137160; // ~0.15 in
  const padY = box.padY ?? 91440; // ~0.10 in

  const txBodyXml = hasText
    ? [
        '<p:txBody>',
        `<a:bodyPr wrap="square" lIns="${padX}" rIns="${padX}" tIns="${padY}" bIns="${padY}" anchor="${box.anchor ?? 't'}"/>`,
        '<a:lstStyle/>',
        ...box.paragraphs!.map(buildParagraphXml),
        '</p:txBody>',
      ].join('')
    : '<p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody>';

  return [
    '<p:sp>',
    `<p:nvSpPr><p:cNvPr id="${box.id}" name="${escapeXml(box.name)}"/><p:cNvSpPr${hasText ? ' txBox="1"' : ''}/><p:nvPr/></p:nvSpPr>`,
    `<p:spPr><a:xfrm><a:off x="${Math.round(box.x)}" y="${Math.round(box.y)}"/><a:ext cx="${Math.round(box.cx)}" cy="${Math.round(box.cy)}"/></a:xfrm><a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fillXml}${lineXml}</p:spPr>`,
    txBodyXml,
    '</p:sp>',
  ].join('');
}

const SLIDE_W = 12_192_000; // 13.333 in
const SLIDE_H = 6_858_000; // 7.5 in
const MARGIN_X = 640_000; // ~0.7 in
const CONTENT_W = SLIDE_W - MARGIN_X * 2; // 10,912,000 EMU

function buildSlideXml(
  slide: PptSlideSpec,
  spec: PptPresentationSpec,
  totalSlides: number,
  palette: PptThemePalette,
): string {
  let nextShapeId = 2;
  const shapes: string[] = [];
  const pushShape = (box: Omit<ShapeBoxSpec, 'id'>) => {
    shapes.push(buildShapeXml({ ...box, id: nextShapeId++ }));
  };

  const footerLabel = spec.footer || 'Generated by Kartik.ai';

  // Top hairline accent strip across full width
  pushShape({
    name: 'TopAccentBar',
    x: 0,
    y: 0,
    cx: SLIDE_W,
    cy: 72_000,
    fillHex: palette.accentHex,
  });

  if (slide.kind === 'cover') {
    // Editorial cover layout
    pushShape({
      name: 'CoverKicker',
      x: MARGIN_X,
      y: 1_050_000,
      cx: CONTENT_W,
      cy: 340_000,
      padX: 0,
      padY: 0,
      paragraphs: [
        {
          text: palette.label.toUpperCase(),
          sizePt: 12,
          colorHex: palette.accentSoftHex,
          bold: true,
        },
      ],
    });

    pushShape({
      name: 'CoverTitle',
      x: MARGIN_X,
      y: 1_450_000,
      cx: CONTENT_W,
      cy: 1_900_000,
      padX: 0,
      padY: 0,
      paragraphs: [
        {
          text: slide.title,
          sizePt: 40,
          colorHex: palette.textPrimaryHex,
          bold: true,
          spaceAfterPt: 14,
        },
        ...(slide.subtitle
          ? [
              {
                text: slide.subtitle,
                sizePt: 20,
                colorHex: palette.textSecondaryHex,
                italic: false,
              },
            ]
          : []),
      ],
    });

    // Horizontal accent rule
    pushShape({
      name: 'CoverRule',
      x: MARGIN_X,
      y: 3_950_000,
      cx: 2_200_000,
      cy: 42_000,
      fillHex: palette.accentHex,
    });

    // Metadata strip
    const metaLines = [
      `${totalSlides} Slides · 16:9 Widescreen`,
      [spec.author, spec.generatedDate, footerLabel].filter(Boolean).join(' · '),
    ];
    pushShape({
      name: 'CoverMeta',
      x: MARGIN_X,
      y: 4_250_000,
      cx: CONTENT_W,
      cy: 900_000,
      padX: 0,
      padY: 0,
      paragraphs: metaLines.map((line, i) => ({
        text: line,
        sizePt: i === 0 ? 14 : 12,
        colorHex: i === 0 ? palette.textSecondaryHex : palette.textMutedHex,
        spaceAfterPt: 6,
      })),
    });
  } else if (slide.kind === 'thank_you') {
    pushShape({
      name: 'ClosingCard',
      x: MARGIN_X,
      y: 1_450_000,
      cx: CONTENT_W,
      cy: 3_750_000,
      preset: 'roundRect',
      fillHex: palette.surfaceHex,
      borderHex: palette.borderHex,
      anchor: 'ctr',
      padX: 480_000,
      padY: 360_000,
      paragraphs: [
        {
          text: 'CLOSING SUMMARY',
          sizePt: 12,
          colorHex: palette.accentSoftHex,
          bold: true,
          align: 'ctr',
          spaceAfterPt: 14,
        },
        {
          text: slide.title,
          sizePt: 40,
          colorHex: palette.textPrimaryHex,
          bold: true,
          align: 'ctr',
          spaceAfterPt: 12,
        },
        ...(slide.subtitle
          ? [
              {
                text: slide.subtitle,
                sizePt: 20,
                colorHex: palette.textSecondaryHex,
                align: 'ctr' as const,
                spaceAfterPt: 20,
              },
            ]
          : []),
        ...slide.bullets.map((b) => ({
          text: b,
          sizePt: 13,
          colorHex: palette.textMutedHex,
          align: 'ctr' as const,
          spaceAfterPt: 6,
        })),
      ],
    });
  } else {
    // Content Slide Header Zone
    const kickerText =
      slide.kicker ||
      `${palette.label} · Module ${String(slide.slideNumber - 1).padStart(2, '0')}`;
    pushShape({
      name: 'SlideKicker',
      x: MARGIN_X,
      y: 260_000,
      cx: CONTENT_W - 1_800_000,
      cy: 260_000,
      padX: 0,
      padY: 0,
      paragraphs: [
        {
          text: kickerText,
          sizePt: 11,
          colorHex: palette.accentSoftHex,
          bold: true,
        },
      ],
    });

    pushShape({
      name: 'SlideCounter',
      x: SLIDE_W - MARGIN_X - 1_700_000,
      y: 260_000,
      cx: 1_700_000,
      cy: 260_000,
      padX: 0,
      padY: 0,
      paragraphs: [
        {
          text: `${String(slide.slideNumber).padStart(2, '0')} / ${String(totalSlides).padStart(2, '0')}`,
          sizePt: 11,
          colorHex: palette.textMutedHex,
          align: 'r',
        },
      ],
    });

    pushShape({
      name: 'SlideTitle',
      x: MARGIN_X,
      y: 540_000,
      cx: CONTENT_W,
      cy: slide.subtitle ? 960_000 : 620_000,
      padX: 0,
      padY: 0,
      paragraphs: [
        {
          text: slide.title,
          sizePt: 28,
          colorHex: palette.textPrimaryHex,
          bold: true,
          spaceAfterPt: 6,
        },
        ...(slide.subtitle
          ? [
              {
                text: slide.subtitle,
                sizePt: 14,
                colorHex: palette.textSecondaryHex,
              },
            ]
          : []),
      ],
    });

    // Subtle header divider
    pushShape({
      name: 'HeaderDivider',
      x: MARGIN_X,
      y: 1_560_000,
      cx: CONTENT_W,
      cy: 16_000,
      fillHex: palette.borderHex,
    });

    const bodyTop = 1_780_000;
    const bodyBottom = 6_120_000;
    const bodyH = bodyBottom - bodyTop;
    const layout = slide.layout ?? 'bullets';

    if (layout === 'metrics' && slide.metrics && slide.metrics.length >= 2) {
      const count = Math.min(4, slide.metrics.length);
      const gap = 220_000;
      const cardW = Math.floor((CONTENT_W - gap * (count - 1)) / count);
      const cardH = 1_850_000;

      slide.metrics.slice(0, count).forEach((m, idx) => {
        const cardX = MARGIN_X + idx * (cardW + gap);
        pushShape({
          name: `MetricCard_${idx + 1}`,
          x: cardX,
          y: bodyTop,
          cx: cardW,
          cy: cardH,
          preset: 'roundRect',
          fillHex: palette.surfaceHex,
          borderHex: palette.borderHex,
          anchor: 'ctr',
          padX: 200_000,
          padY: 180_000,
          paragraphs: [
            {
              text: m.label,
              sizePt: 11,
              colorHex: palette.textMutedHex,
              bold: true,
              spaceAfterPt: 10,
            },
            {
              text: m.value,
              sizePt: 28,
              colorHex: palette.accentSoftHex,
              bold: true,
              spaceAfterPt: 8,
            },
            ...(m.delta
              ? [
                  {
                    text: m.delta,
                    sizePt: 12,
                    colorHex: palette.textSecondaryHex,
                  },
                ]
              : []),
          ],
        });
      });

      // Supporting bullet strip underneath KPIs
      if (slide.bullets.length > 0) {
        pushShape({
          name: 'MetricsSummaryBullets',
          x: MARGIN_X,
          y: bodyTop + cardH + 280_000,
          cx: CONTENT_W,
          cy: bodyH - cardH - 280_000,
          preset: 'roundRect',
          fillHex: palette.surfaceAltHex,
          borderHex: palette.borderHex,
          padX: 260_000,
          padY: 200_000,
          paragraphs: slide.bullets.slice(0, 4).map((b) => ({
            text: `▪  ${b}`,
            sizePt: 14,
            colorHex: palette.textSecondaryHex,
            spaceAfterPt: 10,
          })),
        });
      }
    } else if (layout === 'two_column' && slide.columns && slide.columns.length === 2) {
      const gap = 300_000;
      const colW = Math.floor((CONTENT_W - gap) / 2);
      const colH = slide.callout ? bodyH - 960_000 : bodyH;

      slide.columns.forEach((col, idx) => {
        const colX = MARGIN_X + idx * (colW + gap);
        pushShape({
          name: `ColumnCard_${idx + 1}`,
          x: colX,
          y: bodyTop,
          cx: colW,
          cy: colH,
          preset: 'roundRect',
          fillHex: idx === 0 ? palette.surfaceHex : palette.surfaceAltHex,
          borderHex: idx === 1 ? palette.accentHex : palette.borderHex,
          padX: 260_000,
          padY: 220_000,
          paragraphs: [
            {
              text: col.heading,
              sizePt: 17,
              colorHex: idx === 1 ? palette.accentSoftHex : palette.textPrimaryHex,
              bold: true,
              spaceAfterPt: 14,
            },
            ...col.points.map((pt) => ({
              text: `▪  ${pt}`,
              sizePt: 14,
              colorHex: palette.textSecondaryHex,
              spaceAfterPt: 10,
            })),
          ],
        });
      });

      if (slide.callout) {
        pushShape({
          name: 'ColumnCallout',
          x: MARGIN_X,
          y: bodyBottom - 760_000,
          cx: CONTENT_W,
          cy: 760_000,
          preset: 'roundRect',
          fillHex: palette.surfaceHex,
          borderHex: palette.accentHex,
          anchor: 'ctr',
          padX: 240_000,
          padY: 120_000,
          paragraphs: [
            {
              text: `Key Takeaway: ${slide.callout}`,
              sizePt: 13,
              colorHex: palette.textPrimaryHex,
              bold: true,
            },
          ],
        });
      }
    } else if (layout === 'process' && slide.steps && slide.steps.length >= 2) {
      const count = Math.min(4, slide.steps.length);
      const gap = 200_000;
      const stepW = Math.floor((CONTENT_W - gap * (count - 1)) / count);
      const stepH = slide.callout ? 2_900_000 : 3_500_000;

      slide.steps.slice(0, count).forEach((st, idx) => {
        const stepX = MARGIN_X + idx * (stepW + gap);
        pushShape({
          name: `StepCard_${idx + 1}`,
          x: stepX,
          y: bodyTop,
          cx: stepW,
          cy: stepH,
          preset: 'roundRect',
          fillHex: palette.surfaceHex,
          borderHex: palette.borderHex,
          padX: 200_000,
          padY: 200_000,
          paragraphs: [
            {
              text: `STEP ${st.step}`,
              sizePt: 11,
              colorHex: palette.accentSoftHex,
              bold: true,
              spaceAfterPt: 10,
            },
            {
              text: st.title,
              sizePt: 16,
              colorHex: palette.textPrimaryHex,
              bold: true,
              spaceAfterPt: 10,
            },
            {
              text: st.detail,
              sizePt: 13,
              colorHex: palette.textSecondaryHex,
            },
          ],
        });
      });

      if (slide.callout) {
        pushShape({
          name: 'ProcessTakeaway',
          x: MARGIN_X,
          y: bodyTop + stepH + 260_000,
          cx: CONTENT_W,
          cy: 900_000,
          preset: 'roundRect',
          fillHex: palette.surfaceAltHex,
          borderHex: palette.accentHex,
          anchor: 'ctr',
          padX: 240_000,
          padY: 140_000,
          paragraphs: [
            {
              text: `Execution Outcome: ${slide.callout}`,
              sizePt: 13,
              colorHex: palette.textPrimaryHex,
              bold: true,
            },
          ],
        });
      }
    } else if (layout === 'spotlight' && slide.callout) {
      const leftW = Math.floor(CONTENT_W * 0.48);
      const gap = 300_000;
      const rightW = CONTENT_W - leftW - gap;

      pushShape({
        name: 'SpotlightThesis',
        x: MARGIN_X,
        y: bodyTop,
        cx: leftW,
        cy: bodyH,
        preset: 'roundRect',
        fillHex: palette.surfaceAltHex,
        borderHex: palette.accentHex,
        borderWidthEmu: 19050,
        anchor: 'ctr',
        padX: 300_000,
        padY: 260_000,
        paragraphs: [
          {
            text: 'CORE THESIS',
            sizePt: 11,
            colorHex: palette.accentSoftHex,
            bold: true,
            spaceAfterPt: 12,
          },
          {
            text: `“${slide.callout}”`,
            sizePt: 20,
            colorHex: palette.textPrimaryHex,
            bold: true,
          },
        ],
      });

      pushShape({
        name: 'SpotlightProof',
        x: MARGIN_X + leftW + gap,
        y: bodyTop,
        cx: rightW,
        cy: bodyH,
        preset: 'roundRect',
        fillHex: palette.surfaceHex,
        borderHex: palette.borderHex,
        padX: 280_000,
        padY: 260_000,
        paragraphs: [
          {
            text: 'SUPPORTING EVIDENCE',
            sizePt: 11,
            colorHex: palette.textMutedHex,
            bold: true,
            spaceAfterPt: 14,
          },
          ...slide.bullets.slice(0, 4).map((b) => ({
            text: `▪  ${b}`,
            sizePt: 15,
            colorHex: palette.textSecondaryHex,
            spaceAfterPt: 14,
          })),
        ],
      });
    } else {
      // Standard editorial bullets layout + optional vector chart or takeaway card
      const renderChartBlock = (chart: VectorChartSpec, boxY: number, boxH: number) => {
        pushShape({
          name: 'ChartCard',
          x: MARGIN_X,
          y: boxY,
          cx: CONTENT_W,
          cy: boxH,
          preset: 'roundRect',
          fillHex: palette.surfaceAltHex,
          borderHex: palette.borderHex,
          padX: 240_000,
          padY: 140_000,
          paragraphs: chart.title
            ? [
                {
                  text:
                    chart.unit && !chart.title.toLowerCase().includes(chart.unit.toLowerCase())
                      ? `${chart.title} (${chart.unit})`
                      : chart.title,
                  sizePt: 12,
                  colorHex: palette.accentSoftHex,
                  bold: true,
                },
              ]
            : undefined,
        });
        const bars = chart.bars.slice(0, 5);
        const maxVal = Math.max(1, ...bars.map((b) => b.value));
        const innerTop = boxY + (chart.title ? 460_000 : 180_000);
        const availH = Math.max(600_000, boxH - (chart.title ? 580_000 : 300_000));
        const rowH = Math.floor(availH / Math.max(1, bars.length));
        const labelW = 2_600_000;
        const valW = 1_300_000;
        const trackX = MARGIN_X + labelW + 240_000;
        const trackW = CONTENT_W - labelW - valW - 600_000;

        bars.forEach((bar, bIdx) => {
          const rY = innerTop + bIdx * rowH;
          const barH = Math.min(200_000, Math.max(120_000, Math.floor(rowH * 0.52)));
          pushShape({
            name: `ChartLabel_${bIdx + 1}`,
            x: MARGIN_X + 200_000,
            y: rY,
            cx: labelW,
            cy: rowH,
            padX: 0,
            padY: 0,
            anchor: 'ctr',
            paragraphs: [
              {
                text: bar.label,
                sizePt: 11,
                colorHex: palette.textSecondaryHex,
                bold: true,
              },
            ],
          });
          pushShape({
            name: `ChartTrack_${bIdx + 1}`,
            x: trackX,
            y: rY + Math.floor((rowH - barH) / 2),
            cx: trackW,
            cy: barH,
            preset: 'roundRect',
            fillHex: palette.surfaceHex,
            borderHex: palette.borderHex,
          });
          const ratio = Math.max(0.05, Math.min(1, bar.value / maxVal));
          pushShape({
            name: `ChartBar_${bIdx + 1}`,
            x: trackX,
            y: rY + Math.floor((rowH - barH) / 2),
            cx: Math.max(180_000, Math.floor(trackW * ratio)),
            cy: barH,
            preset: 'roundRect',
            fillHex: palette.accentHex,
          });
          pushShape({
            name: `ChartVal_${bIdx + 1}`,
            x: trackX + trackW + 120_000,
            y: rY,
            cx: valW,
            cy: rowH,
            padX: 0,
            padY: 0,
            anchor: 'ctr',
            paragraphs: [
              {
                text: bar.displayValue || `${bar.value}${chart.unit ? ` ${chart.unit}` : ''}`,
                sizePt: 11,
                colorHex: palette.textPrimaryHex,
                bold: true,
              },
            ],
          });
        });
      };

      if (slide.chart && slide.chart.bars.length >= 2) {
        const bulletsH = Math.floor(bodyH * 0.44);
        const chartH = bodyH - bulletsH - 220_000;
        pushShape({
          name: 'BulletsCard',
          x: MARGIN_X,
          y: bodyTop,
          cx: CONTENT_W,
          cy: bulletsH,
          preset: 'roundRect',
          fillHex: palette.surfaceHex,
          borderHex: palette.borderHex,
          padX: 280_000,
          padY: 180_000,
          paragraphs: slide.bullets.slice(0, 4).map((b, i) => ({
            text: `${String(i + 1).padStart(2, '0')}   ${b}`,
            sizePt: 14,
            colorHex: palette.textPrimaryHex,
            spaceAfterPt: 10,
          })),
        });
        renderChartBlock(slide.chart, bodyTop + bulletsH + 220_000, chartH);
      } else {
        const bulletsH = slide.callout ? bodyH - 1_050_000 : bodyH;
        pushShape({
          name: 'BulletsCard',
          x: MARGIN_X,
          y: bodyTop,
          cx: CONTENT_W,
          cy: bulletsH,
          preset: 'roundRect',
          fillHex: palette.surfaceHex,
          borderHex: palette.borderHex,
          padX: 300_000,
          padY: 240_000,
          paragraphs: slide.bullets.slice(0, 6).map((b, i) => ({
            text: `${String(i + 1).padStart(2, '0')}   ${b}`,
            sizePt: 16,
            colorHex: palette.textPrimaryHex,
            spaceAfterPt: 14,
          })),
        });

        if (slide.callout) {
          pushShape({
            name: 'BulletsTakeaway',
            x: MARGIN_X,
            y: bodyBottom - 840_000,
            cx: CONTENT_W,
            cy: 840_000,
            preset: 'roundRect',
            fillHex: palette.surfaceAltHex,
            borderHex: palette.accentHex,
            anchor: 'ctr',
            padX: 260_000,
            padY: 140_000,
            paragraphs: [
              {
                text: `Key Takeaway: ${slide.callout}`,
                sizePt: 13,
                colorHex: palette.accentSoftHex,
                bold: true,
              },
            ],
          });
        }
      }
    }
  }

  // Bottom footer bar across all slides
  pushShape({
    name: 'SlideFooter',
    x: MARGIN_X,
    y: 6_340_000,
    cx: CONTENT_W,
    cy: 300_000,
    padX: 0,
    padY: 0,
    paragraphs: [
      {
        text: `${footerLabel}  ·  ${spec.title}  ·  Slide ${slide.slideNumber} of ${totalSlides}`,
        sizePt: 10,
        colorHex: palette.textMutedHex,
      },
    ],
  });

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '  <p:cSld>',
    `    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${palette.canvasHex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`,
    '    <p:spTree>',
    '      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    ...shapes.map((s) => `      ${s}`),
    '    </p:spTree>',
    '  </p:cSld>',
    '  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
    '</p:sld>',
  ].join('\n');
}

function buildNotesSlideXml(slide: PptSlideSpec): string {
  const noteText =
    slide.speakerNotes?.trim() ||
    `Slide ${slide.slideNumber}: ${slide.title}. ${slide.bullets.slice(0, 2).join(' ')}`;

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '  <p:cSld>',
    '    <p:spTree>',
    '      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    '      <p:sp>',
    '        <p:nvSpPr><p:cNvPr id="2" name="Notes Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>',
    '        <p:spPr/>',
    '        <p:txBody>',
    '          <a:bodyPr/>',
    '          <a:lstStyle/>',
    `          <a:p><a:r><a:rPr lang="en-US" sz="1200"/><a:t>${escapeXml(noteText)}</a:t></a:r></a:p>`,
    '        </p:txBody>',
    '      </p:sp>',
    '    </p:spTree>',
    '  </p:cSld>',
    '  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
    '</p:notes>',
  ].join('\n');
}

function buildThemeXml(palette: PptThemePalette): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Kartik.ai Keynote Theme">',
    '  <a:themeElements>',
    '    <a:clrScheme name="KartikKeynote">',
    `      <a:dk1><a:srgbClr val="${palette.canvasHex}"/></a:dk1>`,
    `      <a:lt1><a:srgbClr val="${palette.textPrimaryHex}"/></a:lt1>`,
    `      <a:dk2><a:srgbClr val="${palette.surfaceHex}"/></a:dk2>`,
    `      <a:lt2><a:srgbClr val="${palette.textSecondaryHex}"/></a:lt2>`,
    `      <a:accent1><a:srgbClr val="${palette.accentHex}"/></a:accent1>`,
    `      <a:accent2><a:srgbClr val="${palette.accentSoftHex}"/></a:accent2>`,
    '      <a:accent3><a:srgbClr val="10B981"/></a:accent3>',
    '      <a:accent4><a:srgbClr val="F59E0B"/></a:accent4>',
    '      <a:accent5><a:srgbClr val="6366F1"/></a:accent5>',
    '      <a:accent6><a:srgbClr val="F43F5E"/></a:accent6>',
    `      <a:hlink><a:srgbClr val="${palette.accentSoftHex}"/></a:hlink>`,
    `      <a:folHlink><a:srgbClr val="${palette.textMutedHex}"/></a:folHlink>`,
    '    </a:clrScheme>',
    '    <a:fontScheme name="KartikSans">',
    '      <a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>',
    '      <a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>',
    '    </a:fontScheme>',
    '    <a:fmtScheme name="KartikFormat">',
    '      <a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>',
    '      <a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>',
    '      <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>',
    '      <a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>',
    '    </a:fmtScheme>',
    '  </a:themeElements>',
    '</a:theme>',
  ].join('\n');
}

function buildSlideMasterXml(palette: PptThemePalette): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '  <p:cSld>',
    `    <p:bg><p:bgPr><a:solidFill><a:srgbClr val="${palette.canvasHex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`,
    '    <p:spTree>',
    '      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    '    </p:spTree>',
    '  </p:cSld>',
    '  <p:clrMap bg1="dk1" tx1="lt1" bg2="dk2" tx2="lt2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>',
    '  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>',
    '</p:sldMaster>',
  ].join('\n');
}

function buildSlideLayoutXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">',
    '  <p:cSld name="Blank">',
    '    <p:spTree>',
    '      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>',
    '      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>',
    '    </p:spTree>',
    '  </p:cSld>',
    '  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>',
    '</p:sldLayout>',
  ].join('\n');
}

function buildCorePropsXml(spec: PptPresentationSpec): string {
  const isoTimestamp = `${spec.generatedDate && /^\d{4}-\d{2}-\d{2}$/.test(spec.generatedDate) ? spec.generatedDate : new Date().toISOString().slice(0, 10)}T00:00:00Z`;
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    `  <dc:title>${escapeXml(spec.title)}</dc:title>`,
    `  <dc:subject>${escapeXml(spec.subtitle)}</dc:subject>`,
    `  <dc:creator>${escapeXml(spec.author || 'Kartik.ai Presentation Engine')}</dc:creator>`,
    `  <dcterms:created xsi:type="dcterms:W3CDTF">${isoTimestamp}</dcterms:created>`,
    `  <dcterms:modified xsi:type="dcterms:W3CDTF">${isoTimestamp}</dcterms:modified>`,
    '</cp:coreProperties>',
  ].join('\n');
}

function buildAppPropsXml(slideCount: number): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">',
    '  <Application>Kartik.ai Presentation Engine</Application>',
    '  <PresentationFormat>On-screen Show (16:9)</PresentationFormat>',
    `  <Slides>${slideCount}</Slides>`,
    `  <Notes>${slideCount}</Notes>`,
    '</Properties>',
  ].join('\n');
}

/**
 * Compiles a validated `PptPresentationSpec` into a standards-compliant OpenXML `.pptx`
 * binary buffer (`PK\x03\x04`) with SlideMaster, SlideLayout, Theme, multi-shape DrawingML
 * layouts, and PowerPoint Speaker Notes.
 */
export function buildPptxBinaryBuffer(rawSpec: PptPresentationSpec): {
  readonly pptxBytes: Buffer;
  readonly slideCount: number;
  readonly spec: PptPresentationSpec;
} {
  const spec = validatePptPresentationSpec(rawSpec);
  const slides = spec.slides;
  const palette = resolveEffectivePptPalette(
    spec.theme ?? 'editorial_story',
    spec.surfaceMode ?? 'dark',
  );

  const slideOverrides = slides
    .map(
      (_, idx) =>
        `  <Override PartName="/ppt/slides/slide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join('\n');

  const notesOverrides = slides
    .map(
      (_, idx) =>
        `  <Override PartName="/ppt/notesSlides/notesSlide${idx + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`,
    )
    .join('\n');

  const contentTypesXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '  <Default Extension="xml" ContentType="application/xml"/>',
    '  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    '  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
    '  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
    '  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
    '  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>',
    slideOverrides,
    notesOverrides,
    '</Types>',
  ].join('\n');

  const rootRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>',
    '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
    '  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
    '</Relationships>',
  ].join('\n');

  const sldIdLstXml = slides
    .map((_, idx) => `    <p:sldId id="${256 + idx}" r:id="rId${idx + 2}"/>`)
    .join('\n');

  const presentationXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">',
    '  <p:sldMasterIdLst>',
    '    <p:sldMasterId id="2147483648" r:id="rId1"/>',
    '  </p:sldMasterIdLst>',
    '  <p:sldIdLst>',
    sldIdLstXml,
    '  </p:sldIdLst>',
    `  <p:sldSz cx="${SLIDE_W}" cy="${SLIDE_H}" type="screen16x9"/>`,
    '  <p:notesSz cx="6858000" cy="9144000"/>',
    '</p:presentation>',
  ].join('\n');

  const presRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>',
    slides
      .map(
        (_, idx) =>
          `  <Relationship Id="rId${idx + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${idx + 1}.xml"/>`,
      )
      .join('\n'),
    '</Relationships>',
  ].join('\n');

  const slideMasterRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
    '  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>',
    '</Relationships>',
  ].join('\n');

  const slideLayoutRelsXml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>',
    '</Relationships>',
  ].join('\n');

  const zipEntries: ZipEntryInput[] = [
    { path: '[Content_Types].xml', content: Buffer.from(contentTypesXml, 'utf8') },
    { path: '_rels/.rels', content: Buffer.from(rootRelsXml, 'utf8') },
    { path: 'docProps/core.xml', content: Buffer.from(buildCorePropsXml(spec), 'utf8') },
    { path: 'docProps/app.xml', content: Buffer.from(buildAppPropsXml(slides.length), 'utf8') },
    { path: 'ppt/presentation.xml', content: Buffer.from(presentationXml, 'utf8') },
    { path: 'ppt/_rels/presentation.xml.rels', content: Buffer.from(presRelsXml, 'utf8') },
    { path: 'ppt/theme/theme1.xml', content: Buffer.from(buildThemeXml(palette), 'utf8') },
    {
      path: 'ppt/slideMasters/slideMaster1.xml',
      content: Buffer.from(buildSlideMasterXml(palette), 'utf8'),
    },
    {
      path: 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
      content: Buffer.from(slideMasterRelsXml, 'utf8'),
    },
    {
      path: 'ppt/slideLayouts/slideLayout1.xml',
      content: Buffer.from(buildSlideLayoutXml(), 'utf8'),
    },
    {
      path: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
      content: Buffer.from(slideLayoutRelsXml, 'utf8'),
    },
  ];

  slides.forEach((slide, idx) => {
    const slideNum = idx + 1;
    zipEntries.push({
      path: `ppt/slides/slide${slideNum}.xml`,
      content: Buffer.from(buildSlideXml(slide, spec, slides.length, palette), 'utf8'),
    });

    const slideRelsXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>',
      `  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${slideNum}.xml"/>`,
      '</Relationships>',
    ].join('\n');
    zipEntries.push({
      path: `ppt/slides/_rels/slide${slideNum}.xml.rels`,
      content: Buffer.from(slideRelsXml, 'utf8'),
    });

    zipEntries.push({
      path: `ppt/notesSlides/notesSlide${slideNum}.xml`,
      content: Buffer.from(buildNotesSlideXml(slide), 'utf8'),
    });

    const notesRelsXml = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      `  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${slideNum}.xml"/>`,
      '</Relationships>',
    ].join('\n');
    zipEntries.push({
      path: `ppt/notesSlides/_rels/notesSlide${slideNum}.xml.rels`,
      content: Buffer.from(notesRelsXml, 'utf8'),
    });
  });

  const pptxBytes = buildUncompressedZipArchive(zipEntries);

  return Object.freeze({
    pptxBytes,
    slideCount: slides.length,
    spec,
  });
}

/**
 * Formats a concise Markdown summary of the generated slide deck for the assistant chat bubble.
 */
export function formatPptSummaryMarkdown(spec: PptPresentationSpec): string {
  const themeLabel =
    PPT_THEME_PALETTES[spec.theme ?? 'editorial_story'].label;
  const layoutLabels: Record<string, string> = {
    metrics: 'Key Facts',
    two_column: 'Comparison',
    process: 'Journey',
    spotlight: 'Spotlight',
    bullets: 'Editorial',
  };

  const slideLines = spec.slides
    .map((s) => {
      const role =
        s.kind === 'cover'
          ? 'Cover'
          : s.kind === 'thank_you'
            ? 'Closing'
            : layoutLabels[s.layout ?? 'bullets'] ?? 'Content';
      return `- **Slide ${s.slideNumber} (${role}):** ${s.title}`;
    })
    .join('\n');

  return [
    `### ${spec.title}`,
    `*${spec.subtitle}*`,
    '',
    `Built a **${spec.slides.length}-slide widescreen (16:9) ${themeLabel}** with tailored slide layouts and presenter notes. Explore it in **Stage** or **Grid** view below, or download the \`.pptx\` deck:`,
    '',
    slideLines,
  ].join('\n');
}

/**
 * Deterministic 6-Content-Slide (8-Total) PPT Presentation Provider for offline tests
 * and `MOCK_AI=true` environments — adapts cleanly to the classified theme without leaking
 * software/infrastructure boilerplate into general-domain topics.
 */
export class MockPptPresentationProvider implements PptPresentationProvider {
  public readonly providerName = 'mock-ppt';

  public async generatePptPresentation(input: {
    readonly prompt: string;
    readonly maxOutputTokens: number;
    readonly existingArtifactContext?: string;
    readonly signal?: AbortSignal;
  }): Promise<PptPresentationGenerationResult> {
    const cleanTopic =
      input.prompt
        .replace(
          /^(generate|create|write|build|make|design|prepare)\s+(a\s+)?(\d+[- ]slide\s+)?(ppt|pptx|presentation|slide deck|slides|powerpoint|deck)\s*(on|about|for)?\s*/i,
          '',
        )
        .trim() || 'Featured Topic Overview';

    const titleTopic =
      cleanTopic.charAt(0).toUpperCase() + cleanTopic.slice(1).slice(0, 75);
    const theme = classifyPptDeckTheme(input.prompt);
    const surfaceMode = classifyPptSurfaceMode(input.prompt);
    const targetContentSlides = extractRequestedSlideCount(input.prompt);
    const todayIso = new Date().toISOString().slice(0, 10);
    const isTechnical = theme === 'technical_architecture';

    const rawSlides = isTechnical
      ? [
          {
            layout: 'spotlight' as const,
            kicker: 'System Context',
            title: `Why ${titleTopic} Matters`,
            subtitle: 'Core Objectives, Scope & Design Drivers',
            callout: `${titleTopic} aligns reliability, low latency, and clean ownership boundaries in one cohesive architecture.`,
            bullets: [
              'Establishes clear contracts across independent components',
              'Maintains predictable cost and latency budgets under load',
              'Supports safe, incremental scaling without downtime',
            ],
            speakerNotes: `Anchor the room on the technical problem ${titleTopic} solves and the measurable engineering goals that matter most.`,
          },
          {
            layout: 'metrics' as const,
            kicker: 'Target Benchmarks',
            title: 'Key Reliability & Latency Targets',
            subtitle: 'Quantified Service-Level Objectives',
            metrics: [
              { label: 'Availability', value: '99.95%', delta: 'Multi-AZ' },
              { label: 'P95 Latency', value: '42 ms', delta: 'Target budget' },
              { label: 'Isolation', value: '100%', delta: 'Scoped access' },
              { label: 'Recovery RTO', value: '< 5 min', delta: 'Automated' },
            ],
            bullets: [
              'Targets verified continuously with automated contract and load suites',
              'Explicit retry safety prevents duplicate side effects',
            ],
            speakerNotes:
              'Walk through the four headline engineering SLOs and explain how each is measured in staging and production.',
          },
          {
            layout: 'two_column' as const,
            kicker: 'Design Trade-Offs',
            title: 'Coupled Baseline vs Modular Design',
            subtitle: 'Clear Ownership & Failure Containment',
            columns: [
              {
                heading: 'Coupled Baseline',
                points: [
                  'Shared state creates hidden cross-component side effects',
                  'Single bottleneck stalls unrelated workflows',
                  'Deployments require broad coordination across teams',
                ],
              },
              {
                heading: 'Modular Target',
                points: [
                  'Explicit contracts isolate each domain responsibility',
                  'Independent quotas and circuit breakers contain faults',
                  'Teams ship and roll back incrementally with confidence',
                ],
              },
            ],
            bullets: ['Clear boundaries lower mean time to recovery during upstream incidents'],
            callout: 'Well-defined service boundaries cut incident blast radius and speed up iteration.',
            speakerNotes:
              'Contrast the coupled baseline on the left with the modular target on the right to clarify the main architectural trade-offs.',
          },
          {
            layout: 'process' as const,
            kicker: 'Execution Flow',
            title: 'End-to-End Request Lifecycle',
            subtitle: 'Four Core Stages From Ingress to Response',
            steps: [
              { step: '01', title: 'Validate', detail: 'Authenticate caller, enforce quotas, and sanitize inputs.' },
              { step: '02', title: 'Route', detail: 'Dispatch work to the right handler with traced context.' },
              { step: '03', title: 'Execute', detail: 'Run domain logic with bounded timeouts and schema checks.' },
              { step: '04', title: 'Persist', detail: 'Commit state atomically and return structured output.' },
            ],
            bullets: ['Every stage carries a correlated trace identifier for rapid debugging'],
            callout: 'Explicit error handling ensures failed operations clean up cleanly without partial state.',
            speakerNotes:
              'Trace a single request from left to right across validation, routing, execution, and persistence.',
          },
          {
            layout: 'bullets' as const,
            kicker: 'Guardrails',
            title: 'Security & Quality Controls',
            subtitle: 'Defense-in-Depth Across Boundaries',
            bullets: [
              'Validate every external payload against strict schemas before processing',
              'Scope all reads and writes to verified caller ownership',
              'Enforce least-privilege credentials and automated secret scanning',
              'Gate every release on reproducible contract and failover checks',
            ],
            callout: 'Automated verification keeps security invariants intact as the system evolves.',
            speakerNotes:
              'Summarize the defense-in-depth controls that protect data integrity and reliability across every layer.',
          },
          {
            layout: 'process' as const,
            kicker: 'Rollout Plan',
            title: 'Phased Implementation Milestones',
            subtitle: 'Incremental Delivery With Fast Rollback',
            steps: [
              { step: '01', title: 'Phase 1', detail: 'Stand up core contracts, telemetry, and staging smoke tests.' },
              { step: '02', title: 'Phase 2', detail: 'Shift canary traffic with live latency and error budgets.' },
              { step: '03', title: 'Phase 3', detail: 'Complete load drills and promote to full production.' },
            ],
            bullets: ['Each phase advances only after passing automated verification gates'],
            callout: 'Canary progression minimizes delivery risk while validating real-world performance.',
            speakerNotes:
              'Close with the three phased milestones and exit criteria before opening the floor for technical Q&A.',
          },
        ]
      : [
          {
            layout: 'spotlight' as const,
            kicker: 'Opening Premise',
            title: `Understanding ${titleTopic}`,
            subtitle: 'Core Story, Significance & Why It Captivates',
            callout: `${titleTopic} reveals how foundational ideas, human craft, and evolving context come together to leave a lasting mark.`,
            bullets: [
              `Sets the stage for what makes ${titleTopic} distinctive and memorable`,
              'Connects essential background with real-world relevance today',
              'Frames the core questions explored across the next five slides',
            ],
            speakerNotes: `Open by drawing the audience into why ${titleTopic} is fascinating and preview the story arc you will explore together.`,
          },
          {
            layout: 'metrics' as const,
            kicker: 'At a Glance',
            title: 'Essential Highlights & Key Facts',
            subtitle: 'Four Anchor Points That Frame the Subject',
            metrics: [
              { label: 'Core Themes', value: '4 Pillars', delta: 'Interconnected' },
              { label: 'Perspective', value: '360°', delta: 'Context + practice' },
              { label: 'Evolution', value: 'Multi-Era', delta: 'Shaped over time' },
              { label: 'Takeaway', value: 'Actionable', delta: 'Memorable insights' },
            ],
            bullets: [
              'Combines big-picture context with specific, concrete details',
              'Designed for rapid clarity whether you are new or experienced',
            ],
            speakerNotes:
              'Use these four quick-reference highlights to ground the audience before diving into deeper contrasts and progression.',
          },
          {
            layout: 'two_column' as const,
            kicker: 'Key Contrasts',
            title: 'Two Lenses on the Subject',
            subtitle: 'Comparing Common Assumptions Against Deeper Reality',
            columns: [
              {
                heading: 'Surface Impressions',
                points: [
                  'Often reduced to a single headline or stereotype',
                  'Overlooks the subtle context behind key turning points',
                  'Misses how small details drive the bigger outcome',
                ],
              },
              {
                heading: 'Closer Perspective',
                points: [
                  'Reveals rich interplay between craft, timing, and context',
                  'Connects historical or foundational roots to modern impact',
                  'Rewards curiosity with nuanced, lasting understanding',
                ],
              },
            ],
            bullets: ['Looking past first impressions uncovers the most compelling stories'],
            callout: 'Great understanding comes from comparing contrasting viewpoints side by side.',
            speakerNotes:
              'Walk through the contrast between surface assumptions on the left and the deeper reality on the right.',
          },
          {
            layout: 'process' as const,
            kicker: 'Progression',
            title: `How ${titleTopic} Unfolds`,
            subtitle: 'Four Defining Stages From Origins to Impact',
            steps: [
              { step: '01', title: 'Origins', detail: 'Early conditions and spark that set the story in motion.' },
              { step: '02', title: 'Breakthrough', detail: 'Key turning point that transformed reach and recognition.' },
              { step: '03', title: 'Refinement', detail: 'Maturation of signature elements, craft, and variety.' },
              { step: '04', title: 'Legacy Today', detail: 'Enduring influence and how it continues to evolve.' },
            ],
            bullets: ['Each stage builds directly on the breakthroughs that came before it'],
            callout: 'Tracing the journey step by step makes complex developments effortless to remember.',
            speakerNotes:
              'Guide the audience from left to right across these four defining stages to build a clear mental timeline.',
          },
          {
            layout: 'bullets' as const,
            kicker: 'Deep Dive',
            title: 'Defining Elements & Standout Details',
            subtitle: 'What Sets the Finest Examples Apart',
            bullets: [
              `Distinctive signature qualities that immediately define ${titleTopic}`,
              'Memorable real-world examples illustrating core principles in practice',
              'Subtle nuances that enthusiasts and experts notice right away',
              'Enduring lessons that translate well beyond a single context',
            ],
            callout: 'Paying attention to concrete examples turns abstract ideas into vivid insight.',
            speakerNotes:
              'Share one or two vivid stories or examples here to bring each bullet to life for your audience.',
          },
          {
            layout: 'process' as const,
            kicker: 'Next Steps',
            title: 'Key Takeaways & Ways to Explore Further',
            subtitle: 'Three Practical Ways to Put This Into Perspective',
            steps: [
              { step: '01', title: 'Observe', detail: 'Notice the core patterns and details next time you encounter them.' },
              { step: '02', title: 'Compare', detail: 'Place two contrasting examples side by side to spot key differences.' },
              { step: '03', title: 'Share', detail: 'Use the core story and facts here to spark deeper discussion.' },
            ],
            bullets: ['Curiosity and firsthand exploration turn overview into lasting mastery'],
            callout: `Keep ${titleTopic} approachable: start with one fascinating detail and follow where it leads.`,
            speakerNotes:
              'Wrap up with three simple, memorable takeaways and invite questions or personal stories from the audience.',
          },
        ];

    const sizedSlides = [...rawSlides.slice(0, targetContentSlides)];
    while (sizedSlides.length < targetContentSlides) {
      const extraNum = sizedSlides.length + 1;
      sizedSlides.push({
        layout: 'bullets' as const,
        kicker: `Module ${String(extraNum).padStart(2, '0')}`,
        title: `${titleTopic}: Focus Area ${extraNum}`,
        subtitle: 'Additional Perspective & Supporting Detail',
        bullets: [
          `Key dimensions and practical examples within ${titleTopic}`,
          'Notable patterns that reinforce the central theme',
          'Actionable takeaway connecting back to the broader story',
        ],
        callout: `Each additional lens deepens understanding of ${titleTopic}.`,
        speakerNotes: `Highlight this focused perspective on ${titleTopic} before transitioning to the next slide.`,
      });
    }

    const spec = validatePptPresentationSpec({
      title: titleTopic,
      subtitle: `${PPT_THEME_PALETTES[theme].label} · Structured Visual Deck`,
      theme,
      surfaceMode,
      author: 'Kartik.ai Presentation Engine',
      generatedDate: todayIso,
      footer: 'Generated by Kartik.ai',
      slides: sizedSlides,
    });

    const compiled = buildPptxBinaryBuffer(spec);

    return Object.freeze({
      spec: compiled.spec,
      pptxBytes: compiled.pptxBytes,
      slideCount: compiled.slideCount,
      summaryMarkdown: formatPptSummaryMarkdown(compiled.spec),
      tokensUsed: 320,
    });
  }
}
