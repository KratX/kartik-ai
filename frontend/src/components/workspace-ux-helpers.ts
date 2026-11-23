/**
 * @file frontend/src/components/workspace-ux-helpers.ts
 * @description Pure, framework-agnostic Fix #22 workspace UX helpers:
 *  - Slash command registry, filtering, and prompt resolution (`/code`, `/pdf`, `/deep`, etc.)
 *  - Conversation date-bucket grouping (`Pinned`, `Today`, `Yesterday`, `Previous 7 Days`, `Earlier`)
 *  - Universal Split-Screen Artifact Canvas extraction & compact metadata formatting
 *  - Global Cmd+K Command Palette fuzzy filtering
 *  - Split-pane resize clamping and time-of-day hero greetings
 */

import type {
  ArtifactRecord,
  ChatResponseDepth,
  PlatformConversation,
  PlatformMessage,
  SpecialistAgentName,
} from '../types/index.js';

export type SlashCommandKind = 'agent' | 'depth';

export interface SlashCommandItem {
  readonly command: string;
  readonly label: string;
  readonly description: string;
  readonly kind: SlashCommandKind;
  readonly agent?: SpecialistAgentName;
  readonly depth?: ChatResponseDepth;
  readonly badge: string;
}

export const SLASH_COMMANDS: readonly SlashCommandItem[] = Object.freeze([
  {
    command: '/chat',
    label: 'Unified Chat',
    description: 'Adaptive 5-mode reasoning with smart auto-delegation',
    kind: 'agent',
    agent: 'chat',
    badge: '1 cr+',
  },
  {
    command: '/search',
    label: 'Web Search',
    description: 'Live Google search with inline citations & sources',
    kind: 'agent',
    agent: 'search',
    badge: '2 cr',
  },
  {
    command: '/code',
    label: 'Coding Sandbox',
    description: 'Build interactive 3-file web apps or inspect code',
    kind: 'agent',
    agent: 'coding',
    badge: '5 cr',
  },
  {
    command: '/pdf',
    label: 'PDF Generator',
    description: 'Compile publication-grade editorial PDF reports',
    kind: 'agent',
    agent: 'pdf',
    badge: '5 cr',
  },
  {
    command: '/ppt',
    label: 'PPT Studio',
    description: 'Design 16:9 keynote decks with speaker notes & .pptx',
    kind: 'agent',
    agent: 'ppt',
    badge: '8 cr',
  },
  {
    command: '/rag',
    label: 'PDF RAG',
    description: 'Query uploaded PDFs with grounded page citations',
    kind: 'agent',
    agent: 'rag',
    badge: '2 cr',
  },
  {
    command: '/vision',
    label: 'Vision OCR',
    description: 'Extract tables, receipts, UI specs & diagrams from images',
    kind: 'agent',
    agent: 'vision',
    badge: '3 cr',
  },
  {
    command: '/image',
    label: 'Image Studio',
    description: 'Generate art-directed visuals with auto aspect ratios',
    kind: 'agent',
    agent: 'image',
    badge: '10 cr',
  },
  {
    command: '/concise',
    label: 'Concise Depth',
    description: 'Tight executive Chat answers with minimal fluff',
    kind: 'depth',
    depth: 'concise',
    badge: 'Depth',
  },
  {
    command: '/balanced',
    label: 'Balanced Depth',
    description: 'Clear structured Chat explanations & examples',
    kind: 'depth',
    depth: 'balanced',
    badge: 'Depth',
  },
  {
    command: '/deep',
    label: 'Deep Depth',
    description: 'Exhaustive architecture, edge cases & production detail',
    kind: 'depth',
    depth: 'deep',
    badge: 'Depth',
  },
]);

/**
 * Matches slash commands when the composer prompt begins with `/` and has no space yet.
 * Returns an empty array once the user has moved past the slash token.
 */
