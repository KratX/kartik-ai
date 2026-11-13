import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  AGENT_SELECTOR_PILLS,
  assembleMultiFileHtmlPreview,
} from '../src/index.js';

describe('@kartik/frontend Multi-Agent Selector Pills & Multi-File Sandbox Assembler (9.5.a)', () => {
  it('defines Auto Router plus all 8 specialist agent selector pills with credit cost labels', () => {
    assert.equal(AGENT_SELECTOR_PILLS.length, 9);
    const ids = AGENT_SELECTOR_PILLS.map((p) => p.id);
    assert.deepEqual(ids, [
      'auto',
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
});
