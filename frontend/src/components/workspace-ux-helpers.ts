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
          readonly slides?: readonly unknown[];
        };
        if (Array.isArray(parsed.slides) && parsed.slides.length > 0) {
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

