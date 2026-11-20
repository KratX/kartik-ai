/**
 * @kartik/agent/services/web-search-engine — Pure Web Retrieval, SSRF-Safe Page Reader,
 * Real Thumbnail Extraction, Citation Normalization & Follow-Up Synthesis Helpers (Fix #14).
 */

import type {
  SearchImageGalleryItem,
  SearchResultItem,
} from '../models/index.js';

export interface GeminiGroundingSupport {
  readonly segment?: {
    readonly startIndex?: number;
    readonly endIndex?: number;
    readonly text?: string;
  };
  readonly groundingChunkIndices?: readonly number[];
}

export function decodeHtmlAndXmlEntities(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const n = Number.parseInt(hex, 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    })
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCodePoint(n) : '';
    })
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractXmlTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1] ? decodeHtmlAndXmlEntities(match[1]) : '';
}

function extractXmlAttribute(block: string, tag: string, attr: string): string {
  const match = block.match(
    new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']+)["'][^>]*>`, 'i'),
  );
  return match?.[1] ? decodeHtmlAndXmlEntities(match[1]) : '';
}

/**
 * Strict SSRF guard for any outbound URL fetched by the Web Search page reader
 * or surfaced as an image thumbnail.
 */
export function isSafePublicHttpUrl(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.length > 2_048) {
    return false;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return false;
  }
  if (parsed.username || parsed.password) {
    return false;
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || !host.includes('.') && !host.includes(':')) {
    return false;
  }
  if (
    host === 'localhost' ||
    host === 'metadata.google.internal' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost') ||
    host.endsWith('.arpa')
  ) {
    return false;
  }

  // Block IPv4 loopback, private RFC1918, link-local/cloud metadata, CGNAT, and 0.0.0.0/8
  const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const a = Number(ipv4Match[1]);
    const b = Number(ipv4Match[2]);
    const c = Number(ipv4Match[3]);
    const d = Number(ipv4Match[4]);
    if ([a, b, c, d].some((oct) => oct < 0 || oct > 255)) {
      return false;
    }
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      a >= 224
    ) {
      return false;
    }
  }

  // Block IPv6 loopback, unspecified, ULA (fc00::/7), link-local (fe80::/10), and IPv4-mapped
  if (host.includes(':')) {
    if (
      host === '::1' ||
      host === '::' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe8') ||
      host.startsWith('fe9') ||
      host.startsWith('fea') ||
      host.startsWith('feb') ||
      host.includes('::ffff:')
    ) {
      return false;
    }
  }

  return true;
}

/**
 * Extracts a crisp, readable domain (e.g. `postgresql.org`, `reuters.com`) from a URL.
 * Handles Vertex AI grounding redirect URLs gracefully by inspecting `fallbackTitle`
 * when it already represents a clean hostname.
 */
export function extractCleanDomain(rawUrl: string, fallbackTitle?: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (
      host.includes('vertexaisearch.cloud.google.com') ||
      host === 'news.google.com'
    ) {
      const candidate = (fallbackTitle ?? '').trim().toLowerCase().replace(/^www\./, '');
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(candidate)) {
        return candidate;
      }
      if (host === 'news.google.com') {
        return 'news.google.com';
      }
      return 'google.com';
    }
    return host;
  } catch {
    return 'web';
  }
}

export function cleanPublicSearchQuery(rawQuery: string): string {
  const stripped = rawQuery
    .trim()
    .replace(
      /^(?:please\s+)?(?:(?:do\s+a\s+)?web\s*search|search(?:\s+the\s+web|\s+online|\s+google)?|google|look\s+up|find(?:\s+info|\s+information)?)\s+(?:for\s+|about\s+|on\s+)?/i,
      '',
    )
    .replace(/\s+and\s+cite\s+sources\.?$/i, '')
    .trim();
  return stripped.length >= 2 ? stripped : rawQuery.trim();
}

export function isTimeSensitiveQuery(query: string): boolean {
  return /\b(latest|today|now|news|recent|current|2025|2026|2027|price|release|launch|score|winner|won|update|breaking|announced|stock|weather|election)\b/i.test(
    query,
  );
}

export function isTechnicalQuery(query: string): boolean {
  return /\b(postgres|postgresql|node\.?js|typescript|javascript|react|rust|python|go|golang|docker|kubernetes|k8s|redis|sql|database|api|llm|gemini|openai|anthropic|benchmark|compiler|git|github|linux|aws|cloud|wasm|vite|next\.?js|mvcc|raft|microservices|security|cve|framework|sdk|cli)\b/i.test(
    query,
  );
}

function formatShortDate(rawDate: string): string | undefined {
  const trimmed = rawDate.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed
      .replace(/^[A-Za-z]+,\s*/, '')
      .replace(/\s+\d{2}:\d{2}:\d{2}\s+GMT$/i, '')
      .slice(0, 24);
  }
  return parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export async function fetchGoogleNewsRssResults(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const q = encodeURIComponent(query.trim());
  const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KartikAI/1.0 (+https://kartik.ai)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return [];
  }
  const xml = await res.text();
  const items: SearchResultItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = match[1] ?? '';
    const title = extractXmlTag(block, 'title');
    const link = extractXmlTag(block, 'link');
    const pubDate = extractXmlTag(block, 'pubDate');
    const sourceName = extractXmlTag(block, 'source');
    const sourceHomeUrl = extractXmlAttribute(block, 'source', 'url');
    if (!title || !link || !isSafePublicHttpUrl(link)) {
      continue;
    }
    const publishedAt = formatShortDate(pubDate);
    const domain = sourceHomeUrl
      ? extractCleanDomain(sourceHomeUrl, sourceName)
      : extractCleanDomain(link, sourceName);
    const cleanHeadline =
      sourceName && title.endsWith(` - ${sourceName}`)
        ? title.slice(0, -(` - ${sourceName}`).length).trim()
        : title;
    const metaPrefix = [sourceName, publishedAt].filter(Boolean).join(' · ');
    items.push({
      title: title.slice(0, 140),
      url: link,
      snippet: metaPrefix ? `${metaPrefix}: ${cleanHeadline}` : cleanHeadline,
      domain,
      publishedAt,
      sourceType: 'news',
    });
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

export async function fetchWikipediaExtractResults(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const q = encodeURIComponent(query.trim());
  const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${q}&gsrlimit=${limit}&prop=extracts|info|pageimages&exintro=1&explaintext=1&exsentences=4&inprop=url&piprop=thumbnail&pithumbsize=640&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KartikAI/1.0 (+https://kartik.ai)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as {
    query?: {
      pages?: Record<
        string,
        {
          readonly index?: number;
          readonly title?: string;
          readonly fullurl?: string;
          readonly extract?: string;
          readonly thumbnail?: {
            readonly source?: string;
            readonly width?: number;
            readonly height?: number;
          };
        }
      >;
    };
  };
  const pages = Object.values(data.query?.pages ?? {}).sort(
    (a, b) => (a.index ?? 999) - (b.index ?? 999),
  );
  const items: SearchResultItem[] = [];
  for (const page of pages) {
    const title = (page.title ?? '').trim();
    const pageUrl =
      page.fullurl && isSafePublicHttpUrl(page.fullurl)
        ? page.fullurl
        : title
          ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
          : '';
    const extract = (page.extract ?? '').replace(/\s+/g, ' ').trim();
    if (!title || !pageUrl || !extract) {
      continue;
    }
    const thumbSrc = page.thumbnail?.source;
    const validThumb =
      thumbSrc &&
      isSafePublicHttpUrl(thumbSrc) &&
      !thumbSrc.toLowerCase().endsWith('.svg')
        ? thumbSrc
        : undefined;
    items.push({
      title: `${title} — Wikipedia`,
      url: pageUrl,
      snippet: extract.slice(0, 420),
      domain: 'en.wikipedia.org',
      imageUrl: validThumb,
      sourceType: 'encyclopedia',
    });
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

export async function fetchDuckDuckGoInstantResults(
  query: string,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const q = encodeURIComponent(query.trim());
  const url = `https://api.duckduckgo.com/?q=${q}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KartikAI/1.0 (+https://kartik.ai)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as {
    readonly Heading?: string;
    readonly AbstractText?: string;
    readonly AbstractURL?: string;
    readonly Image?: string;
    readonly RelatedTopics?: ReadonlyArray<{
      readonly Text?: string;
      readonly FirstURL?: string;
    }>;
  };

  const items: SearchResultItem[] = [];
  if (data.AbstractText && data.AbstractURL && isSafePublicHttpUrl(data.AbstractURL)) {
    const rawImg = data.Image
      ? data.Image.startsWith('http')
        ? data.Image
        : `https://duckduckgo.com${data.Image.startsWith('/') ? '' : '/'}${data.Image}`
      : undefined;
    const safeImg = rawImg && isSafePublicHttpUrl(rawImg) ? rawImg : undefined;
    items.push({
      title: (data.Heading || query).trim().slice(0, 140),
      url: data.AbstractURL,
      snippet: data.AbstractText.replace(/\s+/g, ' ').trim().slice(0, 380),
      domain: extractCleanDomain(data.AbstractURL),
      imageUrl: safeImg,
      sourceType: 'encyclopedia',
    });
  }

  for (const topic of data.RelatedTopics ?? []) {
    if (items.length >= 2) {
      break;
    }
    if (topic.Text && topic.FirstURL && isSafePublicHttpUrl(topic.FirstURL)) {
      items.push({
        title: topic.Text.split(' - ')[0]?.trim().slice(0, 120) || 'Related Reference',
        url: topic.FirstURL,
        snippet: topic.Text.replace(/\s+/g, ' ').trim().slice(0, 320),
        domain: extractCleanDomain(topic.FirstURL),
        sourceType: 'web',
      });
    }
  }
  return items;
}