export function matchSlashCommands(prompt: string): readonly SlashCommandItem[] {
  const trimmedStart = prompt.trimStart();
  if (!trimmedStart.startsWith('/')) {
    return Object.freeze([]);
  }
  // Only keep slash menu open while typing the leading command token
  if (/\s/.test(trimmedStart)) {
    return Object.freeze([]);
  }
  const needle = trimmedStart.toLowerCase();
  if (needle === '/') {
    return SLASH_COMMANDS;
  }
  const query = needle.slice(1);
  const matched = SLASH_COMMANDS.filter(
    (item) =>
      item.command.slice(1).startsWith(query) ||
      item.label.toLowerCase().startsWith(query),
  ).sort((a, b) => {
    const aExact = a.command.slice(1).startsWith(query) ? 0 : 1;
    const bExact = b.command.slice(1).startsWith(query) ? 0 : 1;
    return aExact - bExact;
  });
  return Object.freeze(matched);
}

/**
 * Strips a leading `/command` token from a prompt after selection, preserving any trailing text.
 */
export function stripLeadingSlashCommand(prompt: string): string {
  const trimmedStart = prompt.trimStart();
  if (!trimmedStart.startsWith('/')) {
    return prompt;
  }
  const spaceIdx = trimmedStart.search(/\s/);
  if (spaceIdx === -1) {
    return '';
  }
  return trimmedStart.slice(spaceIdx).trimStart();
}

export type ConversationDateGroupKey =
  | 'pinned'
  | 'today'
  | 'yesterday'
  | 'previous_7_days'
  | 'earlier';

export interface DecoratedConversation extends PlatformConversation {
  readonly displayTitle: string;
  readonly isPinned: boolean;
}

export interface ConversationDateGroup {
  readonly key: ConversationDateGroupKey;
  readonly label: string;
  readonly items: readonly DecoratedConversation[];
}

const GROUP_LABELS: Readonly<Record<ConversationDateGroupKey, string>> = Object.freeze({
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  previous_7_days: 'Previous 7 Days',
  earlier: 'Earlier',
});

const GROUP_ORDER: readonly ConversationDateGroupKey[] = Object.freeze([
  'pinned',
  'today',
  'yesterday',
  'previous_7_days',
  'earlier',
]);

/**
 * Groups conversations into Pinned, Today, Yesterday, Previous 7 Days, and Earlier
 * while applying user-customized title overrides cleanly.
 */
export function groupConversationsByDate(
  conversations: readonly PlatformConversation[],
  pinnedIds: ReadonlySet<string>,
  titleOverrides: Readonly<Record<string, string>>,
  nowMs = Date.now(),
): readonly ConversationDateGroup[] {
  const nowDate = new Date(nowMs);
  const startOfToday = new Date(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate(),
  ).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
  const startOf7Days = startOfToday - 7 * 24 * 60 * 60 * 1000;

  const buckets: Record<ConversationDateGroupKey, DecoratedConversation[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    previous_7_days: [],
    earlier: [],
  };

  for (const conv of conversations) {
    const customTitle = titleOverrides[conv.conversationId]?.trim();
    const isPinned = pinnedIds.has(conv.conversationId);
    const decorated: DecoratedConversation = {
      ...conv,
      displayTitle: customTitle || conv.title,
      isPinned,
    };

    if (isPinned) {
      buckets.pinned.push(decorated);
      continue;
    }

    const updatedMs = Date.parse(conv.updatedAt || conv.createdAt);
    if (!Number.isFinite(updatedMs) || updatedMs >= startOfToday) {
      buckets.today.push(decorated);
    } else if (updatedMs >= startOfYesterday) {
      buckets.yesterday.push(decorated);
    } else if (updatedMs >= startOf7Days) {
      buckets.previous_7_days.push(decorated);
    } else {
      buckets.earlier.push(decorated);
    }
  }

  return Object.freeze(
    GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
      key,
      label: GROUP_LABELS[key],
      items: Object.freeze(buckets[key]),
    })),
  );
}

