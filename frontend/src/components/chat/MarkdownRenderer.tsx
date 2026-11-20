import React, { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
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
          {token.text}
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

  const handleCopy = () => {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-slate-800 bg-[#070a12]">
      <div className="flex items-center justify-between px-3.5 py-2 bg-slate-900/90 border-b border-slate-800 text-xs text-slate-400 font-mono">
        <div className="flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-sky-400" />
          <span className="uppercase tracking-wider font-semibold text-slate-300">
            {language || 'code'}
          </span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
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
      <pre className="p-3.5 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed">
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
              className="pl-3.5 py-1 border-l-2 border-sky-500/60 bg-sky-500/5 text-slate-300 italic rounded-r"
            >
              {inline(block.text)}
            </blockquote>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={index}
              className={`space-y-1.5 pl-5 ${
                block.ordered ? 'list-decimal' : 'list-disc'
              } text-slate-200`}
            >
              {block.items.map((item, iIdx) => (
                <li key={iIdx}>{inline(item)}</li>
              ))}
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