export async function fetchHackerNewsResults(
  query: string,
  limit: number,
  timeoutMs: number,
): Promise<SearchResultItem[]> {
  const q = encodeURIComponent(query.trim());
  const url = `https://hn.algolia.com/api/v1/search?query=${q}&tags=story&hitsPerPage=${limit}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'KartikAI/1.0 (+https://kartik.ai)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    return [];
  }
  const data = (await res.json()) as {
    readonly hits?: ReadonlyArray<{
      readonly title?: string;
      readonly url?: string;
      readonly objectID?: string;
      readonly points?: number;
      readonly num_comments?: number;
      readonly created_at?: string;
    }>;
  };
  const items: SearchResultItem[] = [];
  for (const hit of data.hits ?? []) {
    const title = (hit.title ?? '').trim();
    const targetUrl =
      hit.url && isSafePublicHttpUrl(hit.url)
        ? hit.url
        : hit.objectID
          ? `https://news.ycombinator.com/item?id=${encodeURIComponent(hit.objectID)}`
          : '';
    if (!title || !targetUrl) {
      continue;
    }
    const publishedAt = hit.created_at ? formatShortDate(hit.created_at) : undefined;
    const metrics = [
      typeof hit.points === 'number' ? `${hit.points} pts` : null,
      typeof hit.num_comments === 'number' ? `${hit.num_comments} comments` : null,
      publishedAt,
    ]
      .filter(Boolean)
      .join(' · ');
    items.push({
      title: title.slice(0, 140),
      url: targetUrl,
      snippet: metrics ? `${title} (${metrics})` : title,
      domain: extractCleanDomain(targetUrl),
      publishedAt,
      sourceType: 'technical',
    });
    if (items.length >= limit) {
      break;
    }
  }
  return items;
}