/**
 * Collects all canvas-capable artifacts generated in the active conversation in chronological order,
 * deduplicated by `artifactId`.
 */
export function extractThreadArtifacts(
  messages: readonly PlatformMessage[],
): readonly ArtifactRecord[] {
  const seen = new Set<string>();
  const collected: ArtifactRecord[] = [];

  for (const msg of messages) {
    for (const art of msg.artifacts ?? []) {
      if (!seen.has(art.artifactId)) {
        seen.add(art.artifactId);
        collected.push(art);
      }
    }
  }

  return Object.freeze(collected);
}

export interface ArtifactMetaSummary {
  readonly typeLabel: string;
  readonly shortBadge: string;
  readonly detailLabel: string;
}

/**
 * Formats crisp unboxed metadata for any artifact type (Code, PDF, PPT, Image)
 * used on inline SpotlightCard launchers and the Universal Split Canvas header.
 */
export function formatArtifactMetaSummary(
  artifact: ArtifactRecord,
): ArtifactMetaSummary {
  if (artifact.artifactType === 'code_bundle') {
    const fileCount = artifact.filesManifest.length;
    return {
      typeLabel: 'Interactive Web App',
      shortBadge: 'Code',
      detailLabel: `${fileCount} ${fileCount === 1 ? 'file' : 'files'} · Live sandbox`,
    };
  }

  if (artifact.artifactType === 'pdf_document') {
    const kb = Math.max(1, Math.round(artifact.sizeBytes / 1024));
    return {
      typeLabel: 'Editorial PDF Report',
      shortBadge: 'PDF',
      detailLabel: `%PDF-1.4 · ${kb} KB`,
    };
  }

  if (artifact.artifactType === 'ppt_presentation') {
    const specFile = artifact.filesManifest.find((f) =>
      f.path.endsWith('slides-spec.json'),
    );
    let slideCount = 8;
    if (specFile?.content) {
      try {
        const parsed = JSON.parse(specFile.content) as {
          readonly slideCount?: number;
          readonly slides?: readonly unknown[];
          readonly spec?: { readonly slides?: readonly unknown[] };
        };
        if (typeof parsed.slideCount === 'number' && parsed.slideCount > 0) {
          slideCount = parsed.slideCount;
        } else if (
          Array.isArray(parsed.spec?.slides) &&
          parsed.spec.slides.length > 0
        ) {
          slideCount = parsed.spec.slides.length;
        } else if (Array.isArray(parsed.slides) && parsed.slides.length > 0) {
          slideCount = parsed.slides.length;
        }
      } catch {
        // Keep default 8-slide label
      }
    }
    return {
      typeLabel: '16:9 Slide Deck',
      shortBadge: 'Deck',
      detailLabel: `${slideCount} slides · OpenXML .pptx`,
    };
  }

  const kb = Math.max(1, Math.round(artifact.sizeBytes / 1024));
  return {
    typeLabel: 'Studio Artwork',
    shortBadge: 'Image',
    detailLabel: `${artifact.mimeType.replace(/^image\//i, '').toUpperCase()} · ${kb} KB`,
  };
}

export interface CommandPaletteSearchable {
  readonly id: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly keywords?: readonly string[];
}

/**
 * Case-insensitive token matcher for the Cmd+K Command Palette.
 */
export function filterCommandPaletteItems<T extends CommandPaletteSearchable>(
  items: readonly T[],
  query: string,
): readonly T[] {
  const cleaned = query.trim().toLowerCase();
  if (!cleaned) {
    return items;
  }
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  return Object.freeze(
    items.filter((item) => {
      const haystack = [
        item.label,
        item.subtitle ?? '',
        ...(item.keywords ?? []),
      ]
        .join(' ')
        .toLowerCase();
      return tokens.every((tok) => haystack.includes(tok));
    }),
  );
}

