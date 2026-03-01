import { useMessageHandlerLogic } from './use-message-handler-logic';

import type { DiceRollContext } from '../../chat/MessageList';
import type { ChatMessage } from '@/types/game';
import type React from 'react';

interface MessageHandlerProps {
  sessionId: string; // Should be non-null if we reach here
  campaignId: string | null;
  characterId: string | null;
  turnCount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateGameSessionState: (newState: Partial<any>) => Promise<void>;
  onAIResponse?: (message: ChatMessage) => Promise<void>; // Callback for processing AI responses (e.g., combat detection)
  children: (props: {
    handleSendMessage: (message: string, context?: DiceRollContext) => Promise<void>;
    isProcessing: boolean;
  }) => React.ReactNode;
}

export const MessageHandler: React.FC<MessageHandlerProps> = (props) => {
  const { handleSendMessage, isProcessing } = useMessageHandlerLogic(props);

  return props.children({
    handleSendMessage,
    isProcessing,
  });
};
