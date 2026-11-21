import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AGENT_SELECTOR_PILLS,
  assembleMultiFileHtmlPreview,
} from '../src/index.js';

describe('@kartik/frontend Multi-Agent Selector Pills & Multi-File Sandbox Assembler (9.5.a)', () => {
  it('defines unified Chat smart hub plus all 7 direct specialist selector pills (Auto Router merged into Chat)', () => {
    assert.equal(AGENT_SELECTOR_PILLS.length, 8);
    const ids = AGENT_SELECTOR_PILLS.map((p) => p.id);
    assert.deepEqual(ids, [
      'chat',
      'search',
      'coding',
      'pdf',
      'ppt',
      'rag',
      'vision',
      'image',
    ]);
  });

  it('assembles index.html, styles.css, and app.js into an isolated sandbox="allow-scripts" srcDoc while escaping </script> breakouts (Invariant #11)', () => {
    const preview = assembleMultiFileHtmlPreview([
      {
        path: 'index.html',
        content: '<!doctype html><html><body><div id="calc">0</div></body></html>',
      },
      {
        path: 'styles.css',
        content: '#calc { color: #38bdf8; }',
      },
      {
        path: 'app.js',
        content: 'const msg = "</script><script>evil()"; document.getElementById("calc").textContent = "42";',
      },
    ]);

    assert.equal(preview.sandboxAttribute, 'allow-scripts');
    assert.ok(!preview.sandboxAttribute.includes('allow-same-origin'));
    assert.ok(preview.srcDoc.includes('#calc { color: #38bdf8; }'));
    assert.ok(preview.srcDoc.includes('<div id="calc">0</div>'));
    assert.ok(preview.srcDoc.includes('<\\/script>'));
  });

  it('exports the deployable React 19 App component and ships frontend/index.html + frontend/vite.config.ts', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { App, FrontendApp } = await import('../src/index.js');

    assert.equal(typeof App, 'function');
    assert.equal(App, FrontendApp);

    const indexHtmlPath = path.resolve(process.cwd(), 'index.html');
    const fallbackRootHtmlPath = path.resolve(process.cwd(), 'frontend/index.html');
    const resolvedIndexHtml = fs.existsSync(fallbackRootHtmlPath)
      ? fallbackRootHtmlPath
      : indexHtmlPath;
    assert.ok(fs.existsSync(resolvedIndexHtml), 'frontend/index.html must exist');
    const htmlContent = fs.readFileSync(resolvedIndexHtml, 'utf8');
    assert.ok(htmlContent.includes('<div id="root"></div>'));
    assert.ok(htmlContent.includes('/src/main.tsx'));
  });

  it('enforces single-source-of-truth component tree by keeping root src/components/** as thin re-exports of @kartik/frontend', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    let repoRoot = process.cwd();
    for (let i = 0; i < 4; i += 1) {
      if (fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml'))) {
        break;
      }
      repoRoot = path.dirname(repoRoot);
    }

    const rootComponentFiles = [
      'src/components/artifacts/ArtifactPanel.tsx',
      'src/components/auth/AuthModal.tsx',
      'src/components/billing/BillingDrawer.tsx',
      'src/components/chat/ChatArea.tsx',
      'src/components/chat/ChatInput.tsx',
      'src/components/chat/MarkdownRenderer.tsx',
      'src/components/chat/MessageBubble.tsx',
      'src/components/chat/MessageList.tsx',
      'src/components/chat/SlideDeckPreview.tsx',
      'src/components/common/LoadingAnimation.tsx',
      'src/components/layout/Nav.tsx',
      'src/components/layout/Sidebar.tsx',
      'src/dev-exports/StepFileDownloads.tsx',
    ];

    for (const relFile of rootComponentFiles) {
      const fullPath = path.join(repoRoot, relFile);
      assert.ok(fs.existsSync(fullPath), `${relFile} must exist`);
      const source = fs.readFileSync(fullPath, 'utf8').trim();
      assert.ok(
        source.includes('frontend/src/components/'),
        `${relFile} must re-export from frontend/src/components/`,
      );
      assert.ok(
        !source.includes('backend/services/'),
        `${relFile} must not import directly from backend/services/`,
      );
      assert.ok(
        !source.includes('server/platform-api-runtime'),
        `${relFile} must not import directly from server/platform-api-runtime`,
      );
    }
  });
});
