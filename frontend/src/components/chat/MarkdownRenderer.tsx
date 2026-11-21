import React, { useState } from 'react';
import { Check, Copy, Terminal, WrapText } from 'lucide-react';
import {
  tokenizeInlineMarkdown,
  tokenizeMarkdownBlocks,
  type MarkdownBlock,
} from '../slide-deck-and-markdown.js';
import type { MessageCitation } from '../../types/index.js';

function formatCitationTooltip(citation: MessageCitation, index: number): string {
  const domainPart = citation.domain
    ? ` (${citation.domain})`
    : /^https?:\/\//i.test(citation.urlOrPage)
      ? ''
      : ` (${citation.urlOrPage})`;
  return `[${index}] ${citation.title}${domainPart}`;
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
          className="px-1.5 py-0.5 mx-0.5 text-xs font-mono bg-slate-800/90 text-sky-300 border border-slate-700/70 rounded"
        >
          {token.text}
        </code>
      );
    }

    if (token.type === 'bold') {
      return (
        <strong key={idx} className="font-semibold text-slate-100">
          {depth < 2
            ? renderInlineFormattedText(token.text, citations, onCitationClick, depth + 1)
            : token.text}
        </strong>
      );
    }

    if (token.type === 'italic') {
      return (
        <em key={idx} className="italic text-slate-300">
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
          className="text-sky-300 underline decoration-sky-500/50 underline-offset-2 hover:text-sky-200 transition-colors"
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

      const isDocumentCitation =
        matched.sourceType === 'document' || !/^https?:\/\//i.test(matched.urlOrPage);

      return (
        <sup key={idx} className="ml-0.5 align-super">
          <button
            type="button"
            onClick={() => onCitationClick?.(citationIdx)}
            title={formatCitationTooltip(matched, token.index)}
            aria-label={`Jump to source ${token.index}: ${matched.title}`}
            className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono font-semibold tabular-nums rounded border transition-colors cursor-pointer ${
              isDocumentCitation
                ? 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/35 hover:border-emerald-400/70'
                : 'bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 border-sky-500/35 hover:border-sky-400/70'
            }`}
          >
            {token.index}
          </button>
        </sup>
      );
    }

    return <React.Fragment key={idx}>{token.text}</React.Fragment>;
  });
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
  const lineCount = code ? code.split('\n').length : 0;

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
      className="my-3 rounded-lg overflow-hidden border border-slate-800 bg-[#070a12]"
    >
      <div className="flex items-center justify-between gap-2 px-3.5 py-2 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span className="uppercase tracking-wider font-semibold text-slate-200 truncate">
            {language || 'code'}
          </span>
          <span className="text-slate-600">·</span>
          <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
            {lineCount} {lineCount === 1 ? 'line' : 'lines'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setWrapLines((prev) => !prev)}
            aria-pressed={wrapLines}
            title={wrapLines ? 'Disable line wrapping' : 'Wrap long lines'}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-sans font-medium transition-colors cursor-pointer ${
              wrapLines
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-transparent'
            }`}
          >
            <WrapText className="w-3 h-3" />
            <span>Wrap</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            data-code-copy-button="true"
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-sans text-[11px] font-medium transition-colors cursor-pointer"
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
        className={`p-3.5 text-xs font-mono text-slate-200 leading-relaxed ${
          wrapLines
            ? 'whitespace-pre-wrap break-words'
            : 'whitespace-pre overflow-x-auto'
        }`}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

export interface MarkdownRendererProps {
  readonly content: string;
  readonly citations?: readonly MessageCitation[];
  readonly onCitationClick?: (citationZeroBasedIndex: number) => void;
}

export function MarkdownRenderer({
  content,
  citations,
  onCitationClick,
}: MarkdownRendererProps) {
  const blocks: readonly MarkdownBlock[] = tokenizeMarkdownBlocks(content);
  const inline = (text: string) =>
    renderInlineFormattedText(text, citations, onCitationClick);

  return (
    <div className="space-y-3 text-sm text-slate-200 leading-relaxed">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const sizeClass =
            block.level === 1
              ? 'text-lg font-bold text-white mt-2'
              : block.level === 2
                ? 'text-base font-bold text-white mt-2'
                : 'text-sm font-semibold text-sky-300 mt-1.5';
          return (
            <div key={index} className={sizeClass}>
              {inline(block.text)}
            </div>
          );
        }

        if (block.type === 'code') {
          return (
            <CodeBlockCard
              key={index}
              language={block.language}
              code={block.code}
            />
          );
        }

        if (block.type === 'table') {
          return (
            <div
              key={index}
              className="my-3 overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/70"
            >
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-300">
                    {block.headers.map((header, hIdx) => (
                      <th key={hIdx} className="py-2.5 px-3 font-semibold">
                        {inline(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-slate-900/40">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="py-2 px-3 text-slate-300">
                          {inline(cell)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote
              key={index}
              className="px-3.5 py-2 border border-sky-500/25 bg-sky-500/5 text-slate-300 text-xs italic rounded-lg"
            >
              {inline(block.text)}
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
              } text-slate-200`}
            >
              {block.items.map((item, iIdx) => {
                const taskMatch = !block.ordered
                  ? /^\[([ xX]?)\]\s+([\s\S]*)$/.exec(item.trim())
                  : null;
                if (taskMatch) {
                  const checked = (taskMatch[1] ?? '').toLowerCase() === 'x';
                  return (
                    <li key={iIdx} className="flex items-start gap-2.5">
                      <span
                        aria-hidden="true"
                        className={`mt-1 inline-flex items-center justify-center w-3.5 h-3.5 rounded border shrink-0 ${
                          checked
                            ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300'
                            : 'bg-slate-900/90 border-slate-600/80'
                        }`}
                      >
                        {checked && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1">{inline(taskMatch[2] ?? '')}</span>
                    </li>
                  );
                }
                return <li key={iIdx}>{inline(item)}</li>;
              })}
            </ListTag>
          );
        }

        return (
          <p key={index} className="text-slate-200">
            {inline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
