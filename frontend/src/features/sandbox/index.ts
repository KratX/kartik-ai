/**
 * @kartik/frontend/features/sandbox — Isolated Browser Code Preview Engine (Micro-step 7.2.a).
 *
 * Enforces Blueprint §9 (Invariants #11 & #12), §10 & §11:
 * 1. Invariant #11: "Generated code is previewed in an isolated browser sandbox and never executed on the backend host."
 * 2. Opaque-Origin Isolation: The iframe `sandbox` attribute is locked to `"allow-scripts"` ONLY.
 *    `allow-same-origin`, `allow-top-navigation`, `allow-popups`, and `allow-forms` are strictly forbidden
 *    so untrusted generated code runs in a `null` opaque origin and can never access parent DOM, cookies,
 *    or storage.
 * 3. Network Exfiltration Lock: Injects a strict Content-Security-Policy (`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:;`)
 *    into the iframe `srcdoc` so sandboxed scripts cannot issue outbound `fetch`, `XMLHttpRequest`, or `WebSocket` calls.
 * 4. Invariant #12: Validates artifact file paths (rejecting `..`, leading `/`, backslashes, null bytes, and disallowed extensions)
 *    and neutralizes `</script>` / `</style>` tag breakouts before assembling `srcdoc`.
 */

export interface FrontendArtifactFile {
  readonly path: string;
  readonly content: string;
}

export interface FrontendArtifactBundle {
  readonly artifactId: string;
  readonly title: string;
  readonly entryFile: string;
  readonly files: readonly FrontendArtifactFile[];
}

export interface SandboxedPreviewDescriptor {
  readonly artifactId: string;
  readonly title: string;
  readonly iframeSandboxAttribute: 'allow-scripts';
  readonly referrerPolicy: 'no-referrer';
  readonly cspPolicy: string;
  readonly srcDoc: string;
  readonly compiledFileCount: number;
}

const ALLOWED_EXTENSIONS = new Set([
  '.html',
  '.css',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.md',
  '.svg',
]);

const MAX_ARTIFACT_FILES = 20;
const MAX_TOTAL_BYTES = 256 * 1024; // 256 KB client preview ceiling

export const SANDBOX_CSP_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; frame-src 'none';";

export function escapeHtmlEntities(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSafeRelativeArtifactPath(filePath: string): boolean {
  if (!filePath || filePath.length > 120) {
    return false;
  }
  if (
    filePath.includes('\0') ||
    filePath.startsWith('/') ||
    filePath.startsWith('\\') ||
    filePath.includes('\\') ||
    filePath.includes('..')
  ) {
    return false;
  }
  const segments = filePath.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || seg.startsWith('.')) {
      return false;
    }
  }
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex <= 0) {
    return false;
  }
  const ext = filePath.slice(dotIndex).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

/**
 * Validates an untrusted coding artifact bundle before rendering it in the browser sandbox
 * (Invariant #12 & §10).
 */
export function validateFrontendArtifactBundle(
  bundle: FrontendArtifactBundle,
): FrontendArtifactBundle {
  if (!bundle || typeof bundle !== 'object') {
    throw new Error('Artifact bundle must be a non-null object');
  }
  if (!bundle.artifactId || typeof bundle.artifactId !== 'string') {
    throw new Error('Artifact bundle requires a valid artifactId');
  }
  if (
    !Array.isArray(bundle.files) ||
    bundle.files.length === 0 ||
    bundle.files.length > MAX_ARTIFACT_FILES
  ) {
    throw new Error(
      `Artifact bundle must contain between 1 and ${MAX_ARTIFACT_FILES} files`,
    );
  }
  if (!isSafeRelativeArtifactPath(bundle.entryFile)) {
    throw new Error(
      `Unsafe or unsupported artifact entryFile path: "${String(bundle.entryFile)}"`,
    );
  }

  let totalBytes = 0;
  let hasEntry = false;

  for (const file of bundle.files) {
    if (!isSafeRelativeArtifactPath(file.path)) {
      throw new Error(`Unsafe or unsupported artifact file path: "${file.path}"`);
    }
    if (typeof file.content !== 'string' || file.content.includes('\0')) {
      throw new Error(`Artifact file "${file.path}" contains invalid content`);
    }
    totalBytes += new TextEncoder().encode(file.content).byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error(
        `Artifact bundle exceeds maximum preview size (${MAX_TOTAL_BYTES} bytes)`,
      );
    }
    if (file.path === bundle.entryFile) {
      hasEntry = true;
    }
  }

  if (!hasEntry) {
    throw new Error(
      `Artifact entryFile "${bundle.entryFile}" is missing from files manifest`,
    );
  }

  return bundle;
}

