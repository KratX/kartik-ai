import React, { useState } from 'react';
import {
  Check,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  assembleMultiFileHtmlPreview,
  buildArtifactRawDownloadUrl,
} from '../../../frontend/src/components/slide-deck-and-markdown.js';
import type { ArtifactRecord } from '../../../backend/services/agent/src/index.js';

export interface ArtifactPanelProps {
  readonly artifact: ArtifactRecord | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

export function ArtifactPanel({ artifact, isOpen, onClose }: ArtifactPanelProps) {
  const [activeTab, setActiveTab] = useState<'preview' | 'code'>('preview');
  const [selectedFilePath, setSelectedFilePath] = useState<string>('index.html');
  const [iframeKey, setIframeKey] = useState(0);
  const [copied, setCopied] = useState(false);

  if (!isOpen || !artifact) {
    return null;
  }

  const files = artifact.filesManifest;
  const currentFile =
    files.find((f) => f.path === selectedFilePath) ?? files[0] ?? null;

  const previewDoc = assembleMultiFileHtmlPreview(files);
  const downloadUrl = buildArtifactRawDownloadUrl(artifact.artifactId);

  const handleCopyFile = () => {
    if (!currentFile?.content) return;
    void navigator.clipboard?.writeText(currentFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <aside className="w-full lg:w-[460px] xl:w-[520px] shrink-0 h-full bg-[#090d18] border-l border-slate-800/90 flex flex-col overflow-hidden">
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
              <ShieldAlert className="w-3 h-3" />
              <span>sandbox=&quot;allow-scripts&quot; (Opaque Origin)</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mode Switcher: Live Preview vs Source Code */}
          <div className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('preview')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
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
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer ${
                activeTab === 'code'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <FileCode className="w-3 h-3" />
              Code ({files.length})
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close Artifact Panel"
            className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-toolbar */}
      <div className="px-4 py-2 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between gap-2">
        {activeTab === 'code' ? (
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {files.map((file) => (
              <button
                key={file.path}
                type="button"
                onClick={() => setSelectedFilePath(file.path)}
                className={`px-2.5 py-1 rounded text-xs font-mono cursor-pointer ${
                  (currentFile?.path ?? '') === file.path
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 font-semibold'
                    : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                }`}
              >
                {file.path}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[11px] font-mono text-slate-400">
            Entry: <span className="text-slate-200">{artifact.entryFile}</span> · No{' '}
            <code className="text-rose-400">allow-same-origin</code>
          </div>
        )}

        <div className="flex items-center gap-1.5 shrink-0">
          {activeTab === 'preview' ? (
            <button
              type="button"
              onClick={() => setIframeKey((k) => k + 1)}
              title="Reload Sandboxed Preview"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              Reload
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCopyFile}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 cursor-pointer"
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
          )}

          <a
            href={downloadUrl}
            download={`${artifact.title.replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase()}-bundle.json`}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-xs text-emerald-300 font-medium"
          >
            <Download className="w-3 h-3" />
            JSON
          </a>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden bg-[#060911]">
        {activeTab === 'preview' ? (
          <iframe
            key={`${artifact.artifactId}_${iframeKey}`}
            title={`Sandboxed Preview — ${artifact.title}`}
            sandbox={previewDoc.sandboxAttribute}
            srcDoc={previewDoc.srcDoc}
            className="w-full h-full border-0 bg-[#090d16]"
          />
        ) : (
          <div className="h-full overflow-auto p-4">
            <pre className="text-xs font-mono text-slate-200 leading-relaxed">
              <code>{currentFile?.content ?? '// Empty file'}</code>
            </pre>
          </div>
        )}
      </div>
    </aside>
  );
}
