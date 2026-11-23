import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  GitFork,
  Globe,
  Terminal,
  WrapText,
} from 'lucide-react';
import {
  formatCitationRelevancePercent,
  tokenizeInlineMarkdown,
  tokenizeMarkdownBlocks,
  type MarkdownBlock,
} from '../slide-deck-and-markdown.js';
import {
  formatLatexMathToUnicode,
  parseMermaidDiagram,
  sortTableRows,
  tableToCsvString,
  tokenizeCodeSyntax,
  type CodeTokenKind,
} from '../studio-power-helpers.js';
import type { MessageCitation } from '../../types/index.js';

function resolveCitationHost(citation: MessageCitation): string {
  if (citation.domain && citation.domain.trim()) {
    return citation.domain.trim();
  }
  try {
    return new URL(citation.urlOrPage).hostname.replace(/^www\./i, '');
  } catch {
    return citation.urlOrPage;
  }
}

function InlineCitationBadge({
  index,
  citation,
  onCitationClick,
}: {
  readonly index: number;
  readonly citation: MessageCitation;
  readonly onCitationClick?: (citationZeroBasedIndex: number) => void;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const citationZeroIdx = index - 1;
  const isDocumentCitation =
    citation.sourceType === 'document' ||
    !/^https?:\/\//i.test(citation.urlOrPage);
  const hostOrPage = resolveCitationHost(citation);
  const matchPct = formatCitationRelevancePercent(citation.score);

  return (
    <sup
      className="relative inline-block ml-0.5 align-super"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
    >
      <button
        type="button"
        onClick={() => onCitationClick?.(citationZeroIdx)}
        data-inline-citation-badge={index}
        aria-label={`Source ${index}: ${citation.title}`}
        className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono font-semibold tabular-nums rounded border transition-colors cursor-pointer ${
          isDocumentCitation
            ? 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/35'
            : 'bg-white/[0.09] hover:bg-white/[0.2] text-zinc-100 border-white/[0.18]'
        }`}
      >
        {index}
      </button>

      {/* 21st.dev Inline Citation Hover Popover Card */}
      {isHovered && (
        <span
          role="tooltip"
          data-citation-hover-card={index}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-72 max-w-[80vw] rounded-xl bg-[#111114]/98 backdrop-blur-xl border border-white/[0.14] shadow-[0_20px_50px_-10px_rgba(0,0,0,0.92)] p-3 text-left font-sans not-italic font-normal leading-snug block"
        >
          <span className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-md bg-white/[0.07] border border-white/[0.1] flex items-center justify-center shrink-0 mt-0.5">
              {isDocumentCitation ? (
                <FileText className="w-3 h-3 text-emerald-400" />
              ) : (
                <Globe className="w-3 h-3 text-zinc-200" />
              )}
            </span>
            <span className="min-w-0 flex-1 block">
              <span className="block text-[11.5px] font-semibold text-white line-clamp-2">
                {citation.title}
              </span>
              <span className="block text-[10px] font-mono text-zinc-400 truncate mt-0.5 tabular-nums">
                {hostOrPage}
                {matchPct !== null ? ` · ${matchPct}% match` : ''}
              </span>
            </span>
          </span>

          {citation.snippet && (
            <span className="block mt-2 pt-2 border-t border-white/[0.07] text-[11px] text-zinc-300 line-clamp-3 leading-relaxed">
              &ldquo;{citation.snippet.trim()}&rdquo;
            </span>
          )}

          <span className="mt-2 pt-1.5 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-zinc-400">
            <span>Click badge to jump</span>
            {!isDocumentCitation && (
              <a
                href={citation.urlOrPage}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 text-white hover:underline"
              >
                <span>Open</span>
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            )}
          </span>
        </span>
      )}
    </sup>
  );
}

function renderInlineFormattedText(
  text: string,
  citations?: readonly MessageCitation[],
  onCitationClick?: (citationZeroBasedIndex: number) => void,
  depth = 0,
): React.ReactNode[] {
  const tokens = tokenizeInlineMarkdown(text);
  return tokens.map((token, idx) => {
    if (token.type === 'code') {
      return (
        <code
          key={idx}
          className="px-1.5 py-0.5 mx-0.5 text-[12px] font-mono bg-white/[0.07] text-zinc-100 border border-white/[0.09] rounded-md"
        >
          {token.text}
        </code>
      );
    }

    if (token.type === 'math') {
      return (
        <span
          key={idx}
          data-inline-math="true"
          title={token.expression}
          className="inline-block px-1.5 py-0.5 mx-0.5 rounded bg-white/[0.05] border border-white/[0.1] font-serif italic text-[14px] text-zinc-100 tracking-wide"
        >
          {formatLatexMathToUnicode(token.expression)}
        </span>
      );
    }

    if (token.type === 'bold') {
      return (
        <strong key={idx} className="font-semibold text-white">
          {depth < 2
            ? renderInlineFormattedText(
                token.text,
                citations,
                onCitationClick,
                depth + 1,
              )
            : token.text}
        </strong>
      );
    }

    if (token.type === 'italic') {
      return (
        <em key={idx} className="italic text-zinc-300">
          {token.text}
        </em>
      );
    }

    if (token.type === 'link') {
      return (
        <a
          key={idx}
          href={token.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-white underline decoration-white/35 underline-offset-4 hover:decoration-white transition-colors"
        >
          {token.label}
        </a>
      );
    }

    if (token.type === 'citation') {
      const citationIdx = token.index - 1;
      const matched =
        citations && citationIdx >= 0 && citationIdx < citations.length
          ? citations[citationIdx]
          : undefined;

      if (!matched) {
        return <React.Fragment key={idx}>{token.raw}</React.Fragment>;
      }

      return (
        <InlineCitationBadge
          key={idx}
          index={token.index}
          citation={matched}
          onCitationClick={onCitationClick}
        />
      );
    }

    return <React.Fragment key={idx}>{token.text}</React.Fragment>;
  });
}

const CODE_TOKEN_CLASSES: Readonly<Record<CodeTokenKind, string>> = {
  plain: 'text-zinc-200',
  keyword: 'text-sky-300 font-medium',
  string: 'text-emerald-300',
  comment: 'text-zinc-500 italic',
  number: 'text-amber-300',
  type: 'text-violet-300',
  property: 'text-cyan-200',
  operator: 'text-zinc-400',
  tag: 'text-rose-300',
};

function MermaidDiagramCard({ source }: { readonly source: string }) {
  const [viewMode, setViewMode] = useState<'diagram' | 'source'>('diagram');
  const [copied, setCopied] = useState(false);
  const parsed = useMemo(() => parseMermaidDiagram(source), [source]);

  const handleCopy = () => {
    const clip = navigator.clipboard?.writeText(source);
    if (clip && typeof clip.catch === 'function') {
      clip.catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!parsed) {
    return <CodeBlockCard language="mermaid" code={source} />;
  }

  const nodeW = 152;
  const nodeH = 44;
  const gapX = 56;
  const gapY = 48;
  const pad = 28;

  const maxCol = Math.max(0, ...parsed.nodes.map((n) => n.col));
  const maxRow = Math.max(0, ...parsed.nodes.map((n) => n.row));
  const svgW = Math.max(420, pad * 2 + (maxCol + 1) * nodeW + maxCol * gapX);
  const svgH = Math.max(150, pad * 2 + (maxRow + 1) * nodeH + maxRow * gapY);

  const posById = new Map<string, { x: number; y: number }>();
  for (const node of parsed.nodes) {
    posById.set(node.id, {
      x: pad + node.col * (nodeW + gapX),
      y: pad + node.row * (nodeH + gapY),
    });
  }

  return (
    <div
      data-mermaid-diagram="true"
      className="my-4 rounded-xl overflow-hidden border border-white/[0.09] bg-[#0d0d10]"
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-[#131317] border-b border-white/[0.07] text-xs text-zinc-400 font-mono">
        <div className="flex items-center gap-2">
          <GitFork className="w-3.5 h-3.5 text-zinc-300" />
          <span className="uppercase tracking-wider font-semibold text-zinc-200">
            Mermaid {parsed.kind}
          </span>
          <span className="text-zinc-600">·</span>
          <span className="text-[11px] text-zinc-500 tabular-nums">
            {parsed.nodes.length} nodes · {parsed.edges.length} edges
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="inline-flex rounded-md bg-white/[0.05] p-0.5 font-sans">
            <button
              type="button"
              onClick={() => setViewMode('diagram')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'diagram'
                  ? 'bg-white text-zinc-950'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Diagram
            </button>
            <button
              type="button"
              onClick={() => setViewMode('source')}
              className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                viewMode === 'source'
                  ? 'bg-white text-zinc-950'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Source
            </button>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 font-sans text-[11px] font-medium transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>

      {viewMode === 'source' ? (
        <pre className="p-4 text-[12px] font-mono text-zinc-300 overflow-x-auto leading-relaxed">
          <code>{source}</code>
        </pre>
      ) : (
        <div className="p-4 overflow-x-auto bg-[#09090b]">
          <svg
            viewBox={`0 0 ${svgW} ${svgH}`}
            width={svgW}
            height={svgH}
            role="img"
            aria-label={`Mermaid ${parsed.kind} diagram`}
            className="mx-auto max-w-full h-auto"
          >
            <defs>
              <marker
                id="kartik-mermaid-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="#71717a" />
              </marker>
            </defs>

            {parsed.edges.map((edge, idx) => {
              const fromPos = posById.get(edge.from);
              const toPos = posById.get(edge.to);
              if (!fromPos || !toPos) return null;
              const isHorizontal = parsed.direction === 'LR';
              const x1 = isHorizontal ? fromPos.x + nodeW : fromPos.x + nodeW / 2;
              const y1 = isHorizontal ? fromPos.y + nodeH / 2 : fromPos.y + nodeH;
              const x2 = isHorizontal ? toPos.x : toPos.x + nodeW / 2;
              const y2 = isHorizontal ? toPos.y + nodeH / 2 : toPos.y;
              const midX = (x1 + x2) / 2;
              const midY = (y1 + y2) / 2;
              return (
                <g key={`${edge.from}-${edge.to}-${idx}`}>
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#52525b"
                    strokeWidth="1.5"
                    markerEnd="url(#kartik-mermaid-arrow)"
                  />
                  {edge.label && (
                    <g>
                      <rect
                        x={midX - Math.min(64, edge.label.length * 3.5 + 8)}
                        y={midY - 9}
                        width={Math.min(128, edge.label.length * 7 + 16)}
                        height={18}
                        rx={4}
                        fill="#111114"
                        stroke="#27272a"
                      />
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        fill="#a1a1aa"
                        fontSize="10"
                        fontFamily="ui-monospace, SFMono-Regular, monospace"
                      >
                        {edge.label.slice(0, 22)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {parsed.nodes.map((node) => {
              const pos = posById.get(node.id)!;
              const cx = pos.x + nodeW / 2;
              const cy = pos.y + nodeH / 2;
              const displayLabel =
                node.label.length > 20 ? `${node.label.slice(0, 18)}…` : node.label;
              return (
                <g key={node.id}>
                  {node.shape === 'diamond' ? (
                    <polygon
                      points={`${cx},${pos.y - 4} ${pos.x + nodeW + 4},${cy} ${cx},${pos.y + nodeH + 4} ${pos.x - 4},${cy}`}
                      fill="#18181b"
                      stroke="#e4e4e7"
                      strokeWidth="1.2"
                    />
                  ) : node.shape === 'circle' ? (
                    <rect
                      x={pos.x}
                      y={pos.y}
                      width={nodeW}
                      height={nodeH}
                      rx={nodeH / 2}
                      fill="#141418"
                      stroke="#a1a1aa"
                      strokeWidth="1.2"
                    />
                  ) : (
                    <rect
                      x={pos.x}
                      y={pos.y}
                      width={nodeW}
                      height={nodeH}
                      rx={node.shape === 'round' ? 14 : 8}
                      fill="#141418"
                      stroke="#3f3f46"
                      strokeWidth="1.2"
                    />
                  )}
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fill="#f4f4f5"
                    fontSize="11.5"
                    fontWeight="500"
                    fontFamily="Inter, system-ui, sans-serif"
                  >
                    {displayLabel}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

function CodeBlockCard({
  language,
  code,
}: {
  readonly language: string;
  readonly code: string;
}) {
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);
  const tokenizedLines = useMemo(
    () => tokenizeCodeSyntax(code, language),
    [code, language],
  );
  const lineCount = code ? tokenizedLines.length : 0;

  const handleCopy = () => {
    const clip = navigator.clipboard?.writeText(code);
    if (clip && typeof clip.catch === 'function') {
      clip.catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      data-code-block="true"
      data-code-highlighted="true"
      className="my-4 rounded-xl overflow-hidden border border-white/[0.09] bg-[#0d0d10]"
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-[#131317] border-b border-white/[0.07] text-xs text-zinc-400 font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
          <span className="uppercase tracking-wider font-semibold text-zinc-200 truncate">
            {language || 'code'}
          </span>
          <span className="text-zinc-600">·</span>
          <span className="text-[11px] text-zinc-500 tabular-nums whitespace-nowrap">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setWrapLines((prev) => !prev)}
            aria-pressed={wrapLines}
            title={wrapLines ? 'Disable line wrapping' : 'Wrap long lines'}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-sans font-medium transition-colors cursor-pointer ${
              wrapLines
                ? 'bg-white text-zinc-950'
                : 'bg-white/[0.06] hover:bg-white/[0.12] text-zinc-300'
            }`}
          >
            <WrapText className="w-3 h-3" />
            <span>Wrap</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            data-code-copy-button="true"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 font-sans text-[11px] font-medium transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
      <pre
        className={`p-4 text-[12.5px] font-mono leading-relaxed ${
          wrapLines
            ? 'whitespace-pre-wrap break-words'
            : 'whitespace-pre overflow-x-auto'
        }`}
      >
        <code>
          {tokenizedLines.map((lineTokens, lineIdx) => (
            <span key={lineIdx} className="block min-h-[1.3em]">
              {lineTokens.length === 0
                ? ' '
                : lineTokens.map((tok, tIdx) => (
                    <span
                      key={tIdx}
                      className={CODE_TOKEN_CLASSES[tok.kind]}
                    >
                      {tok.text}
                    </span>
                  ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function InteractiveTableCard({
  headers,
  rows,
  flowClass,
  renderCell,
}: {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly flowClass: string;
  readonly renderCell: (text: string) => React.ReactNode;
}) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [copiedCsv, setCopiedCsv] = useState(false);

  const displayedRows = useMemo(() => {
    if (sortCol === null) return rows;
    return sortTableRows(rows, sortCol, sortDir);
  }, [rows, sortCol, sortDir]);

  const handleSort = (colIdx: number) => {
    if (sortCol === colIdx) {
      if (sortDir === 'asc') {
        setSortDir('desc');
      } else {
        setSortCol(null);
        setSortDir('asc');
      }
    } else {
      setSortCol(colIdx);
      setSortDir('asc');
    }
  };

  const handleCopyCsv = () => {
    const csv = tableToCsvString(headers, displayedRows);
    const clip = navigator.clipboard?.writeText(csv);
    if (clip && typeof clip.catch === 'function') {
      clip.catch(() => {});
    }
    setCopiedCsv(true);
    setTimeout(() => setCopiedCsv(false), 1800);
  };

  const handleDownloadCsv = () => {
    const csv = tableToCsvString(headers, displayedRows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'kartik-table.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      data-interactive-table="true"
      className={`my-4 rounded-xl border border-white/[0.08] bg-[#0e0e11] overflow-hidden ${flowClass}`}
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-[#131317] border-b border-white/[0.07] text-[11px] text-zinc-400">
        <span className="font-mono tabular-nums">
          {rows.length} {rows.length === 1 ? 'row' : 'rows'} · {headers.length}{' '}
          cols{sortCol !== null ? ` · sorted ${sortDir}` : ''}
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopyCsv}
            data-table-copy-csv="true"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            {copiedCsv ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Copied CSV</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy CSV</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadCsv}
            data-table-download-csv="true"
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.12] text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            <Download className="w-3 h-3" />
            <span>.CSV</span>
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr className="bg-[#141418] border-b border-white/[0.08] text-zinc-200">
              {headers.map((header, hIdx) => {
                const isSorted = sortCol === hIdx;
                return (
                  <th key={hIdx} className="py-2 px-3.5 font-semibold">
                    <button
                      type="button"
                      onClick={() => handleSort(hIdx)}
                      aria-label={`Sort by ${header}`}
                      className="inline-flex items-center gap-1.5 text-left hover:text-white transition-colors cursor-pointer"
                    >
                      <span>{renderCell(header)}</span>
                      {isSorted ? (
                        sortDir === 'asc' ? (
                          <ArrowUp className="w-3 h-3 text-white shrink-0" />
                        ) : (
                          <ArrowDown className="w-3 h-3 text-white shrink-0" />
                        )
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-zinc-600 shrink-0" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06]">
            {displayedRows.map((row, rIdx) => (
              <tr key={rIdx} className="hover:bg-white/[0.025]">
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="py-2.5 px-3.5 text-zinc-300">
                    {renderCell(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export interface MarkdownRendererProps {
  readonly content: string;
  readonly citations?: readonly MessageCitation[];
  readonly onCitationClick?: (citationZeroBasedIndex: number) => void;
  readonly isStreaming?: boolean;
}

export function MarkdownRenderer({
  content,
  citations,
  onCitationClick,
  isStreaming = false,
}: MarkdownRendererProps) {
  const blocks: readonly MarkdownBlock[] = tokenizeMarkdownBlocks(content);
  const inline = (text: string) =>
    renderInlineFormattedText(text, citations, onCitationClick);

  const caret = isStreaming ? (
    <span
      aria-hidden="true"
      data-stream-caret="true"
      className="kartik-stream-caret inline-block w-[7px] h-[14px] ml-1 align-middle rounded-[2px] bg-white/90"
    />
  ) : null;

  return (
    <div className="space-y-3.5 text-[14.5px] text-zinc-200 leading-[1.68] tracking-[0.004em]">
      {blocks.map((block, index) => {
        const isLastBlock = index === blocks.length - 1;
        const flowClass = isStreaming ? 'kartik-flow-block' : '';

        if (block.type === 'heading') {
          const sizeClass =
            block.level === 1
              ? 'text-lg font-semibold text-white tracking-tight mt-4'
              : block.level === 2
                ? 'text-base font-semibold text-white tracking-tight mt-3.5'
                : 'text-sm font-semibold text-zinc-100 mt-2.5';
          return (
            <div key={index} className={`${sizeClass} ${flowClass}`}>
              {inline(block.text)}
              {isLastBlock && caret}
            </div>
          );
        }

        if (block.type === 'code') {
          if (block.language.trim().toLowerCase() === 'mermaid') {
            return (
              <div key={index} className={flowClass}>
                <MermaidDiagramCard source={block.code} />
              </div>
            );
          }
          return (
            <div key={index} className={flowClass}>
              <CodeBlockCard language={block.language} code={block.code} />
            </div>
          );
        }

        if (block.type === 'math') {
          return (
            <div
              key={index}
              data-math-block="true"
              title={block.expression}
              className={`my-4 px-5 py-3.5 rounded-xl border border-white/[0.09] bg-[#0e0e12] text-center overflow-x-auto ${flowClass}`}
            >
              <div className="font-serif italic text-[17px] text-white tracking-wide leading-relaxed">
                {formatLatexMathToUnicode(block.expression)}
              </div>
            </div>
          );
        }

        if (block.type === 'table') {
          return (
            <InteractiveTableCard
              key={index}
              headers={block.headers}
              rows={block.rows}
              flowClass={flowClass}
              renderCell={inline}
            />
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={index}
              className={`px-4 py-2.5 border border-white/[0.1] bg-white/[0.03] text-zinc-300 text-xs italic rounded-xl ${flowClass}`}
            >
              {inline(block.text)}
              {isLastBlock && caret}
            </blockquote>
          );
        }

        if (block.type === 'list') {
          const isTaskList =
            !block.ordered &&
            block.items.some((item) => /^\[[ xX]?\]\s+/.test(item.trim()));
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={index}
              className={`space-y-1.5 ${
                isTaskList
                  ? 'list-none pl-0.5'
                  : block.ordered
                    ? 'list-decimal pl-5'
                    : 'list-disc pl-5'
              } text-zinc-200 marker:text-zinc-500 ${flowClass}`}
            >
              {block.items.map((item, iIdx) => {
                const isLastItem = isLastBlock && iIdx === block.items.length - 1;
                const taskMatch = !block.ordered
                  ? /^\[([ xX]?)\]\s+([\s\S]*)$/.exec(item.trim())
                  : null;
                if (taskMatch) {
                  const checked = (taskMatch[1] ?? '').toLowerCase() === 'x';
                  return (
                    <li key={iIdx} className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className={`mt-1.5 inline-flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${
                          checked
                            ? 'bg-white border-white text-zinc-950'
                            : 'bg-[#111114] border-zinc-600'
                        }`}
                      >
                        {checked && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        {inline(taskMatch[2] ?? '')}
                        {isLastItem && caret}
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={iIdx}>
                    {inline(item)}
                    {isLastItem && caret}
                  </li>
                );
              })}
            </ListTag>
          );
        }

        return (
          <p key={index} className={`text-zinc-200 ${flowClass}`}>
            {inline(block.text)}
            {isLastBlock && caret}
          </p>
        );
      })}
      {isStreaming && blocks.length === 0 && caret}
    </div>
  );
}