/**
 * Extracts readable metadata (`og:image`, `meta description`, and clean paragraph excerpt)
 * from an HTML document string without external DOM dependencies.
 */
export function extractHtmlPageMetadata(
  html: string,
  pageUrl: string,
): {
  readonly excerpt?: string;
  readonly imageUrl?: string;
} {
  const findMeta = (pattern: RegExp): string | undefined => {
    const match = html.match(pattern);
    return match?.[1] ? decodeHtmlAndXmlEntities(match[1]) : undefined;
  };

  const ogDesc =
    findMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    findMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i);
  const metaDesc =
    findMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    findMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);

  const rawImg =
    findMeta(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    findMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["'][^>]*>/i) ??
    findMeta(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i) ??
    findMeta(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i);

  let imageUrl: string | undefined;
  if (rawImg) {
    try {
      const resolved = new URL(rawImg, pageUrl).toString();
      if (isSafePublicHttpUrl(resolved) && !/\.svg(?:$|\?)/i.test(resolved)) {
        imageUrl = resolved;
      }
    } catch {
      // Ignore malformed image URL
    }
  }

  // Pull up to 2 meaningful <p> paragraphs as supplementary excerpt
  const cleanedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  const paragraphs: string[] = [];
  for (const pMatch of cleanedHtml.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)) {
    const text = decodeHtmlAndXmlEntities(pMatch[1] ?? '');
    if (text.length >= 60 && !/cookie|subscribe|sign in|privacy policy/i.test(text)) {
      paragraphs.push(text);
    }
    if (paragraphs.length >= 2) {
      break;
    }
  }

  const candidateExcerpt = [ogDesc || metaDesc, ...paragraphs]
    .filter((v): v is string => Boolean(v && v.trim().length > 25))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    excerpt: candidateExcerpt ? candidateExcerpt.slice(0, 440) : undefined,
    imageUrl,
  };
}

