/**
 * @file backend/services/agent/src/agents/image/index.ts
 * @description Fix #20 — Pure Image Generation Art-Direction, Style & Aspect-Ratio Intelligence Module.
 * Provides:
 *  - 6-way visual style archetype classification (`photorealistic`, `technical_diagram`,
 *    `ui_product_mockup`, `editorial_illustration`, `logo_icon`, `cinematic_artwork`)
 *  - Automatic aspect ratio extraction from natural language prompts (`1:1`, `16:9`, `9:16`, `4:3`, `3:4`)
 *  - Deterministic art-directed prompt enhancement (composition, lighting, rendering medium, anti-artifact guardrails)
 *  - Structured `image-spec.json` manifest builder & 3 clickable visual refinement follow-ups
 */

import { deflateSync } from 'node:zlib';

export const IMAGE_STYLE_ARCHETYPES = [
  'photorealistic',
  'technical_diagram',
  'ui_product_mockup',
  'editorial_illustration',
  'logo_icon',
  'cinematic_artwork',
] as const;

export type ImageStyleArchetype = (typeof IMAGE_STYLE_ARCHETYPES)[number];

export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export interface ImageArtifactSpecPayload {
  readonly originalPrompt: string;
  readonly enhancedPrompt: string;
  readonly style: ImageStyleArchetype;
  readonly styleLabel: string;
  readonly aspectRatio: ImageAspectRatio;
  readonly width: number | null;
  readonly height: number | null;
  readonly model: string;
  readonly isEdit: boolean;
  readonly referenceFilename?: string;
  readonly liveGenerated: boolean;
}

const STYLE_DISPLAY_LABELS: Readonly<Record<ImageStyleArchetype, string>> = Object.freeze({
  photorealistic: 'Editorial Photography',
  technical_diagram: 'Technical Architecture',
  ui_product_mockup: 'Product & UI Render',
  editorial_illustration: 'Editorial Illustration',
  logo_icon: 'Minimalist Brand Mark',
  cinematic_artwork: 'Cinematic Concept Art',
});

export function getImageStyleDisplayLabel(style: ImageStyleArchetype): string {
  return STYLE_DISPLAY_LABELS[style];
}

/**
 * Classifies an image generation prompt into one of 6 visual style archetypes so art direction,
 * lighting, rendering cues, and follow-up refinements match the user's creative goal.
 */
export function classifyImageStyle(prompt: string): ImageStyleArchetype {
  const lower = prompt.toLowerCase();

  // 1. Logo / App Icon / Emblem / Brand Mark
  if (
    /\b(logo|app\s+icon|brand\s+mark|monogram|emblem|favicon|mascot\s+icon|badge\s+icon|vector\s+icon)\b/i.test(
      lower,
    )
  ) {
    return 'logo_icon';
  }

  // 2. Technical Architecture / Blueprint / Infographic / Schematic
  if (
    /\b(architecture\s+diagram|system\s+diagram|blueprint|schematic|infographic|isometric\s+(architecture|cloud|network|system)|flowchart|topology|cutaway\s+diagram|exploded\s+view)\b/i.test(
      lower,
    )
  ) {
    return 'technical_diagram';
  }

  // 3. UI / Product Mockup / Industrial Hardware / Studio Packaging
  if (
    /\b(mockup|ui\s+design|product\s+shot|product\s+photo|packaging|sneaker|headphones|watch\s+render|industrial\s+design|hardware\s+render|studio\s+product|minimalist\s+desk)\b/i.test(
      lower,
    )
  ) {
    return 'ui_product_mockup';
  }

  // 4. Photorealistic / Portrait / Architectural / Nature Photography
  if (
    /\b(photorealistic|photograph|photo\s+of|dslr|35mm|85mm|portrait|street\s+photography|macro\s+photo|architectural\s+photo|editorial\s+photo|golden\s+hour|natural\s+light|candid|documentary)\b/i.test(
      lower,
    )
  ) {
    return 'photorealistic';
  }

  // 5. Editorial / Watercolor / Vector / Storybook / Flat Illustration
  if (
    /\b(illustration|watercolor|gouache|storybook|editorial\s+art|vector\s+art|flat\s+design|line\s+art|ink\s+drawing|sketch|comic|anime|poster\s+art|risograph|ukiyo-e)\b/i.test(
      lower,
    )
  ) {
    return 'editorial_illustration';
  }

  // 6. Default: Cinematic Concept Art & High-Craft Visuals
  return 'cinematic_artwork';
}