/**
 * Clamps Universal Artifact Canvas split width percentage to safe desktop ergonomics.
 */
export function clampCanvasWidthPct(widthPct: number): number {
  if (!Number.isFinite(widthPct)) {
    return 48;
  }
  return Math.max(34, Math.min(66, Math.round(widthPct * 10) / 10));
}

/**
 * Builds a calm, human time-of-day hero greeting for fresh empty chats.
 */
export function getTimeOfDayGreeting(
  hour: number,
  displayName?: string | null,
): string {
  const period =
    hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = displayName?.trim().split(/\s+/)[0];
  return firstName ? `${period}, ${firstName}` : period;
}

export type CreditLedgerFilter = 'all' | 'credits' | 'debits';

export interface CreditLedgerSummary {
  readonly totalAdded: number;
  readonly totalSpent: number;
  readonly topUpCount: number;
  readonly usageCount: number;
  readonly totalEntries: number;
}

/**
 * Summarizes immutable credit ledger entries into total credits added, spent, and event counts.
 */
export function summarizeCreditLedger(
  ledger: readonly Pick<
    import('../types/index.js').PlatformLedgerEntry,
    'deltaCredits'
  >[],
): CreditLedgerSummary {
  let totalAdded = 0;
  let totalSpent = 0;
  let topUpCount = 0;
  let usageCount = 0;

  for (const entry of ledger) {
    if (entry.deltaCredits >= 0) {
      totalAdded += entry.deltaCredits;
      topUpCount += 1;
    } else {
      totalSpent += Math.abs(entry.deltaCredits);
      usageCount += 1;
    }
  }

  return {
    totalAdded,
    totalSpent,
    topUpCount,
    usageCount,
    totalEntries: ledger.length,
  };
}

/**
 * Filters credit ledger rows by direction (`all` | `credits` | `debits`) and search query.
 */
export function filterCreditLedger<
  T extends Pick<
    import('../types/index.js').PlatformLedgerEntry,
    'description' | 'requestId' | 'deltaCredits'
  >,
>(
  ledger: readonly T[],
  filter: CreditLedgerFilter,
  query: string,
): readonly T[] {
  const needle = query.trim().toLowerCase();
  return Object.freeze(
    ledger.filter((entry) => {
      if (filter === 'credits' && entry.deltaCredits < 0) return false;
      if (filter === 'debits' && entry.deltaCredits >= 0) return false;
      if (!needle) return true;
      return (
        entry.description.toLowerCase().includes(needle) ||
        entry.requestId.toLowerCase().includes(needle)
      );
    }),
  );
}

/**
 * Formats integer paise / credits into exact INR-per-credit unit pricing (e.g. "₹0.33 / cr").
 */
export function formatPlanUnitPrice(
  amountPaise: number,
  creditsGranted: number,
): string {
  if (!Number.isFinite(amountPaise) || !Number.isFinite(creditsGranted) || creditsGranted <= 0) {
    return '—';
  }
  const rupeesPerCredit = amountPaise / 100 / creditsGranted;
  return `₹${rupeesPerCredit.toFixed(2)} / cr`;
}

/**
 * Converts internal billing plan IDs into clean, human-readable tier labels.
 */
