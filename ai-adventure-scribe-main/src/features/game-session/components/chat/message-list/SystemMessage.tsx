import React from 'react';

import { MessageMetadata } from './MessageMetadata';

import type { ChatMessage } from '@/types/game';

interface SystemMessageProps {
  message: ChatMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  displayText: string;
}

/** Explicitly renders engine/local notices instead of routing them through a player bubble. */
export const SystemMessage: React.FC<SystemMessageProps> = React.memo(
  ({ message, isFirstInGroup, isLastInGroup, displayText }) => (
    <div
      role="status"
      aria-label="System message"
      className="w-full rounded-xl border border-infinite-gold/30 bg-card/70 px-4 py-3 text-sm text-muted-foreground shadow-sm"
    >
      <div className="whitespace-pre-wrap leading-relaxed">{displayText}</div>
      <MessageMetadata
        message={message}
        isFirstInGroup={isFirstInGroup}
        isLastInGroup={isLastInGroup}
        isPlayer={false}
      />
    </div>
  ),
);
