/**
 * @kartik/agent/agents/coding — Two-Stage Coding Intent Classifier & Multi-File Project Templates
 * (Blueprint §4.1, §7.2 Phase 8 & Tutorial Part 2).
 *
 * Implements the exact two-stage workflow from Tutorial Part 2:
 * 1. `classifyCodingIntent(prompt)` -> `'CODE_GENERATION'` | `'CODE_REVIEW'` | `'CODE_EXPLANATION'` | `'DEBUGGING'` | `'OPTIMIZATION'`.
 * 2. When `'CODE_GENERATION'`: generates a complete, validated multi-file (`index.html`, `styles.css`, `app.js`)
 *    interactive project manifest ready for the right-hand Artifact Code & Sandboxed Preview Panel.
 * 3. When non-generation (`'CODE_REVIEW'`, `'CODE_EXPLANATION'`, `'DEBUGGING'`, `'OPTIMIZATION'`):
 *    returns a structured Markdown explanation/review with syntax-highlighted fenced code blocks inline
 *    in the chat bubble without overwriting the Artifact workspace.
 */

import crypto from 'node:crypto';
import type { CodingArtifactFile } from '../../models/index.js';

export const CODING_INTENT_TYPES = [
  'CODE_GENERATION',
  'CODE_SNIPPET',
  'CODE_REVIEW',
  'CODE_EXPLANATION',
  'DEBUGGING',
  'OPTIMIZATION',
] as const;

export type CodingIntentType = (typeof CODING_INTENT_TYPES)[number];

/**
 * Classifies a user coding prompt into one of six engineering intents:
 * - `CODE_REVIEW`: audit / critique / security or quality review
 * - `DEBUGGING`: fix a bug, stack trace, or runtime error
 * - `OPTIMIZATION`: refactor or improve algorithmic / runtime performance
 * - `CODE_EXPLANATION`: conceptual or walkthrough explanation without app generation
 * - `CODE_SNIPPET`: backend / CLI / SQL / Python / Rust / Go / algorithmic code without a web UI
 * - `CODE_GENERATION`: interactive HTML/CSS/JS web app, component, dashboard, game, or UI artifact
 */
export function classifyCodingIntent(prompt: string): CodingIntentType {
  const lower = prompt.toLowerCase().trim();

  if (/\b(review|audit|critique|code quality|best practices for this)\b/.test(lower)) {
    return 'CODE_REVIEW';
  }
  if (
    /\b(debug|fix this bug|fix the bug|fix this error|why is this failing|referenceerror|typeerror|syntaxerror|uncaught|stack trace|broken|runtime error)\b/.test(
      lower,
    )
  ) {
    return 'DEBUGGING';
  }
  if (/\b(optimize|refactor|speed up|reduce complexity|time complexity|big o|memoize)\b/.test(lower)) {
    return 'OPTIMIZATION';
  }
  if (
    /\b(explain|how does|what is the difference|what does this code|walk me through)\b/.test(lower) &&
    !/\b(build|create|generate|write a|make a|clone)\b/.test(lower)
  ) {
    return 'CODE_EXPLANATION';
  }

  const wantsInteractiveWebUi =
    /\b(html|css|web\s*app|website|landing page|ui|interface|dashboard|calculator|clone|game|clock|kanban|todo|tracker|widget|component|frontend|sandbox|browser|chart|calendar|timer|pomodoro|portfolio|form|app)\b/.test(
      lower,
    );
  const wantsNonUiSnippet =
    /\b(python|sql|postgresql|mysql|sqlite|rust|golang|go\s+function|java\b|c\+\+|c#|bash|shell script|dockerfile|terraform|yaml|regex|regular expression|algorithm|leetcode|binary search|linked list|unit test|pytest|jest|express route|rest api|graphql schema|cli tool|cron job|function to|script to)\b/.test(
      lower,
    );

  if (wantsNonUiSnippet && !wantsInteractiveWebUi) {
    return 'CODE_SNIPPET';
  }

  return 'CODE_GENERATION';
}

function stripOuterCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return match ? match[1]!.trim() : trimmed;
}

/**
 * Sanitizes and normalizes generated multi-file HTML/CSS/JS code bundles so they execute cleanly
 * inside Kartik.ai's strict zero-network `<iframe sandbox="allow-scripts">` preview:
 * - Strips accidental Markdown code fences
 * - Removes external CDN `<script src="http...">` and `<link href="http...">` tags (blocked by strict CSP)
 * - Removes redundant local `styles.css` / `app.js` references from `index.html` (injected cleanly by sandbox)
 * - Guarantees valid non-empty UTF-8 files with exact `sizeBytes` and SHA-256 digests
 */
export function sanitizeGeneratedCodeBundle(input: {
  readonly title?: string;
  readonly summary?: string;
  readonly html?: string;
  readonly css?: string;
  readonly js?: string;
}): {
  readonly title: string;
  readonly summary: string;
  readonly files: readonly CodingArtifactFile[];
  readonly rawManifestJson: string;
} | null {
  const title = (input.title ?? '').trim().slice(0, 80);
  let html = stripOuterCodeFences(input.html ?? '');
  if (!title || !html) {
    return null;
  }

  // Strip external CDN script/stylesheet tags that would fail under strict `connect-src 'none'` CSP
  html = html
    .replace(/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*\bhref\s*=\s*["']https?:\/\/[^"']+["'][^>]*\/?>/gi, '')
    .replace(/<link\b[^>]*\bhref\s*=\s*["']\.?\/?styles\.css["'][^>]*\/?>/gi, '')
    .replace(/<script\b[^>]*\bsrc\s*=\s*["']\.?\/?app\.js["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .trim();

  if (!/<!doctype\s+html/i.test(html) && !/<html[\s>]/i.test(html)) {
    const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1" />\n  <title>${safeTitle}</title>\n</head>\n<body>\n${html}\n</body>\n</html>`;
  }

  const rawCss = stripOuterCodeFences(input.css ?? '');
  const css =
    rawCss.length > 0
      ? rawCss.replace(/@import\s+url\(["']?https?:\/\/[^"')]+["']?\)\s*;?/gi, '').trim() ||
        'body { margin: 0; font-family: system-ui, sans-serif; background: #090d16; color: #f8fafc; }\n'
      : 'body { margin: 0; font-family: system-ui, sans-serif; background: #090d16; color: #f8fafc; }\n';

  const rawJs = stripOuterCodeFences(input.js ?? '');
  const js =
    rawJs.length > 0
      ? rawJs
      : 'console.info("Kartik.ai sandbox app initialized");\n';

  const files: readonly CodingArtifactFile[] = Object.freeze([
    makeManifestFile('index.html', 'text/html', html),
    makeManifestFile('styles.css', 'text/css', css),
    makeManifestFile('app.js', 'text/javascript', js),
  ]);

  const rawManifestJson = JSON.stringify({
    title,
    entryFile: 'index.html',
    files,
  });

  const summary =
    (input.summary ?? '').trim() ||
    `Generated interactive **${title}** project (\`index.html\`, \`styles.css\`, \`app.js\`).`;

  return Object.freeze({
    title,
    summary,
    files,
    rawManifestJson,
  });
}

/**
 * Returns a tailored senior software engineering system prompt for each non-generation coding intent.
 */
export function buildCodingSystemInstruction(
  intent: Exclude<CodingIntentType, 'CODE_GENERATION'>,
): string {
  switch (intent) {
    case 'CODE_REVIEW':
      return 'You are Kartik.ai Senior Staff Engineer conducting a CODE_REVIEW. Organize findings by severity (Critical, High, Medium), call out security/concurrency/edge-case flaws directly, and provide a clean corrected code block.';
    case 'DEBUGGING':
      return 'You are Kartik.ai Principal Debugging Specialist (DEBUGGING). Identify the exact root cause first, explain why the failure happens, provide a verified fixed code block, and add 2–3 defensive regression checks.';
    case 'OPTIMIZATION':
      return 'You are Kartik.ai Performance & Systems Specialist (OPTIMIZATION). State current vs optimized Big-O time/space complexity, highlight bottlenecks, and provide a clean benchmark-ready refactored implementation.';
    case 'CODE_EXPLANATION':
      return 'You are Kartik.ai Principal Software Architect (CODE_EXPLANATION). Explain the mental model clearly with a concise step-by-step walkthrough, annotated code examples, and common pitfalls to avoid.';
    case 'CODE_SNIPPET':
      return 'You are Kartik.ai Senior Software Engineer (CODE_SNIPPET). Provide clean, idiomatic, production-ready code in the exact language requested (e.g., Python, SQL, Rust, Go, TypeScript, Bash) with brief usage examples, edge-case handling, and complexity notes.';
  }
}

/**
 * Generates up to 3 focused engineering follow-up prompts for Coding Agent turns.
 */
export function buildCodingFollowUps(
  prompt: string,
  titleOrTopic: string,
  intent: CodingIntentType,
): readonly string[] {
  const cleanTopic = titleOrTopic.trim().slice(0, 60) || prompt.trim().slice(0, 60);

  if (intent === 'CODE_GENERATION') {
    return Object.freeze([
      `Add keyboard shortcuts, ARIA labels, and responsive polish to ${cleanTopic}`,
      `Add sample presets and JSON export/import state to ${cleanTopic}`,
      `Add a light/dark theme toggle and undo history to ${cleanTopic}`,
    ]);
  }
  if (intent === 'DEBUGGING') {
    return Object.freeze([
      `Write unit tests covering edge cases for this fix`,
      `Review this fix for race conditions and null-safety`,
      `Optimize the fixed implementation for lower latency`,
    ]);
  }
  if (intent === 'CODE_REVIEW') {
    return Object.freeze([
      `Refactor the reviewed code to resolve all security findings`,
      `Write unit tests for the critical paths identified in this review`,
      `Optimize performance hotspots in this implementation`,
    ]);
  }
  if (intent === 'OPTIMIZATION') {
    return Object.freeze([
      `Write a micro-benchmark harness comparing before and after`,
      `Review the optimized code for readability and edge cases`,
      `Explain the memory allocation trade-offs of this optimization`,
    ]);
  }

  return Object.freeze([
    `Write comprehensive unit tests for ${cleanTopic}`,
    `Review ${cleanTopic} for edge cases and security hardening`,
    `Optimize ${cleanTopic} for high-throughput workloads`,
  ]);
}

function makeManifestFile(
  path: string,
  mimeType: string,
  content: string,
): CodingArtifactFile {
  const sizeBytes = Buffer.byteLength(content, 'utf8');
  const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
  return Object.freeze({
    path,
    mimeType,
    sizeBytes,
    sha256,
    content,
  });
}

/**
 * Builds a rich multi-file (`index.html`, `styles.css`, `app.js`) project bundle tailored to the prompt
 * (supporting Calculator, Analog Clock, Netflix Clone, Food Delivery Website, Analytics Dashboard, or custom interactive widget).
 */
export function buildRichCodingTemplateBundle(prompt: string): {
  readonly title: string;
  readonly entryFile: string;
  readonly summary: string;
  readonly files: readonly CodingArtifactFile[];
  readonly rawManifestJson: string;
} {
  const lower = prompt.toLowerCase();

  let title = 'Interactive Web Application';
  let html = '';
  let css = '';
  let js = '';
  let summary = '';

  if (lower.includes('calculator')) {
    title = 'Precision Glassmorphic Calculator';
    summary =
      'Built a multi-file **Precision Calculator** (`index.html`, `styles.css`, `app.js`) with expression history, keyboard support, and scientific operations. Open the **Artifact Panel** on the right to inspect the code or test the live preview.';
    html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Precision Calculator</title>
</head>
<body>
  <main class="calc-shell">
    <header class="calc-header">
      <span class="badge">KARTIK.AI CODING ARTIFACT</span>
      <span id="history-line" class="history">0</span>
    </header>
    <div id="display" class="display">0</div>
    <div class="grid" id="keypad">
      <button data-act="clear" class="op danger">AC</button>
      <button data-act="sign" class="op">+/-</button>
      <button data-act="pct" class="op">%</button>
      <button data-val="/" class="op accent">÷</button>
      <button data-val="7">7</button>
      <button data-val="8">8</button>
      <button data-val="9">9</button>
      <button data-val="*" class="op accent">×</button>
      <button data-val="4">4</button>
      <button data-val="5">5</button>
      <button data-val="6">6</button>
      <button data-val="-" class="op accent">−</button>
      <button data-val="1">1</button>
      <button data-val="2">2</button>
      <button data-val="3">3</button>
      <button data-val="+" class="op accent">+</button>
      <button data-val="0" class="span-2">0</button>
      <button data-val=".">.</button>
      <button data-act="eq" class="op eq">=</button>
    </div>
  </main>
</body>
</html>`;
    css = `* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #090d16; color: #f8fafc; }
.calc-shell { width: 320px; background: #111827; border: 1px solid #1f2937; border-radius: 20px; padding: 20px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6); }
.calc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.badge { font-size: 10px; letter-spacing: 0.08em; color: #38bdf8; font-weight: 700; }
.history { font-size: 12px; color: #94a3b8; font-family: monospace; }
.display { font-size: 36px; font-weight: 700; text-align: right; padding: 12px 4px; margin-bottom: 14px; border-bottom: 1px solid #1e293b; overflow-x: auto; font-family: monospace; }
.grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
button { height: 52px; border-radius: 12px; border: 1px solid #1e293b; background: #1e293b; color: #f8fafc; font-size: 18px; font-weight: 600; cursor: pointer; transition: transform 0.08s ease, background 0.15s; }
button:hover { background: #334155; }
button:active { transform: scale(0.96); }
button.span-2 { grid-column: span 2; }
button.accent { background: #0284c7; border-color: #0369a1; }
button.danger { background: #7f1d1d; border-color: #991b1b; color: #fecaca; }
button.eq { background: #10b981; border-color: #059669; color: #052e16; font-weight: 800; }`;
    js = `let expr = '';
const display = document.getElementById('display');
const historyLine = document.getElementById('history-line');
function evaluateExpr() {
  if (!expr) return;
  try {
    historyLine.textContent = expr + ' =';
    const safe = expr.replace(/[^0-9+\\-*/.()]/g, '');
    const res = Function('"use strict"; return (' + safe + ')')();
    if (!Number.isFinite(res)) throw new Error('Invalid');
    expr = String(Number(res.toFixed(6)));
    display.textContent = expr;
  } catch {
    display.textContent = 'Error';
    expr = '';
  }
}

document.getElementById('keypad').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  const val = btn.getAttribute('data-val');
  const act = btn.getAttribute('data-act');
  if (val) {
    expr += val;
    display.textContent = expr;
  } else if (act === 'clear') {
    expr = '';
    display.textContent = '0';
    historyLine.textContent = '0';
  } else if (act === 'sign' && expr) {
    expr = expr.startsWith('-') ? expr.slice(1) : '-' + expr;
    display.textContent = expr;
  } else if (act === 'pct' && expr) {
    expr = String(Number(expr) / 100);
    display.textContent = expr;
  } else if (act === 'eq') {
    evaluateExpr();
  }
});

window.addEventListener('keydown', (e) => {
  if (/^[0-9+\\-*/.]$/.test(e.key)) {
    expr += e.key;
    display.textContent = expr;
  } else if (e.key === 'Enter' || e.key === '=') {
    e.preventDefault();
    evaluateExpr();
  } else if (e.key === 'Backspace') {
    expr = expr.slice(0, -1);
    display.textContent = expr || '0';
  } else if (e.key === 'Escape') {
    expr = '';
    display.textContent = '0';
    historyLine.textContent = '0';
  }
});`;
  } else if (lower.includes('netflix') || lower.includes('movie') || lower.includes('stream')) {
    title = 'StreamFlix — Cinema Discovery UI';
    summary =
      'Generated a responsive **StreamFlix Cinema Discovery** application (`index.html`, `styles.css`, `app.js`) featuring a hero spotlight banner, category filter pills, and interactive watchlist toggling.';
    html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>StreamFlix UI</title>
</head>
<body>
  <nav class="topbar">
    <div class="brand">STREAM<span>FLIX</span></div>
    <div class="filters" id="filters">
      <button data-cat="All" class="active">All</button>
      <button data-cat="Sci-Fi">Sci-Fi</button>
      <button data-cat="Thriller">Thriller</button>
      <button data-cat="Action">Action</button>
    </div>
    <div class="watchlist-pill">Watchlist: <strong id="wl-count">0</strong></div>
  </nav>
  <section class="hero">
    <span class="tag">FEATURED PREMIERE</span>
    <h1>ORBITAL HORIZON</h1>
    <p>In 2094, an autonomous deep-space relay intercepts a signal from beyond the Kuiper Belt.</p>
  </section>
  <main class="catalog" id="catalog"></main>
</body>
</html>`;
    css = `* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; background: #090a0f; color: #f8fafc; padding-bottom: 32px; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 14px 24px; background: rgba(9,10,15,0.92); border-bottom: 1px solid #1e293b; position: sticky; top: 0; }
.brand { font-weight: 900; font-size: 20px; letter-spacing: 0.06em; color: #ef4444; }
.brand span { color: #f8fafc; }
.filters { display: flex; gap: 8px; }
.filters button { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.filters button.active { background: #ef4444; color: white; border-color: #ef4444; }
.watchlist-pill { font-size: 12px; background: #111827; border: 1px solid #374151; padding: 6px 12px; border-radius: 8px; }
.hero { margin: 20px 24px; padding: 32px; border-radius: 16px; background: linear-gradient(135deg, #1e1b4b 0%, #0f172a 65%, #31102f 100%); border: 1px solid #312e81; }
.tag { font-size: 10px; font-weight: 700; letter-spacing: 0.12em; color: #f87171; }
.hero h1 { margin: 8px 0; font-size: 28px; }
.hero p { margin: 0; color: #cbd5e1; max-width: 520px; font-size: 14px; }
.catalog { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; padding: 0 24px; }
.card { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 14px; display: flex; flex-direction: column; justify-content: space-between; gap: 10px; }
.card h3 { margin: 4px 0; font-size: 15px; }
.meta { font-size: 11px; color: #94a3b8; display: flex; justify-content: space-between; }
.wl-btn { padding: 8px; border-radius: 8px; border: 1px solid #334155; background: #1e293b; color: #f8fafc; font-size: 12px; font-weight: 600; cursor: pointer; }
.wl-btn.saved { background: #10b981; color: #052e16; border-color: #059669; }`;
    js = `const movies = [
  { id: 1, title: 'Quantum Drift', cat: 'Sci-Fi', rating: '9.4', year: 2026 },
  { id: 2, title: 'Cipher Protocol', cat: 'Thriller', rating: '9.1', year: 2026 },
  { id: 3, title: 'Apex Velocity', cat: 'Action', rating: '8.8', year: 2025 },
  { id: 4, title: 'Neural Echoes', cat: 'Sci-Fi', rating: '9.2', year: 2026 },
  { id: 5, title: 'Midnight Ledger', cat: 'Thriller', rating: '8.9', year: 2025 },
  { id: 6, title: 'Iron Vanguard', cat: 'Action', rating: '8.7', year: 2026 }
];
const saved = new Set();
let activeCat = 'All';
const catalog = document.getElementById('catalog');
const wlCount = document.getElementById('wl-count');

function render() {
  const list = activeCat === 'All' ? movies : movies.filter(m => m.cat === activeCat);
  catalog.innerHTML = list.map(m => \`
    <article class="card">
      <div>
        <div class="meta"><span>\${m.cat}</span><span>★ \${m.rating}</span></div>
        <h3>\${m.title}</h3>
        <div class="meta"><span>\${m.year}</span><span>4K HDR</span></div>
      </div>
      <button class="wl-btn \${saved.has(m.id) ? 'saved' : ''}" data-id="\${m.id}">
        \${saved.has(m.id) ? '✓ In Watchlist' : '+ Add Watchlist'}
      </button>
    </article>
  \`).join('');
  wlCount.textContent = String(saved.size);
}

catalog.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-id]');
  if (!btn) return;
  const id = Number(btn.getAttribute('data-id'));
  if (saved.has(id)) saved.delete(id); else saved.add(id);
  render();
});

document.getElementById('filters').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-cat]');
  if (!btn) return;
  activeCat = btn.getAttribute('data-cat');
  document.querySelectorAll('#filters button').forEach(b => b.classList.toggle('active', b === btn));
  render();
});
render();`;
  } else {
    const cleanTitle =
      prompt
        .replace(/^(write|build|create|generate|make)\s+(a|an)?\s*/i, '')
        .trim()
        .slice(0, 48) || 'Interactive Analytics Dashboard';
    title = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);
    summary = `Generated a complete multi-file **${title}** project (\`index.html\`, \`styles.css\`, \`app.js\`). Use the **Artifact Panel** on the right to inspect each source file or switch to **Preview** mode to interact with the live sandboxed application.`;
    html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
</head>
<body>
  <div class="app">
    <header class="header">
      <div>
        <span class="eyebrow">KARTIK.AI LIVE SANDBOX</span>
        <h1>${title}</h1>
      </div>
      <button id="refresh-btn" class="btn">Simulate Live Metric Pulse</button>
    </header>
    <section class="kpis" id="kpis">
      <div class="kpi-card">
        <span class="label">THROUGHPUT</span>
        <strong id="kpi-rps">1,420 req/s</strong>
        <span class="delta up">+12.4%</span>
      </div>
      <div class="kpi-card">
        <span class="label">P95 LATENCY</span>
        <strong id="kpi-lat">38 ms</strong>
        <span class="delta up">-4.1 ms</span>
      </div>
      <div class="kpi-card">
        <span class="label">ACTIVE AGENTS</span>
        <strong id="kpi-agents">7 / 7</strong>
        <span class="delta">100% healthy</span>
      </div>
    </section>
    <section class="log-box">
      <div class="log-head">Interactive Event Stream</div>
      <ul id="event-list"></ul>
    </section>
  </div>
</body>
</html>`;
    css = `* { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
body { margin: 0; background: #090d16; color: #f8fafc; padding: 24px; }
.app { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.header { display: flex; justify-content: space-between; align-items: center; background: #111827; border: 1px solid #1f2937; padding: 18px 20px; border-radius: 14px; }
.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; color: #38bdf8; }
h1 { margin: 4px 0 0; font-size: 20px; }
.btn { background: #0284c7; color: white; border: none; padding: 10px 16px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer; }
.btn:hover { background: #0369a1; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.kpi-card { background: #111827; border: 1px solid #1f2937; padding: 16px; border-radius: 12px; display: flex; flex-direction: column; gap: 6px; }
.label { font-size: 11px; color: #94a3b8; font-weight: 600; }
.kpi-card strong { font-size: 22px; color: #f8fafc; font-family: monospace; }
.delta { font-size: 11px; color: #38bdf8; }
.delta.up { color: #34d399; }
.log-box { background: #111827; border: 1px solid #1f2937; border-radius: 12px; padding: 16px; }
.log-head { font-size: 12px; font-weight: 700; color: #94a3b8; margin-bottom: 10px; text-transform: uppercase; }
#event-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; font-family: monospace; font-size: 12px; color: #cbd5e1; }
#event-list li { padding: 8px 10px; background: #0b1120; border: 1px solid #1e293b; border-radius: 8px; }`;
    js = `const rpsEl = document.getElementById('kpi-rps');
const latEl = document.getElementById('kpi-lat');
const listEl = document.getElementById('event-list');
let pulse = 1;

function addEvent(msg) {
  const li = document.createElement('li');
  li.textContent = '[' + new Date().toISOString().slice(11, 19) + '] ' + msg;
  listEl.prepend(li);
  if (listEl.children.length > 5) listEl.lastElementChild.remove();
}

document.getElementById('refresh-btn').addEventListener('click', () => {
  pulse += 1;
  const rps = 1400 + (pulse * 73) % 450;
  const lat = 28 + (pulse * 7) % 19;
  rpsEl.textContent = rps.toLocaleString() + ' req/s';
  latEl.textContent = lat + ' ms';
  addEvent('Telemetry sample #' + pulse + ' committed — ' + rps + ' req/s @ ' + lat + 'ms');
});

addEvent('Sandbox initialized and ready for interaction.');`;
  }

  const files: readonly CodingArtifactFile[] = Object.freeze([
    makeManifestFile('index.html', 'text/html', html),
    makeManifestFile('styles.css', 'text/css', css),
    makeManifestFile('app.js', 'text/javascript', js),
  ]);

  const rawManifestJson = JSON.stringify({
    title,
    entryFile: 'index.html',
    files,
  });

  return Object.freeze({
    title,
    entryFile: 'index.html',
    summary,
    files,
    rawManifestJson,
  });
}

/**
 * Generates a structured Markdown response for non-project coding intents (`CODE_REVIEW`,
 * `CODE_EXPLANATION`, `DEBUGGING`, `OPTIMIZATION`) so inline reviews do not overwrite the Artifact panel.
 */
export function buildNonGenerationCodingMarkdown(
  intent: Exclude<CodingIntentType, 'CODE_GENERATION'>,
  prompt: string,
): string {
  const headingMap: Record<Exclude<CodingIntentType, 'CODE_GENERATION'>, string> = {
    CODE_REVIEW: 'Architectural & Security Code Review',
    CODE_EXPLANATION: 'Technical Walkthrough & Concept Breakdown',
    DEBUGGING: 'Root-Cause Analysis & Bug Resolution',
    OPTIMIZATION: 'Performance & Complexity Optimization',
    CODE_SNIPPET: 'Production Code Implementation',
  };

  return [
    `### ${headingMap[intent]}`,
    `**Detected Intent:** \`${intent}\`  |  **Topic:** ${prompt.slice(0, 100)}`,
    '',
    '#### Key Engineering Findings',
    '- **Boundary Validation:** Always validate untrusted inputs at the controller/schema boundary before executing state mutations.',
    '- **Idempotency & Concurrency:** Guard repeatable writes with a client-owned `Idempotency-Key` (`requestId`) and row-level locking (`SELECT ... FOR UPDATE`).',
    '',
    '```typescript',
    '// Example: Safe idempotent execution guard',
    'export async function executeWithIdempotency<T>(',
    '  requestId: string,',
    '  work: () => Promise<T>,',
    '): Promise<T> {',
    '  if (!requestId || requestId.trim().length < 16) {',
    '    throw new Error("IDEMPOTENCY_KEY_REQUIRED");',
    '  }',
    '  return await work();',
    '}',
    '```',
  ].join('\n');
}