export function formatPlanDisplayName(planId: string): string {
  switch (planId) {
    case 'plan_pro_499':
      return 'Pro Plan';
    case 'plan_starter_199':
      return 'Starter Plan';
    case 'plan_free':
      return 'Free Workspace';
    default:
      return planId
        .replace(/^plan_/, '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
}

export interface SpecialistRateCapacity {
  readonly id: SpecialistAgentName;
  readonly label: string;
  readonly costCredits: number;
  readonly estimatedRuns: number;
  readonly summary: string;
}

const SPECIALIST_RATE_TABLE: ReadonlyArray<{
  readonly id: SpecialistAgentName;
  readonly label: string;
  readonly costCredits: number;
  readonly summary: string;
}> = Object.freeze([
  { id: 'chat', label: 'Unified Chat', costCredits: 1, summary: 'Adaptive 5-mode reasoning & smart routing' },
  { id: 'search', label: 'Web Search', costCredits: 2, summary: 'Live Google grounding & cited synthesis' },
  { id: 'rag', label: 'PDF RAG', costCredits: 2, summary: 'Hybrid semantic + BM25 document Q&A' },
  { id: 'vision', label: 'Vision OCR', costCredits: 3, summary: 'Tables, receipts, diagrams & UI audits' },
  { id: 'coding', label: 'Coding Sandbox', costCredits: 5, summary: 'Interactive 3-file web apps & live IDE' },
  { id: 'pdf', label: 'PDF Report', costCredits: 5, summary: 'Editorial %PDF-1.4 reports with KPIs & tables' },
  { id: 'ppt', label: 'PPT Studio', costCredits: 8, summary: '16:9 keynote decks with speaker notes & .pptx' },
  { id: 'image', label: 'Image Studio', costCredits: 10, summary: 'Art-directed visuals & image-to-image restyling' },
]);

/**
 * Calculates how many specialist runs the user's current available credit balance supports.
 */
export function computeCreditCapacity(
  availableCredits: number,
): readonly SpecialistRateCapacity[] {
  const safeBalance = Math.max(0, Math.floor(Number.isFinite(availableCredits) ? availableCredits : 0));
  return Object.freeze(
    SPECIALIST_RATE_TABLE.map((row) => ({
      ...row,
      estimatedRuns: Math.floor(safeBalance / row.costCredits),
    })),
  );
}

/* ── Fix #24 Pure Helpers: Scramble Hero, Fluid Streaming Pacing & Thread Artifact Icons ── */

export const HERO_SCRAMBLE_LINES: readonly string[] = Object.freeze([
  'Sharks existed before trees, flowers, and even the rings of Saturn.',
  'Sloths can hold their breath underwater longer than dolphins — up to 40 minutes.',
  'Wombats are the only known animals on Earth that produce cube-shaped poop.',
  'The inventor of the Pringles can had part of his ashes buried inside one.',
  'Mantis shrimp punch so fast they create tiny underwater flashes of light.',
  "Scotland's official national animal has been the unicorn since the 1400s.",
  'One species of jellyfish can reset its own cells and age in reverse.',
  'Oxford University was teaching students 200 years before the Aztec Empire began.',
  'A single fluffy cumulus cloud can weigh over a million pounds — roughly 100 elephants.',
  'Astronauts say outer space smells like seared steak, hot metal, and gunpowder.',
  'In 1932, Australia fought a real military war against emus — and lost.',
  'A single teaspoon of a neutron star would weigh roughly as much as Mount Everest.',
  'Butterflies can still remember things they learned back when they were caterpillars.',
  'Cows form genuine best friendships and get stressed when separated from them.',
]);

const DEFAULT_SCRAMBLE_CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789·/—';

/**
 * Computes a deterministic scramble-to-settle text frame (inspired by 21st.dev motion-scramble-text).
 * Spaces and trailing punctuation stay stable so lines never jitter horizontally.
 */
export function computeScrambleFrame(
  target: string,
  progress: number,
  seed = 0,
  charset = DEFAULT_SCRAMBLE_CHARSET,
): string {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 1));
  if (clamped >= 1 || target.length === 0) {
    return target;
  }

  const settledCount = Math.floor(clamped * target.length);
  const activeWindowEnd = Math.min(target.length, settledCount + 8);
  const chars = Array.from(target);
  const poolLen = Math.max(1, charset.length);

  for (let i = settledCount; i < chars.length; i += 1) {
    const ch = chars[i] ?? '';
    if (ch === ' ' || ch === '.' || ch === ',' || ch === '&' || ch === '—') {
      continue;
    }
    if (i < activeWindowEnd) {
      const idx = Math.abs((i * 17 + seed * 31 + settledCount * 7) % poolLen);
      chars[i] = charset[idx] ?? ch;
    } else {
      const idx = Math.abs((i * 13 + seed * 19) % poolLen);
      chars[i] = charset[idx] ?? ch;
    }
  }

  return chars.join('');
}

