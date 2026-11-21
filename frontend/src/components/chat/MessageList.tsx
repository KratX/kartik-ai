import React, { useEffect, useRef } from 'react';
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
  readonly onFollowUpSearch?: (
    query: string,
    agent?: SpecialistAgentName,
  ) => void;
  readonly onRegenerate?: (message: PlatformMessage) => void;
  readonly onHandoffToSpecialist?: (
    target: 'pdf' | 'ppt' | 'search',
    message: PlatformMessage,
  ) => void;
  readonly onOpenCodeArtifact?: (artifact: ArtifactRecord) => void;
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
  onFollowUpSearch,
  onRegenerate,
  onHandoffToSpecialist,
  onOpenCodeArtifact,
  onOpenLightboxImage,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, isLoading]);

  return (
    <div className="space-y-5">
      {messages.map((msg) => (
        <MessageBubble
          key={msg.messageId}
          message={msg}
          isLoading={isLoading}
          onFollowUpSearch={onFollowUpSearch}
          onRegenerate={onRegenerate}
          onHandoffToSpecialist={onHandoffToSpecialist}
          onOpenCodeArtifact={onOpenCodeArtifact}
          onOpenLightboxImage={onOpenLightboxImage}
        />
      ))}

      {isLoading && <LoadingAnimation activeAgent={activeAgent} />}
      <div ref={bottomRef} />
    </div>
  );
}
