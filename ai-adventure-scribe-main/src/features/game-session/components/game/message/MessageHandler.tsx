import { useEffect } from 'react';

import { useMessageHandlerLogic } from './use-message-handler-logic';

import type { MessageSendContext } from '../../chat/MessageList';
import type { SpellCastHandlerRef } from '../spell-cast-handler';
import type { CombatTurnUiState } from '@/hooks/ai/combat-turn-preflight';
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
  spellCastHandlerRef?: SpellCastHandlerRef;
  children: (props: {
    handleSendMessage: (message: string, context?: MessageSendContext) => Promise<void>;
    isProcessing: boolean;
    isReconnecting: boolean;
    isStillThinking: boolean;
    sendError: string | null;
    onRetry: (input: string) => Promise<void>;
    combatTurnUiState: CombatTurnUiState;
    onResumeTurn: () => Promise<void>;
    /** #2456: handled terminal death state; when set, the UI renders the death screen. */
    terminalDeathState: { state: 'party_defeated'; encounterId: string | null; receivedAt: number } | null;
  }) => React.ReactNode;
}

export const MessageHandler: React.FC<MessageHandlerProps> = (props) => {
  const {
    handleSendMessage,
    isProcessing,
    isReconnecting,
    isStillThinking,
    sendError,
    retrySendMessage,
    combatTurnUiState,
    resumeCombatTurn,
    terminalDeathState,
  } = useMessageHandlerLogic(props);

  useEffect(() => {
    if (!props.spellCastHandlerRef) return;

    props.spellCastHandlerRef.current = handleSendMessage;
    return () => {
      if (props.spellCastHandlerRef?.current === handleSendMessage) {
        props.spellCastHandlerRef.current = null;
      }
    };
  }, [handleSendMessage, props.spellCastHandlerRef]);

  return props.children({
    handleSendMessage,
    isProcessing,
    isReconnecting,
    isStillThinking,
    sendError,
    onRetry: retrySendMessage,
    combatTurnUiState,
    onResumeTurn: resumeCombatTurn,
    terminalDeathState,
  });
};
