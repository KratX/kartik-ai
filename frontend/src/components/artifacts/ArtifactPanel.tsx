import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
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
  FileDiff,
  FilePlus2,
  FileText,
  FolderArchive,
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
import {
  buildArtifactRawDownloadUrl,
  type ParsedPptSurfaceMode,
} from '../slide-deck-and-markdown.js';
import {
  computeLineDiff,
  tokenizeCodeSyntax,
  type CodeTokenKind,
} from '../studio-power-helpers.js';
import {
  buildClientZipBytes,
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
import { ImageArtifactCard } from '../chat/ImageArtifactCard.js';

const LazyPdfDocumentPreview = lazy(() =>
  import('../chat/PdfDocumentPreview.js').then((m) => ({
    default: m.PdfDocumentPreview,
  })),
);
const LazySlideDeckPreview = lazy(() =>
  import('../chat/SlideDeckPreview.js').then((m) => ({
    default: m.SlideDeckPreview,
  })),
);

export interface ArtifactPanelProps {
  readonly artifact: ArtifactRecord | null;
  readonly threadArtifacts?: readonly ArtifactRecord[];
  readonly isOpen: boolean;
  readonly isTurnLoading?: boolean;
  readonly widthPct?: number;
  readonly defaultPptSurfaceMode?: ParsedPptSurfaceMode;
  readonly onPptSurfaceModeChange?: (mode: ParsedPptSurfaceMode) => void;
  readonly onResizeWidthPct?: (nextPct: number) => void;
  readonly onSelectArtifact?: (artifact: ArtifactRecord) => void;
  readonly onClose: () => void;
  readonly onAskAiToFix?: (fixPrompt: string) => void;
  readonly onRemixImage?: (artifact: ArtifactRecord) => void;
  readonly onVariationImage?: (artifact: ArtifactRecord) => void;
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

const EDITOR_TOKEN_COLORS: Readonly<Record<CodeTokenKind, string>> = {
  keyword: 'text-sky-300',
  string: 'text-emerald-300',
  number: 'text-amber-300',
  comment: 'text-zinc-500 italic',
  tag: 'text-rose-300',
  type: 'text-teal-300',
  property: 'text-indigo-300',
  operator: 'text-zinc-400',
  plain: 'text-zinc-200',
};

function inferCodeLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'css') return 'css';
  if (ext === 'json') return 'json';
  if (ext === 'ts' || ext === 'tsx') return 'ts';
  if (ext === 'py') return 'python';
  if (ext === 'sql') return 'sql';
  if (ext === 'sh') return 'bash';
  return 'js';
}

