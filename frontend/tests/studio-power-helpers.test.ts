import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  computeLineDiff,
  formatLatexMathToUnicode,
  parseMermaidDiagram,
  slideDeckToHandoutPdfSpec,
  sortTableRows,
  tableToCsvString,
  tokenizeCodeSyntax,
} from '../src/components/studio-power-helpers.js';
import type { ParsedSlideDeckViewModel } from '../src/components/slide-deck-and-markdown.js';

describe('@kartik/frontend Fix #29 Studio Power Helpers', () => {
  it('tokenizes syntax across TypeScript, Python, SQL, HTML, CSS, and JSON without emitting raw HTML', () => {
    const tsLines = tokenizeCodeSyntax(
      'export const count: number = 42; // total\nconst label = "ok";',
      'typescript',
    );
    assert.equal(tsLines.length, 2);
    assert.ok(tsLines[0]!.some((t) => t.kind === 'keyword' && t.text === 'export'));
    assert.ok(tsLines[0]!.some((t) => t.kind === 'number' && t.text === '42'));
    assert.ok(tsLines[0]!.some((t) => t.kind === 'comment' && t.text.includes('total')));
    assert.ok(tsLines[1]!.some((t) => t.kind === 'string' && t.text === '"ok"'));

    const pyLines = tokenizeCodeSyntax('def compute(x):\n    return x * 2 # double', 'python');
    assert.ok(pyLines[0]!.some((t) => t.kind === 'keyword' && t.text === 'def'));
    assert.ok(pyLines[1]!.some((t) => t.kind === 'comment' && t.text.includes('double')));

    const sqlLines = tokenizeCodeSyntax('SELECT id FROM users WHERE active = 1 -- filter', 'sql');
    assert.ok(sqlLines[0]!.some((t) => t.kind === 'keyword' && t.text === 'SELECT'));
    assert.ok(sqlLines[0]!.some((t) => t.kind === 'comment'));

    const htmlLines = tokenizeCodeSyntax('<div class="card">Hello</div>', 'html');
    assert.ok(htmlLines[0]!.some((t) => t.kind === 'tag' && t.text === '<div'));
    assert.ok(htmlLines[0]!.some((t) => t.kind === 'property' && t.text === 'class'));

    const cssLines = tokenizeCodeSyntax('color: #18181B; padding: 12px;', 'css');
    assert.ok(cssLines[0]!.some((t) => t.kind === 'property' && t.text === 'color'));
    assert.ok(cssLines[0]!.some((t) => t.kind === 'number' && t.text === '#18181B'));

    const jsonLines = tokenizeCodeSyntax('{"active": true, "score": 98}', 'json');
    assert.ok(jsonLines[0]!.some((t) => t.kind === 'property' && t.text === '"active"'));
    assert.ok(jsonLines[0]!.some((t) => t.kind === 'keyword' && t.text === 'true'));
  });

  it('exports RFC-4180 CSV and performs numeric-aware ascending/descending table sorting', () => {
    const headers = ['Region', 'Revenue', 'Notes'];
    const rows = [
      ['North, West', '$1,200', 'Quoted "high"'],
      ['East', '$450', '**Steady**'],
      ['South', '$10,500', 'Growth'],
    ];

    const csv = tableToCsvString(headers, rows);
    const lines = csv.split('\r\n');
    assert.equal(lines[0], 'Region,Revenue,Notes');
    assert.equal(lines[1], '"North, West","$1,200","Quoted ""high"""');
    assert.equal(lines[2], 'East,$450,Steady');

    const ascNumeric = sortTableRows(rows, 1, 'asc');
    assert.deepEqual(
      ascNumeric.map((r) => r[0]),
      ['East', 'North, West', 'South'],
    );

    const descNumeric = sortTableRows(rows, 1, 'desc');
    assert.deepEqual(
      descNumeric.map((r) => r[0]),
      ['South', 'North, West', 'East'],
    );

    const ascAlpha = sortTableRows(rows, 0, 'asc');
    assert.deepEqual(
      ascAlpha.map((r) => r[0]),
      ['East', 'North, West', 'South'],
    );
  });

  it('formats LaTeX equations into clean Unicode mathematical notation', () => {
    assert.equal(formatLatexMathToUnicode('E = mc^2'), 'E = mc²');
    assert.equal(
      formatLatexMathToUnicode('\\frac{a+b}{2} + \\sqrt{x} \\leq \\infty'),
      '(a+b)/2 + √x ≤ ∞',
    );
    assert.equal(
      formatLatexMathToUnicode('\\sum_{i=1}^{n} \\alpha_i \\cdot x_i'),
      '∑ᵢ₌₁ⁿ αᵢ · xᵢ',
    );
  });

  it('parses Mermaid flowcharts and sequence diagrams into positioned node/edge graphs', () => {
    const flow = parseMermaidDiagram(`
      graph LR
      A[User Prompt] -->|Route| B{Planner}
      B -->|Code| C(Sandbox)
      B -->|Slides| D((Deck))
    `);
    assert.ok(flow);
    assert.equal(flow.kind, 'flowchart');
    assert.equal(flow.direction, 'LR');
    assert.equal(flow.nodes.length, 4);
    assert.equal(flow.edges.length, 3);
    const planner = flow.nodes.find((n) => n.id === 'B');
    assert.equal(planner?.shape, 'diamond');
    assert.equal(planner?.col, 1);

    const seq = parseMermaidDiagram(`
      sequenceDiagram
      participant Client
      participant API
      Client->>API: POST /messages
      API-->>Client: 201 Created
    `);
    assert.ok(seq);
    assert.equal(seq.kind, 'sequence');
    assert.equal(seq.nodes.length, 2);
    assert.equal(seq.edges.length, 2);
    assert.equal(seq.edges[0]?.label, 'POST /messages');

    assert.equal(parseMermaidDiagram('not a mermaid diagram'), null);
  });

  it('computes accurate LCS line diffs with exact added and removed counts', () => {
    const before = ['const a = 1;', 'const b = 2;', 'const c = 3;'].join('\n');
    const after = ['const a = 1;', 'const b = 20;', 'const c = 3;', 'const d = 4;'].join('\n');

    const diff = computeLineDiff(before, after);
    assert.equal(diff.removedCount, 1);
    assert.equal(diff.addedCount, 2);
    assert.ok(diff.lines.some((l) => l.kind === 'remove' && l.text === 'const b = 2;'));
    assert.ok(diff.lines.some((l) => l.kind === 'add' && l.text === 'const b = 20;'));
    assert.ok(diff.lines.some((l) => l.kind === 'add' && l.text === 'const d = 4;'));

    const identical = computeLineDiff(before, before);
    assert.equal(identical.addedCount, 0);
    assert.equal(identical.removedCount, 0);
  });

  it('converts an edited Slide Deck into a printable PDF Handout specification preserving speaker notes and charts', () => {
    const deck: ParsedSlideDeckViewModel = {
      deckTitle: 'Solar Grid Expansion',
      deckSubtitle: '2026 Regional Review',
      theme: 'editorial_story',
      surfaceMode: 'light',
      author: 'Editorial Team',
      generatedDate: '2026-11-22',
      slides: [
        {
          slideNumber: 1,
          totalSlides: 2,
          kind: 'cover',
          layout: 'spotlight',
          title: 'Solar Grid Expansion',
          subtitle: '2026 Regional Review',
          bullets: [],
          footer: 'Kartik.ai',
        },
        {
          slideNumber: 2,
          totalSlides: 2,
          kind: 'content',
          layout: 'metrics',
          title: 'Capacity Highlights',
          subtitle: 'Regional Utility Additions',
          bullets: [],
          metrics: [{ label: 'Solar Added', value: '420 GW', delta: '+18%' }],
          speakerNotes: 'Highlight the utility-scale surge across Asia and Europe.',
          chart: {
            title: 'GW Added',
            unit: 'GW',
            bars: [
              { label: 'Solar', value: 420, displayValue: '420 GW' },
              { label: 'Wind', value: 185, displayValue: '185 GW' },
            ],
          },
          footer: 'Kartik.ai',
        },
      ],
    };

    const handout = slideDeckToHandoutPdfSpec(deck);
    assert.equal(handout.title, 'Solar Grid Expansion — Presenter Handout');
    assert.equal(handout.documentType, 'general_guide');
    assert.equal(handout.sections.length, 1);
    assert.ok(handout.sections[0]?.content.includes('Speaker Notes: Highlight the utility-scale surge'));
    assert.deepEqual(handout.sections[0]?.bullets, ['Solar Added: 420 GW (+18%)']);
    assert.equal(handout.sections[0]?.chart?.bars.length, 2);
  });
});
