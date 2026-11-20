import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Tablet,
  Terminal,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { buildArtifactRawDownloadUrl } from '../slide-deck-and-markdown.js';
import {
  buildSandboxedPreviewDocument,
  buildStandaloneHtmlExport,
  type SandboxConsoleBridgeMessage,
} from '../../features/sandbox/index.js';
import type { ArtifactRecord } from '../../types/index.js';

export interface ArtifactPanelProps {
  readonly artifact: ArtifactRecord | null;
  readonly isOpen: boolean;
  readonly isTurnLoading?: boolean;
  readonly onClose: () => void;
  readonly onAskAiToFix?: (fixPrompt: string) => void;
}

type ViewportPreset = 'desktop' | 'tablet' | 'mobile';

interface ConsoleEntry {
  readonly id: string;
  readonly level: 'log' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly timestamp: string;
}

function toSafeSlug(title: string): string {
  return (
    title
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 48) || 'kartik-app'
  );
}

export function ArtifactPanel({
  artifact,
  isOpen,
  isTurnLoading = false,
  onClose,
  onAskAiToFix,
}: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('index.html');
  const [viewport, setViewport] = useState<ViewportPreset>('desktop');
  const [isExpanded, setIsExpanded] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [copied, setCopied] = useState(false);

  // Live editable code buffers (keyed by file path)
  const [editedContents, setEditedContents] = useState<Record<string, string>>(
    {},
  );
  const [appliedContents, setAppliedContents] = useState<Record<string, string>>(
    {},
  );

  // Live Sandbox Console state
  const [consoleLogs, setConsoleLogs] = useState<readonly ConsoleEntry[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);

  const artifactId = artifact?.artifactId ?? '';

  // Reset editor buffers, active file tab, and console whenever artifact changes
  useEffect(() => {
    if (!artifact) return;
    const initialMap: Record<string, string> = {};
    for (const file of artifact.filesManifest) {
      initialMap[file.path] = file.content ?? '';
    }
    setEditedContents(initialMap);
    setAppliedContents(initialMap);
    setSelectedFilePath(artifact.entryFile || artifact.filesManifest[0]?.path || 'index.html');
    setConsoleLogs([]);
    setIsConsoleOpen(false);
    setIframeKey((k) => k + 1);
  }, [artifactId, artifact]);

  const bridgeToken = useMemo(
    () => `sbx_${artifactId || 'none'}_${iframeKey}`,
    [artifactId, iframeKey],
  );

  // Listen for scoped runtime console/error events from the opaque-origin iframe
  useEffect(() => {
    if (!isOpen || !artifactId) return;

    const handleMessage = (event: MessageEvent) => {
      const payload = event.data as Partial<SandboxConsoleBridgeMessage> | null;
      if (
        !payload ||
        payload.source !== 'kartik-sandbox' ||
        payload.token !== bridgeToken ||
        typeof payload.message !== 'string'
      ) {
        return;
      }
      const level =
        payload.level === 'error' ||
        payload.level === 'warn' ||
        payload.level === 'info'
          ? payload.level
          : 'log';
      const entry: ConsoleEntry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        level,
        message: payload.message,
        timestamp:
          typeof payload.timestamp === 'string'
            ? payload.timestamp
            : new Date().toISOString().slice(11, 19),
      };
      setConsoleLogs((prev) => [...prev.slice(-49), entry]);
      if (level === 'error') {
        setIsConsoleOpen(true);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [isOpen, artifactId, bridgeToken]);

  const effectiveFiles = useMemo(() => {
    if (!artifact) return [];
    return artifact.filesManifest.map((file) => ({
      path: file.path,
      content: appliedContents[file.path] ?? file.content ?? '',
    }));
  }, [artifact, appliedContents]);

  const previewResult = useMemo(() => {
    if (!artifact || effectiveFiles.length === 0) {
      return { descriptor: null, error: null as string | null };
    }
    try {
      const descriptor = buildSandboxedPreviewDocument(
        {
          artifactId: artifact.artifactId,
          title: artifact.title,
          entryFile: artifact.entryFile,
          files: effectiveFiles,
        },
        { bridgeToken },
      );
      return { descriptor, error: null as string | null };
    } catch (err) {
      return {
        descriptor: null,
        error:
          err instanceof Error
            ? err.message
            : 'Sandbox preview validation failed.',
      };
    }
  }, [artifact, effectiveFiles, bridgeToken]);

  if (!isOpen || !artifact) {
    return null;
  }

  const files = artifact.filesManifest;
  const currentFile =
    files.find((f) => f.path === selectedFilePath) ?? files[0] ?? null;
  const currentEditorText = currentFile
    ? (editedContents[currentFile.path] ?? currentFile.content ?? '')
    : '';
  const currentLineCount = currentEditorText
    ? currentEditorText.split('\n').length
    : 0;

  const hasUnappliedChanges = files.some(
    (f) => (editedContents[f.path] ?? f.content ?? '') !== (appliedContents[f.path] ?? f.content ?? ''),
  );
  const hasEditsFromOriginal = files.some(
    (f) => (editedContents[f.path] ?? f.content ?? '') !== (f.content ?? ''),
  );

  const errorEntries = consoleLogs.filter((entry) => entry.level === 'error');
  const downloadJsonUrl = buildArtifactRawDownloadUrl(artifact.artifactId);

  const handleApplyAndRun = () => {
    setAppliedContents({ ...editedContents });
    setConsoleLogs([]);
    setIframeKey((k) => k + 1);
    setActiveTab('preview');
  };

  const handleResetToOriginal = () => {
    const originalMap: Record<string, string> = {};
    for (const file of files) {
      originalMap[file.path] = file.content ?? '';
    }
    setEditedContents(originalMap);
    setAppliedContents(originalMap);
    setConsoleLogs([]);
    setIframeKey((k) => k + 1);
  };

  const handleCopyFile = () => {
    if (!currentEditorText) return;
    void navigator.clipboard?.writeText(currentEditorText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadStandaloneHtml = () => {
    try {
      const html = buildStandaloneHtmlExport({
        artifactId: artifact.artifactId,
        title: artifact.title,
        entryFile: artifact.entryFile,
        files: files.map((f) => ({
          path: f.path,
          content: editedContents[f.path] ?? f.content ?? '',
        })),
      });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${toSafeSlug(artifact.title)}.html`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // Ignore blob export errors in restricted environments
    }
  };

  const handleAskAiToFix = () => {
    if (!onAskAiToFix || errorEntries.length === 0) return;
    const latestErrors = errorEntries
      .slice(-3)
      .map((e) => `- ${e.message}`)
      .join('\n');
    const jsExcerpt = (appliedContents['app.js'] ?? '')
      .trim()
      .slice(0, 1200);
    const fixPrompt = [
      `Fix the runtime error in my "${artifact.title}" web app and rebuild a clean working version:`,
      '',
      'Captured sandbox errors:',
      latestErrors,
      jsExcerpt ? `\nRelevant app.js excerpt:\n\`\`\`js\n${jsExcerpt}\n\`\`\`` : '',
    ]
      .filter(Boolean)
      .join('\n');
    onAskAiToFix(fixPrompt);
  };

  const iframeWidthClass =
    viewport === 'mobile'
      ? 'w-[390px] max-w-full border-x border-slate-800 shadow-2xl'
      : viewport === 'tablet'
        ? 'w-[768px] max-w-full border-x border-slate-800 shadow-2xl'
        : 'w-full';

  return (
    <aside
      className={`w-full shrink-0 h-full bg-[#090d18] border-l border-slate-800/90 flex flex-col overflow-hidden transition-all ${
        isExpanded
          ? 'lg:w-[620px] xl:w-[740px]'
          : 'lg:w-[480px] xl:w-[540px]'
      }`}
    >
      {/* Top Bar */}
      <div className="h-14 px-4 border-b border-slate-800/90 flex items-center justify-between gap-2 bg-slate-950/70">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
            <Code2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-white truncate">
              {artifact.title}
            </div>
            <div className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 shrink-0" />
              <span className="truncate">
                sandbox=&quot;allow-scripts&quot; · CSP locked
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mode Switcher: Live Preview vs Editable Source Code */}
          <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                activeTab === 'preview'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Eye className="w-3 h-3" />
              Preview
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('code')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                activeTab === 'code'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3 h-3" />
              Code ({files.length})
              {hasUnappliedChanges && (
                <span
                  className="w-1.5 h-1.5 rounded-full bg-amber-400"
                  aria-label="Unapplied edits"
                />
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? 'Compact Sandbox Width' : 'Expand Sandbox Width'}
            aria-label={isExpanded ? 'Compact Sandbox Width' : 'Expand Sandbox Width'}
            className="hidden lg:inline-flex p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            {isExpanded ? (
              <Minimize2 className="w-4 h-4" />
            ) : (
              <Maximize2 className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            title="Close Artifact Panel"
            aria-label="Close Artifact Panel"
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-toolbar */}
      <div className="px-3.5 py-2 bg-slate-900/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        {activeTab === 'code' ? (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {files.map((file) => {
              const isModified =
                (editedContents[file.path] ?? file.content ?? '') !==
                (file.content ?? '');
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => setSelectedFilePath(file.path)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono cursor-pointer transition-colors ${
                    (currentFile?.path ?? '') === file.path
                      ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                      : 'bg-slate-800/80 text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  <span>{file.path}</span>
                  {isModified && (
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              title="Desktop Viewport (100%)"
              aria-label="Desktop viewport"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                viewport === 'desktop'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border border-transparent'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Desktop</span>
            </button>
            <button
              type="button"
              onClick={() => setViewport('tablet')}
              title="Tablet Viewport (768px)"
              aria-label="Tablet viewport"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                viewport === 'tablet'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border border-transparent'
              }`}
            >
              <Tablet className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Tablet</span>
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              title="Mobile Viewport (390px)"
              aria-label="Mobile viewport"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                viewport === 'mobile'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 border border-transparent'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Mobile</span>
            </button>
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {activeTab === 'preview' ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setConsoleLogs([]);
                  setIframeKey((k) => k + 1);
                }}
                title="Reload Sandboxed Preview"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                Reload
              </button>
              {hasEditsFromOriginal && (
                <button
                  type="button"
                  onClick={handleResetToOriginal}
                  title="Reset all files to original generated code"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs text-amber-300 font-medium cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleApplyAndRun}
                title="Apply edits and reload preview (Ctrl/Cmd+Enter)"
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold cursor-pointer transition-colors ${
                  hasUnappliedChanges
                    ? 'bg-sky-500 hover:bg-sky-400 text-slate-950'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
              >
                <Play className="w-3 h-3" />
                Apply &amp; Run
              </button>
              {hasEditsFromOriginal && (
                <button
                  type="button"
                  onClick={handleResetToOriginal}
                  title="Reset all files to original generated code"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  Reset
                </button>
              )}
              <button
                type="button"
                onClick={handleCopyFile}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
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
            </>
          )}

          <button
            type="button"
            onClick={handleDownloadStandaloneHtml}
            title="Download self-contained runnable .html file"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs text-emerald-300 font-medium cursor-pointer"
          >
            <Download className="w-3 h-3" />
            HTML
          </button>

          <a
            href={downloadJsonUrl}
            download={`${toSafeSlug(artifact.title)}-bundle.json`}
            title="Download raw multi-file manifest JSON"
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-xs text-slate-300 font-mono"
          >
            JSON
          </a>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 overflow-hidden bg-[#060911] flex flex-col">
        {activeTab === 'preview' ? (
          previewResult.error || !previewResult.descriptor ? (
            <div className="flex-1 p-6 flex items-center justify-center">
              <div className="max-w-sm rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200 space-y-2">
                <div className="flex items-center gap-2 font-semibold text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>Sandbox Validation Blocked Preview</span>
                </div>
                <p className="text-rose-200/90 leading-relaxed">
                  {previewResult.error ?? 'Unable to assemble sandboxed preview.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 w-full flex justify-center bg-[#050810] overflow-auto">
              <iframe
                key={`${artifact.artifactId}_${iframeKey}`}
                title={`Sandboxed Preview — ${artifact.title}`}
                sandbox={previewResult.descriptor.iframeSandboxAttribute}
                referrerPolicy={previewResult.descriptor.referrerPolicy}
                srcDoc={previewResult.descriptor.srcDoc}
                className={`${iframeWidthClass} h-full border-0 bg-[#090d16] transition-all`}
              />
            </div>
          )
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="px-4 py-1.5 bg-slate-950/80 border-b border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
              <span>
                {currentFile?.path ?? 'index.html'} ·{' '}
                <span className="tabular-nums">{currentLineCount} lines</span>
              </span>
              <span className="text-slate-500">
                Editable · Ctrl/Cmd+Enter to run
              </span>
            </div>
            <textarea
              aria-label={`Edit ${currentFile?.path ?? 'code file'}`}
              value={currentEditorText}
              spellCheck={false}
              onChange={(e) => {
                if (!currentFile) return;
                const nextVal = e.target.value;
                setEditedContents((prev) => ({
                  ...prev,
                  [currentFile.path]: nextVal,
                }));
              }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  handleApplyAndRun();
                }
              }}
              className="flex-1 w-full resize-none bg-[#060911] p-4 text-xs font-mono text-slate-200 leading-relaxed focus:outline-none"
            />
          </div>
        )}
      </div>

      {/* Live Sandbox Console Strip */}
      <div className="border-t border-slate-800 bg-slate-950/90 shrink-0">
        <div className="px-3.5 py-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setIsConsoleOpen((prev) => !prev)}
            className="inline-flex items-center gap-2 text-xs font-mono text-slate-300 hover:text-white cursor-pointer"
          >
            <Terminal className="w-3.5 h-3.5 text-sky-400" />
            <span>Sandbox Console</span>
            <span className="text-[11px] tabular-nums text-slate-500">
              ({consoleLogs.length})
            </span>
            {errorEntries.length > 0 && (
              <span className="text-[11px] font-semibold tabular-nums text-rose-400">
                · {errorEntries.length}{' '}
                {errorEntries.length === 1 ? 'error' : 'errors'}
              </span>
            )}
            {isConsoleOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5 text-slate-500" />
            )}
          </button>

          <div className="flex items-center gap-1.5">
            {errorEntries.length > 0 && onAskAiToFix && (
              <button
                type="button"
                disabled={isTurnLoading}
                onClick={handleAskAiToFix}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[11px] font-semibold text-rose-200 cursor-pointer disabled:opacity-50"
              >
                <Wrench className="w-3 h-3" />
                Fix with AI
              </button>
            )}
            {consoleLogs.length > 0 && (
              <button
                type="button"
                onClick={() => setConsoleLogs([])}
                title="Clear console output"
                aria-label="Clear console output"
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {isConsoleOpen && (
          <div className="max-h-36 overflow-y-auto border-t border-slate-800/80 px-3.5 py-2 space-y-1 font-mono text-[11px] bg-[#050810]">
            {consoleLogs.length === 0 ? (
              <div className="text-slate-500 py-1">
                No console output or runtime errors captured yet.
              </div>
            ) : (
              consoleLogs.map((entry) => (
                <div
                  key={entry.id}
                  className={`flex items-start gap-2 py-0.5 ${
                    entry.level === 'error'
                      ? 'text-rose-300'
                      : entry.level === 'warn'
                        ? 'text-amber-300'
                        : 'text-slate-300'
                  }`}
                >
                  <span className="text-slate-600 tabular-nums shrink-0">
                    {entry.timestamp}
                  </span>
                  <span className="uppercase text-[10px] font-semibold shrink-0 w-10">
                    {entry.level}
                  </span>
                  <span className="break-all whitespace-pre-wrap">
                    {entry.message}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
