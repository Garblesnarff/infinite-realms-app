import React from 'react';

import type { ChatMessage } from '@/types/game';

interface MessageMetadataProps {
  message: ChatMessage;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  isPlayer: boolean;
}

/**
 * MessageMetadata Component
 * Displays timestamps, context metadata (emotion, location) for messages
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the metadata
 * (emotions, locations, timestamps) for all messages when only one message changes.
 */
export const MessageMetadata: React.FC<MessageMetadataProps> = React.memo(({
  message,
  isFirstInGroup,
  isLastInGroup,
  isPlayer,
}) => {
  // The mood word is data for developers, not for players (#2256): it renders in dev builds only.
  const emotionLabel = import.meta.env.DEV ? message.context?.emotion : undefined;
  const hasVisibleContext = Boolean(emotionLabel || message.context?.location);
  return (
    <>
      {/* Context metadata - only show on first message */}
      {isFirstInGroup && hasVisibleContext && (
        <div className="mt-2 pt-2 border-t border-border/20 space-y-1 text-xs opacity-80">
          {emotionLabel && (
            <div className="flex items-center">
              <span className="font-medium mr-1">🎭</span>
              <span>{emotionLabel}</span>
            </div>
          )}
          {message.context?.location && (
            <div className="flex items-center">
              <span className="font-medium mr-1">📍</span>
              <span>{message.context.location}</span>
            </div>
          )}
        </div>
      )}

      {/* Timestamp - only on last message */}
      {isLastInGroup && (
        <div className={`text-xs message-meta px-2 ${isPlayer ? 'text-right' : 'text-left'} mt-1`}>
          {message.timestamp
            ? new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })
            : ''}
        </div>
      )}
    </>
  );
});
