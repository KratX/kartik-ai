/**
 * @file src/server/seo.ts
 * @description Server-side SEO, robots.txt, XML sitemap, Web App Manifest,
 * canonical origin resolution, and Google Search Console verification injection.
 *
 * Pure, decoupled helpers verified by unit tests (`src/server/seo.test.ts`).
 */

export const DEFAULT_PRODUCTION_SITE_URL = 'https://kartik-ai-app.onrender.com';

export const SEO_BRAND_NAME = 'Kartik.ai';
export const SEO_TITLE = 'Kartik.ai — Multi-Agent AI Workspace';
export const SEO_DESCRIPTION =
  'Build live code, PDF reports, 16:9 slide decks, cited web research, and FLUX images in Kartik.ai — the all-in-one multi-agent AI workspace. Start free.';

function stripEnvQuotes(value?: string): string {
  return (value ?? '').trim().replace(/^["']|["']$/g, '');
}

function normalizeOrigin(rawUrl: string): string | null {
  const cleaned = stripEnvQuotes(rawUrl);
  if (!cleaned) {
    return null;
  }
  try {
    const withScheme = /^https?:\/\//i.test(cleaned)
      ? cleaned
      : `https://${cleaned}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export interface RequestHostHeaders {
  readonly host?: string | string[];
  readonly 'x-forwarded-host'?: string | string[];
  readonly 'x-forwarded-proto'?: string | string[];
}

function firstHeader(value?: string | string[]): string {
  if (typeof value === 'string') {
    return value.split(',')[0]?.trim() ?? '';
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0].split(',')[0]?.trim() ?? '';
  }
  return '';
}

/**
 * Resolves the canonical public origin for sitemap, robots.txt, OpenGraph, and JSON-LD.
 * Priority: PUBLIC_APP_URL > APP_URL > RENDER_EXTERNAL_URL > request Host > default Render URL.
 */
export function resolvePublicSiteUrl(
  env: Record<string, string | undefined> = process.env,
  headers?: RequestHostHeaders,
): string {
  const candidates = [
    env.PUBLIC_APP_URL,
    env.APP_URL,
    env.RENDER_EXTERNAL_URL,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeOrigin(candidate ?? '');
    if (normalized) {
      return normalized;
    }
  }

  if (headers) {
    const host =
      firstHeader(headers['x-forwarded-host']) || firstHeader(headers.host);
    if (host) {
      const protoHeader = firstHeader(headers['x-forwarded-proto']).toLowerCase();
      const isLocalHost =
        host.startsWith('localhost') ||
        host.startsWith('127.0.0.1') ||
        host.startsWith('[::1]');
      const proto =
        protoHeader === 'http' || protoHeader === 'https'
          ? protoHeader
          : isLocalHost
            ? 'http'
            : 'https';
      const normalized = normalizeOrigin(`${proto}://${host}`);
      if (normalized) {
        return normalized;
      }
    }
  }

  return DEFAULT_PRODUCTION_SITE_URL;
}

/**
 * Extracts a clean Google Search Console verification token from either a raw
 * token string OR a full pasted `<meta name="google-site-verification" content="..." />` tag.
 */
export function normalizeGoogleSiteVerificationToken(rawValue?: string): string | null {
  const cleaned = stripEnvQuotes(rawValue);
  if (!cleaned) {
    return null;
  }
  const metaMatch = cleaned.match(/content\s*=\s*["']([^"']+)["']/i);
  const token = (metaMatch?.[1] ?? cleaned).trim();
  if (!token || !/^[A-Za-z0-9._-]{8,128}$/.test(token)) {
    return null;
  }
  return token;
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates `/robots.txt` allowing public search & AI answer crawlers on the app
 * while keeping API endpoints, health probes, and dev downloads out of the index.
 */
export function buildRobotsTxt(siteUrl: string): string {
  const origin = normalizeOrigin(siteUrl) ?? DEFAULT_PRODUCTION_SITE_URL;
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /__downloads/',
    'Disallow: /healthz',
    'Disallow: /readyz',
    'Disallow: /ping',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Generates `/sitemap.xml` with Google Image Sitemap extension pointing to the OG banner.
 */
export function buildSitemapXml(
  siteUrl: string,
  lastModIso: string = new Date().toISOString().slice(0, 10),
): string {
  const origin = normalizeOrigin(siteUrl) ?? DEFAULT_PRODUCTION_SITE_URL;
  const safeOrigin = escapeXml(origin);
  const safeLastMod = escapeXml(lastModIso);
  const safeTitle = escapeXml(SEO_TITLE);
  const safeDesc = escapeXml(SEO_DESCRIPTION);

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
    '  <url>',
    `    <loc>${safeOrigin}/</loc>`,
    `    <lastmod>${safeLastMod}</lastmod>`,
    '    <changefreq>weekly</changefreq>',
    '    <priority>1.0</priority>',
    '    <image:image>',
    `      <image:loc>${safeOrigin}/og-image.jpg</image:loc>`,
    `      <image:title>${safeTitle}</image:title>`,
    `      <image:caption>${safeDesc}</image:caption>`,
    '    </image:image>',
    '  </url>',
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * Generates `/site.webmanifest` so Google Search, Android, and desktop browsers
 * recognize brand identity, theme color, and crisp icons.
 */
export function buildWebManifest(siteUrl: string): Record<string, unknown> {
  const origin = normalizeOrigin(siteUrl) ?? DEFAULT_PRODUCTION_SITE_URL;
  return {
    name: SEO_TITLE,
    short_name: SEO_BRAND_NAME,
    description: SEO_DESCRIPTION,
    id: `${origin}/`,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    categories: ['productivity', 'developer tools', 'utilities'],
    icons: [
      {
        src: '/favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
}

const STATIC_ASSET_EXTENSIONS = new Set([
  '.ico',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.svg',
  '.gif',
  '.css',
  '.js',
  '.mjs',
  '.cjs',
  '.map',
  '.json',
  '.xml',
  '.txt',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.pdf',
  '.zip',
  '.php',
  '.env',
]);

/**
 * Returns true when a request pathname looks like a static asset or file extension
 * so the SPA fallback returns a clean HTTP 404 instead of a Soft-404 HTML page.
 */
export function isStaticAssetRequestPath(pathname: string): boolean {
  const cleanPath = pathname.split('?')[0]?.trim().toLowerCase() ?? '';
  if (!cleanPath || cleanPath === '/') {
    return false;
  }
  const lastSegment = cleanPath.slice(cleanPath.lastIndexOf('/') + 1);
  const dotIdx = lastSegment.lastIndexOf('.');
  if (dotIdx <= 0) {
    return false;
  }
  return STATIC_ASSET_EXTENSIONS.has(lastSegment.slice(dotIdx));
}

/**
 * Rewrites canonical origin placeholders in `index.html` to the exact active public URL
 * and injects `<meta name="google-site-verification" ... />` when configured in env.
 */
export function injectSeoIntoHtml(
  html: string,
  options: {
    readonly siteUrl: string;
    readonly googleSiteVerification?: string;
  },
): string {
  const origin = normalizeOrigin(options.siteUrl) ?? DEFAULT_PRODUCTION_SITE_URL;
  let result = html.split(DEFAULT_PRODUCTION_SITE_URL).join(origin);

  const gscToken = normalizeGoogleSiteVerificationToken(
    options.googleSiteVerification,
  );
  if (gscToken && !result.includes('name="google-site-verification"')) {
    const metaTag = `    <meta name="google-site-verification" content="${escapeHtmlAttr(gscToken)}" />\n`;
    if (result.includes('</head>')) {
      result = result.replace('</head>', `${metaTag}  </head>`);
    }
  }

  return result;
}
