import React from 'react';

import { DMMessageVoiceControls } from '@/components/game/voice/DMMessageVoiceControls';

interface MessageVoicePlayerProps {
  messageId: string;
  messageText: string;
  narrationSegments?: Array<{
    text: string;
    audioUrl?: string;
    emotion?: string;
  }>;
}

/**
 * MessageVoicePlayer Component
 * Wraps DMMessageVoiceControls with hover effects and positioning
 * Only visible on hover for DM messages
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the voice
 * controls for all messages when only one message changes.
 */
export const MessageVoicePlayer: React.FC<MessageVoicePlayerProps> = React.memo(({
  messageId,
  messageText,
  narrationSegments,
}) => {
  return (
    <div className="absolute bottom-2 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
      <DMMessageVoiceControls
        messageId={messageId}
        messageText={messageText}
        narrationSegments={narrationSegments as any}
      />
    </div>
  );
});
