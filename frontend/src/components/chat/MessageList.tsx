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
          onOpenCodeArtifact={onOpenCodeArtifact}
          onOpenLightboxImage={onOpenLightboxImage}
        />
      ))}

      {isLoading && <LoadingAnimation activeAgent={activeAgent} />}
      <div ref={bottomRef} />
    </div>
  );
}