/**
 * Detects an explicit or implied aspect ratio from the user's prompt.
 * Defaults to `1:1` for icons/avatars/general prompts, `16:9` for widescreen/banners/landscapes,
 * `9:16` for vertical/mobile/stories/posters, `4:3` for slides/classic frames, and `3:4` for portraits/covers.
 */
export function detectImageAspectRatio(prompt: string): ImageAspectRatio {
  const lower = prompt.toLowerCase();

  // Explicit numeric ratios first
  if (/\b16\s*[:x/]\s*9\b/.test(lower)) return '16:9';
  if (/\b9\s*[:x/]\s*16\b/.test(lower)) return '9:16';
  if (/\b4\s*[:x/]\s*3\b/.test(lower)) return '4:3';
  if (/\b3\s*[:x/]\s*4\b/.test(lower)) return '3:4';
  if (/\b1\s*[:x/]\s*1\b/.test(lower)) return '1:1';

  // Semantic aspect hints (check specific vertical/mobile wallpapers before generic wallpaper)
  if (
    /\b(vertical|mobile\s+wallpaper|phone\s+wallpaper|instagram\s+story|tiktok|reel\s+cover|tall\s+poster|portrait\s+wallpaper)\b/i.test(
      lower,
    )
  ) {
    return '9:16';
  }

  if (
    /\b(widescreen|wide\s+shot|panoramic|panorama|hero\s+banner|banner|desktop\s+wallpaper|wallpaper|cinematic\s+wide|landscape\s+view|youtube\s+thumbnail)\b/i.test(
      lower,
    )
  ) {
    return '16:9';
  }

  if (/\b(book\s+cover|magazine\s+cover|poster|vertical\s+card|portrait\s+frame)\b/i.test(lower)) {
    return '3:4';
  }

  if (/\b(presentation\s+slide|classic\s+frame|editorial\s+spread)\b/i.test(lower)) {
    return '4:3';
  }

  if (/\b(square|app\s+icon|favicon|avatar|profile\s+picture|logo)\b/i.test(lower)) {
    return '1:1';
  }

  return '1:1';
}

/**
 * Enriches the user's raw prompt with concise, style-matched art direction (composition, lighting,
 * rendering craft, and clean anti-watermark/artifact discipline) without distorting the subject.
 */
export function buildEnhancedImagePrompt(input: {
  readonly prompt: string;
  readonly style: ImageStyleArchetype;
  readonly aspectRatio: ImageAspectRatio;
  readonly isEdit?: boolean;
}): string {
  const cleaned = input.prompt.trim().replace(/\s+/g, ' ');

  if (input.isEdit) {
    return [
      `Using the provided reference image, apply the following transformation faithfully: ${cleaned}.`,
      'Preserve core composition and subject coherence where appropriate, maintain crisp detail and balanced lighting, with zero watermarks or garbled text.',
    ].join(' ');
  }

  const styleDirection: Record<ImageStyleArchetype, string> = {
    photorealistic:
      'Editorial photograph captured on full-frame camera, crisp natural depth of field, authentic textures, balanced studio or natural lighting, realistic color grading, ultra-sharp detail, no watermarks or artificial artifacts.',
    technical_diagram:
      'Clean isometric/flat technical architecture illustration on a refined dark slate canvas, crisp geometric connectors, clear visual hierarchy, subtle glowing accents, precise alignment, minimal clean aesthetics without garbled or illegible text.',
    ui_product_mockup:
      'High-craft studio product photography render, soft diffused key lighting with clean rim highlights, tactile matte and brushed-metal materials, uncluttered architectural backdrop, crisp shadow falloff, no watermarks.',
    editorial_illustration:
      'Award-winning editorial illustration with cohesive color harmony, deliberate line weight and painterly texture, expressive focal composition, balanced negative space, clean publication-grade finish.',
    logo_icon:
      'Minimalist modern geometric vector brand mark centered on a clean solid background, bold unmistakable silhouette, balanced negative space, scalable flat-to-subtle-gradient craftsmanship, zero cluttered text or watermarks.',
    cinematic_artwork:
      'Cinematic high-craft concept art, dramatic volumetric lighting, strong atmospheric depth, rich material detail, deliberate rule-of-thirds composition, cohesive color palette, crisp 4K studio finish, no watermarks or signatures.',
  };

  return `${cleaned}. ${styleDirection[input.style]} Composed cleanly for a ${input.aspectRatio} frame.`;
}

