import { useEffect, useRef } from 'react';

import type { ChatMessage } from '@/types/game';

import { useGame } from '@/contexts/GameContext';
import { latestUnansweredDmRollRequest } from '@/utils/dm-roll-recovery';

interface UsePendingDmRollRecoveryProps {
  sessionId?: string;
  messages: readonly ChatMessage[];
  messagesReady: boolean;
}

/**
 * Restore an unanswered narrative roll once after this session's persisted messages load.
 *
 * The check runs a single time per session, on the first ready page: it is for a popup lost to
 * a reload. Rows written live later (a reply whose roll is still in the queue, or one the player
 * just dismissed) must not re-open the popup, so they are never looked at (#2280).
 */
export function usePendingDmRollRecovery({
  sessionId,
  messages,
  messagesReady,
}: UsePendingDmRollRecoveryProps): void {
  const { processAiResponse, state } = useGame();
  const checkedSessionId = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || !messagesReady) return;
    if (checkedSessionId.current === sessionId) return;
    // Set before dispatch so StrictMode's repeated effect setup cannot enqueue it twice.
    checkedSessionId.current = sessionId;

    // A live queue already owns the visible slot. Recovery is for a queue lost between loads.
    if (state.diceRollQueue.pendingRolls.some((roll) => roll.status === 'pending')) return;

    const pending = latestUnansweredDmRollRequest(messages);
    if (!pending) return;
    processAiResponse(pending.requests);
  }, [messages, messagesReady, processAiResponse, sessionId, state.diceRollQueue.pendingRolls]);
}
