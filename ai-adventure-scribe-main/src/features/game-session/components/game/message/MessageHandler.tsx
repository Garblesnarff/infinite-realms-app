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
  /**
   * #2517: reports the terminal death state upward so the game screen can
   * swap to the fallen end state as a page state (not an overlay inside the
   * chat column).
   */
  onTerminalDeathStateChange?: (
    state: {
      state: 'party_defeated';
      encounterId: string | null;
      receivedAt: number;
      finalLines?: string[];
    } | null,
  ) => void;
  children: (props: {
    handleSendMessage: (message: string, context?: MessageSendContext) => Promise<void>;
    isProcessing: boolean;
    isReconnecting: boolean;
    isStillThinking: boolean;
    attackWaitLabel: string | null;
    sendError: string | null;
    onRetry: (input: string) => Promise<void>;
    combatTurnUiState: CombatTurnUiState;
    onResumeTurn: () => Promise<void>;
    /** #2456: handled terminal death state; when set, the UI renders the death screen. */
    terminalDeathState: {
      state: 'party_defeated';
      encounterId: string | null;
      receivedAt: number;
      finalLines?: string[];
    } | null;
  }) => React.ReactNode;
}

export const MessageHandler: React.FC<MessageHandlerProps> = (props) => {
  const {
    handleSendMessage,
    isProcessing,
    isReconnecting,
    isStillThinking,
    attackWaitLabel,
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

  const onTerminalDeathStateChange = props.onTerminalDeathStateChange;
  useEffect(() => {
    // #2517: report the terminal state only once no send is in flight. The
    // death state can be set while the killing turn is still finishing —
    // the DM reply and engine-row persistence run after the combat check
    // inside the turn — and swapping the tree mid-send would unmount this
    // handler before those saves settle. Holding the report lets the turn
    // land in history first; the end state then replaces a completed turn
    // and "Read the story so far" holds the killing blow.
    if (terminalDeathState && isProcessing) return;
    onTerminalDeathStateChange?.(terminalDeathState);
  }, [onTerminalDeathStateChange, terminalDeathState, isProcessing]);

  return props.children({
    handleSendMessage,
    isProcessing,
    isReconnecting,
    isStillThinking,
    attackWaitLabel,
    sendError,
    onRetry: retrySendMessage,
    combatTurnUiState,
    onResumeTurn: resumeCombatTurn,
    terminalDeathState,
  });
};
