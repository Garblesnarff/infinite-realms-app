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
 * Places DMMessageVoiceControls under every DM message. The control is visible at rest,
 * not on hover (#1236 C).
 *
 * ⚡ Bolt: Wrapped in React.memo to prevent redundant re-renders of the voice
 * controls for all messages when only one message changes.
 */
export const MessageVoicePlayer: React.FC<MessageVoicePlayerProps> = React.memo(
  ({ messageId, messageText, narrationSegments }) => {
    return (
      <div className="flex justify-end">
        <DMMessageVoiceControls
          messageId={messageId}
          messageText={messageText}
          narrationSegments={narrationSegments as any}
        />
      </div>
    );
  },
);