/**
 * SSRF-safe lightweight page reader for top public web articles.
 * Caps response body to 64 KB and enforces a tight timeout (default 3s).
 */
export async function readPublicPageSnippet(
  url: string,
  timeoutMs = 3_000,
): Promise<{ readonly excerpt?: string; readonly imageUrl?: string } | null> {
  if (!isSafePublicHttpUrl(url)) {
    return null;
  }
  const domain = extractCleanDomain(url);
  // Skip known redirect/non-article hosts where HTML scraping adds latency without value
  if (
    domain === 'news.google.com' ||
    domain.includes('vertexaisearch.cloud.google.com') ||
    domain.endsWith('wikipedia.org') ||
    /\.pdf(?:$|\?)/i.test(url)
  ) {
    return null;
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'KartikAI/1.0 (+https://kartik.ai)',
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      return null;
    }
    if (res.url && !isSafePublicHttpUrl(res.url)) {
      return null;
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null;
    }

    const reader = res.body?.getReader();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder('utf-8');
      let totalBytes = 0;
      const MAX_BYTES = 65_536;
      while (totalBytes < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done || !value) {
          break;
        }
        totalBytes += value.byteLength;
        html += decoder.decode(value, { stream: true });
      }
      try {
        await reader.cancel();
      } catch {
        // Ignore cancel errors
      }
    } else {
      html = (await res.text()).slice(0, 65_536);
    }

    return extractHtmlPageMetadata(html, res.url || url);
  } catch {
    return null;
  }
}

export async function fetchMultiSourceLiveWebResults(
  query: string,
  maxItems = 6,
  options?: { readonly readTopPages?: boolean },
): Promise<SearchResultItem[]> {
  const cleanedQuery = cleanPublicSearchQuery(query);
  const perSourceLimit = Math.max(3, Math.min(5, maxItems));
  const timeoutMs = 5_500;
  const technical = isTechnicalQuery(cleanedQuery);

  const [newsSettled, wikiSettled, ddgSettled, hnSettled] = await Promise.allSettled([
    fetchGoogleNewsRssResults(cleanedQuery, perSourceLimit, timeoutMs),
    fetchWikipediaExtractResults(cleanedQuery, perSourceLimit, timeoutMs),
    fetchDuckDuckGoInstantResults(cleanedQuery, 3_500),
    technical
      ? fetchHackerNewsResults(cleanedQuery, perSourceLimit, 4_000)
      : Promise.resolve([] as SearchResultItem[]),
  ]);

  const newsItems = newsSettled.status === 'fulfilled' ? newsSettled.value : [];
  const wikiItems = wikiSettled.status === 'fulfilled' ? wikiSettled.value : [];
  const ddgItems = ddgSettled.status === 'fulfilled' ? ddgSettled.value : [];
  const hnItems = hnSettled.status === 'fulfilled' ? hnSettled.value : [];

  const merged: SearchResultItem[] = [];
  const seenUrls = new Set<string>();
  const pushItem = (item: SearchResultItem | undefined) => {
    if (!item || seenUrls.has(item.url) || merged.length >= maxItems) {
      return;
    }
    seenUrls.add(item.url);
    merged.push(item);
  };

  if (isTimeSensitiveQuery(query)) {
    // Lead with fresh news, then tech discussions (if technical), then Wikipedia/DDG context
    for (let i = 0; i < Math.max(newsItems.length, hnItems.length); i += 1) {
      pushItem(newsItems[i]);
      if (technical) {
        pushItem(hnItems[i]);
      }
    }
    for (const w of wikiItems) pushItem(w);
    for (const d of ddgItems) pushItem(d);
  } else if (technical) {
    // Interleave technical HN articles, Wikipedia definitions, DDG abstracts, and News
    const maxLen = Math.max(hnItems.length, wikiItems.length, newsItems.length, ddgItems.length);
    for (let i = 0; i < maxLen; i += 1) {
      pushItem(hnItems[i]);
      pushItem(wikiItems[i]);
      pushItem(ddgItems[i]);
      pushItem(newsItems[i]);
    }
  } else {
    // Interleave Wikipedia authoritative extracts, DDG instant answers, and Google News
    const maxLen = Math.max(wikiItems.length, ddgItems.length, newsItems.length);
    for (let i = 0; i < maxLen; i += 1) {
      pushItem(wikiItems[i]);
      pushItem(ddgItems[i]);
      pushItem(newsItems[i]);
    }
  }

  if (options?.readTopPages !== false && merged.length > 0) {
    // Enrich up to 2 eligible non-Wikipedia/non-redirect articles with actual page excerpts & og:image
    const candidates = merged
      .map((item, idx) => ({ item, idx }))
      .filter(({ item }) => {
        const domain = item.domain ?? extractCleanDomain(item.url);
        return (
          domain !== 'news.google.com' &&
          !domain.endsWith('wikipedia.org') &&
          !domain.includes('vertexaisearch.cloud.google.com')
        );
      })
      .slice(0, 2);

    if (candidates.length > 0) {
      const settledReads = await Promise.allSettled(
        candidates.map(({ item }) => readPublicPageSnippet(item.url, 3_000)),
      );
      settledReads.forEach((res, i) => {
        if (res.status === 'fulfilled' && res.value) {
          const targetIdx = candidates[i]!.idx;
          const prev = merged[targetIdx]!;
          merged[targetIdx] = {
            ...prev,
            snippet:
              res.value.excerpt && res.value.excerpt.length > prev.snippet.length
                ? res.value.excerpt
                : prev.snippet,
            imageUrl: prev.imageUrl ?? res.value.imageUrl,
          };
        }
      });
    }
  }

  return merged;
}