export interface SandboxBuildOptions {
  readonly bridgeToken?: string;
}

export interface SandboxConsoleBridgeMessage {
  readonly source: 'kartik-sandbox';
  readonly token: string;
  readonly level: 'log' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly timestamp: string;
}

function extractCleanHtmlBody(rawHtml: string): string {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(rawHtml);
  const inner = bodyMatch ? bodyMatch[1]! : rawHtml;
  return inner
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<meta\b[^>]*>/gi, '')
    .replace(/<link\b[^>]*>/gi, '')
    .trim();
}

function buildSandboxBootstrapScript(bridgeToken?: string): string {
  const storageShim = [
    '(function(){',
    '  function makeMemStorage(){',
    '    var store = Object.create(null);',
    '    return {',
    '      getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, String(k)) ? store[String(k)] : null; },',
    '      setItem: function(k, v){ store[String(k)] = String(v); },',
    '      removeItem: function(k){ delete store[String(k)]; },',
    '      clear: function(){ store = Object.create(null); },',
    '      key: function(i){ return Object.keys(store)[i] || null; },',
    '      get length(){ return Object.keys(store).length; }',
    '    };',
    '  }',
    '  try { window.localStorage.getItem("__kartik_probe__"); } catch (_) {',
    '    try { Object.defineProperty(window, "localStorage", { value: makeMemStorage(), configurable: true }); } catch (__) {}',
    '  }',
    '  try { window.sessionStorage.getItem("__kartik_probe__"); } catch (_) {',
    '    try { Object.defineProperty(window, "sessionStorage", { value: makeMemStorage(), configurable: true }); } catch (__) {}',
    '  }',
    '})();',
  ].join('\n');

  if (!bridgeToken) {
    return storageShim;
  }

  const safeToken = JSON.stringify(bridgeToken.slice(0, 64));
  const consoleBridge = [
    '(function(){',
    `  var TOKEN = ${safeToken};`,
    '  function fmt(args){',
    '    return Array.prototype.slice.call(args).map(function(a){',
    '      if (typeof a === "string") return a;',
    '      if (a instanceof Error) return a.stack || a.message || String(a);',
    '      try { return JSON.stringify(a); } catch (_) { return String(a); }',
    '    }).join(" ").slice(0, 800);',
    '  }',
    '  function emit(level, msg){',
    '    try {',
    '      window.parent.postMessage({ source: "kartik-sandbox", token: TOKEN, level: level, message: String(msg).slice(0, 800), timestamp: new Date().toISOString().slice(11, 19) }, "*");',
    '    } catch (_) {}',
    '  }',
    '  ["log", "info", "warn", "error"].forEach(function(lvl){',
    '    var orig = console[lvl];',
    '    console[lvl] = function(){',
    '      emit(lvl, fmt(arguments));',
    '      if (typeof orig === "function") { try { orig.apply(console, arguments); } catch (_) {} }',
    '    };',
    '  });',
    '  window.addEventListener("error", function(ev){',
    '    var detail = ev && ev.message ? ev.message : "Uncaught runtime error";',
    '    if (ev && ev.lineno) detail += " (line " + ev.lineno + ")";',
    '    emit("error", detail);',
    '  });',
    '  window.addEventListener("unhandledrejection", function(ev){',
    '    var reason = ev && ev.reason;',
    '    var msg = reason instanceof Error ? (reason.message || String(reason)) : String(reason || "Unhandled promise rejection");',
    '    emit("error", "UnhandledRejection: " + msg);',
    '  });',
    '})();',
  ].join('\n');

  return `${storageShim}\n${consoleBridge}`;
}

