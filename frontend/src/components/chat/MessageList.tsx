import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import type {
  ArtifactRecord,
  PlatformMessage,
  SpecialistAgentName,
  UploadedFileRecord,
} from '../../types/index.js';
import type { LiveStreamProgressState } from '../workspace-ux-helpers.js';
import { LoadingAnimation } from '../common/LoadingAnimation.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { MessageBubble } from './MessageBubble.js';

export interface MessageListProps {
  readonly messages: readonly PlatformMessage[];
  readonly isLoading: boolean;
  readonly activeAgent?: SpecialistAgentName;
  readonly liveStreamState?: LiveStreamProgressState | null;
  readonly streamingMessageIds?: ReadonlySet<string>;
  readonly activeCanvasArtifactId?: string | null;
  readonly isCanvasOpen?: boolean;
  readonly onStreamComplete?: (messageId: string) => void;
  readonly onStreamTick?: () => void;
  readonly onFollowUpSearch?: (
    query: string,
    agent?: SpecialistAgentName,
  ) => void;
  readonly onRegenerate?: (message: PlatformMessage) => void;
  readonly onEditPrompt?: (prompt: string) => void;
  readonly onHandoffToSpecialist?: (
    target: 'pdf' | 'ppt' | 'search',
    message: PlatformMessage,
  ) => void;
  readonly onOpenArtifact?: (artifact: ArtifactRecord) => void;
  readonly onOpenAttachment?: (file: UploadedFileRecord) => void;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
  readonly onNotify?: (message: string, tone?: 'success' | 'info') => void;
}

export function MessageList({
  messages,
  isLoading,
  activeAgent,
  liveStreamState = null,
  streamingMessageIds,
  activeCanvasArtifactId,
  isCanvasOpen = false,
  onStreamComplete,
  onStreamTick,
  onFollowUpSearch,
  onRegenerate,
  onEditPrompt,
  onHandoffToSpecialist,
  onOpenArtifact,
  onOpenAttachment,
  onOpenLightboxImage,
  onNotify,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  useEffect(() => {
    if (liveStreamState?.partialText) {
      onStreamTick?.();
    }
  }, [liveStreamState?.partialText, onStreamTick]);

  const hasLivePartialText =
    isLoading && Boolean(liveStreamState && liveStreamState.partialText.length > 0);

  return (
    <div className="max-w-3xl mx-auto w-full space-y-7 pb-6">
      {messages.map((msg) => (
        <motion.div
          key={msg.messageId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        >
          <MessageBubble
            message={msg}
            isLoading={isLoading}
            shouldStream={streamingMessageIds?.has(msg.messageId) ?? false}
            activeCanvasArtifactId={activeCanvasArtifactId}
            isCanvasOpen={isCanvasOpen}
            onStreamComplete={onStreamComplete}
            onStreamTick={onStreamTick}
            onFollowUpSearch={onFollowUpSearch}
            onRegenerate={onRegenerate}
            onEditPrompt={onEditPrompt}
            onHandoffToSpecialist={onHandoffToSpecialist}
            onOpenArtifact={onOpenArtifact}
            onOpenAttachment={onOpenAttachment}
            onOpenLightboxImage={onOpenLightboxImage}
            onNotify={onNotify}
          />
        </motion.div>
      ))}

      {hasLivePartialText && liveStreamState ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          data-live-sse-stream="true"
          className="flex items-start gap-3 py-1"
        >
          <div className="w-6 h-6 rounded-full border border-white/15 bg-white/[0.04] flex items-center justify-center shrink-0 mt-0.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="font-medium text-zinc-200">Kartik.ai</span>
              <span aria-hidden="true" className="text-zinc-600">
                ·
              </span>
              <span className="text-zinc-400 uppercase font-mono text-[10px]">
                {liveStreamState.agent}
              </span>
              <span aria-hidden="true" className="text-zinc-600">
                ·
              </span>
              <span className="text-zinc-500 text-[11px] truncate">
                {liveStreamState.stageLabel}
              </span>
            </div>
            <div className="text-zinc-100">
              <MarkdownRenderer content={liveStreamState.partialText} />
              <span
                aria-hidden="true"
                className="inline-block w-1.5 h-4 ml-1 align-middle bg-white/80 animate-pulse rounded-[1px]"
              />
            </div>
          </div>
        </motion.div>
      ) : (
        isLoading && (
          <LoadingAnimation
            activeAgent={liveStreamState?.agent ?? activeAgent}
            stageLabel={liveStreamState?.stageLabel}
          />
        )
      )}
      <div ref={bottomRef} />
    </div>
  );
}
