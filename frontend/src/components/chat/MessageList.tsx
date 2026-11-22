import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import type {
  ArtifactRecord,
  PlatformMessage,
  SpecialistAgentName,
  UploadedFileRecord,
} from '../../types/index.js';
import { LoadingAnimation } from '../common/LoadingAnimation.js';
import { MessageBubble } from './MessageBubble.js';

export interface MessageListProps {
  readonly messages: readonly PlatformMessage[];
  readonly isLoading: boolean;
  readonly activeAgent?: SpecialistAgentName;
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

      {isLoading && <LoadingAnimation activeAgent={activeAgent} />}
      <div ref={bottomRef} />
    </div>
  );
}