/**
 * Assembles a self-contained, CSP-locked `srcDoc` and `<iframe sandbox="allow-scripts">`
 * descriptor for previewing generated code in an isolated opaque origin (Invariant #11 & §11).
 */
export function buildSandboxedPreviewDocument(
  rawBundle: FrontendArtifactBundle,
  options?: SandboxBuildOptions,
): SandboxedPreviewDescriptor {
  const bundle = validateFrontendArtifactBundle(rawBundle);

  const cssBlocks: string[] = [];
  const jsBlocks: string[] = [];
  let htmlBody = '<div id="app"></div>';

  for (const file of bundle.files) {
    const lower = file.path.toLowerCase();
    if (lower.endsWith('.css')) {
      // Neutralize any </style> breakout inside CSS files
      cssBlocks.push(file.content.replace(/<\/style/gi, '<\\/style'));
    } else if (
      lower.endsWith('.js') ||
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.jsx')
    ) {
      // Neutralize any </script> breakout inside script files
      jsBlocks.push(file.content.replace(/<\/script/gi, '<\\/script'));
    } else if (lower.endsWith('.html') && file.path === bundle.entryFile) {
      // Extract clean <body> inner markup and strip untrusted scripts/meta/external links
      const extracted = extractCleanHtmlBody(file.content);
      htmlBody = extracted || '<div id="app"></div>';
    }
  }

  const safeTitle = escapeHtmlEntities(bundle.title || 'Sandboxed Code Preview');
  const combinedCss = cssBlocks.join('\n');
  const bootstrapJs = buildSandboxBootstrapScript(options?.bridgeToken);
  const combinedJs = jsBlocks.join('\n;\n');

  const srcDoc = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP_POLICY}" />`,
    `<title>${safeTitle}</title>`,
    combinedCss ? `<style>\n${combinedCss}\n</style>` : '',
    '</head>',
    '<body>',
    htmlBody,
    `<script>\n${bootstrapJs}\n</script>`,
    combinedJs ? `<script>\n${combinedJs}\n</script>` : '',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');

  return Object.freeze({
    artifactId: bundle.artifactId,
    title: bundle.title,
    iframeSandboxAttribute: 'allow-scripts',
    referrerPolicy: 'no-referrer',
    cspPolicy: SANDBOX_CSP_POLICY,
    srcDoc,
    compiledFileCount: bundle.files.length,
  });
}

/**
 * Compiles a validated multi-file coding bundle into a clean, self-contained single-file `.html`
 * document suitable for direct local download and offline browser execution.
 */
export function buildStandaloneHtmlExport(
  rawBundle: FrontendArtifactBundle,
): string {
  const bundle = validateFrontendArtifactBundle(rawBundle);
  const cssBlocks: string[] = [];
  const jsBlocks: string[] = [];
  let htmlBody = '<div id="app"></div>';

  for (const file of bundle.files) {
    const lower = file.path.toLowerCase();
    if (lower.endsWith('.css')) {
      cssBlocks.push(file.content.replace(/<\/style/gi, '<\\/style'));
    } else if (
      lower.endsWith('.js') ||
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.jsx')
    ) {
      jsBlocks.push(file.content.replace(/<\/script/gi, '<\\/script'));
    } else if (lower.endsWith('.html') && file.path === bundle.entryFile) {
      const extracted = extractCleanHtmlBody(file.content);
      htmlBody = extracted || '<div id="app"></div>';
    }
  }

  const safeTitle = escapeHtmlEntities(bundle.title || 'Kartik.ai Web App');
  const combinedCss = cssBlocks.join('\n');
  const combinedJs = jsBlocks.join('\n;\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="utf-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `  <title>${safeTitle}</title>`,
    combinedCss ? `  <style>\n${combinedCss}\n  </style>` : '',
    '</head>',
    '<body>',
    htmlBody,
    combinedJs ? `<script>\n${combinedJs}\n</script>` : '',
    '</body>',
    '</html>',
  ]
    .filter(Boolean)
    .join('\n');
}
