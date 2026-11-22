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
          className="px-1.5 py-0.5 mx-0.5 text-[12px] font-mono bg-white/[0.07] text-zinc-100 border border-white/[0.09] rounded-md"
        >
          {token.text}
        </code>
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

      const isDocumentCitation =
        matched.sourceType === 'document' ||
        !/^https?:\/\//i.test(matched.urlOrPage);

      return (
        <sup key={idx} className="ml-0.5 align-super">
          <button
            type="button"
            onClick={() => onCitationClick?.(citationIdx)}
            title={formatCitationTooltip(matched, token.index)}
            aria-label={`Jump to source ${token.index}: ${matched.title}`}
            className={`inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-mono font-semibold tabular-nums rounded border transition-colors cursor-pointer ${
              isDocumentCitation
                ? 'bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/35'
                : 'bg-white/[0.09] hover:bg-white/[0.18] text-zinc-100 border-white/[0.18]'
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
        className={`p-4 text-[12.5px] font-mono text-zinc-200 leading-relaxed ${
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
    <div className="space-y-3.5 text-[14.5px] text-zinc-200 leading-[1.68] tracking-[0.004em]">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const sizeClass =
            block.level === 1
              ? 'text-lg font-semibold text-white tracking-tight mt-4'
              : block.level === 2
                ? 'text-base font-semibold text-white tracking-tight mt-3.5'
                : 'text-sm font-semibold text-zinc-100 mt-2.5';
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
              className="my-4 overflow-x-auto rounded-xl border border-white/[0.08] bg-[#0e0e11]"
            >
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#141418] border-b border-white/[0.08] text-zinc-200">
                    {block.headers.map((header, hIdx) => (
                      <th key={hIdx} className="py-2.5 px-3.5 font-semibold">
                        {inline(header)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {block.rows.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-white/[0.025]">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="py-2.5 px-3.5 text-zinc-300">
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
              className="px-4 py-2.5 border border-white/[0.1] bg-white/[0.03] text-zinc-300 text-xs italic rounded-xl"
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
              } text-zinc-200 marker:text-zinc-500`}
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
                      </span>
                    </li>
                  );
                }
                return <li key={iIdx}>{inline(item)}</li>;
              })}
            </ListTag>
          );
        }

        return (
          <p key={index} className="text-zinc-200">
            {inline(block.text)}
          </p>
        );
      })}
    </div>
  );
}
