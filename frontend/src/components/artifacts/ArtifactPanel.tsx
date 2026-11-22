import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
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
  FileText,
  GripVertical,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Monitor,
  Play,
  Presentation,
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
  clampCanvasWidthPct,
  formatArtifactMetaSummary,
} from '../workspace-ux-helpers.js';
import {
  buildSandboxedPreviewDocument,
  buildStandaloneHtmlExport,
  type SandboxConsoleBridgeMessage,
} from '../../features/sandbox/index.js';
import type { ArtifactRecord } from '../../types/index.js';
import { BorderBeam } from '../motion/primitives.js';
import { PdfDocumentPreview } from '../chat/PdfDocumentPreview.js';
import { SlideDeckPreview } from '../chat/SlideDeckPreview.js';
import { ImageArtifactCard } from '../chat/ImageArtifactCard.js';

export interface ArtifactPanelProps {
  readonly artifact: ArtifactRecord | null;
  readonly threadArtifacts?: readonly ArtifactRecord[];
  readonly isOpen: boolean;
  readonly isTurnLoading?: boolean;
  readonly widthPct?: number;
  readonly onResizeWidthPct?: (nextPct: number) => void;
  readonly onSelectArtifact?: (artifact: ArtifactRecord) => void;
  readonly onClose: () => void;
  readonly onAskAiToFix?: (fixPrompt: string) => void;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
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

function getCanvasTypeIcon(type: ArtifactRecord['artifactType']) {
  switch (type) {
    case 'code_bundle':
      return <Code2 className="w-4 h-4" />;
    case 'pdf_document':
      return <FileText className="w-4 h-4" />;
    case 'ppt_presentation':
      return <Presentation className="w-4 h-4" />;
    case 'generated_image':
      return <ImageIcon className="w-4 h-4" />;
  }
}

export function ArtifactPanel({
  artifact,
  threadArtifacts = [],
  isOpen,
  isTurnLoading = false,
  widthPct = 48,
  onResizeWidthPct,
  onSelectArtifact,
  onClose,
  onAskAiToFix,
  onOpenLightboxImage,
}: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('index.html');
  const [viewport, setViewport] = useState<ViewportPreset>('desktop');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const [editedContents, setEditedContents] = useState<Record<string, string>>(
    {},
  );
  const [appliedContents, setAppliedContents] = useState<
    Record<string, string>
  >({});
  const [consoleLogs, setConsoleLogs] = useState<readonly ConsoleEntry[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  const artifactId = artifact?.artifactId ?? '';
  const isCodeBundle = artifact?.artifactType === 'code_bundle';

  useEffect(() => {
    if (!artifact || artifact.artifactType !== 'code_bundle') return;
    const initialMap: Record<string, string> = {};
    for (const file of artifact.filesManifest) {
      initialMap[file.path] = file.content ?? '';
    }
    setEditedContents(initialMap);
    setAppliedContents(initialMap);
    setSelectedFilePath(
      artifact.entryFile || artifact.filesManifest[0]?.path || 'index.html',
    );
    setConsoleLogs([]);
    setIsConsoleOpen(false);
    setActiveTab('preview');
    setIframeKey((k) => k + 1);
  }, [artifactId, artifact]);

  // Draggable split-screen resize handler
  useEffect(() => {
    if (!isDraggingResize || !onResizeWidthPct) return;

    const handlePointerMove = (event: MouseEvent) => {
      const parent = panelRef.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      if (rect.width <= 0) return;
      const rightEdgeDist = rect.right - event.clientX;
      const nextPct = clampCanvasWidthPct((rightEdgeDist / rect.width) * 100);
      onResizeWidthPct(nextPct);
    };

    const handlePointerUp = () => {
      setIsDraggingResize(false);
    };

    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('mouseup', handlePointerUp);
    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
    };
  }, [isDraggingResize, onResizeWidthPct]);

  const bridgeToken = useMemo(
    () => `sbx_${artifactId || 'none'}_${iframeKey}`,
    [artifactId, iframeKey],
  );

  useEffect(() => {
    if (!isOpen || !artifactId || !isCodeBundle) return;

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
  }, [isOpen, artifactId, isCodeBundle, bridgeToken]);

  const effectiveFiles = useMemo(() => {
    if (!artifact || artifact.artifactType !== 'code_bundle') return [];
    return artifact.filesManifest.map((file) => ({
      path: file.path,
      content: appliedContents[file.path] ?? file.content ?? '',
    }));
  }, [artifact, appliedContents]);

  const previewResult = useMemo(() => {
    if (
      !artifact ||
      artifact.artifactType !== 'code_bundle' ||
      effectiveFiles.length === 0
    ) {
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

  const files = artifact?.filesManifest ?? [];
  const currentFile =
    files.find((f) => f.path === selectedFilePath) ?? files[0] ?? null;
  const currentEditorText = currentFile
    ? (editedContents[currentFile.path] ?? currentFile.content ?? '')
    : '';
  const currentLineCount = currentEditorText
    ? currentEditorText.split('\n').length
    : 0;

  const hasUnappliedChanges =
    isCodeBundle &&
    files.some(
      (f) =>
        (editedContents[f.path] ?? f.content ?? '') !==
        (appliedContents[f.path] ?? f.content ?? ''),
    );
  const hasEditsFromOriginal =
    isCodeBundle &&
    files.some(
      (f) => (editedContents[f.path] ?? f.content ?? '') !== (f.content ?? ''),
    );

  const errorEntries = consoleLogs.filter((entry) => entry.level === 'error');
  const downloadJsonUrl = artifact
    ? buildArtifactRawDownloadUrl(artifact.artifactId)
    : '#';

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
    const clip = navigator.clipboard?.writeText(currentEditorText);
    if (clip && typeof clip.catch === 'function') clip.catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadStandaloneHtml = () => {
    if (!artifact || !isCodeBundle) return;
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
    if (!artifact || !onAskAiToFix || errorEntries.length === 0) return;
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
      jsExcerpt
        ? `\nRelevant app.js excerpt:\n\`\`\`js\n${jsExcerpt}\n\`\`\``
        : '',
    ]
      .filter(Boolean)
      .join('\n');
    onAskAiToFix(fixPrompt);
  };

  const iframeWidthClass =
    viewport === 'mobile'
      ? 'w-[390px] max-w-full border-x border-white/[0.1] shadow-2xl'
      : viewport === 'tablet'
        ? 'w-[768px] max-w-full border-x border-white/[0.1] shadow-2xl'
        : 'w-full';

  const meta = artifact ? formatArtifactMetaSummary(artifact) : null;

  return (
    <AnimatePresence>
      {isOpen && artifact && (
        <motion.aside
          ref={panelRef}
          initial={{ opacity: 0, x: 36 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 36 }}
          transition={{ type: 'spring', stiffness: 390, damping: 36 }}
          data-universal-canvas="true"
          data-canvas-artifact-type={artifact.artifactType}
          style={
            !isExpanded
              ? ({
                  '--canvas-w': `${clampCanvasWidthPct(widthPct)}%`,
                } as React.CSSProperties)
              : undefined
          }
          className={`relative shrink-0 h-full bg-[#0c0c0f] border-l border-white/[0.08] flex flex-col overflow-hidden ${
            isExpanded
              ? 'fixed inset-0 z-40 w-full'
              : 'w-full lg:w-[var(--canvas-w,48%)]'
          }`}
        >
          {/* Subtle 21st.dev BorderBeam Accent along Top Edge */}
          <BorderBeam durationSec={9} intensity={isTurnLoading ? 'thinking' : 'idle'} />

          {/* Draggable Horizontal Resize Handle (Desktop split mode only) */}
          {!isExpanded && onResizeWidthPct && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize Artifact Canvas"
              data-canvas-resize-handle="true"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDraggingResize(true);
              }}
              className={`hidden lg:flex items-center justify-center absolute left-0 top-0 bottom-0 w-2 -ml-1 z-30 cursor-col-resize group transition-colors ${
                isDraggingResize ? 'bg-white/25' : 'hover:bg-white/15'
              }`}
            >
              <GripVertical className="w-3 h-3 text-zinc-600 group-hover:text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          )}

          {/* Top Canvas Studio Header */}
          <div className="relative z-10 h-13 px-4 border-b border-white/[0.08] flex items-center justify-between gap-2 bg-[#101014]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-white/[0.07] border border-white/[0.1] flex items-center justify-center text-white shrink-0">
                {getCanvasTypeIcon(artifact.artifactType)}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate">
                  {artifact.title}
                </div>
                <div className="text-[10px] font-mono text-zinc-400 flex items-center gap-1.5 truncate">
                  {isCodeBundle ? (
                    <>
                      <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                      <span className="truncate">
                        sandbox=&quot;allow-scripts&quot; · CSP locked
                      </span>
                    </>
                  ) : (
                    <span className="truncate">
                      {meta?.typeLabel} · {meta?.detailLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Coding Preview / Code Spring Switcher */}
              {isCodeBundle && (
                <div className="inline-flex rounded-lg bg-[#18181c] p-0.5 border border-white/[0.08]">
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className={`relative inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                      activeTab === 'preview'
                        ? 'text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {activeTab === 'preview' && (
                      <motion.span
                        layoutId="canvas-code-mode-tab"
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 36,
                        }}
                        className="absolute inset-0 rounded-md bg-white"
                      />
                    )}
                    <Eye className="w-3 h-3 relative z-10" />
                    <span className="relative z-10">Preview</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('code')}
                    className={`relative inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                      activeTab === 'code'
                        ? 'text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {activeTab === 'code' && (
                      <motion.span
                        layoutId="canvas-code-mode-tab"
                        transition={{
                          type: 'spring',
                          stiffness: 500,
                          damping: 36,
                        }}
                        className="absolute inset-0 rounded-md bg-white"
                      />
                    )}
                    <FileCode className="w-3 h-3 relative z-10" />
                    <span className="relative z-10 tabular-nums">
                      Code ({files.length})
                    </span>
                    {hasUnappliedChanges && (
                      <span
                        className="relative z-10 w-1.5 h-1.5 rounded-full bg-amber-400"
                        aria-label="Unapplied edits"
                      />
                    )}
                  </button>
                </div>
              )}

              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                title={isExpanded ? 'Exit Fullscreen' : 'Expand Canvas Fullscreen'}
                aria-label={isExpanded ? 'Exit Fullscreen' : 'Expand Canvas'}
                className="p-1.5 rounded-lg bg-[#18181c] hover:bg-white/[0.12] text-zinc-400 hover:text-white cursor-pointer transition-colors"
              >
                {isExpanded ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsExpanded(false);
                  onClose();
                }}
                title="Close Artifact Canvas"
                aria-label="Close Artifact Canvas"
                data-close-canvas="true"
                className="p-1.5 rounded-lg bg-[#18181c] hover:bg-white/[0.12] text-zinc-400 hover:text-white cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Multi-Artifact Thread Switcher Strip (when thread has >1 artifact) */}
          {threadArtifacts.length > 1 && onSelectArtifact && (
            <div
              data-canvas-artifact-switcher="true"
              className="relative z-10 px-3 py-2 bg-[#0e0e11] border-b border-white/[0.07] flex items-center gap-1.5 overflow-x-auto no-scrollbar"
            >
              {threadArtifacts.map((item) => {
                const isSelected = item.artifactId === artifact.artifactId;
                const itemMeta = formatArtifactMetaSummary(item);
                return (
                  <button
                    key={item.artifactId}
                    type="button"
                    onClick={() => onSelectArtifact(item)}
                    className={`relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap cursor-pointer transition-colors shrink-0 ${
                      isSelected
                        ? 'text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.05]'
                    }`}
                  >
                    {isSelected && (
                      <motion.span
                        layoutId="canvas-artifact-switcher-pill"
                        transition={{
                          type: 'spring',
                          stiffness: 480,
                          damping: 34,
                        }}
                        className="absolute inset-0 rounded-lg bg-white"
                      />
                    )}
                    <span className="relative z-10">
                      {getCanvasTypeIcon(item.artifactType)}
                    </span>
                    <span className="relative z-10 max-w-[140px] truncate">
                      {item.title}
                    </span>
                    <span
                      className={`relative z-10 text-[10px] font-mono ${
                        isSelected ? 'text-zinc-600' : 'text-zinc-500'
                      }`}
                    >
                      {itemMeta.shortBadge}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── TYPE-NATIVE STUDIO BODY ── */}
          {isCodeBundle ? (
            <>
              {/* Coding Sub-Toolbar */}
              <div className="relative z-10 px-3.5 py-2 bg-[#111114] border-b border-white/[0.07] flex flex-wrap items-center justify-between gap-2">
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
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono cursor-pointer transition-colors ${
                            (currentFile?.path ?? '') === file.path
                              ? 'bg-white text-zinc-950 font-semibold'
                              : 'bg-[#18181c] text-zinc-400 hover:text-zinc-100'
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
                    {(
                      [
                        { id: 'desktop', label: 'Desktop', icon: Monitor },
                        { id: 'tablet', label: 'Tablet', icon: Tablet },
                        { id: 'mobile', label: 'Mobile', icon: Smartphone },
                      ] as const
                    ).map((preset) => {
                      const Icon = preset.icon;
                      const active = viewport === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setViewport(preset.id)}
                          aria-label={`${preset.label} viewport`}
                          className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium cursor-pointer transition-colors ${
                            active
                              ? 'bg-white text-zinc-950'
                              : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06]'
                          }`}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">{preset.label}</span>
                        </button>
                      );
                    })}
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
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#18181c] hover:bg-white/[0.12] text-xs text-zinc-200 cursor-pointer"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Reload
                      </button>
                      {hasEditsFromOriginal && (
                        <button
                          type="button"
                          onClick={handleResetToOriginal}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-xs text-amber-300 font-medium cursor-pointer"
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
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold cursor-pointer transition-colors ${
                          hasUnappliedChanges
                            ? 'bg-white hover:bg-zinc-200 text-zinc-950'
                            : 'bg-[#18181c] hover:bg-white/[0.12] text-zinc-200'
                        }`}
                      >
                        <Play className="w-3 h-3" />
                        Apply &amp; Run
                      </button>
                      {hasEditsFromOriginal && (
                        <button
                          type="button"
                          onClick={handleResetToOriginal}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#18181c] hover:bg-white/[0.12] text-xs text-zinc-300 cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          Reset
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleCopyFile}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#18181c] hover:bg-white/[0.12] text-xs text-zinc-200 cursor-pointer"
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
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.08] hover:bg-white hover:text-zinc-950 text-xs text-zinc-100 font-medium cursor-pointer transition-colors"
                  >
                    <Download className="w-3 h-3" />
                    HTML
                  </button>

                  <a
                    href={downloadJsonUrl}
                    download={`${toSafeSlug(artifact.title)}-bundle.json`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#18181c] hover:bg-white/[0.12] text-xs text-zinc-300 font-mono"
                  >
                    JSON
                  </a>
                </div>
              </div>

              {/* Preview Iframe or Code Editor */}
              <div className="relative z-10 flex-1 min-h-0 overflow-hidden bg-[#09090b] flex flex-col">
                {activeTab === 'preview' ? (
                  previewResult.error || !previewResult.descriptor ? (
                    <div className="flex-1 p-6 flex items-center justify-center">
                      <div className="max-w-sm rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200 space-y-2">
                        <div className="flex items-center gap-2 font-semibold text-rose-300">
                          <AlertCircle className="w-4 h-4 shrink-0" />
                          <span>Sandbox Validation Blocked Preview</span>
                        </div>
                        <p className="text-rose-200/90 leading-relaxed">
                          {previewResult.error ??
                            'Unable to assemble sandboxed preview.'}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 w-full flex justify-center bg-[#060608] overflow-auto">
                      <iframe
                        key={`${artifact.artifactId}_${iframeKey}`}
                        title={`Sandboxed Preview — ${artifact.title}`}
                        sandbox={previewResult.descriptor.iframeSandboxAttribute}
                        referrerPolicy={previewResult.descriptor.referrerPolicy}
                        srcDoc={previewResult.descriptor.srcDoc}
                        className={`${iframeWidthClass} h-full border-0 bg-[#09090b] transition-all`}
                      />
                    </div>
                  )
                ) : (
                  <div className="flex-1 min-h-0 flex flex-col">
                    <div className="px-4 py-1.5 bg-[#0e0e11] border-b border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>
                        {currentFile?.path ?? 'index.html'} ·{' '}
                        <span className="tabular-nums">
                          {currentLineCount} lines
                        </span>
                      </span>
                      <span className="text-zinc-500">
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
                      className="flex-1 w-full resize-none bg-[#09090b] p-4 text-xs font-mono text-zinc-200 leading-relaxed focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Live Sandbox Console Strip */}
              <div className="relative z-10 border-t border-white/[0.08] bg-[#101014] shrink-0">
                <div className="px-3.5 py-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setIsConsoleOpen((prev) => !prev)}
                    className="inline-flex items-center gap-2 text-xs font-mono text-zinc-300 hover:text-white cursor-pointer"
                  >
                    <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                    <span>Sandbox Console</span>
                    <span className="text-[11px] tabular-nums text-zinc-500">
                      ({consoleLogs.length})
                    </span>
                    {errorEntries.length > 0 && (
                      <span className="text-[11px] font-semibold tabular-nums text-rose-400">
                        · {errorEntries.length}{' '}
                        {errorEntries.length === 1 ? 'error' : 'errors'}
                      </span>
                    )}
                    {isConsoleOpen ? (
                      <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
                    ) : (
                      <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
                    )}
                  </button>

                  <div className="flex items-center gap-1.5">
                    {errorEntries.length > 0 && onAskAiToFix && (
                      <button
                        type="button"
                        disabled={isTurnLoading}
                        onClick={handleAskAiToFix}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-[11px] font-semibold text-rose-200 cursor-pointer disabled:opacity-50"
                      >
                        <Wrench className="w-3 h-3" />
                        Fix with AI
                      </button>
                    )}
                    {consoleLogs.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setConsoleLogs([])}
                        aria-label="Clear console output"
                        className="p-1 rounded text-zinc-400 hover:text-white hover:bg-white/[0.08] cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isConsoleOpen && (
                  <div className="max-h-36 overflow-y-auto border-t border-white/[0.07] px-3.5 py-2 space-y-1 font-mono text-[11px] bg-[#09090b]">
                    {consoleLogs.length === 0 ? (
                      <div className="text-zinc-500 py-1">
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
                                : 'text-zinc-300'
                          }`}
                        >
                          <span className="text-zinc-600 tabular-nums shrink-0">
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
            </>
          ) : (
            /* Universal Studio Stage for PDF Reports, 16:9 Slide Decks, and Artwork */
            <div className="relative z-10 flex-1 min-h-0 overflow-y-auto p-4 bg-[#09090b]">
              {artifact.artifactType === 'pdf_document' && (
                <PdfDocumentPreview artifact={artifact} />
              )}
              {artifact.artifactType === 'ppt_presentation' && (
                <SlideDeckPreview artifact={artifact} />
              )}
              {artifact.artifactType === 'generated_image' && (
                <ImageArtifactCard
                  artifact={artifact}
                  onOpenLightboxImage={onOpenLightboxImage}
                />
              )}
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
