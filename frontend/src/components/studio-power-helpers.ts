/**
 * @file frontend/src/components/studio-power-helpers.ts
 * @description Pure TypeScript helpers for Fix #29 Studio Power Suite:
 * - Zero-dependency syntax highlighting tokenizer (JS/TS/Python/HTML/CSS/SQL/JSON/Bash)
 * - Interactive GFM table CSV exporter & numeric-aware sorter
 * - LaTeX inline/block math Unicode formatter
 * - Safe Mermaid flowchart & sequence diagram parser (for pure React SVG rendering)
 * - LCS unified line diff engine for Artifact Version History
 * - Slide Deck -> Printable PDF Handout compiler spec converter
 */

import type {
  ParsedSlideDeckViewModel,
  ParsedVectorChart,
} from './slide-deck-and-markdown.js';

export type CodeTokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'type'
  | 'property'
  | 'operator'
  | 'tag';

export interface CodeSyntaxToken {
  readonly kind: CodeTokenKind;
  readonly text: string;
}

const JS_TS_KEYWORDS = new Set([
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
]);

const PYTHON_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'False',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'None',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'True',
  'try',
  'while',
  'with',
  'yield',
]);

const SQL_KEYWORDS = new Set([
  'select',
  'from',
  'where',
  'join',
  'left',
  'right',
  'inner',
  'outer',
  'on',
  'group',
  'by',
  'order',
  'asc',
  'desc',
  'limit',
  'offset',
  'insert',
  'into',
  'values',
  'update',
  'set',
  'delete',
  'create',
  'table',
  'alter',
  'drop',
  'index',
  'as',
  'and',
  'or',
  'not',
  'null',
  'is',
  'in',
  'having',
  'distinct',
  'union',
  'with',
  'case',
  'when',
  'then',
  'else',
  'end',
]);

const BASH_KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'do',
  'done',
  'while',
  'case',
  'esac',
  'function',
  'export',
  'local',
  'return',
  'echo',
  'cd',
  'npm',
  'npx',
  'node',
  'git',
  'curl',
  'docker',
  'python',
  'python3',
]);

function normalizeLang(language: string): string {
  const lower = language.trim().toLowerCase();
  if (['ts', 'tsx', 'typescript', 'js', 'jsx', 'javascript', 'mjs', 'cjs'].includes(lower)) {
    return 'js';
  }
  if (['py', 'python'].includes(lower)) return 'python';
  if (['sql', 'postgres', 'postgresql', 'sqlite', 'mysql'].includes(lower)) return 'sql';
  if (['json', 'jsonc'].includes(lower)) return 'json';
  if (['html', 'xml', 'svg'].includes(lower)) return 'html';
  if (['css', 'scss', 'less'].includes(lower)) return 'css';
  if (['sh', 'bash', 'zsh', 'shell', 'console'].includes(lower)) return 'bash';
  return 'generic';
}

/**
 * Tokenizes a single line of source code into typed highlight spans.
 * Pure, safe, zero-regex-catastrophe scanner that never emits raw HTML.
 */