export function ArtifactPanel({
  artifact,
  threadArtifacts = [],
  isOpen,
  isTurnLoading = false,
  widthPct = 48,
  defaultPptSurfaceMode,
  onPptSurfaceModeChange,
  onResizeWidthPct,
  onSelectArtifact,
  onClose,
  onAskAiToFix,
  onRemixImage,
  onVariationImage,
  onOpenLightboxImage,
}: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'diff'>('preview');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('index.html');
  const [viewport, setViewport] = useState<ViewportPreset>('desktop');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDraggingResize, setIsDraggingResize] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const [filePaths, setFilePaths] = useState<readonly string[]>([]);
  const [isAddingFile, setIsAddingFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [editedContents, setEditedContents] = useState<Record<string, string>>(
    {},
  );
  const [appliedContents, setAppliedContents] = useState<
    Record<string, string>
  >({});
  const [consoleLogs, setConsoleLogs] = useState<readonly ConsoleEntry[]>([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);
  const editorHighlightRef = useRef<HTMLPreElement | null>(null);
  const editorGutterRef = useRef<HTMLDivElement | null>(null);

  const artifactId = artifact?.artifactId ?? '';
  const isCodeBundle = artifact?.artifactType === 'code_bundle';

  useEffect(() => {
    if (!artifact || artifact.artifactType !== 'code_bundle') return;
    const initialMap: Record<string, string> = {};
    const initialPaths: string[] = [];
    for (const file of artifact.filesManifest) {
      initialMap[file.path] = file.content ?? '';
      initialPaths.push(file.path);
    }
    setFilePaths(initialPaths);
    setEditedContents(initialMap);
    setAppliedContents(initialMap);
    setIsAddingFile(false);
    setNewFileName('');
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

  // Same-type artifact version history (v1, v2, v3...)
  const sameTypeVersions = useMemo(() => {
    if (!artifact) return [];
    return threadArtifacts.filter(
      (item) => item.artifactType === artifact.artifactType,
    );
  }, [artifact, threadArtifacts]);

  const currentVersionIndex = useMemo(() => {
    if (!artifact) return -1;
    return sameTypeVersions.findIndex((item) => item.artifactId === artifact.artifactId);
  }, [artifact, sameTypeVersions]);

  const previousCodeArtifact =
    isCodeBundle && currentVersionIndex > 0
      ? sameTypeVersions[currentVersionIndex - 1] ?? null
      : null;

  const originalFileMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of artifact?.filesManifest ?? []) {
      map.set(f.path, f.content ?? '');
    }
    return map;
  }, [artifact]);

  const files = useMemo(() => {
    if (!artifact || !isCodeBundle) return [];
    const paths =
      filePaths.length > 0
        ? filePaths
        : artifact.filesManifest.map((f) => f.path);
    return paths.map((path) => ({
      path,
      content: originalFileMap.get(path) ?? '',
      isCustom: !originalFileMap.has(path),
    }));
  }, [artifact, isCodeBundle, filePaths, originalFileMap]);

  const effectiveFiles = useMemo(() => {
    if (!artifact || artifact.artifactType !== 'code_bundle') return [];
    return files.map((file) => ({
      path: file.path,
      content: appliedContents[file.path] ?? file.content ?? '',
    }));
  }, [artifact, files, appliedContents]);

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

  const currentFile =
    files.find((f) => f.path === selectedFilePath) ?? files[0] ?? null;
  const currentEditorText = currentFile
    ? (editedContents[currentFile.path] ?? currentFile.content ?? '')
    : '';
  const currentLines = useMemo(
    () => (currentEditorText ? currentEditorText.split('\n') : ['']),
    [currentEditorText],
  );
  const currentLineCount = currentLines.length;
  const highlightedEditorLines = useMemo(
    () =>
      tokenizeCodeSyntax(
        currentEditorText,
        inferCodeLanguageFromPath(currentFile?.path ?? 'app.js'),
      ),
    [currentEditorText, currentFile?.path],
  );

  const hasUnappliedChanges =
    isCodeBundle &&
    (files.some(
      (f) =>
        (editedContents[f.path] ?? f.content ?? '') !==
        (appliedContents[f.path] ?? f.content ?? ''),
    ) ||
      files.some((f) => !(f.path in appliedContents)));
  const hasEditsFromOriginal =
    isCodeBundle &&
    (files.length !== (artifact?.filesManifest.length ?? 0) ||
      files.some(
        (f) =>
          f.isCustom ||
          (editedContents[f.path] ?? f.content ?? '') !== (f.content ?? ''),
      ));

  const diffBaselineLabel = useMemo(() => {
    if (hasEditsFromOriginal) {
      return `Original v${Math.max(1, currentVersionIndex + 1)} → Local Edits`;
    }
    if (previousCodeArtifact) {
      return `v${currentVersionIndex} (${previousCodeArtifact.title}) → v${currentVersionIndex + 1}`;
    }
    return 'No previous version or local edits yet';
  }, [hasEditsFromOriginal, currentVersionIndex, previousCodeArtifact]);

  const activeFileDiff = useMemo(() => {
    if (!currentFile) {
      return computeLineDiff('', '');
    }
    const afterText = editedContents[currentFile.path] ?? currentFile.content ?? '';
    let beforeText = currentFile.content ?? '';
    if (!hasEditsFromOriginal && previousCodeArtifact) {
      const prevEntry = previousCodeArtifact.filesManifest.find(
        (f) => f.path === currentFile.path,
      );
      beforeText = prevEntry?.content ?? '';
    }
    return computeLineDiff(beforeText, afterText);
  }, [currentFile, editedContents, hasEditsFromOriginal, previousCodeArtifact]);

  const errorEntries = consoleLogs.filter((entry) => entry.level === 'error');
  const downloadJsonUrl = artifact
    ? buildArtifactRawDownloadUrl(artifact.artifactId)
    : '#';

  const handleApplyAndRun = (switchToPreview = true) => {
    setAppliedContents({ ...editedContents });
    setConsoleLogs([]);
    setIframeKey((k) => k + 1);
    if (switchToPreview) {
      setActiveTab('preview');
    }
  };

  const handleAddCustomFile = (e?: React.FormEvent) => {
    e?.preventDefault();
    const cleaned = newFileName
      .trim()
      .replace(/^\/+/, '')
      .replace(/[^A-Za-z0-9._/-]/g, '');
    if (!cleaned || files.some((f) => f.path === cleaned)) {
      return;
    }
    const starterContent = cleaned.endsWith('.css')
      ? `/* ${cleaned} */\n`
      : cleaned.endsWith('.json')
        ? '{\n  \n}\n'
        : cleaned.endsWith('.html')
          ? `<!-- ${cleaned} -->\n`
          : `// ${cleaned}\n`;
    setFilePaths((prev) => [...prev, cleaned]);
    setEditedContents((prev) => ({ ...prev, [cleaned]: starterContent }));
    setAppliedContents((prev) => ({ ...prev, [cleaned]: starterContent }));
    setSelectedFilePath(cleaned);
    setNewFileName('');
    setIsAddingFile(false);
  };

  const handleDeleteCustomFile = (targetPath: string) => {
    if (!artifact || targetPath === artifact.entryFile || files.length <= 1) {
      return;
    }
    const remaining = files
      .map((f) => f.path)
      .filter((p) => p !== targetPath);
    setFilePaths(remaining);
    setEditedContents((prev) => {
      const next = { ...prev };
      delete next[targetPath];
      return next;
    });
    setAppliedContents((prev) => {
      const next = { ...prev };
      delete next[targetPath];
      return next;
    });
    if (selectedFilePath === targetPath) {
      setSelectedFilePath(remaining[0] ?? artifact.entryFile ?? 'index.html');
    }
    setIframeKey((k) => k + 1);
  };

  const handleResetToOriginal = () => {
    if (!artifact) return;
    const originalMap: Record<string, string> = {};
    const originalPaths: string[] = [];
    for (const file of artifact.filesManifest) {
      originalMap[file.path] = file.content ?? '';
      originalPaths.push(file.path);
    }
    setFilePaths(originalPaths);
    setEditedContents(originalMap);
    setAppliedContents(originalMap);
    setSelectedFilePath(
      artifact.entryFile || originalPaths[0] || 'index.html',
    );
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

  const handleDownloadProjectZip = () => {
    if (!artifact || !isCodeBundle) return;
    try {
      const zipBytes = buildClientZipBytes(
        files.map((f) => ({
          path: f.path,
          content: editedContents[f.path] ?? f.content ?? '',
        })),
      );
      const blob = new Blob([zipBytes.buffer as ArrayBuffer], {
        type: 'application/zip',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${toSafeSlug(artifact.title)}.zip`;
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
              {/* Same-Type Artifact Version History Switcher (v1 / v2 / v3) */}
              {sameTypeVersions.length > 1 && onSelectArtifact && (
                <div
                  data-artifact-version-switcher="true"
                  className="inline-flex items-center rounded-lg bg-[#18181c] p-0.5 border border-white/[0.08]"
                >
                  {sameTypeVersions.map((ver, idx) => {
                    const active = ver.artifactId === artifact.artifactId;
                    return (
                      <button
                        key={ver.artifactId}
                        type="button"
                        onClick={() => onSelectArtifact(ver)}
                        title={`Version ${idx + 1}: ${ver.title}`}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums cursor-pointer transition-colors ${
                          active
                            ? 'bg-white text-zinc-950 font-semibold'
                            : 'text-zinc-400 hover:text-zinc-100'
                        }`}
                      >
                        v{idx + 1}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Coding Preview / Code / Diff Spring Switcher */}
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
                    data-artifact-tab-code="true"
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
                  <button
                    type="button"
                    data-artifact-tab-diff="true"
                    onClick={() => setActiveTab('diff')}
                    className={`relative inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors ${
                      activeTab === 'diff'
                        ? 'text-zinc-950'
                        : 'text-zinc-400 hover:text-zinc-100'
                    }`}
                  >
                    {activeTab === 'diff' && (
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
                    <FileDiff className="w-3 h-3 relative z-10" />
                    <span className="relative z-10">Diff</span>
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
                {activeTab === 'code' || activeTab === 'diff' ? (
                  <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
                    {files.map((file) => {
                      const isModified =
                        file.isCustom ||
                        (editedContents[file.path] ?? file.content ?? '') !==
                          (file.content ?? '');
                      const isEntry = file.path === artifact.entryFile;
                      const isSelected = (currentFile?.path ?? '') === file.path;
                      return (
                        <div
                          key={file.path}
                          className={`inline-flex items-center rounded-md text-xs font-mono transition-colors ${
                            isSelected
                              ? 'bg-white text-zinc-950 font-semibold'
                              : 'bg-[#18181c] text-zinc-400 hover:text-zinc-100'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedFilePath(file.path)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 cursor-pointer"
                          >
                            <span>{file.path}</span>
                            {isModified && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            )}
                          </button>
                          {activeTab === 'code' && !isEntry && files.length > 1 && (
                            <button
                              type="button"
                              aria-label={`Delete ${file.path}`}
                              onClick={() => handleDeleteCustomFile(file.path)}
                              className={`pr-1.5 pl-0.5 py-1 cursor-pointer ${
                                isSelected
                                  ? 'text-zinc-600 hover:text-rose-700'
                                  : 'text-zinc-500 hover:text-rose-400'
                              }`}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                    {activeTab === 'code' &&
                      (isAddingFile ? (
                        <form
                          onSubmit={handleAddCustomFile}
                          className="inline-flex items-center gap-1"
                        >
                          <input
                            type="text"
                            autoFocus
                            data-sandbox-new-file-input="true"
                            value={newFileName}
                            onChange={(e) => setNewFileName(e.target.value)}
                            placeholder="utils.js"
                            className="w-28 px-2 py-0.5 rounded bg-[#09090b] border border-white/25 text-xs font-mono text-white focus:outline-none"
                          />
                          <button
                            type="submit"
                            className="px-2 py-0.5 rounded bg-white text-zinc-950 text-[11px] font-semibold cursor-pointer"
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsAddingFile(false);
                              setNewFileName('');
                            }}
                            className="p-0.5 text-zinc-400 hover:text-white cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          data-sandbox-add-file-btn="true"
                          onClick={() => setIsAddingFile(true)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-[#18181c] hover:bg-white/[0.12] border border-white/[0.08] text-[11px] text-zinc-300 hover:text-white cursor-pointer"
                        >
                          <FilePlus2 className="w-3 h-3" />
                          <span>New File</span>
                        </button>
                      ))}
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
                        onClick={() => handleApplyAndRun(true)}
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
                    onClick={handleDownloadProjectZip}
                    data-artifact-download-zip="true"
                    title="Download multi-file project as .zip archive"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/[0.08] hover:bg-white hover:text-zinc-950 text-xs text-zinc-100 font-medium cursor-pointer transition-colors"
                  >
                    <FolderArchive className="w-3 h-3" />
                    ZIP
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadStandaloneHtml}
                    title="Download self-contained runnable .html file"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#18181c] hover:bg-white hover:text-zinc-950 text-xs text-zinc-200 font-medium cursor-pointer transition-colors"
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

              {/* Preview Iframe, Line-Numbered Syntax Code Editor, or Unified Diff View */}
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
                ) : activeTab === 'diff' ? (
                  <div
                    data-artifact-diff-view="true"
                    className="flex-1 min-h-0 flex flex-col"
                  >
                    <div className="px-4 py-2 bg-[#0e0e11] border-b border-white/[0.06] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
                      <span className="text-zinc-300 truncate">
                        {currentFile?.path ?? 'index.html'} ·{' '}
                        <span className="text-zinc-500">{diffBaselineLabel}</span>
                      </span>
                      <div className="flex items-center gap-2 tabular-nums shrink-0">
                        <span className="text-emerald-400">
                          +{activeFileDiff.addedCount}
                        </span>
                        <span className="text-rose-400">
                          -{activeFileDiff.removedCount}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 overflow-auto bg-[#09090b] font-mono text-xs leading-relaxed">
                      {activeFileDiff.addedCount === 0 &&
                      activeFileDiff.removedCount === 0 ? (
                        <div className="p-8 text-center text-zinc-500 text-xs">
                          No differences detected for{' '}
                          <span className="text-zinc-300">{currentFile?.path}</span>.
                          Edit code in the Code tab or generate a follow-up version to inspect line changes.
                        </div>
                      ) : (
                        <div className="divide-y divide-white/[0.02]">
                          {activeFileDiff.lines.map((row, idx) => (
                            <div
                              key={idx}
                              className={`flex items-start px-3 py-0.5 whitespace-pre ${
                                row.kind === 'add'
                                  ? 'bg-emerald-500/12 text-emerald-200'
                                  : row.kind === 'remove'
                                    ? 'bg-rose-500/12 text-rose-200'
                                    : 'text-zinc-400'
                              }`}
                            >
                              <span className="w-9 shrink-0 select-none text-right pr-2 text-[10px] text-zinc-600 tabular-nums">
                                {row.oldLine ?? ''}
                              </span>
                              <span className="w-9 shrink-0 select-none text-right pr-2 text-[10px] text-zinc-600 tabular-nums">
                                {row.newLine ?? ''}
                              </span>
                              <span className="w-4 shrink-0 select-none font-semibold">
                                {row.kind === 'add'
                                  ? '+'
                                  : row.kind === 'remove'
                                    ? '-'
                                    : ' '}
                              </span>
                              <span className="flex-1 break-all whitespace-pre-wrap">
                                {row.text || ' '}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div
                    data-sandbox-code-editor="true"
                    className="flex-1 min-h-0 flex flex-col"
                  >
                    <div className="px-4 py-1.5 bg-[#0e0e11] border-b border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>
                        {currentFile?.path ?? 'index.html'} ·{' '}
                        <span className="tabular-nums">
                          {currentLineCount} lines
                        </span>
                      </span>
                      <span className="text-zinc-500">
                        Syntax Highlighted · ⌘S / Ctrl+S to Apply &amp; Run
                      </span>
                    </div>
                    <div className="flex-1 min-h-0 flex relative overflow-hidden bg-[#09090b]">
                      {/* Line Number Gutter */}
                      <div
                        ref={editorGutterRef}
                        aria-hidden="true"
                        className="w-11 shrink-0 py-4 px-2 bg-[#0c0c10] border-r border-white/[0.06] text-right font-mono text-[11px] leading-[1.625] text-zinc-600 select-none overflow-hidden tabular-nums"
                      >
                        {currentLines.map((_, idx) => (
                          <div key={idx}>{idx + 1}</div>
                        ))}
                      </div>
                      {/* Synchronized Syntax Highlight Layer + Transparent Caret Textarea */}
                      <div className="relative flex-1 min-w-0 h-full overflow-hidden">
                        <pre
                          ref={editorHighlightRef}
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 m-0 p-4 text-xs font-mono leading-[1.625] whitespace-pre overflow-hidden"
                        >
                          {highlightedEditorLines.map((tokens, lineIdx) => (
                            <div key={lineIdx}>
                              {tokens.length === 0 ? (
                                ' '
                              ) : (
                                tokens.map((tok, tokIdx) => (
                                  <span
                                    key={tokIdx}
                                    className={EDITOR_TOKEN_COLORS[tok.kind]}
                                  >
                                    {tok.text}
                                  </span>
                                ))
                              )}
                            </div>
                          ))}
                        </pre>
                        <textarea
                          aria-label={`Edit ${currentFile?.path ?? 'code file'}`}
                          value={currentEditorText}
                          spellCheck={false}
                          wrap="off"
                          onScroll={(e) => {
                            const target = e.currentTarget;
                            if (editorHighlightRef.current) {
                              editorHighlightRef.current.scrollTop = target.scrollTop;
                              editorHighlightRef.current.scrollLeft = target.scrollLeft;
                            }
                            if (editorGutterRef.current) {
                              editorGutterRef.current.scrollTop = target.scrollTop;
                            }
                          }}
                          onChange={(e) => {
                            if (!currentFile) return;
                            const nextVal = e.target.value;
                            setEditedContents((prev) => ({
                              ...prev,
                              [currentFile.path]: nextVal,
                            }));
                          }}
                          onKeyDown={(e) => {
                            if (
                              (e.metaKey || e.ctrlKey) &&
                              (e.key.toLowerCase() === 's' || e.key === 'Enter')
                            ) {
                              e.preventDefault();
                              handleApplyAndRun(e.key === 'Enter');
                            }
                          }}
                          className="relative z-10 w-full h-full resize-none bg-transparent p-4 text-xs font-mono leading-[1.625] text-transparent caret-white selection:bg-white/20 whitespace-pre overflow-auto focus:outline-none"
                        />
                      </div>
                    </div>
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
              <Suspense
                fallback={
                  <div className="rounded-xl border border-white/[0.08] bg-[#111114] p-8 text-center text-xs text-zinc-400">
                    Loading Studio Preview…
                  </div>
                }
              >
                {artifact.artifactType === 'pdf_document' && (
                  <LazyPdfDocumentPreview artifact={artifact} />
                )}
                {artifact.artifactType === 'ppt_presentation' && (
                  <LazySlideDeckPreview
                    artifact={artifact}
                    defaultSurfaceMode={defaultPptSurfaceMode}
                    onSurfaceModeChange={onPptSurfaceModeChange}
                  />
                )}
                {artifact.artifactType === 'generated_image' && (
                  <ImageArtifactCard
                    artifact={artifact}
                    onOpenLightboxImage={onOpenLightboxImage}
                    onRemixImage={onRemixImage}
                    onVariationImage={onVariationImage}
                  />
                )}
              </Suspense>
            </div>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
