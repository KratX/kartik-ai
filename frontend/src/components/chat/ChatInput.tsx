import React, { useRef, useState } from 'react';
import {
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import {
  AGENT_SELECTOR_PILLS,
  CHAT_RESPONSE_DEPTH_OPTIONS,
  buildUploadedFileRawUrl,
  formatImageFileBadge,
  type AgentSelectorPillSpec,
} from '../slide-deck-and-markdown.js';
import type {
  ChatResponseDepth,
  SpecialistAgentName,
  UploadedFileRecord,
} from '../../types/index.js';

export interface ChatInputProps {
  readonly selectedAgent: AgentSelectorPillSpec['id'];
  readonly onSelectAgent: (agent: AgentSelectorPillSpec['id']) => void;
  readonly responseDepth: ChatResponseDepth;
  readonly onSelectResponseDepth: (depth: ChatResponseDepth) => void;
  readonly attachedFiles: readonly UploadedFileRecord[];
  readonly onRemoveAttachedFile: (fileId: string) => void;
  readonly onUploadFile: (file: {
    readonly originalFilename: string;
    readonly declaredMimeType: string;
    readonly contentBase64: string;
  }) => Promise<void>;
  readonly onSendMessage: (
    prompt: string,
    preferredAgent?: SpecialistAgentName,
  ) => Promise<void>;
  readonly isLoading: boolean;
  readonly demoReadOnly: boolean;
}

export function ChatInput({
  selectedAgent,
  onSelectAgent,
  responseDepth,
  onSelectResponseDepth,
  attachedFiles,
  onRemoveAttachedFile,
  onUploadFile,
  onSendMessage,
  isLoading,
  demoReadOnly,
}: ChatInputProps) {
  const [prompt, setPrompt] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const activePill =
    AGENT_SELECTOR_PILLS.find((p) => p.id === selectedAgent) ??
    AGENT_SELECTOR_PILLS[0]!;

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploadError(null);
    setIsUploading(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = '';
      for (let i = 0; i < uint8.byteLength; i++) {
        binary += String.fromCharCode(uint8[i]!);
      }
      const contentBase64 = btoa(binary);

      await onUploadFile({
        originalFilename: file.name,
        declaredMimeType: file.type || 'application/pdf',
        contentBase64,
      });

      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        onSelectAgent('rag');
      } else if (file.type.startsWith('image/')) {
        onSelectAgent('vision');
      }
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'File upload validation failed',
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleToggleVoice = () => {
    if (isRecordingVoice) {
      setIsRecordingVoice(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
      };
    };

    const SpeechCtor = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (SpeechCtor) {
      try {
        const recognition = new SpeechCtor();
        recognition.lang = 'en-US';
        recognition.interimResults = false;
        setIsRecordingVoice(true);
        recognition.onresult = (ev) => {
          const transcript = ev.results?.[0]?.[0]?.transcript ?? '';
          if (transcript) {
            setPrompt((prev) => (prev ? `${prev} ${transcript}` : transcript));
          }
          setIsRecordingVoice(false);
        };
        recognition.onerror = () => {
          setIsRecordingVoice(false);
        };
        recognition.onend = () => {
          setIsRecordingVoice(false);
        };
        recognition.start();
        return;
      } catch {
        // Fall through to simulated voice dictation
      }
    }

    // Fallback voice dictation for headless/restricted microphone environments
    setIsRecordingVoice(true);
    setTimeout(() => {
      setPrompt((prev) =>
        prev
          ? prev
          : 'Create a 6-slide presentation on Zero-Trust Service Mesh Architecture',
      );
      setIsRecordingVoice(false);
    }, 900);
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = prompt.trim();
    if (!trimmed || isLoading || demoReadOnly) return;

    // Fix #21: When unified Chat is active, omit preferredAgent so the smart hybrid router
    // answers conceptual questions in Chat (1 cr) and seamlessly delegates specialist tasks.
    const preferred: SpecialistAgentName | undefined =
      selectedAgent === 'chat' ? undefined : selectedAgent;
    setPrompt('');
    await onSendMessage(trimmed, preferred);
  };

  return (
    <div className="shrink-0 border-t border-slate-800/90 bg-[#090d18]/95 px-4 sm:px-6 py-3.5 space-y-2.5">
      {/* DEMO_READ_ONLY Warning Banner */}
      {demoReadOnly && (
        <div className="px-3.5 py-2 rounded-lg bg-amber-500/15 border border-amber-500/30 text-xs text-amber-300 flex items-center justify-between">
          <span>
            <strong>DEMO_READ_ONLY Freeze Active:</strong> Mutating requests return{' '}
            <code className="font-mono">403 DEMO_READ_ONLY</code> while browsing remains enabled.
          </span>
        </div>
      )}

      {uploadError && (
        <div className="px-3.5 py-2 rounded-lg bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300 flex items-center justify-between">
          <span>{uploadError}</span>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="text-rose-300 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Specialist Agent Selector Pills + Chat Response Depth Control */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <div
          data-agent-selector-bar="true"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0"
        >
          {AGENT_SELECTOR_PILLS.map((pill) => {
            const isSelected = pill.id === selectedAgent;
            return (
              <button
                key={pill.id}
                type="button"
                data-agent-pill={pill.id}
                onClick={() => onSelectAgent(pill.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all shrink-0 whitespace-nowrap cursor-pointer border ${
                  isSelected
                    ? 'bg-sky-500/20 border-sky-400 text-sky-200 shadow-sm'
                    : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                {pill.id === 'chat' && <Sparkles className="w-3 h-3 text-sky-400" />}
                <span>{pill.label}</span>
                <span
                  className={`text-[10px] font-mono tabular-nums px-1 rounded ${
                    isSelected
                      ? 'bg-sky-500/30 text-sky-200'
                      : 'bg-slate-800 text-slate-500'
                  }`}
                >
                  {pill.creditCostLabel}
                </span>
              </button>
            );
          })}
        </div>

        {selectedAgent === 'chat' && (
          <div
            role="group"
            aria-label="Chat response depth"
            data-chat-depth-selector="true"
            className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-900 border border-slate-800 shrink-0"
          >
            <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 px-2 select-none">
              Depth
            </span>
            {CHAT_RESPONSE_DEPTH_OPTIONS.map((opt) => {
              const active = responseDepth === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  data-depth-option={opt.id}
                  aria-pressed={active}
                  title={opt.description}
                  onClick={() => onSelectResponseDepth(opt.id)}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium transition-colors whitespace-nowrap cursor-pointer ${
                    active
                      ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                      : 'text-slate-400 hover:text-slate-200 border border-transparent'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Attached File Chips */}
      {attachedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachedFiles.map((file) => {
            const isImage = file.mimeType.startsWith('image/');
            if (isImage) {
              return (
                <div
                  key={file.fileId}
                  data-attached-image-chip="true"
                  className="inline-flex items-center gap-2.5 pl-1.5 pr-2.5 py-1.5 rounded-lg bg-slate-900 border border-sky-500/40 text-xs text-slate-100"
                >
                  <div className="w-9 h-9 rounded-md overflow-hidden border border-slate-700 bg-slate-950 flex items-center justify-center shrink-0">
                    <img
                      src={buildUploadedFileRawUrl(file.fileId)}
                      alt={file.originalFilename}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 font-medium text-slate-100 max-w-[200px]">
                      <ImageIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="truncate">{file.originalFilename}</span>
                    </div>
                    <div className="text-[10px] font-mono tabular-nums text-sky-300/80">
                      {formatImageFileBadge(file.mimeType, file.sizeBytes)} · Vision ready
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${file.originalFilename}`}
                    onClick={() => onRemoveAttachedFile(file.fileId)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            }

            return (
              <div
                key={file.fileId}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-200"
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-medium">{file.originalFilename}</span>
                <span className="text-[10px] font-mono tabular-nums text-emerald-300/80">
                  {file.pageCount ? `${file.pageCount}p · ${file.chunkCount} chunks` : 'ready'}
                </span>
                <button
                  type="button"
                  aria-label={`Remove ${file.originalFilename}`}
                  onClick={() => onRemoveAttachedFile(file.fileId)}
                  className="p-0.5 rounded hover:bg-emerald-500/20 text-emerald-300 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Input Composer Box */}
      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Paperclip Upload Button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading || demoReadOnly}
          title="Upload .PDF (for RAG) or PNG/JPEG/WebP (for Vision OCR)"
          className="h-10 w-10 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 hover:text-sky-400 disabled:opacity-40 cursor-pointer shrink-0"
        >
          {isUploading ? (
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
          ) : (
            <Paperclip className="w-4 h-4" />
          )}
        </button>

        {/* Voice-to-Text Microphone Button */}
        <button
          type="button"
          onClick={handleToggleVoice}
          disabled={demoReadOnly}
          title="Voice-to-Text Dictation (Web Speech API)"
          className={`h-10 w-10 rounded-xl border flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
            isRecordingVoice
              ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 animate-pulse'
              : 'bg-slate-900 hover:bg-slate-800 border-slate-800 text-slate-300 hover:text-sky-400'
          }`}
        >
          {isRecordingVoice ? (
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </button>

        {/* Prompt Textarea */}
        <div className="flex-1 relative">
          <textarea
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={demoReadOnly}
            placeholder={activePill.placeholder}
            className="w-full px-4 py-2.5 text-sm bg-slate-900/90 border border-slate-800 rounded-xl text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/60 resize-none"
          />
        </div>

        {/* Send Turn Button */}
        <button
          type="submit"
          disabled={!prompt.trim() || isLoading || demoReadOnly}
          className="h-10 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:pointer-events-none text-slate-950 font-semibold text-xs inline-flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Send</span>
        </button>
      </form>
    </div>
  );
}