/**
 * Collects ONLY genuine verified `https://` web thumbnails (Wikimedia `pageimages`
 * and safe `og:image` URLs). Returns `[]` if no real image is available—never fabricates SVG placeholders.
 */
export function collectRealSearchImages(
  items: readonly SearchResultItem[],
  maxImages = 4,
): readonly SearchImageGalleryItem[] {
  const gallery: SearchImageGalleryItem[] = [];
  const seenImages = new Set<string>();

  for (const item of items) {
    const imgUrl = item.imageUrl?.trim();
    if (!imgUrl || seenImages.has(imgUrl) || !isSafePublicHttpUrl(imgUrl)) {
      continue;
    }
    if (/\.svg(?:$|\?)/i.test(imgUrl)) {
      continue;
    }
    seenImages.add(imgUrl);
    gallery.push(
      Object.freeze({
        id: `simg_${gallery.length + 1}`,
        title: item.title.slice(0, 80),
        imageUrl: imgUrl,
        sourceUrl: item.url,
        domain: item.domain ?? extractCleanDomain(item.url),
      }),
    );
    if (gallery.length >= maxImages) {
      break;
    }
  }

  return Object.freeze(gallery);
}

/**
 * Normalizes `[src_1]` / `[src_2]` markers into crisp `[1]` / `[2]` inline citation tokens
 * while leaving code fences untouched.
 */
export function normalizeInlineCitations(markdown: string, maxSourceCount: number): string {
  if (!markdown || maxSourceCount <= 0) {
    return markdown;
  }
  const normalized = markdown.replace(/\[src_(\d+)\]/gi, (match, numStr) => {
    const n = Number(numStr);
    if (Number.isInteger(n) && n >= 1 && n <= maxSourceCount) {
      return `[${n}]`;
    }
    return match;
  });
  return normalized;
}

/**
 * When Gemini `googleSearch` returns `groundingSupports` metadata and the model did not already
 * include inline `[1]` citation markers, inserts `[1]`/`[2]` markers at the exact grounded UTF-8 byte offsets.
 */
