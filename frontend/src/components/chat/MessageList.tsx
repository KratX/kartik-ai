import React, { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import type {
  ArtifactRecord,
  PlatformMessage,
  SpecialistAgentName,
} from '../../types/index.js';
import { LoadingAnimation } from '../common/LoadingAnimation.js';
import { MessageBubble } from './MessageBubble.js';

export interface MessageListProps {
  readonly messages: readonly PlatformMessage[];
  readonly isLoading: boolean;
  readonly activeAgent?: SpecialistAgentName;
  readonly activeCanvasArtifactId?: string | null;
  readonly isCanvasOpen?: boolean;
  readonly onFollowUpSearch?: (
    query: string,
    agent?: SpecialistAgentName,
  ) => void;
  readonly onRegenerate?: (message: PlatformMessage) => void;
  readonly onHandoffToSpecialist?: (
    target: 'pdf' | 'ppt' | 'search',
    message: PlatformMessage,
  ) => void;
  readonly onOpenArtifact?: (artifact: ArtifactRecord) => void;
  readonly onOpenLightboxImage?: (image: {
    readonly title: string;
    readonly imageUrl: string;
    readonly sourceUrl?: string;
  }) => void;
}

export function MessageList({
  messages,
  isLoading,
  activeAgent,
  activeCanvasArtifactId,
  isCanvasOpen = false,
  onFollowUpSearch,
  onRegenerate,
  onHandoffToSpecialist,
  onOpenArtifact,
  onOpenLightboxImage,
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
            activeCanvasArtifactId={activeCanvasArtifactId}
            isCanvasOpen={isCanvasOpen}
            onFollowUpSearch={onFollowUpSearch}
            onRegenerate={onRegenerate}
            onHandoffToSpecialist={onHandoffToSpecialist}
            onOpenArtifact={onOpenArtifact}
            onOpenLightboxImage={onOpenLightboxImage}
          />
        </motion.div>
      ))}

      {isLoading && <LoadingAnimation activeAgent={activeAgent} />}
      <div ref={bottomRef} />
    </div>
  );
}