/**
 * Adaptive character-per-frame pacing for fluid Gemini-like streaming text reveal.
 * Short replies glide smoothly letter-by-letter; long technical briefs accelerate
 * gently so reading feels effortless without stalling.
 */
export function computeStreamStepChars(
  totalLength: number,
  remainingChars: number,
): number {
  if (!Number.isFinite(totalLength) || !Number.isFinite(remainingChars) || remainingChars <= 0) {
    return 0;
  }
  const baseStep =
    totalLength <= 180
      ? 2
      : totalLength <= 650
        ? 4
        : totalLength <= 1600
          ? 8
          : 14;
  return Math.min(remainingChars, baseStep);
}

/**
 * Infers a subtle monochrome artifact badge for a sidebar conversation row
 * from recorded thread artifacts or title keywords.
 */
export function inferConversationArtifactKind(
  title: string,
  recordedType?: ArtifactRecord['artifactType'] | null,
): ArtifactRecord['artifactType'] | null {
  if (recordedType) {
    return recordedType;
  }
  const lower = title.toLowerCase();
  if (/\b(pptx|slides?|deck|presentation|keynote)\b/.test(lower)) {
    return 'ppt_presentation';
  }
  if (/\b(pdf|report|brief|whitepaper|proposal)\b/.test(lower)) {
    return 'pdf_document';
  }
  if (/\b(image|artwork|poster|logo|render|illustration|pavilion|photo)\b/.test(lower)) {
    return 'generated_image';
  }
  if (/\b(code|app|sandbox|calculator|dashboard|html|react|script|game)\b/.test(lower)) {
    return 'code_bundle';
  }
  return null;
}

export interface LiveStreamProgressState {
  readonly agent: SpecialistAgentName;
  readonly stage: string;
  readonly stageLabel: string;
  readonly partialText: string;
}

export interface ParsedSseEvent {
  readonly event: string;
  readonly data: string;
}

/**
 * Parses a single Server-Sent Events (SSE) frame block (delimited by `\n\n`)
 * into its `event` name (default `'message'`) and concatenated `data` payload.
 */
