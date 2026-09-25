import { useEffect, useRef } from 'react';

import type { ChatMessage } from '@/types/game';

import { useGame } from '@/contexts/GameContext';
import { latestUnansweredDmRollRequest } from '@/utils/dm-roll-recovery';

interface UsePendingDmRollRecoveryProps {
  sessionId?: string;
  messages: readonly ChatMessage[];
  messagesReady: boolean;
}

/** Restore an unanswered narrative roll once after this session's persisted messages load. */
export function usePendingDmRollRecovery({
  sessionId,
  messages,
  messagesReady,
}: UsePendingDmRollRecoveryProps): void {
  const { processAiResponse, state } = useGame();
  const lastSessionId = useRef(sessionId);
  const recoveredMessageKey = useRef<string | null>(null);

  useEffect(() => {
    if (lastSessionId.current !== sessionId) {
      lastSessionId.current = sessionId;
      recoveredMessageKey.current = null;
    }
    if (!sessionId || !messagesReady) return;

    // A live queue already owns the visible slot. Recovery is for a queue lost between loads.
    if (state.diceRollQueue.pendingRolls.length > 0) return;

    const pending = latestUnansweredDmRollRequest(messages);
    if (!pending) return;

    const recoveryKey = `${sessionId}:${pending.messageKey}`;
    if (recoveredMessageKey.current === recoveryKey) return;

    // Set this before dispatch so StrictMode's repeated effect setup cannot enqueue it twice.
    recoveredMessageKey.current = recoveryKey;
    processAiResponse(pending.requests);
  }, [messages, messagesReady, processAiResponse, sessionId, state.diceRollQueue.pendingRolls]);
}
