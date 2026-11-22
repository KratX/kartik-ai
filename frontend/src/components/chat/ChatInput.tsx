import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUp,
  ChevronDown,
  Code2,
  Eye,
  FileSearch,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Presentation,
  SlidersHorizontal,
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
import {
  matchSlashCommands,
  stripLeadingSlashCommand,
  type SlashCommandItem,
} from '../workspace-ux-helpers.js';
import type {
  ChatResponseDepth,
  SpecialistAgentName,
  UploadedFileRecord,
} from '../../types/index.js';
import { BorderBeam, MorphingPopover } from '../motion/primitives.js';

function getSpecialistIcon(agent: SpecialistAgentName, className = 'w-3.5 h-3.5') {
  switch (agent) {
    case 'chat':
      return <Sparkles className={className} />;
    case 'search':
      return <Globe className={className} />;
    case 'coding':
      return <Code2 className={className} />;
    case 'pdf':
      return <FileText className={className} />;
    case 'ppt':
      return <Presentation className={className} />;
    case 'rag':
      return <FileSearch className={className} />;
    case 'vision':
      return <Eye className={className} />;
    case 'image':
      return <ImageIcon className={className} />;
  }
}

export interface ChatInputProps {
  readonly variant?: 'hero' | 'dock';
  readonly selectedAgent: AgentSelectorPillSpec['id'];
  readonly onSelectAgent: (agent: AgentSelectorPillSpec['id']) => void;
  readonly responseDepth: ChatResponseDepth;
  readonly onSelectResponseDepth: (depth: ChatResponseDepth) => void;
  readonly attachedFiles: readonly UploadedFileRecord[];
  readonly onRemoveAttachedFile: (fileId: string) => void;
  readonly onOpenAttachment?: (file: UploadedFileRecord) => void;
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
  variant = 'dock',
  selectedAgent,
  onSelectAgent,
  responseDepth,
  onSelectResponseDepth,
  attachedFiles,
  onRemoveAttachedFile,
  onOpenAttachment,
  onUploadFile,
  onSendMessage,
  isLoading,
  demoReadOnly,
}: ChatInputProps) {
  const [prompt, setPrompt] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [isSpecialistOpen, setIsSpecialistOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const specialistBtnRef = useRef<HTMLButtonElement | null>(null);

  const activePill =
    AGENT_SELECTOR_PILLS.find((p) => p.id === selectedAgent) ??
    AGENT_SELECTOR_PILLS[0]!;

  const slashMatches = useMemo(() => matchSlashCommands(prompt), [prompt]);
  const isSlashMenuVisible = slashMatches.length > 0 && !demoReadOnly;

  useEffect(() => {
    setSlashIndex(0);
  }, [slashMatches.length, prompt]);

  // Auto-grow textarea cleanly up to 180px
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(180, Math.max(variant === 'hero' ? 56 : 44, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
  }, [prompt, variant]);

  const applySlashCommand = (cmd: SlashCommandItem) => {
    if (cmd.kind === 'agent' && cmd.agent) {
      onSelectAgent(cmd.agent);
    } else if (cmd.kind === 'depth' && cmd.depth) {
      onSelectAgent('chat');
      onSelectResponseDepth(cmd.depth);
    }
    setPrompt(stripLeadingSlashCommand(prompt));
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

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
        recognition.onerror = () => setIsRecordingVoice(false);
        recognition.onend = () => setIsRecordingVoice(false);
        recognition.start();
        return;
      } catch {
        // Fall through to simulated voice dictation
      }
    }

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

    const preferred: SpecialistAgentName | undefined =
      selectedAgent === 'chat' ? undefined : selectedAgent;
    setPrompt('');
    await onSendMessage(trimmed, preferred);
  };

  const beamIntensity = isLoading ? 'thinking' : isFocused ? 'focus' : 'idle';

  const composerBody = (
    <div className="w-full max-w-3xl mx-auto relative">
      {/* Alerts */}
      {demoReadOnly && (
        <div className="mb-2.5 px-3.5 py-2 rounded-xl bg-amber-500/12 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between">
          <span>
            <strong className="font-semibold">Read-Only Freeze Active:</strong> Mutating
            requests return <code className="font-mono">403 DEMO_READ_ONLY</code> while
            browsing remains enabled.
          </span>
        </div>
      )}

      {uploadError && (
        <div className="mb-2.5 px-3.5 py-2 rounded-xl bg-rose-500/12 border border-rose-500/30 text-xs text-rose-200 flex items-center justify-between">
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

      {/* Slash Command Autocomplete Menu (/) */}
      <AnimatePresence>
        {isSlashMenuVisible && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 460, damping: 34 }}
            data-slash-menu="true"
            className="absolute bottom-full left-0 right-0 mb-2.5 z-40 rounded-2xl bg-[#111114]/98 backdrop-blur-xl border border-white/[0.12] shadow-[0_24px_60px_-14px_rgba(0,0,0,0.9)] overflow-hidden"
          >
            <div className="px-3.5 py-2 border-b border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-500">
              <span>Slash Commands</span>
              <span className="font-mono text-[10px]">↑↓ · Enter to apply</span>
            </div>
            <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
              {slashMatches.map((item, idx) => {
                const highlighted = idx === slashIndex;
                return (
                  <button
                    key={item.command}
                    type="button"
                    data-slash-option={item.command}
                    onMouseEnter={() => setSlashIndex(idx)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applySlashCommand(item);
                    }}
                    className={`relative w-full flex items-center justify-between gap-3 px-3 py-2 rounded-xl text-left transition-colors cursor-pointer ${
                      highlighted ? 'text-white' : 'text-zinc-300'
                    }`}
                  >
                    {highlighted && (
                      <motion.span
                        layoutId="slash-menu-active-row"
                        transition={{ type: 'spring', stiffness: 520, damping: 36 }}
                        className="absolute inset-0 rounded-xl bg-white/[0.09] border border-white/[0.08]"
                      />
                    )}
                    <div className="relative z-10 flex items-center gap-2.5 min-w-0">
                      <span className="text-zinc-300 shrink-0">
                        {item.agent ? (
                          getSpecialistIcon(item.agent, 'w-3.5 h-3.5')
                        ) : (
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        )}
                      </span>
                      <span className="font-mono text-xs font-semibold text-white shrink-0">
                        {item.command}
                      </span>
                      <span className="text-xs text-zinc-400 truncate">
                        {item.description}
                      </span>
                    </div>
                    <span className="relative z-10 text-[10px] font-mono tabular-nums text-zinc-500 shrink-0">
                      {item.badge}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating 21st.dev BorderBeam Obsidian Composer Card */}
      <form
        onSubmit={handleSubmit}
        data-floating-composer="true"
        data-composer-variant={variant}
        className="relative rounded-2xl bg-[#111114]/95 backdrop-blur-xl border border-white/[0.1] shadow-[0_18px_50px_-14px_rgba(0,0,0,0.85)] transition-colors"
      >
        <BorderBeam durationSec={7.5} intensity={beamIntensity} />

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Attached File Preview Strip Inside Composer */}
        {attachedFiles.length > 0 && (
          <div className="relative z-10 px-3.5 pt-3 flex flex-wrap gap-2">
            {attachedFiles.map((file) => {
              const isImage = file.mimeType.startsWith('image/');
              if (isImage) {
                return (
                  <div
                    key={file.fileId}
                    data-attached-image-chip="true"
                    className="inline-flex items-center gap-2 pl-1.5 pr-2 py-1.5 rounded-xl bg-[#18181c] border border-white/[0.12] hover:border-white/[0.22] text-xs text-zinc-100 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenAttachment?.(file)}
                      title={`Inspect ${file.originalFilename}`}
                      className="inline-flex items-center gap-2.5 text-left cursor-pointer"
                    >
                      <div className="w-8 h-8 rounded-lg overflow-hidden border border-white/10 bg-[#09090b] flex items-center justify-center shrink-0">
                        <img
                          src={buildUploadedFileRawUrl(file.fileId)}
                          alt={file.originalFilename}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-100 max-w-[180px] truncate text-xs">
                          {file.originalFilename}
                        </div>
                        <div className="text-[10px] font-mono tabular-nums text-zinc-400">
                          {formatImageFileBadge(file.mimeType, file.sizeBytes)} · Vision
                        </div>
                      </div>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${file.originalFilename}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveAttachedFile(file.fileId);
                      }}
                      className="p-1 rounded-md hover:bg-white/[0.08] text-zinc-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              }

              return (
                <div
                  key={file.fileId}
                  className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 rounded-xl bg-[#18181c] border border-white/[0.1] hover:border-white/[0.22] text-xs text-zinc-200 transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => onOpenAttachment?.(file)}
                    title={`Inspect ${file.originalFilename}`}
                    className="inline-flex items-center gap-2 text-left cursor-pointer"
                  >
                    <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="font-medium max-w-[180px] truncate">
                      {file.originalFilename}
                    </span>
                    <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                      {file.pageCount ? `${file.pageCount}p · ${file.chunkCount} ch` : 'ready'}
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${file.originalFilename}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveAttachedFile(file.fileId);
                    }}
                    className="p-0.5 rounded hover:bg-white/[0.1] text-zinc-400 hover:text-white cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Auto-Expanding Prompt Textarea */}
        <div className="relative z-10 px-4 pt-3.5 pb-2">
          <textarea
            ref={textareaRef}
            rows={variant === 'hero' ? 2 : 1}
            value={prompt}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (isSlashMenuVisible) {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setSlashIndex((prev) => (prev + 1) % slashMatches.length);
                  return;
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSlashIndex(
                    (prev) => (prev - 1 + slashMatches.length) % slashMatches.length,
                  );
                  return;
                }
                if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  const chosen = slashMatches[slashIndex];
                  if (chosen) applySlashCommand(chosen);
                  return;
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setPrompt('');
                  return;
                }
              }

              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit();
              }
            }}
            disabled={demoReadOnly}
            placeholder={
              selectedAgent === 'chat'
                ? 'Ask anything, or type / for specialists (Code, PDF, Slides, Search, Image)…'
                : activePill.placeholder
            }
            className="w-full bg-transparent text-sm sm:text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none resize-none leading-relaxed"
          />
        </div>

        {/* Integrated Bottom Action Bar */}
        <div className="relative z-10 px-3 pb-2.5 pt-1 flex flex-wrap items-center justify-between gap-2">
          {/* Left Tools: Attach, Voice & Compact Specialist MorphingPopover */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || demoReadOnly}
              title="Attach PDF (RAG) or Image (Vision OCR)"
              aria-label="Attach file"
              className="h-8 w-8 rounded-lg bg-transparent hover:bg-white/[0.07] text-zinc-400 hover:text-white flex items-center justify-center transition-colors disabled:opacity-40 cursor-pointer shrink-0"
            >
              {isUploading ? (
                <Loader2 className="w-4 h-4 animate-spin text-white" />
              ) : (
                <Paperclip className="w-4 h-4" />
              )}
            </button>

            <button
              type="button"
              onClick={handleToggleVoice}
              disabled={demoReadOnly}
              title="Voice dictation"
              aria-label="Voice dictation"
              className={`h-8 w-8 rounded-lg flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                isRecordingVoice
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-transparent hover:bg-white/[0.07] text-zinc-400 hover:text-white'
              }`}
            >
              {isRecordingVoice ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </button>

            <span aria-hidden="true" className="h-4 w-px bg-white/[0.08] mx-0.5" />

            {/* Compact Specialist Mode Switcher (MorphingPopover) */}
            <div className="relative" data-agent-selector-bar="true">
              <button
                ref={specialistBtnRef}
                type="button"
                data-specialist-menu-trigger="true"
                data-active-agent={selectedAgent}
                aria-expanded={isSpecialistOpen}
                onClick={() => setIsSpecialistOpen((prev) => !prev)}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-[#18181c] hover:bg-[#202026] border border-white/[0.09] hover:border-white/[0.18] text-xs font-medium text-zinc-100 transition-colors whitespace-nowrap cursor-pointer"
              >
                <span className="text-zinc-200">
                  {getSpecialistIcon(selectedAgent, 'w-3.5 h-3.5')}
                </span>
                <span>{activePill.label}</span>
                <span className="text-[10px] font-mono tabular-nums text-zinc-400">
                  {activePill.creditCostLabel}
                </span>
                <ChevronDown
                  className={`w-3 h-3 text-zinc-500 transition-transform duration-150 ${
                    isSpecialistOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <MorphingPopover
                isOpen={isSpecialistOpen}
                onClose={() => setIsSpecialistOpen(false)}
                align="left"
                side="top"
                triggerRef={specialistBtnRef}
                className="w-80 p-1.5"
              >
                <div className="px-2.5 py-1.5 flex items-center justify-between text-[11px] text-zinc-500 border-b border-white/[0.06] mb-1">
                  <span>Select Specialist Mode</span>
                  <span className="font-mono text-[10px]">or type /</span>
                </div>
                <div className="space-y-0.5 max-h-72 overflow-y-auto">
                  {AGENT_SELECTOR_PILLS.map((pill) => {
                    const isSelected = pill.id === selectedAgent;
                    return (
                      <button
                        key={pill.id}
                        type="button"
                        data-agent-pill={pill.id}
                        aria-pressed={isSelected}
                        onClick={() => {
                          onSelectAgent(pill.id);
                          setIsSpecialistOpen(false);
                          requestAnimationFrame(() => textareaRef.current?.focus());
                        }}
                        className={`w-full flex items-center justify-between gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors cursor-pointer ${
                          isSelected
                            ? 'bg-white/[0.1] text-white'
                            : 'text-zinc-300 hover:bg-white/[0.05] hover:text-white'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={`shrink-0 ${
                              isSelected ? 'text-white' : 'text-zinc-400'
                            }`}
                          >
                            {getSpecialistIcon(pill.id, 'w-3.5 h-3.5')}
                          </span>
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">
                              {pill.label}
                            </div>
                            <div className="text-[10px] text-zinc-500 truncate">
                              {pill.id === 'chat'
                                ? 'Smart auto-routing + 5-mode reasoning'
                                : pill.placeholder}
                            </div>
                          </div>
                        </div>
                        <span className="text-[10px] font-mono tabular-nums text-zinc-400 shrink-0">
                          {pill.creditCostLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </MorphingPopover>
            </div>
          </div>

          {/* Right Controls: Spring Depth Switcher + Pure White Circular Send */}
          <div className="flex items-center gap-2">
            {selectedAgent === 'chat' && (
              <div
                role="group"
                aria-label="Chat response depth"
                data-chat-depth-selector="true"
                className="inline-flex items-center p-0.5 rounded-lg bg-[#18181c] border border-white/[0.07]"
              >
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
                      className="group relative isolate px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap cursor-pointer"
                    >
                      {active && (
                        <motion.span
                          layoutId={`chat-depth-pill-${variant}`}
                          transition={{
                            type: 'spring',
                            stiffness: 500,
                            damping: 36,
                          }}
                          className="absolute inset-0 z-0 rounded-md bg-white shadow-sm"
                        />
                      )}
                      <span
                        className={`relative z-10 ${
                          active
                            ? 'text-[#09090b] font-semibold'
                            : 'text-zinc-400 group-hover:text-zinc-100'
                        }`}
                      >
                        {opt.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <button
              type="submit"
              disabled={!prompt.trim() || isLoading || demoReadOnly}
              aria-label="Send message"
              data-composer-send="true"
              className="h-8 w-8 rounded-full bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed shrink-0"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4 stroke-[2.5]" />
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );

  if (variant === 'hero') {
    return composerBody;
  }

  return (
    <div className="shrink-0 px-4 sm:px-6 pb-4 pt-2 bg-gradient-to-t from-[#09090b] via-[#09090b]/95 to-transparent">
      {composerBody}
    </div>
  );
}