export function parseSseEventBlock(block: string): ParsedSseEvent | null {
  const normalized = block.replace(/\r\n/g, '\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const rawLine of normalized.split('\n')) {
    if (!rawLine || rawLine.startsWith(':')) {
      continue;
    }
    const colonIdx = rawLine.indexOf(':');
    const field = colonIdx === -1 ? rawLine : rawLine.slice(0, colonIdx);
    let value = colonIdx === -1 ? '' : rawLine.slice(colonIdx + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event' && value.trim()) {
      eventName = value.trim();
    } else if (field === 'data') {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return Object.freeze({
    event: eventName,
    data: dataLines.join('\n'),
  });
}

let cachedCrc32Table: Uint32Array | null = null;

function getCrc32Table(): Uint32Array {
  if (cachedCrc32Table) {
    return cachedCrc32Table;
  }
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  cachedCrc32Table = table;
  return table;
}

function computeCrc32(bytes: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = table[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function writeU16LE(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value & 0xffff, true);
}

function writeU32LE(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value >>> 0, true);
}

/**
 * Pure, zero-dependency PKZIP (uncompressed STORE method 0) archive builder for browser & Node.
 * Generates a standards-compliant `.zip` byte array suitable for one-click Code Sandbox export.
 */
export function buildClientZipBytes(
  files: ReadonlyArray<{ readonly path: string; readonly content: string | Uint8Array }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const rawFile of files) {
    const cleanPath = rawFile.path
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .trim();
    if (!cleanPath) continue;

    const nameBytes = encoder.encode(cleanPath);
    const dataBytes =
      typeof rawFile.content === 'string'
        ? encoder.encode(rawFile.content)
        : rawFile.content;
    const crc = computeCrc32(dataBytes);

    // Local File Header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    writeU32LE(lv, 0, 0x04034b50); // Local header signature
    writeU16LE(lv, 4, 20); // Version needed (2.0)
    writeU16LE(lv, 6, 0x0800); // UTF-8 filename flag
    writeU16LE(lv, 8, 0); // Method 0 (STORE)
    writeU16LE(lv, 10, 0); // Mod time
    writeU16LE(lv, 12, 0); // Mod date
    writeU32LE(lv, 14, crc);
    writeU32LE(lv, 18, dataBytes.length);
    writeU32LE(lv, 22, dataBytes.length);
    writeU16LE(lv, 26, nameBytes.length);
    writeU16LE(lv, 28, 0);
    localHeader.set(nameBytes, 30);

    // Central Directory Header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    writeU32LE(cv, 0, 0x02014b50); // Central directory signature
    writeU16LE(cv, 4, 20); // Version made by
    writeU16LE(cv, 6, 20); // Version needed
    writeU16LE(cv, 8, 0x0800); // UTF-8 flag
    writeU16LE(cv, 10, 0); // Method 0 (STORE)
    writeU16LE(cv, 12, 0);
    writeU16LE(cv, 14, 0);
    writeU32LE(cv, 16, crc);
    writeU32LE(cv, 20, dataBytes.length);
    writeU32LE(cv, 24, dataBytes.length);
    writeU16LE(cv, 28, nameBytes.length);
    writeU16LE(cv, 30, 0);
    writeU16LE(cv, 32, 0);
    writeU16LE(cv, 34, 0);
    writeU16LE(cv, 36, 0);
    writeU32LE(cv, 38, 0);
    writeU32LE(cv, 42, localOffset);
    centralHeader.set(nameBytes, 46);

    localParts.push(localHeader, dataBytes);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const entryCount = centralParts.length;

  // End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  writeU32LE(ev, 0, 0x06054b50);
  writeU16LE(ev, 4, 0);
  writeU16LE(ev, 6, 0);
  writeU16LE(ev, 8, entryCount);
  writeU16LE(ev, 10, entryCount);
  writeU32LE(ev, 12, centralSize);
  writeU32LE(ev, 16, localOffset);
  writeU16LE(ev, 20, 0);

  const totalLength = localOffset + centralSize + eocd.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(eocd, cursor);
  return output;
}

/**
 * Exports a full conversation thread (prompts, assistant responses, citations, and artifact summaries)
 * as clean GitHub-Flavored Markdown (`.md`).
 */
export function buildConversationMarkdownExport(
  title: string,
  messages: readonly PlatformMessage[],
): string {
  const cleanTitle = title.trim() || 'Kartik.ai Conversation';
  const exportedOn = new Date().toISOString().slice(0, 10);
  const lines: string[] = [
    `# ${cleanTitle}`,
    '',
    `> Exported from Kartik.ai on ${exportedOn} · ${messages.length} message${messages.length === 1 ? '' : 's'}`,
    '',
  ];

  for (const msg of messages) {
    const roleLabel =
      msg.role === 'user'
        ? 'You'
        : `Kartik.ai (${msg.agentUsed ? msg.agentUsed.toUpperCase() : 'ASSISTANT'})`;
    lines.push(`## ${roleLabel}`, '');
    lines.push((msg.content || '').trim(), '');

    if (msg.citations && msg.citations.length > 0) {
      lines.push('**Sources:**');
      for (const cite of msg.citations) {
        lines.push(`- ${cite.title} (${cite.urlOrPage})`);
      }
      lines.push('');
    }

    if (msg.artifacts && msg.artifacts.length > 0) {
      lines.push('**Generated Artifacts:**');
      for (const art of msg.artifacts) {
        lines.push(`- ${art.title} (\`${art.artifactType}\`, ${Math.max(1, Math.round(art.sizeBytes / 1024))} KB)`);
      }
      lines.push('');
    }

    lines.push('---', '');
  }

  return lines.join('\n').trim();
}

/**
 * Builds a structured `PdfDocumentSpec`-compatible payload for exporting an active conversation
 * thread as a cleanly formatted `%PDF-1.4` transcript via `POST /api/v1/artifacts/recompile`.
 */
export function buildConversationTranscriptPdfSpec(
  title: string,
  messages: readonly PlatformMessage[],
): {
  readonly title: string;
  readonly subtitle: string;
  readonly documentType: 'general_guide';
  readonly author: string;
  readonly generatedDate: string;
  readonly executiveSummary: string;
  readonly keyMetrics: ReadonlyArray<{ readonly label: string; readonly value: string }>;
  readonly sections: ReadonlyArray<{
    readonly heading: string;
    readonly content: string;
    readonly bullets: readonly string[];
  }>;
  readonly footer: string;
} {
  const cleanTitle = title.trim() || 'Kartik.ai Conversation Transcript';
  const generatedDate = new Date().toISOString().slice(0, 10);
  const userTurns = messages.filter((m) => m.role === 'user').length;
  const assistantTurns = messages.filter((m) => m.role === 'assistant').length;
  const totalArtifacts = messages.reduce(
    (sum, m) => sum + (m.artifacts?.length ?? 0),
    0,
  );

  const stripMd = (raw: string) =>
    raw
      .replace(/```[\s\S]*?```/g, '[Code Block]')
      .replace(/[#*_`>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const sections: Array<{
    readonly heading: string;
    readonly content: string;
    readonly bullets: readonly string[];
  }> = [];

  for (let i = 0; i < messages.length && sections.length < 10; i += 1) {
    const msg = messages[i]!;
    const cleanBody = stripMd(msg.content || '');
    const heading =
      msg.role === 'user'
        ? `Prompt ${Math.ceil((i + 1) / 2)}`
        : `Response (${(msg.agentUsed ?? 'chat').toUpperCase()})`;
    const bullets: string[] = [];
    if (msg.citations && msg.citations.length > 0) {
      for (const c of msg.citations.slice(0, 4)) {
        bullets.push(`Source: ${c.title} (${c.urlOrPage})`);
      }
    }
    if (msg.artifacts && msg.artifacts.length > 0) {
      for (const a of msg.artifacts.slice(0, 3)) {
        bullets.push(`Artifact: ${a.title} [${a.artifactType}]`);
      }
    }
    sections.push({
      heading,
      content: cleanBody.slice(0, 1100) || '(No text content)',
      bullets,
    });
  }

  if (sections.length === 0) {
    sections.push({
      heading: 'Empty Session',
      content: 'No messages recorded in this conversation yet.',
      bullets: [],
    });
  }

  return {
    title: cleanTitle,
    subtitle: `Conversation Transcript · Exported ${generatedDate}`,
    documentType: 'general_guide',
    author: 'Kartik.ai Workspace',
    generatedDate,
    executiveSummary: `Complete exported transcript for "${cleanTitle}" containing ${messages.length} total message(s) across ${userTurns} prompt(s) and ${assistantTurns} specialist response(s).`,
    keyMetrics: [
      { label: 'Total Messages', value: String(messages.length) },
      { label: 'Prompts', value: String(userTurns) },
      { label: 'Responses', value: String(assistantTurns) },
      { label: 'Artifacts', value: String(totalArtifacts) },
    ],
    sections,
    footer: 'Exported from Kartik.ai',
  };
}



