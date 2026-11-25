import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildRobotsTxt,
  buildSitemapXml,
  buildWebManifest,
  DEFAULT_PRODUCTION_SITE_URL,
  injectSeoIntoHtml,
  isStaticAssetRequestPath,
  normalizeGoogleSiteVerificationToken,
  resolvePublicSiteUrl,
  SEO_DESCRIPTION,
  SEO_TITLE,
} from './seo.ts';

describe('SEO, Sitemap, Robots.txt, Icons & Rich Results Helpers (Fix #38 / #42)', () => {
  it('enforces optimal Google snippet lengths for title (30-60 chars) and description (120-160 chars)', () => {
    assert.ok(
      SEO_TITLE.length >= 30 && SEO_TITLE.length <= 60,
      `Expected SEO_TITLE length 30..60, got ${SEO_TITLE.length}`,
    );
    assert.ok(
      SEO_DESCRIPTION.length >= 120 && SEO_DESCRIPTION.length <= 160,
      `Expected SEO_DESCRIPTION length 120..160, got ${SEO_DESCRIPTION.length}`,
    );
  });

  it('resolves canonical site URL with strict priority: PUBLIC_APP_URL > APP_URL > RENDER_EXTERNAL_URL > Host > default', () => {
    assert.equal(
      resolvePublicSiteUrl({
        PUBLIC_APP_URL: 'https://kartik.ai/',
        APP_URL: 'https://app.kartik.ai',
        RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com',
      }),
      'https://kartik.ai',
    );

    assert.equal(
      resolvePublicSiteUrl({
        RENDER_EXTERNAL_URL: 'https://kartik-ai-app.onrender.com/',
      }),
      'https://kartik-ai-app.onrender.com',
    );

    assert.equal(
      resolvePublicSiteUrl(
        {},
        {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'kartik-studio.onrender.com',
        },
      ),
      'https://kartik-studio.onrender.com',
    );

    assert.equal(resolvePublicSiteUrl({}), DEFAULT_PRODUCTION_SITE_URL);
  });

  it('builds a valid robots.txt blocking private API/download routes and declaring sitemap', () => {
    const txt = buildRobotsTxt('https://kartik-ai-app.onrender.com/');
    assert.match(txt, /User-agent: \*/);
    assert.match(txt, /Allow: \//);
    assert.match(txt, /Disallow: \/api\//);
    assert.match(txt, /Disallow: \/__downloads\//);
    assert.match(txt, /Sitemap: https:\/\/kartik-ai-app\.onrender\.com\/sitemap\.xml/);
  });

  it('builds valid XML sitemap with canonical loc and image preview metadata', () => {
    const xml = buildSitemapXml('https://kartik-ai-app.onrender.com', '2026-11-24');
    assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<loc>https:\/\/kartik-ai-app\.onrender\.com\/<\/loc>/);
    assert.match(xml, /<lastmod>2026-11-24<\/lastmod>/);
    assert.match(
      xml,
      /<image:loc>https:\/\/kartik-ai-app\.onrender\.com\/og-image\.jpg<\/image:loc>/,
    );
  });

  it('normalizes Google Search Console tokens from raw tokens or full pasted meta tags', () => {
    assert.equal(
      normalizeGoogleSiteVerificationToken('abc123_DEF-4567890'),
      'abc123_DEF-4567890',
    );
    assert.equal(
      normalizeGoogleSiteVerificationToken(
        '<meta name="google-site-verification" content="gsc_Token-987654321" />',
      ),
      'gsc_Token-987654321',
    );
    assert.equal(normalizeGoogleSiteVerificationToken('<script>alert(1)</script>'), null);
    assert.equal(normalizeGoogleSiteVerificationToken(''), null);
  });

  it('rewrites canonical URLs and injects google-site-verification safely into HTML', () => {
    const baseHtml = [
      '<html><head>',
      '<link rel="canonical" href="https://kartik-ai-app.onrender.com/" />',
      '<meta property="og:image" content="https://kartik-ai-app.onrender.com/og-image.jpg" />',
      '</head><body></body></html>',
    ].join('\n');

    const rendered = injectSeoIntoHtml(baseHtml, {
      siteUrl: 'https://my-kartik-app.onrender.com/',
      googleSiteVerification: 'verify_Token_123456789',
    });

    assert.match(
      rendered,
      /<link rel="canonical" href="https:\/\/my-kartik-app\.onrender\.com\/" \/>/,
    );
    assert.match(
      rendered,
      /<meta property="og:image" content="https:\/\/my-kartik-app\.onrender\.com\/og-image\.jpg" \/>/,
    );
    assert.match(
      rendered,
      /<meta name="google-site-verification" content="verify_Token_123456789" \/>/,
    );
  });

  it('builds a valid web manifest with SVG + 192x192 + 512x512 PNG icons', () => {
    const manifest = buildWebManifest('https://kartik-ai-app.onrender.com');
    assert.equal(manifest.short_name, 'Kartik.ai');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.theme_color, '#09090b');
    const icons = manifest.icons as Array<{ src: string; sizes: string; type: string }>;
    assert.ok(icons.some((i) => i.src === '/favicon.svg' && i.type === 'image/svg+xml'));
    assert.ok(icons.some((i) => i.src === '/icon-192.png' && i.sizes === '192x192'));
    assert.ok(icons.some((i) => i.src === '/icon-512.png' && i.sizes === '512x512'));
  });

  it('identifies static asset paths so SPA fallback prevents Soft-404s on missing files', () => {
    assert.equal(isStaticAssetRequestPath('/favicon.ico'), true);
    assert.equal(isStaticAssetRequestPath('/missing-image.png'), true);
    assert.equal(isStaticAssetRequestPath('/wp-login.php'), true);
    assert.equal(isStaticAssetRequestPath('/assets/nonexistent.js'), true);
    assert.equal(isStaticAssetRequestPath('/'), false);
    assert.equal(isStaticAssetRequestPath('/chat/conv_123'), false);
    assert.equal(isStaticAssetRequestPath('/workspace'), false);
  });

  it('ships valid, policy-compliant JSON-LD and synced canonical metadata in index.html and frontend/index.html', () => {
    for (const rel of ['index.html', 'frontend/index.html']) {
      const html = fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8');
      assert.match(html, /<link rel="canonical" href="https:\/\/kartik-ai-app\.onrender\.com\/" \/>/);
      assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="48x48" \/>/);
      assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/);
      assert.match(html, /<meta property="og:image:width" content="1280" \/>/);
      assert.match(html, /<meta property="og:image:height" content="640" \/>/);

      const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
      assert.ok(ldMatch?.[1], `Missing JSON-LD in ${rel}`);
      const parsed = JSON.parse(ldMatch[1]) as { '@graph': Array<Record<string, unknown>> };
      const types = parsed['@graph'].map((node) => node['@type']);
      assert.deepEqual(types, ['WebApplication', 'WebSite', 'Organization']);
      const org = parsed['@graph'].find((n) => n['@type'] === 'Organization') as {
        logo: { url: string; width: number; height: number };
      };
      assert.equal(org.logo.url, 'https://kartik-ai-app.onrender.com/icon-512.png');
      assert.equal(org.logo.width, 512);
      assert.equal(org.logo.height, 512);
    }

    // Verify all declared public icon & OG assets exist on disk
    for (const asset of [
      'public/favicon.ico',
      'public/favicon.svg',
      'public/favicon-48.png',
      'public/apple-touch-icon.png',
      'public/icon-192.png',
      'public/icon-512.png',
      'public/og-image.jpg',
    ]) {
      const stat = fs.statSync(path.resolve(process.cwd(), asset));
      assert.ok(stat.size > 100, `Expected ${asset} to be non-empty`);
    }
  });
});
