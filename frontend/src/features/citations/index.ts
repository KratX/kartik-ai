/**
 * @kartik/frontend/features/citations — Grounded Citation & RAG Source Formatter (Micro-step 7.2.a).
 *
 * Enforces Blueprint §10 & §11:
 * 1. "Search answers must distinguish cited source material from synthesis. If search fails, say the lookup failed — never invent sources."
 * 2. "RAG answers must be grounded in retrieved chunks and cite document and page. If retrieval finds nothing useful, say so."
 * 3. "Never inject untrusted provider HTML into the application DOM."
 */

import { escapeHtmlEntities } from '../sandbox/index.js';
import type { MessageCitation, SpecialistAgentName } from '../../types/index.js';

export type CitationKind = 'web_url' | 'pdf_page' | 'blocked_unsafe';

export interface FormattedCitationBadge {
  readonly index: number;
  readonly sourceId: string;
  readonly kind: CitationKind;
  readonly safeTitle: string;
  readonly safeLocationLabel: string;
  readonly safeHref: string | null;
}

export interface GroundedMessagePresentation {
  readonly agentUsed: SpecialistAgentName | null;
  readonly groundingMode: 'rag_document' | 'web_search' | 'standard';
  readonly hasVerifiedSources: boolean;
  readonly groundingBannerText: string;
  readonly badges: readonly FormattedCitationBadge[];
}

const PDF_PAGE_PATTERN = /^(?:p\.?\s*|page\s+)\d+(?:\s*[-–]\s*\d+)?$/i;

/**
 * Validates a citation `urlOrPage` field:
 * - Allows `https://` and `http://` external web URLs (`kind: 'web_url'`).
 * - Recognizes PDF page locators such as `p. 4` or `page 12` (`kind: 'pdf_page'`, `safeHref: null`).
 * - Blocks dangerous schemes (`javascript:`, `data:`, `vbscript:`, `file:`) with `kind: 'blocked_unsafe'`
 *   and `safeHref: null` so untrusted search/PDF metadata can never execute script via citation links (§11).
 */
export function sanitizeExternalCitationUrl(rawUrlOrPage: string): {
  readonly kind: CitationKind;
  readonly safeHref: string | null;
  readonly safeLocationLabel: string;
} {
  const trimmed = (rawUrlOrPage ?? '').trim();
  if (PDF_PAGE_PATTERN.test(trimmed)) {
    return Object.freeze({
      kind: 'pdf_page',
      safeHref: null,
      safeLocationLabel: escapeHtmlEntities(trimmed),
    });
  }

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return Object.freeze({
        kind: 'web_url',
        safeHref: parsed.toString(),
        safeLocationLabel: escapeHtmlEntities(parsed.hostname),
      });
    }
  } catch {
    // Falls through to blocked_unsafe
  }

  return Object.freeze({
    kind: 'blocked_unsafe',
    safeHref: null,
    safeLocationLabel: 'unverified-locator',
  });
}

/**
 * Formats untrusted message citations into HTML-escaped, protocol-verified badges
 * and distinguishes RAG document grounding from web search synthesis (§10 & §11).
 */
export function formatGroundedCitations(input: {
  readonly agentUsed: SpecialistAgentName | null;
  readonly citations: readonly MessageCitation[];
}): GroundedMessagePresentation {
  const badges: FormattedCitationBadge[] = input.citations.map((cit, idx) => {
    const sanitized = sanitizeExternalCitationUrl(cit.urlOrPage);
    return Object.freeze({
      index: idx + 1,
      sourceId: escapeHtmlEntities(cit.sourceId),
      kind: sanitized.kind,
      safeTitle: escapeHtmlEntities(cit.title || `Source ${idx + 1}`),
      safeLocationLabel: sanitized.safeLocationLabel,
      safeHref: sanitized.safeHref,
    });
  });

  const validBadges = badges.filter((b) => b.kind !== 'blocked_unsafe');
  const hasVerifiedSources = validBadges.length > 0;

  if (input.agentUsed === 'rag') {
    return Object.freeze({
      agentUsed: 'rag',
      groundingMode: 'rag_document',
      hasVerifiedSources,
      groundingBannerText: hasVerifiedSources
        ? `Grounded in ${validBadges.length} retrieved document chunk(s) with page citations.`
        : 'No relevant chunks were retrieved from your uploaded PDF documents.',
      badges: Object.freeze(badges),
    });
  }

  if (input.agentUsed === 'search') {
    return Object.freeze({
      agentUsed: 'search',
      groundingMode: 'web_search',
      hasVerifiedSources,
      groundingBannerText: hasVerifiedSources
        ? `Synthesized from ${validBadges.length} cited web source(s).`
        : 'Web lookup returned no verified external sources.',
      badges: Object.freeze(badges),
    });
  }

  return Object.freeze({
    agentUsed: input.agentUsed,
    groundingMode: 'standard',
    hasVerifiedSources,
    groundingBannerText: 'Direct specialist response.',
    badges: Object.freeze(badges),
  });
}
