import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SANDBOX_CSP_POLICY,
  buildSandboxedPreviewDocument,
  buildStandaloneHtmlExport,
  formatGroundedCitations,
  sanitizeExternalCitationUrl,
  validateFrontendArtifactBundle,
} from '../src/index.js';

describe('@kartik/frontend Sandboxed Code Preview & Grounded Citations (7.2.a)', () => {
  it('builds an opaque-origin iframe descriptor with sandbox="allow-scripts" (never allow-same-origin) and strict CSP (Invariant #11 & §11)', () => {
    const preview = buildSandboxedPreviewDocument({
      artifactId: 'art_calc_72a',
      title: 'Compound Interest <Calculator>',
      entryFile: 'src/App.tsx',
      files: [
        {
          path: 'src/styles.css',
          content: 'body { background: #020617; color: #f8fafc; }',
        },
        {
          path: 'src/App.tsx',
          content:
            'const root = document.getElementById("app"); if (root) root.textContent = "Ready";',
        },
      ],
    });

    // Invariant #11 & §11: sandbox is strictly "allow-scripts" and NEVER contains "allow-same-origin"
    assert.equal(preview.iframeSandboxAttribute, 'allow-scripts');
    assert.equal(
      preview.iframeSandboxAttribute.includes('allow-same-origin'),
      false,
    );
    assert.equal(preview.referrerPolicy, 'no-referrer');
    assert.equal(preview.cspPolicy, SANDBOX_CSP_POLICY);
    assert.ok(preview.srcDoc.includes("connect-src 'none'"));
    // Title HTML entities are escaped
    assert.ok(preview.srcDoc.includes('Compound Interest &lt;Calculator&gt;'));
    assert.equal(preview.compiledFileCount, 2);
  });

  it('rejects path traversal (..), absolute paths, hidden dotfiles, missing entryFile, and escapes </script> breakouts (Invariant #12 & §10)', () => {
    assert.throws(
      () =>
        validateFrontendArtifactBundle({
          artifactId: 'art_bad_1',
          title: 'Traversal Attempt',
          entryFile: '../secrets.js',
          files: [{ path: '../secrets.js', content: 'alert(1)' }],
        }),
      /Unsafe or unsupported artifact/,
    );

    assert.throws(
      () =>
        validateFrontendArtifactBundle({
          artifactId: 'art_bad_2',
          title: 'Absolute Path Attempt',
          entryFile: '/etc/passwd.js',
          files: [{ path: '/etc/passwd.js', content: 'alert(1)' }],
        }),
      /Unsafe or unsupported artifact/,
    );

    assert.throws(
      () =>
        validateFrontendArtifactBundle({
          artifactId: 'art_bad_3',
          title: 'Disallowed Executable Extension',
          entryFile: 'payload.sh',
          files: [{ path: 'payload.sh', content: 'rm -rf /' }],
        }),
      /Unsafe or unsupported artifact/,
    );

    // Neutralizes </script> tag breakout inside generated JS
    const escapedPreview = buildSandboxedPreviewDocument({
      artifactId: 'art_breakout_test',
      title: 'Breakout Guard',
      entryFile: 'index.js',
      files: [
        {
          path: 'index.js',
          content: 'const tpl = "</script><script>evil()</script>";',
        },
      ],
    });
    assert.ok(escapedPreview.srcDoc.includes('<\\/script>'));
  });

  it('distinguishes RAG document page citations from web search URLs and reports empty retrieval honestly (§10)', () => {
    const ragGrounded = formatGroundedCitations({
      agentUsed: 'rag',
      citations: [
        {
          sourceId: 'chunk_01',
          title: 'Kartik Architecture Spec.pdf',
          urlOrPage: 'p. 14',
        },
      ],
    });

    assert.equal(ragGrounded.groundingMode, 'rag_document');
    assert.equal(ragGrounded.hasVerifiedSources, true);
    assert.equal(ragGrounded.badges[0]?.kind, 'pdf_page');
    assert.equal(ragGrounded.badges[0]?.safeLocationLabel, 'p. 14');
    assert.equal(ragGrounded.badges[0]?.safeHref, null);

    const ragEmpty = formatGroundedCitations({
      agentUsed: 'rag',
      citations: [],
    });
    assert.equal(ragEmpty.hasVerifiedSources, false);
    assert.match(
      ragEmpty.groundingBannerText,
      /No relevant chunks were retrieved/,
    );
  });

  it('blocks javascript: and data: URLs in citation links and escapes untrusted HTML in citation titles (§11)', () => {
    const unsafeJs = sanitizeExternalCitationUrl('javascript:alert(document.cookie)');
    assert.equal(unsafeJs.kind, 'blocked_unsafe');
    assert.equal(unsafeJs.safeHref, null);

    const unsafeData = sanitizeExternalCitationUrl(
      'data:text/html,<script>alert(1)</script>',
    );
    assert.equal(unsafeData.kind, 'blocked_unsafe');
    assert.equal(unsafeData.safeHref, null);

    const presentation = formatGroundedCitations({
      agentUsed: 'search',
      citations: [
        {
          sourceId: 'src_xss',
          title: '<img src=x onerror=alert(1)>Official Docs',
          urlOrPage: 'https://developer.mozilla.org/en-US/docs/Web',
        },
        {
          sourceId: 'src_bad_scheme',
          title: 'Malicious Link',
          urlOrPage: 'javascript:evil()',
        },
      ],
    });

    assert.equal(presentation.groundingMode, 'web_search');
    assert.equal(presentation.hasVerifiedSources, true);
    assert.equal(
      presentation.badges[0]?.safeTitle,
      '&lt;img src=x onerror=alert(1)&gt;Official Docs',
    );
    assert.equal(
      presentation.badges[0]?.safeHref,
      'https://developer.mozilla.org/en-US/docs/Web',
    );
    assert.equal(presentation.badges[1]?.kind, 'blocked_unsafe');
    assert.equal(presentation.badges[1]?.safeHref, null);
  });

  it('Fix #15: extracts clean HTML body, injects opaque-origin storage shim & scoped console bridge, and exports runnable standalone HTML', () => {
    const bundle = {
      artifactId: 'art_fix15_sandbox',
      title: 'Timer <Pro>',
      entryFile: 'index.html',
      files: [
        {
          path: 'index.html',
          content:
            '<!doctype html><html><head><link rel="stylesheet" href="styles.css" /></head><body><main id="app"><h1>25:00</h1></main><script src="app.js"></script></body></html>',
        },
        {
          path: 'styles.css',
          content: 'body { color: #f8fafc; } /* </style> breakout */',
        },
        {
          path: 'app.js',
          content:
            'localStorage.setItem("timer", "25:00"); console.log("ready", "</script>");',
        },
      ],
    };

    const preview = buildSandboxedPreviewDocument(bundle, {
      bridgeToken: 'sbx_fix15_token',
    });

    // Security invariants remain locked
    assert.equal(preview.iframeSandboxAttribute, 'allow-scripts');
    assert.equal(preview.iframeSandboxAttribute.includes('allow-same-origin'), false);
    assert.equal(preview.referrerPolicy, 'no-referrer');
    assert.equal(preview.cspPolicy, SANDBOX_CSP_POLICY);
    assert.ok(preview.srcDoc.includes("connect-src 'none'"));

    // Clean body extraction: only ONE <!doctype html> at document start, no redundant local links
    assert.equal(preview.srcDoc.match(/<!doctype html>/gi)?.length, 1);
    assert.ok(!preview.srcDoc.includes('href="styles.css"'));
    assert.ok(!preview.srcDoc.includes('src="app.js"'));
    assert.ok(preview.srcDoc.includes('<main id="app"><h1>25:00</h1></main>'));

    // Storage shim & scoped console bridge injected safely
    assert.ok(preview.srcDoc.includes('kartik-sandbox'));
    assert.ok(preview.srcDoc.includes('sbx_fix15_token'));
    assert.ok(preview.srcDoc.includes('localStorage'));
    assert.ok(preview.srcDoc.includes('<\\/script>'));
    assert.ok(preview.srcDoc.includes('<\\/style>'));

    // Standalone single-file HTML export is clean and runnable without bridge noise
    const exportedHtml = buildStandaloneHtmlExport(bundle);
    assert.match(exportedHtml, /^<!doctype html>/i);
    assert.ok(exportedHtml.includes('<title>Timer &lt;Pro&gt;</title>'));
    assert.ok(exportedHtml.includes('<main id="app"><h1>25:00</h1></main>'));
    assert.ok(exportedHtml.includes('body { color: #f8fafc; }'));
    assert.ok(exportedHtml.includes('localStorage.setItem("timer", "25:00")'));
    assert.ok(!exportedHtml.includes('sbx_fix15_token'));
    assert.ok(exportedHtml.includes('<\\/script>'));
    assert.ok(exportedHtml.includes('<\\/style>'));
  });
});