export function injectGroundingSupportCitations(
  text: string,
  supports: readonly GeminiGroundingSupport[] | undefined,
  maxSourceCount: number,
): string {
  if (!text || !supports || supports.length === 0 || maxSourceCount <= 0) {
    return text;
  }
  if (/\[\d+\]/.test(text) || /\[src_\d+\]/i.test(text)) {
    return normalizeInlineCitations(text, maxSourceCount);
  }

  const bytes = Buffer.from(text, 'utf8');
  const insertions: Array<{ readonly byteIndex: number; readonly marker: string }> = [];

  for (const support of supports) {
    const endIndex = support.segment?.endIndex;
    const indices = support.groundingChunkIndices ?? [];
    if (
      typeof endIndex !== 'number' ||
      endIndex <= 0 ||
      endIndex > bytes.length ||
      indices.length === 0
    ) {
      continue;
    }
    const validMarkers = [...new Set(indices)]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < maxSourceCount)
      .slice(0, 3)
      .map((i) => `[${i + 1}]`)
      .join('');
    if (validMarkers) {
      insertions.push({ byteIndex: endIndex, marker: validMarkers });
    }
  }

  if (insertions.length === 0) {
    return text;
  }

  // Sort descending by byte offset so splicing never shifts earlier indices
  insertions.sort((a, b) => b.byteIndex - a.byteIndex);
  let out = bytes;
  const seenOffsets = new Set<number>();
  for (const ins of insertions) {
    if (seenOffsets.has(ins.byteIndex)) {
      continue;
    }
    seenOffsets.add(ins.byteIndex);
    const markerBuf = Buffer.from(ins.marker, 'utf8');
    out = Buffer.concat([
      out.subarray(0, ins.byteIndex),
      markerBuf,
      out.subarray(ins.byteIndex),
    ]);
  }
  return out.toString('utf8');
}

export function buildDeterministicFollowUps(
  query: string,
  results: readonly SearchResultItem[],
): readonly string[] {
  const cleanTopic = cleanPublicSearchQuery(query)
    .replace(/[?!.]+$/, '')
    .trim()
    .slice(0, 72);
  if (!cleanTopic) {
    return Object.freeze([]);
  }

  const technical = isTechnicalQuery(cleanTopic);
  const timeSensitive = isTimeSensitiveQuery(cleanTopic);

  if (technical) {
    return Object.freeze([
      `What are the latest benchmarks and trade-offs for ${cleanTopic}?`,
      `How does ${cleanTopic} compare to leading alternatives in production?`,
      `What are the most common pitfalls when adopting ${cleanTopic}?`,
    ]);
  }

  if (timeSensitive) {
    return Object.freeze([
      `What is the broader context and timeline behind ${cleanTopic}?`,
      `What are the key reactions and expert analyses on ${cleanTopic}?`,
      `What happens next regarding ${cleanTopic}?`,
    ]);
  }

  const firstDomain = results[0]?.domain;
  return Object.freeze([
    `What are the most recent developments in ${cleanTopic}?`,
    `Compare key perspectives and trade-offs around ${cleanTopic}`,
    firstDomain
      ? `Deep dive into primary data and examples for ${cleanTopic}`
      : `Explain ${cleanTopic} with real-world examples`,
  ]);
}

/**
 * Splits a Gemini synthesis response that optionally ends with a `FOLLOW_UP_QUESTIONS:` block
 * into clean Markdown answer prose + up to 3 concise follow-up search queries.
 */
export function parseAnswerAndFollowUps(
  rawText: string,
  query: string,
  results: readonly SearchResultItem[],
): {
  readonly answer: string;
  readonly followUpQueries: readonly string[];
} {
  const markerMatch = rawText.match(/(?:^|\n)#{0,3}\s*FOLLOW_UP_QUESTIONS\s*:?\s*\n([\s\S]*)$/i);
  let answer = rawText.trim();
  const parsedFollowUps: string[] = [];

  if (markerMatch && typeof markerMatch.index === 'number') {
    answer = rawText.slice(0, markerMatch.index).trim();
    const block = markerMatch[1] ?? '';
    for (const line of block.split('\n')) {
      const cleaned = line
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .trim();
      if (cleaned.length >= 10 && cleaned.length <= 140) {
        parsedFollowUps.push(cleaned);
      }
      if (parsedFollowUps.length >= 3) {
        break;
      }
    }
  }

  const followUpQueries =
    parsedFollowUps.length >= 2
      ? Object.freeze(parsedFollowUps.slice(0, 3))
      : buildDeterministicFollowUps(query, results);

  return { answer, followUpQueries };
}