export function tokenizeCodeLine(
  line: string,
  language = 'text',
): readonly CodeSyntaxToken[] {
  const lang = normalizeLang(language);
  const tokens: CodeSyntaxToken[] = [];
  const push = (kind: CodeTokenKind, text: string) => {
    if (!text) return;
    const prev = tokens[tokens.length - 1];
    if (prev && prev.kind === kind) {
      tokens[tokens.length - 1] = { kind, text: prev.text + text };
    } else {
      tokens.push({ kind, text });
    }
  };

  let i = 0;
  const len = line.length;

  while (i < len) {
    const ch = line[i]!;
    const next = line[i + 1] ?? '';

    // Line comments
    if (
      ((lang === 'js' || lang === 'css' || lang === 'generic') && ch === '/' && next === '/') ||
      ((lang === 'python' || lang === 'bash') && ch === '#') ||
      (lang === 'sql' && ch === '-' && next === '-')
    ) {
      push('comment', line.slice(i));
      break;
    }

    // Block comment inline /* ... */ or <!-- ... -->
    if (ch === '/' && next === '*') {
      const end = line.indexOf('*/', i + 2);
      const sliceEnd = end === -1 ? len : end + 2;
      push('comment', line.slice(i, sliceEnd));
      i = sliceEnd;
      continue;
    }
    if (lang === 'html' && line.startsWith('<!--', i)) {
      const end = line.indexOf('-->', i + 4);
      const sliceEnd = end === -1 ? len : end + 3;
      push('comment', line.slice(i, sliceEnd));
      i = sliceEnd;
      continue;
    }

    // Strings ("...", '...', `...`)
    if (ch === '"' || ch === "'" || (ch === '`' && lang === 'js')) {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (line[j] === '\\') {
          j += 2;
          continue;
        }
        if (line[j] === quote) {
          j += 1;
          break;
        }
        j += 1;
      }
      const rawStr = line.slice(i, j);
      // JSON key detection ("key":)
      if (lang === 'json' && quote === '"') {
        const rest = line.slice(j).trimStart();
        push(rest.startsWith(':') ? 'property' : 'string', rawStr);
      } else {
        push('string', rawStr);
      }
      i = j;
      continue;
    }

    // HTML / JSX tags (<div, </div, />)
    if (lang === 'html' && ch === '<') {
      const m = /^<\/?[A-Za-z][A-Za-z0-9:-]*/.exec(line.slice(i));
      if (m) {
        push('tag', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // CSS property or hex color
    if (lang === 'css' && ch === '#') {
      const m = /^#[0-9a-fA-F]{3,8}\b/.exec(line.slice(i));
      if (m) {
        push('number', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Numbers
    if (/[0-9]/.test(ch) && (i === 0 || !/[A-Za-z_$]/.test(line[i - 1]!))) {
      const m = /^(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?:px|rem|em|%|ms|s|vh|vw)?)/.exec(
        line.slice(i),
      );
      if (m) {
        push('number', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Identifiers / keywords / types / properties
    if (/[A-Za-z_$@-]/.test(ch) && (ch !== '-' || lang === 'css')) {
      const m =
        lang === 'css'
          ? /^[@-]?[A-Za-z_][A-Za-z0-9_-]*/.exec(line.slice(i))
          : /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(line.slice(i));
      if (m) {
        const word = m[0];
        const after = line.slice(i + word.length).trimStart();
        if (lang === 'js') {
          if (JS_TS_KEYWORDS.has(word)) {
            push('keyword', word);
          } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) {
            push('type', word);
          } else if (after.startsWith(':') && !after.startsWith('::')) {
            push('property', word);
          } else {
            push('plain', word);
          }
        } else if (lang === 'python') {
          if (PYTHON_KEYWORDS.has(word)) {
            push('keyword', word);
          } else if (/^[A-Z][A-Za-z0-9_]*$/.test(word)) {
            push('type', word);
          } else {
            push('plain', word);
          }
        } else if (lang === 'sql') {
          push(SQL_KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'plain', word);
        } else if (lang === 'bash') {
          push(BASH_KEYWORDS.has(word) ? 'keyword' : 'plain', word);
        } else if (lang === 'css') {
          if (word.startsWith('@')) {
            push('keyword', word);
          } else if (after.startsWith(':')) {
            push('property', word);
          } else {
            push('plain', word);
          }
        } else if (lang === 'html') {
          if (after.startsWith('=')) {
            push('property', word);
          } else {
            push('plain', word);
          }
        } else if (lang === 'json') {
          if (word === 'true' || word === 'false' || word === 'null') {
            push('keyword', word);
          } else {
            push('plain', word);
          }
        } else {
          push(JS_TS_KEYWORDS.has(word) ? 'keyword' : 'plain', word);
        }
        i += word.length;
        continue;
      }
    }

    // Operators & punctuation
    if (/[=+\-*/<>!&|?:{}()[\].,;]/.test(ch)) {
      push('operator', ch);
      i += 1;
      continue;
    }

    push('plain', ch);
    i += 1;
  }

  return tokens;
}

export function tokenizeCodeSyntax(
  code: string,
  language = 'text',
): readonly (readonly CodeSyntaxToken[])[] {
  return code.split('\n').map((line) => tokenizeCodeLine(line, language));
}

/**
 * Serializes a Markdown GFM table into RFC-4180 compliant CSV.
 */
export function tableToCsvString(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const escapeCell = (cell: string): string => {
    const clean = cell.replace(/\*\*|__|`/g, '').trim();
    if (/[",\r\n]/.test(clean)) {
      return `"${clean.replace(/"/g, '""')}"`;
    }
    return clean;
  };
  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) =>
      headers.map((_, idx) => escapeCell(row[idx] ?? '')).join(','),
    ),
  ];
  return lines.join('\r\n');
}

/**
 * Numeric-aware sorting for GFM table rows by column index.
 */
export function sortTableRows(
  rows: readonly (readonly string[])[],
  columnIndex: number,
  direction: 'asc' | 'desc',
): readonly (readonly string[])[] {
  const factor = direction === 'asc' ? 1 : -1;
  const parseComparableNumber = (raw: string): number | null => {
    const stripped = raw
      .replace(/\*\*|__|`/g, '')
      .replace(/[$,€£¥%,\s]/g, '')
      .trim();
    if (!stripped) return null;
    const num = Number(stripped);
    return Number.isFinite(num) ? num : null;
  };

  return [...rows].sort((a, b) => {
    const rawA = (a[columnIndex] ?? '').replace(/\*\*|__|`/g, '').trim();
    const rawB = (b[columnIndex] ?? '').replace(/\*\*|__|`/g, '').trim();
    const numA = parseComparableNumber(rawA);
    const numB = parseComparableNumber(rawB);
    if (numA !== null && numB !== null) {
      return (numA - numB) * factor;
    }
    return rawA.localeCompare(rawB, undefined, { numeric: true, sensitivity: 'base' }) * factor;
  });
}

const LATEX_SYMBOLS: Readonly<Record<string, string>> = {
  '\\alpha': 'α',
  '\\beta': 'β',
  '\\gamma': 'γ',
  '\\delta': 'δ',
  '\\epsilon': 'ε',
  '\\varepsilon': 'ε',
  '\\zeta': 'ζ',
  '\\eta': 'η',
  '\\theta': 'θ',
  '\\iota': 'ι',
  '\\kappa': 'κ',
  '\\lambda': 'λ',
  '\\mu': 'μ',
  '\\nu': 'ν',
  '\\xi': 'ξ',
  '\\pi': 'π',
  '\\rho': 'ρ',
  '\\sigma': 'σ',
  '\\tau': 'τ',
  '\\upsilon': 'υ',
  '\\phi': 'φ',
  '\\varphi': 'φ',
  '\\chi': 'χ',
  '\\psi': 'ψ',
  '\\omega': 'ω',
  '\\Gamma': 'Γ',
  '\\Delta': 'Δ',
  '\\Theta': 'Θ',
  '\\Lambda': 'Λ',
  '\\Pi': 'Π',
  '\\Sigma': 'Σ',
  '\\Phi': 'Φ',
  '\\Psi': 'Ψ',
  '\\Omega': 'Ω',
  '\\infty': '∞',
  '\\pm': '±',
  '\\mp': '∓',
  '\\times': '×',
  '\\cdot': '·',
  '\\div': '÷',
  '\\neq': '≠',
  '\\ne': '≠',
  '\\leq': '≤',
  '\\le': '≤',
  '\\geq': '≥',
  '\\ge': '≥',
  '\\approx': '≈',
  '\\equiv': '≡',
  '\\propto': '∝',
  '\\sum': '∑',
  '\\prod': '∏',
  '\\int': '∫',
  '\\partial': '∂',
  '\\nabla': '∇',
  '\\in': '∈',
  '\\notin': '∉',
  '\\subset': '⊂',
  '\\subseteq': '⊆',
  '\\cup': '∪',
  '\\cap': '∩',
  '\\forall': '∀',
  '\\exists': '∃',
  '\\rightarrow': '→',
  '\\to': '→',
  '\\leftarrow': '←',
  '\\leftrightarrow': '↔',
  '\\Rightarrow': '⇒',
  '\\Leftarrow': '⇐',
  '\\Leftrightarrow': '⇔',
  '\\degree': '°',
  '\\circ': '°',
  '\\ldots': '…',
  '\\cdots': '⋯',
};

const SUPERSCRIPT_MAP: Readonly<Record<string, string>> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '+': '⁺',
  '-': '⁻',
  '=': '⁼',
  '(': '⁽',
  ')': '⁾',
  n: 'ⁿ',
  i: 'ⁱ',
  x: 'ˣ',
  y: 'ʸ',
  k: 'ᵏ',
  t: 'ᵗ',
};

const SUBSCRIPT_MAP: Readonly<Record<string, string>> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  '+': '₊',
  '-': '₋',
  '=': '₌',
  '(': '₍',
  ')': '₎',
  i: 'ᵢ',
  j: 'ⱼ',
  k: 'ₖ',
  n: 'ₙ',
  x: 'ₓ',
  a: 'ₐ',
  e: 'ₑ',
  o: 'ₒ',
};

function mapChars(text: string, map: Readonly<Record<string, string>>): string | null {
  let out = '';
  for (const ch of text) {
    const mapped = map[ch];
    if (!mapped) return null;
    out += mapped;
  }
  return out;
}

/**
 * Formats common LaTeX math expressions into clean, readable Unicode math notation
 * without requiring heavy external CSS/font bundles.
 */
export function formatLatexMathToUnicode(rawExpr: string): string {
  let s = rawExpr.trim();
  if (!s) return '';

  // Unwrap \text{...} and \mathrm{...}
  s = s.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]+)\}/g, '$1');
  // Replace \frac{a}{b} -> (a)/(b) or a/b when simple
  for (let pass = 0; pass < 3; pass += 1) {
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, num: string, den: string) => {
      const n = num.trim();
      const d = den.trim();
      const nFmt = n.length <= 2 ? n : `(${n})`;
      const dFmt = d.length <= 2 ? d : `(${d})`;
      return `${nFmt}/${dFmt}`;
    });
  }
  // Replace \sqrt{x} -> √(x)
  s = s.replace(/\\sqrt\{([^{}]+)\}/g, (_, inner: string) =>
    inner.trim().length <= 2 ? `√${inner.trim()}` : `√(${inner.trim()})`,
  );
  // Replace \left / \right sizing commands
  s = s.replace(/\\(?:left|right)\b/g, '');
  // Replace known LaTeX command symbols (longest first)
  const orderedSymbols = Object.keys(LATEX_SYMBOLS).sort((a, b) => b.length - a.length);
  for (const cmd of orderedSymbols) {
    if (s.includes(cmd)) {
      const escaped = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      s = s.replace(new RegExp(`${escaped}(?![A-Za-z])`, 'g'), LATEX_SYMBOLS[cmd]!);
    }
  }
  // Superscripts ^{...} or ^x
  s = s.replace(/\^\{([^{}]+)\}/g, (_, inner: string) => {
    const mapped = mapChars(inner.trim(), SUPERSCRIPT_MAP);
    return mapped ?? `^(${inner.trim()})`;
  });
  s = s.replace(/\^([0-9a-zA-Z+-])/g, (_, ch: string) => SUPERSCRIPT_MAP[ch] ?? `^${ch}`);
  // Subscripts _{...} or _x
  s = s.replace(/_\{([^{}]+)\}/g, (_, inner: string) => {
    const mapped = mapChars(inner.trim(), SUBSCRIPT_MAP);
    return mapped ?? `_${inner.trim()}`;
  });
  s = s.replace(/_([0-9a-zA-Z+-])/g, (_, ch: string) => SUBSCRIPT_MAP[ch] ?? `_${ch}`);

  return s.replace(/\s{2,}/g, ' ').trim();
}

export interface MermaidDiagramNode {
  readonly id: string;
  readonly label: string;
  readonly shape: 'rect' | 'round' | 'diamond' | 'circle';
  readonly col: number;
  readonly row: number;
}

export interface MermaidDiagramEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

export interface ParsedMermaidDiagram {
  readonly kind: 'flowchart' | 'sequence';
  readonly direction: 'TD' | 'LR';
  readonly nodes: readonly MermaidDiagramNode[];
  readonly edges: readonly MermaidDiagramEdge[];
}

function parseMermaidNodeToken(rawToken: string): {
  id: string;
  label?: string;
  shape?: MermaidDiagramNode['shape'];
} | null {
  const token = rawToken.trim();
  if (!token) return null;

  const patterns: Array<{
    regex: RegExp;
    shape: MermaidDiagramNode['shape'];
  }> = [
    { regex: /^([A-Za-z0-9_-]+)\(\((.+)\)\)$/, shape: 'circle' },
    { regex: /^([A-Za-z0-9_-]+)\{(.+)\}$/, shape: 'diamond' },
    { regex: /^([A-Za-z0-9_-]+)\((.+)\)$/, shape: 'round' },
    { regex: /^([A-Za-z0-9_-]+)\[(.+)\]$/, shape: 'rect' },
  ];

  for (const { regex, shape } of patterns) {
    const m = regex.exec(token);
    if (m) {
      return {
        id: m[1]!,
        label: m[2]!.replace(/^["']|["']$/g, '').trim(),
        shape,
      };
    }
  }

  const plainId = /^([A-Za-z0-9_-]+)$/.exec(token);
  if (plainId) {
    return { id: plainId[1]! };
  }
  return null;
}

/**
 * Parses Mermaid flowchart (`graph TD/LR`, `flowchart TD/LR`) or basic `sequenceDiagram`
 * into a deterministic node/edge graph for safe native SVG rendering.
 */
export function parseMermaidDiagram(source: string): ParsedMermaidDiagram | null {
  const lines = source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('%%'));

  if (lines.length === 0) return null;

  const header = lines[0]!;
  const isSequence = /^sequenceDiagram\b/i.test(header);
  const flowMatch = /^(?:graph|flowchart)\s+(TD|TB|LR|RL|BT)\b/i.exec(header);

  if (!isSequence && !flowMatch) {
    return null;
  }

  const direction: 'TD' | 'LR' =
    isSequence || (flowMatch && /^LR|RL$/i.test(flowMatch[1]!)) ? 'LR' : 'TD';

  const nodeMap = new Map<
    string,
    { id: string; label: string; shape: MermaidDiagramNode['shape'] }
  >();
  const edges: MermaidDiagramEdge[] = [];

  const upsertNode = (
    id: string,
    label?: string,
    shape?: MermaidDiagramNode['shape'],
  ) => {
    const existing = nodeMap.get(id);
    if (existing) {
      if (label && existing.label === existing.id) {
        existing.label = label;
      }
      if (shape && existing.shape === 'rect') {
        existing.shape = shape;
      }
      return;
    }
    nodeMap.set(id, {
      id,
      label: label || id,
      shape: shape || 'rect',
    });
  };

  for (const line of lines.slice(1)) {
    if (/^(?:subgraph|end|classDef|class|style|participant|actor)\b/i.test(line)) {
      const pMatch = /^(?:participant|actor)\s+([A-Za-z0-9_-]+)(?:\s+as\s+(.+))?$/i.exec(line);
      if (pMatch) {
        upsertNode(pMatch[1]!, pMatch[2]?.trim() || pMatch[1]!, 'round');
      }
      continue;
    }

    if (isSequence) {
      const seqMatch = /^([A-Za-z0-9_-]+?)\s*(?:-->>|->>|-->|->)\s*([A-Za-z0-9_-]+)\s*:\s*(.+)$/.exec(
        line,
      );
      if (seqMatch) {
        upsertNode(seqMatch[1]!, undefined, 'round');
        upsertNode(seqMatch[2]!, undefined, 'round');
        edges.push({
          from: seqMatch[1]!,
          to: seqMatch[2]!,
          label: seqMatch[3]!.trim(),
        });
      }
      continue;
    }

    // Flowchart edges: A[Start] -->|Yes| B{Check} or A --> B
    const edgeMatch =
      /^(.+?)\s*(?:-->|==>|-.->|---)\s*(?:\|([^|]+)\|\s*)?(.+?);?$/.exec(line);
    if (edgeMatch) {
      const left = parseMermaidNodeToken(edgeMatch[1]!);
      const right = parseMermaidNodeToken(edgeMatch[3]!);
      if (left && right) {
        upsertNode(left.id, left.label, left.shape);
        upsertNode(right.id, right.label, right.shape);
        edges.push({
          from: left.id,
          to: right.id,
          label: edgeMatch[2]?.trim() || undefined,
        });
      }
      continue;
    }

    // Standalone node declaration
    const solo = parseMermaidNodeToken(line.replace(/;$/, ''));
    if (solo) {
      upsertNode(solo.id, solo.label, solo.shape);
    }
  }

  if (nodeMap.size === 0) return null;

  // Topological level layout (BFS layers)
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const id of nodeMap.keys()) {
    inDegree.set(id, 0);
    outgoing.set(id, []);
  }
  for (const edge of edges) {
    if (edge.from !== edge.to) {
      outgoing.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }
  }

  const levelMap = new Map<string, number>();
  const queue: string[] = [];
  for (const [id, deg] of inDegree.entries()) {
    if (deg === 0) {
      levelMap.set(id, 0);
      queue.push(id);
    }
  }
  if (queue.length === 0) {
    const firstId = nodeMap.keys().next().value as string;
    levelMap.set(firstId, 0);
    queue.push(firstId);
  }

  let head = 0;
  while (head < queue.length) {
    const curr = queue[head++]!;
    const currLevel = levelMap.get(curr) ?? 0;
    for (const nxt of outgoing.get(curr) ?? []) {
      if (!levelMap.has(nxt)) {
        levelMap.set(nxt, currLevel + 1);
        queue.push(nxt);
      }
    }
  }
  // Assign any remaining disconnected nodes
  for (const id of nodeMap.keys()) {
    if (!levelMap.has(id)) {
      levelMap.set(id, 0);
    }
  }

  const perLevelCounts = new Map<number, number>();
  const positionedNodes: MermaidDiagramNode[] = [];
  for (const node of nodeMap.values()) {
    const level = levelMap.get(node.id) ?? 0;
    const lane = perLevelCounts.get(level) ?? 0;
    perLevelCounts.set(level, lane + 1);
    positionedNodes.push({
      ...node,
      col: direction === 'LR' ? level : lane,
      row: direction === 'LR' ? lane : level,
    });
  }

  return {
    kind: isSequence ? 'sequence' : 'flowchart',
    direction,
    nodes: positionedNodes,
    edges,
  };
}

export interface UnifiedDiffLine {
  readonly kind: 'same' | 'add' | 'remove';
  readonly text: string;
  readonly oldLine: number | null;
  readonly newLine: number | null;
}

export interface UnifiedDiffResult {
  readonly lines: readonly UnifiedDiffLine[];
  readonly addedCount: number;
  readonly removedCount: number;
}

/**
 * Pure LCS line-level diff engine for comparing code bundle versions or unsaved edits.
 */
export function computeLineDiff(
  beforeText: string,
  afterText: string,
): UnifiedDiffResult {
  const a = beforeText === '' ? [] : beforeText.replace(/\r\n/g, '\n').split('\n');
  const b = afterText === '' ? [] : afterText.replace(/\r\n/g, '\n').split('\n');

  const n = a.length;
  const m = b.length;

  // Guard huge files with simple line-by-line fallback to stay instant
  if (n * m > 250_000) {
    const lines: UnifiedDiffLine[] = [];
    const maxLen = Math.max(n, m);
    let addedCount = 0;
    let removedCount = 0;
    for (let i = 0; i < maxLen; i += 1) {
      if (i < n && i < m && a[i] === b[i]) {
        lines.push({ kind: 'same', text: a[i]!, oldLine: i + 1, newLine: i + 1 });
      } else {
        if (i < n) {
          lines.push({ kind: 'remove', text: a[i]!, oldLine: i + 1, newLine: null });
          removedCount += 1;
        }
        if (i < m) {
          lines.push({ kind: 'add', text: b[i]!, oldLine: null, newLine: i + 1 });
          addedCount += 1;
        }
      }
    }
    return { lines, addedCount, removedCount };
  }

  const dp: Uint32Array[] = Array.from(
    { length: n + 1 },
    () => new Uint32Array(m + 1),
  );

  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i]!;
    const nextRow = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j -= 1) {
      if (a[i] === b[j]) {
        row[j] = nextRow[j + 1]! + 1;
      } else {
        row[j] = Math.max(nextRow[j]!, row[j + 1]!);
      }
    }
  }

  const lines: UnifiedDiffLine[] = [];
  let i = 0;
  let j = 0;
  let addedCount = 0;
  let removedCount = 0;

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i]!, oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      lines.push({ kind: 'remove', text: a[i]!, oldLine: i + 1, newLine: null });
      removedCount += 1;
      i += 1;
    } else {
      lines.push({ kind: 'add', text: b[j]!, oldLine: null, newLine: j + 1 });
      addedCount += 1;
      j += 1;
    }
  }

  while (i < n) {
    lines.push({ kind: 'remove', text: a[i]!, oldLine: i + 1, newLine: null });
    removedCount += 1;
    i += 1;
  }
  while (j < m) {
    lines.push({ kind: 'add', text: b[j]!, oldLine: null, newLine: j + 1 });
    addedCount += 1;
    j += 1;
  }

  return { lines, addedCount, removedCount };
}

/**
 * Converts a slide deck view-model (including inline edits, charts, and speaker notes)
 * into a printable multi-section %PDF-1.4 handout specification for /api/v1/artifacts/recompile.
 */
export function slideDeckToHandoutPdfSpec(deck: ParsedSlideDeckViewModel): {
  readonly title: string;
  readonly subtitle: string;
  readonly documentType: 'general_guide';
  readonly author: string;
  readonly generatedDate: string;
  readonly executiveSummary: string;
  readonly keyMetrics: readonly { readonly label: string; readonly value: string }[];
  readonly sections: readonly {
    readonly heading: string;
    readonly content: string;
    readonly bullets: readonly string[];
    readonly callout?: string;
    readonly chart?: ParsedVectorChart;
  }[];
  readonly footer: string;
} {
  const contentSlides = deck.slides.filter((s) => s.kind === 'content');
  const usableSlides = contentSlides.length > 0 ? contentSlides : deck.slides;

  return {
    title: `${deck.deckTitle} — Presenter Handout`,
    subtitle: deck.deckSubtitle || 'Printable Slide Deck Handout & Speaker Notes',
    documentType: 'general_guide',
    author: deck.author || 'Kartik.ai Presentation Studio',
    generatedDate: deck.generatedDate || new Date().toISOString().slice(0, 10),
    executiveSummary: `Complete ${deck.slides.length}-slide presenter handout for "${deck.deckTitle}" including slide talking points, visual charts, and speaker notes.`,
    keyMetrics: [
      { label: 'Total Slides', value: String(deck.slides.length) },
      { label: 'Content Modules', value: String(contentSlides.length) },
      { label: 'Surface Theme', value: deck.surfaceMode === 'light' ? 'Paper Light' : 'Obsidian Dark' },
    ],
    sections: usableSlides.slice(0, 12).map((slide, idx) => {
      const notesPrefix = slide.speakerNotes
        ? `Speaker Notes: ${slide.speakerNotes}`
        : slide.subtitle || `Key points for Slide ${idx + 1}: ${slide.title}.`;
      const derivedBullets: string[] = [...slide.bullets];
      if (derivedBullets.length === 0 && slide.metrics && slide.metrics.length > 0) {
        slide.metrics.forEach((m) =>
          derivedBullets.push(`${m.label}: ${m.value}${m.delta ? ` (${m.delta})` : ''}`),
        );
      }
      if (derivedBullets.length === 0 && slide.steps && slide.steps.length > 0) {
        slide.steps.forEach((st) =>
          derivedBullets.push(`${st.step}. ${st.title} — ${st.detail}`),
        );
      }
      if (derivedBullets.length === 0 && slide.columns && slide.columns.length > 0) {
        slide.columns.forEach((col) =>
          derivedBullets.push(`${col.heading}: ${col.points.join('; ')}`),
        );
      }

      return {
        heading: `Slide ${slide.slideNumber}: ${slide.title}`,
        content: notesPrefix,
        bullets: derivedBullets.slice(0, 6),
        ...(slide.callout ? { callout: slide.callout } : {}),
        ...(slide.chart ? { chart: slide.chart } : {}),
      };
    }),
    footer: deck.slides[0]?.footer || 'Generated by Kartik.ai Slide Handout Compiler',
  };
}