/**
 * Formats a concise, informative Markdown caption for the assistant message bubble.
 * Preserves `**Enhanced Prompt:**` for downstream parser and regression test compatibility.
 */
export function formatImageCaption(input: {
  readonly originalPrompt: string;
  readonly enhancedPrompt: string;
  readonly style: ImageStyleArchetype;
  readonly aspectRatio: ImageAspectRatio;
  readonly isEdit?: boolean;
  readonly referenceFilename?: string;
}): string {
  const styleLabel = getImageStyleDisplayLabel(input.style);
  const heading = input.isEdit
    ? `### Restyled Visual Artwork${input.referenceFilename ? ` (from \`${input.referenceFilename}\`)` : ''}`
    : '### Generated Visual Artwork';

  return [
    heading,
    `Created in **${styleLabel}** style (**${input.aspectRatio}** frame).`,
    '',
    `**Enhanced Prompt:** *${input.enhancedPrompt}*`,
  ].join('\n');
}

/**
 * Builds 3 contextual, clickable visual refinement prompts for the Image Gen specialist.
 */
export function buildImageFollowUps(
  prompt: string,
  style: ImageStyleArchetype,
  aspectRatio: ImageAspectRatio,
): readonly string[] {
  const cleanedRaw = prompt
    .trim()
    .replace(/\s+/g, ' ')
    .replace(
      /^(?:please\s+)?(?:generate|create|draw|render|make|design|build|produce|paint|illustrate)\s+(?:me\s+)?(?:an?\s+)?/i,
      '',
    )
    .replace(
      /^(?:(?:16[:x/]9|9[:x/]16|4[:x/]3|3[:x/]4|1[:x/]1)\s+)?(?:(?:widescreen|vertical|horizontal|square|panoramic|cinematic|high-res|4k|ultra-detailed)\s+)*/i,
      '',
    )
    .replace(
      /^(?:image|picture|artwork|illustration|photo|photograph|poster|wallpaper|banner|logo|icon|diagram|mockup|render|concept\s+art)\s+(?:of\s+|for\s+|showing\s+|depicting\s+)?/i,
      '',
    )
    .replace(/^(?:an?\s+|the\s+)/i, '')
    .trim();

  // Truncate strictly at a word boundary so follow-up chips never slice mid-word
  let subject = cleanedRaw;
  if (subject.length > 46) {
    const slice = subject.slice(0, 46);
    const lastSpace = slice.lastIndexOf(' ');
    subject = (lastSpace > 18 ? slice.slice(0, lastSpace) : slice).trim();
  }
  subject = subject.replace(/[\s,.;:!?-]+$/, '');

  const topic = subject || 'this scene';
  const altRatio: ImageAspectRatio = aspectRatio === '16:9' ? '3:4' : '16:9';
  const altRatioLabel = altRatio === '16:9' ? '16:9 widescreen cinematic' : '3:4 vertical editorial poster';

  if (style === 'logo_icon') {
    return Object.freeze([
      `Create a monochrome white-on-obsidian minimalist logo variation of ${topic}`,
      `Render a 3D glassmorphic app icon version of ${topic} in 1:1 studio lighting`,
      `Design a 16:9 brand presentation hero banner showcasing ${topic}`,
    ]);
  }

  if (style === 'technical_diagram') {
    return Object.freeze([
      `Create a 16:9 high-contrast white-paper blueprint diagram of ${topic}`,
      `Render a dramatic dark-mode isometric 3D visualization of ${topic}`,
      `Generate a minimalist editorial vector infographic version of ${topic}`,
    ]);
  }

  if (style === 'photorealistic') {
    return Object.freeze([
      `Create a ${altRatioLabel} golden-hour variation of ${topic}`,
      `Reimagine ${topic} as a crisp minimalist editorial gouache illustration`,
      `Render ${topic} with dramatic moody night-time studio lighting`,
    ]);
  }

  return Object.freeze([
    `Generate a ${altRatioLabel} variation of ${topic} with dramatic rim lighting`,
    `Reimagine ${topic} as a photorealistic 35mm architectural photograph`,
    `Create a minimalist flat-vector editorial illustration of ${topic}`,
  ]);
}

/**
 * Serializes the structured `image-spec.json` manifest stored alongside generated image artifacts.
 */
export function buildImageSpecManifestPayload(
  spec: Omit<ImageArtifactSpecPayload, 'styleLabel'>,
): ImageArtifactSpecPayload {
  return Object.freeze({
    ...spec,
    styleLabel: getImageStyleDisplayLabel(spec.style),
  });
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC32_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length, false);
  chunk[4] = type.charCodeAt(0);
  chunk[5] = type.charCodeAt(1);
  chunk[6] = type.charCodeAt(2);
  chunk[7] = type.charCodeAt(3);
  chunk.set(data, 8);
  const crc = crc32(chunk.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return chunk;
}

const OFFLINE_DIMENSIONS_BY_RATIO: Readonly<
  Record<ImageAspectRatio, { readonly width: number; readonly height: number }>
> = Object.freeze({
  '16:9': { width: 640, height: 360 },
  '9:16': { width: 360, height: 640 },
  '4:3': { width: 640, height: 480 },
  '3:4': { width: 480, height: 640 },
  '1:1': { width: 512, height: 512 },
});

const STYLE_PALETTES: Readonly<
  Record<
    ImageStyleArchetype,
    {
      readonly bgTop: readonly [number, number, number];
      readonly bgBottom: readonly [number, number, number];
      readonly accentA: readonly [number, number, number];
      readonly accentB: readonly [number, number, number];
    }
  >
> = Object.freeze({
  cinematic_artwork: {
    bgTop: [7, 13, 28],
    bgBottom: [15, 29, 54],
    accentA: [56, 189, 248],
    accentB: [168, 85, 247],
  },
  photorealistic: {
    bgTop: [18, 22, 30],
    bgBottom: [42, 34, 28],
    accentA: [245, 158, 11],
    accentB: [56, 189, 248],
  },
  technical_diagram: {
    bgTop: [8, 15, 28],
    bgBottom: [12, 24, 42],
    accentA: [14, 165, 233],
    accentB: [16, 185, 129],
  },
  ui_product_mockup: {
    bgTop: [17, 20, 30],
    bgBottom: [28, 33, 48],
    accentA: [129, 140, 248],
    accentB: [56, 189, 248],
  },
  editorial_illustration: {
    bgTop: [24, 18, 36],
    bgBottom: [44, 26, 52],
    accentA: [244, 114, 182],
    accentB: [251, 191, 36],
  },
  logo_icon: {
    bgTop: [12, 14, 22],
    bgBottom: [20, 24, 38],
    accentA: [168, 85, 247],
    accentB: [56, 189, 248],
  },
});

/**
 * Generates a lightweight, zero-dependency, aspect-ratio-accurate raster PNG artwork preview
 * for offline/demo mode when `GEMINI_API_KEY` is unset (replacing tiny 1x1 placeholder bytes).
 */
export function buildOfflineStudioPreviewPng(input: {
  readonly style: ImageStyleArchetype;
  readonly aspectRatio: ImageAspectRatio;
  readonly prompt: string;
}): Uint8Array {
  const { width, height } = OFFLINE_DIMENSIONS_BY_RATIO[input.aspectRatio];
  const palette = STYLE_PALETTES[input.style];

  // Deterministic prompt hash to vary focal orb position & architectural rhythm slightly
  let hash = 2166136261;
  for (let i = 0; i < input.prompt.length; i += 1) {
    hash ^= input.prompt.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const cx1 = width * (0.34 + ((hash & 0xff) / 255) * 0.32);
  const cy1 = height * (0.32 + (((hash >>> 8) & 0xff) / 255) * 0.28);
  const cx2 = width * (0.68 - (((hash >>> 16) & 0xff) / 255) * 0.25);
  const cy2 = height * (0.62 + (((hash >>> 24) & 0xff) / 255) * 0.16);
  const r1 = Math.min(width, height) * 0.46;
  const r2 = Math.min(width, height) * 0.38;
  const horizonY = Math.round(height * 0.66);

  const rowStride = 1 + width * 3;
  const raw = new Uint8Array(rowStride * height);

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * rowStride;
    raw[rowStart] = 0; // filter type None
    const ty = y / Math.max(1, height - 1);
    const baseR = palette.bgTop[0] + (palette.bgBottom[0] - palette.bgTop[0]) * ty;
    const baseG = palette.bgTop[1] + (palette.bgBottom[1] - palette.bgTop[1]) * ty;
    const baseB = palette.bgTop[2] + (palette.bgBottom[2] - palette.bgTop[2]) * ty;

    const dy1 = y - cy1;
    const dy2 = y - cy2;
    const isHorizonLine = Math.abs(y - horizonY) <= 1;

    for (let x = 0; x < width; x += 1) {
      const dx1 = x - cx1;
      const dx2 = x - cx2;
      const d1 = Math.sqrt(dx1 * dx1 + dy1 * dy1);
      const d2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);

      const g1 = Math.max(0, 1 - d1 / r1);
      const glow1 = g1 * g1 * 0.72;
      const g2 = Math.max(0, 1 - d2 / r2);
      const glow2 = g2 * g2 * 0.52;

      let r = baseR + palette.accentA[0] * glow1 + palette.accentB[0] * glow2;
      let g = baseG + palette.accentA[1] * glow1 + palette.accentB[1] * glow2;
      let b = baseB + palette.accentA[2] * glow1 + palette.accentB[2] * glow2;

      // Subtle architectural lighting pillars / geometric studio grid
      if (y > horizonY) {
        const depth = (y - horizonY) / Math.max(1, height - horizonY);
        const gridStep = Math.max(14, Math.round(20 + depth * 42));
        const xCentered = Math.abs(x - width * 0.5);
        const onVertical = Math.floor(xCentered) % gridStep === 0;
        const onHorizontal = (y - horizonY) % Math.max(10, Math.round(14 + depth * 22)) === 0;
        if (onVertical || onHorizontal) {
          const lineStrength = 0.22 * (1 - depth * 0.45);
          r += palette.accentA[0] * lineStrength;
          g += palette.accentA[1] * lineStrength;
          b += palette.accentA[2] * lineStrength;
        }
      } else if (isHorizonLine) {
        r += palette.accentA[0] * 0.35;
        g += palette.accentA[1] * 0.35;
        b += palette.accentA[2] * 0.35;
      } else {
        // Crisp centered geometric studio focal ring / monolith silhouette
        const ringDist = Math.abs(d1 - r1 * 0.42);
        if (ringDist < 1.6) {
          r += 110;
          g += 130;
          b += 165;
        }
      }

      // Clean 1px studio frame inset
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        r = Math.min(255, r + 28);
        g = Math.min(255, g + 34);
        b = Math.min(255, b + 46);
      }

      const off = rowStart + 1 + x * 3;
      raw[off] = Math.max(0, Math.min(255, Math.round(r)));
      raw[off + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[off + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }

  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const compressed = deflateSync(raw, { level: 1 });
  const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrChunk = makePngChunk('IHDR', ihdr);
  const idatChunk = makePngChunk('IDAT', new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.byteLength));
  const iendChunk = makePngChunk('IEND', new Uint8Array(0));

  const out = new Uint8Array(
    signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length,
  );
  let pos = 0;
  out.set(signature, pos);
  pos += signature.length;
  out.set(ihdrChunk, pos);
  pos += ihdrChunk.length;
  out.set(idatChunk, pos);
  pos += idatChunk.length;
  out.set(iendChunk, pos);
  return out;
}

export const GEMINI_IMAGE_DEFAULT_MODEL = 'gemini-3.1-flash-lite-image' as const;
export const GEMINI_IMAGE_PRO_MODEL = 'gemini-nano-banana-2.1' as const;

export type GeminiImageErrorKind =
  | 'paid_tier_required'
  | 'transient_rate_limit'
  | 'auth_forbidden'
  | 'model_not_found'
  | 'bad_request'
  | 'upstream_unavailable';

export interface GeminiImageErrorClassification {
  readonly kind: GeminiImageErrorKind;
  readonly retryable: boolean;
  readonly retryDelayMs: number;
  readonly retryAfterSeconds?: number;
  readonly appErrorCode: 'RATE_LIMITED' | 'FORBIDDEN' | 'PROVIDER_UNAVAILABLE';
  readonly userMessage: string;
}

function isDeprecatedOrLegacyImageModel(model: string): boolean {
  const lower = model.trim().toLowerCase();
  return (
    lower.startsWith('imagen-') ||
    lower.startsWith('gemini-1.5') ||
    lower.startsWith('gemini-2.0') ||
    lower.includes('exp-image-generation')
  );
}

/**
 * Selects an active Gemini image generation model (`gemini-3.1-flash-lite-image` by default,
 * upgrading to `gemini-nano-banana-2.1` when 2K/4K resolution is explicitly requested),
 * while safely ignoring deprecated `imagen-*` / `gemini-2.0-*` env overrides.
 */
export function selectGeminiImageModel(input: {
  readonly prompt: string;
  readonly aspectRatio?: string;
  readonly configuredModel?: string;
}): string {
  const configured = (input.configuredModel ?? '').trim().replace(/^["']|["']$/g, '');
  if (configured && !isDeprecatedOrLegacyImageModel(configured)) {
    return configured;
  }

  const ratio = (input.aspectRatio ?? '').trim();
  if (ratio === '1:4' || ratio === '1:8' || ratio === '4:1' || ratio === '8:1') {
    return GEMINI_IMAGE_PRO_MODEL;
  }

  if (/\b(4k|2k|ultra\s+hd|ultra-high\s+res)\b/i.test(input.prompt)) {
    return GEMINI_IMAGE_PRO_MODEL;
  }

  return GEMINI_IMAGE_DEFAULT_MODEL;
}

/**
 * Extracts a bounded retry delay in milliseconds from an HTTP `Retry-After` header
 * or Gemini JSON `retryDelay` / `"Please retry in Xs"` error body.
 */
export function parseGeminiRetryDelayMs(
  rawBody: string,
  retryAfterHeader?: string | null,
): number | null {
  if (retryAfterHeader) {
    const trimmed = retryAfterHeader.trim();
    const numericSeconds = Number(trimmed);
    if (Number.isFinite(numericSeconds) && numericSeconds > 0) {
      return Math.min(4_000, Math.max(250, Math.round(numericSeconds * 1000)));
    }
    const parsedDateMs = Date.parse(trimmed);
    if (Number.isFinite(parsedDateMs)) {
      const deltaMs = parsedDateMs - Date.now();
      if (deltaMs > 0) {
        return Math.min(4_000, Math.max(250, Math.round(deltaMs)));
      }
    }
  }

  const jsonRetryMatch = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/i.exec(rawBody);
  if (jsonRetryMatch?.[1]) {
    const sec = Number(jsonRetryMatch[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(4_000, Math.max(250, Math.round(sec * 1000)));
    }
  }

  const textRetryMatch = /please\s+retry\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/i.exec(rawBody);
  if (textRetryMatch?.[1] && textRetryMatch[2]) {
    const value = Number(textRetryMatch[1]);
    if (Number.isFinite(value) && value > 0) {
      const ms = textRetryMatch[2].toLowerCase() === 'ms' ? value : value * 1000;
      return Math.min(4_000, Math.max(250, Math.round(ms)));
    }
  }

  return null;
}

/**
 * Classifies Gemini Image Generation HTTP failures so zero-quota free-tier `429 RESOURCE_EXHAUSTED`
 * (`limit: 0`) fails fast with an actionable billing message (and 0 credit loss) instead of
 * wasting retries or silently returning a placeholder gradient image.
 */
export function classifyGeminiImageError(input: {
  readonly status: number;
  readonly rawBody: string;
  readonly model: string;
  readonly retryAfterHeader?: string | null;
  readonly attempt?: number;
}): GeminiImageErrorClassification {
  const { status, rawBody, model, retryAfterHeader } = input;
  const attempt = Math.max(0, input.attempt ?? 0);
  const lower = rawBody.toLowerCase();

  if (status === 429) {
    const indicatesZeroQuota =
      /\blimit\s*:\s*0\b/i.test(rawBody) ||
      /"limit"\s*:\s*0\b/i.test(rawBody) ||
      /quotavalue["']?\s*[:=]\s*["']?0\b/i.test(rawBody) ||
      lower.includes('free_tier') ||
      lower.includes('freetier') ||
      lower.includes('free tier') ||
      lower.includes('billing') ||
      lower.includes('paid tier') ||
      lower.includes('check your plan');

    if (indicatesZeroQuota) {
      return {
        kind: 'paid_tier_required',
        retryable: false,
        retryDelayMs: 0,
        retryAfterSeconds: 60,
        appErrorCode: 'RATE_LIMITED',
        userMessage: `Image generation (${model}) returned HTTP 429 RESOURCE_EXHAUSTED because Gemini image models have a free-tier quota of 0 and require a billing-enabled API key — even on your first request. Enable billing on your Gemini API key (or select a paid key in Settings > Secrets), or set IMAGE_PROVIDER=mock in .env for local offline previews. No credits were charged.`,
      };
    }

    const parsedDelay = parseGeminiRetryDelayMs(rawBody, retryAfterHeader);
    const backoffMs = Math.min(4_000, 600 * Math.pow(2, attempt));
    const retryDelayMs = parsedDelay ?? backoffMs;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryDelayMs / 1000));

    return {
      kind: 'transient_rate_limit',
      retryable: true,
      retryDelayMs,
      retryAfterSeconds,
      appErrorCode: 'RATE_LIMITED',
      userMessage: `Gemini image generation (${model}) is temporarily rate-limited (HTTP 429 RESOURCE_EXHAUSTED). Please wait a few seconds and retry. No credits were charged.`,
    };
  }

  if (status === 401 || status === 403) {
    return {
      kind: 'auth_forbidden',
      retryable: false,
      retryDelayMs: 0,
      appErrorCode: 'FORBIDDEN',
      userMessage: `Gemini image generation (${model}) rejected the configured API key (HTTP ${status}). Verify your billing-enabled Gemini API key permissions. No credits were charged.`,
    };
  }

  if (status === 404) {
    return {
      kind: 'model_not_found',
      retryable: false,
      retryDelayMs: 0,
      appErrorCode: 'PROVIDER_UNAVAILABLE',
      userMessage: `Gemini image model "${model}" is unavailable (HTTP 404). Verify GEMINI_IMAGE_MODEL is set to an active Gemini image model (e.g. ${GEMINI_IMAGE_DEFAULT_MODEL}). No credits were charged.`,
    };
  }

  if (status === 400) {
    return {
      kind: 'bad_request',
      retryable: false,
      retryDelayMs: 0,
      appErrorCode: 'PROVIDER_UNAVAILABLE',
      userMessage: `Gemini image generation (${model}) could not process this prompt (HTTP 400). Try rephrasing the visual description. No credits were charged.`,
    };
  }

  const retryDelayMs = Math.min(3_000, 500 * Math.pow(2, attempt));
  return {
    kind: 'upstream_unavailable',
    retryable: status >= 500 || status === 0,
    retryDelayMs,
    appErrorCode: 'PROVIDER_UNAVAILABLE',
    userMessage: `Gemini image generation (${model}) encountered a temporary upstream error${status > 0 ? ` (HTTP ${status})` : ''}. Please retry in a moment. No credits were charged.`,
  };
}

export const CLOUDFLARE_IMAGE_DEFAULT_MODEL = '@cf/black-forest-labs/flux-1-schnell' as const;

export const CLOUDFLARE_IMAGE_DIMENSIONS: Readonly<
  Record<ImageAspectRatio, { readonly width: number; readonly height: number }>
> = Object.freeze({
  '1:1': { width: 1024, height: 1024 },
  '16:9': { width: 1024, height: 576 },
  '9:16': { width: 576, height: 1024 },
  '4:3': { width: 1024, height: 768 },
  '3:4': { width: 768, height: 1024 },
});

/**
 * Detects PNG, JPEG, or WebP MIME type directly from image file magic bytes.
 */
export function detectImageMimeFromMagicBytes(
  bytes: Uint8Array,
  fallback: 'image/png' | 'image/jpeg' | 'image/webp' = 'image/jpeg',
): 'image/png' | 'image/jpeg' | 'image/webp' {
  if (
    bytes.byteLength >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'image/png';
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return fallback;
}

/**
 * Builds a validated Cloudflare Workers AI image generation payload.
 * Enforces Cloudflare's 2,048-character prompt ceiling and model-specific parameters.
 */
export function buildCloudflareImageRequestBody(input: {
  readonly model: string;
  readonly prompt: string;
  readonly aspectRatio: ImageAspectRatio;
  readonly steps?: number;
}): Record<string, unknown> {
  const prompt = input.prompt.trim().slice(0, 2048);
  const lowerModel = input.model.toLowerCase();

  // FLUX.1 Schnell accepts `prompt`, `steps` (1-8, default 4)
  if (lowerModel.includes('flux-1-schnell')) {
    const steps = Math.max(1, Math.min(8, Math.round(input.steps ?? 4)));
    return { prompt, steps };
  }

  // SDXL / Lucid / FLUX-2 models accept explicit width & height
  const dims = CLOUDFLARE_IMAGE_DIMENSIONS[input.aspectRatio] ?? CLOUDFLARE_IMAGE_DIMENSIONS['1:1'];
  if (lowerModel.includes('stable-diffusion')) {
    const numSteps = Math.max(1, Math.min(20, Math.round(input.steps ?? 16)));
    return {
      prompt,
      width: dims.width,
      height: dims.height,
      num_steps: numSteps,
    };
  }

  return {
    prompt,
    width: dims.width,
    height: dims.height,
    steps: Math.max(1, Math.min(8, Math.round(input.steps ?? 4))),
  };
}

/**
 * Decodes either Cloudflare's JSON `{ result: { image: "<base64>" } }` response (FLUX models)
 * or raw binary PNG/JPEG image stream (SDXL models) into normalized image bytes + MIME type.
 */
export function decodeCloudflareImageResponse(input: {
  readonly contentType: string;
  readonly bodyBytes: Uint8Array;
}): {
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  readonly data: Uint8Array;
} | null {
  const ct = input.contentType.toLowerCase();

  // Raw binary image stream (e.g. Stable Diffusion XL)
  if (ct.startsWith('image/')) {
    if (input.bodyBytes.byteLength <= 64) {
      return null;
    }
    const fallbackMime: 'image/png' | 'image/jpeg' | 'image/webp' = ct.includes('png')
      ? 'image/png'
      : ct.includes('webp')
        ? 'image/webp'
        : 'image/jpeg';
    return {
      mimeType: detectImageMimeFromMagicBytes(input.bodyBytes, fallbackMime),
      data: input.bodyBytes,
    };
  }

  // JSON envelope `{ success: true, result: { image: "<base64>" } }` (FLUX.1 Schnell)
  try {
    const text = Buffer.from(input.bodyBytes).toString('utf8');
    const parsed = JSON.parse(text) as {
      readonly success?: boolean;
      readonly result?: { readonly image?: string };
      readonly image?: string;
    };
    const rawB64 = parsed.result?.image ?? parsed.image;
    if (!rawB64 || typeof rawB64 !== 'string') {
      return null;
    }
    const cleanedB64 = rawB64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim();
    const decoded = new Uint8Array(Buffer.from(cleanedB64, 'base64'));
    if (decoded.byteLength <= 64) {
      return null;
    }
    return {
      mimeType: detectImageMimeFromMagicBytes(decoded, 'image/jpeg'),
      data: decoded,
    };
  } catch {
    return null;
  }
}


