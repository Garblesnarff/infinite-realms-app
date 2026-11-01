import { useEffect } from 'react';

import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';

import { useGame } from '@/contexts/GameContext';
import { ROLL_DECLINED_INTENT, identifyDmRollRequests } from '@/utils/dm-roll-recovery';
import { isNarrativeRollRequest } from '@/utils/roll-request/engine-channel';

interface UseLiveDmFallbackPushProps {
  sessionId?: string;
  messages: readonly ChatMessage[];
}

interface DmFallbackPersistedDetail {
  sessionId?: unknown;
  messageId?: unknown;
  rollRequests?: unknown;
}

/**
 * Offer a server-rescued fallback row's rolls to a live tab (#800 item 3).
 *
 * The server broadcasts `dm_fallback_persisted` when it persists a fallback
 * row for a turn the client never saved. This is NOT the reload recovery
 * (`usePendingDmRollRecovery` runs once per session on first load, and live
 * rows must not re-open popups per #2280) — it is a rescue event for a LOST
 * turn, and it only enqueues when the tab has no live queue and the requests
 * are still owed:
 * - a live queue already owns the visible slot → skip (the generating tab
 *   still shows its own popup; a second enqueue would fight it);
 * - a request already answered by an id-matched dice-roll or declined line
 *   in the current list → skip that request (the player answered or
 *   dismissed it on another tab; re-opening it would nag).
 * The socket hook's refetch pulls the row itself into the list through the
 * normal dialogue path; this hook only owns the popup. A broadcast fires
 * once per persist, so one event enqueues once.
 * The frame's requests are filtered to narrative rolls first (string type,
 * not an engine-channel `attack`/`initiative` — the same rule
 * `narrativeRollRequestsOf` applies on reload): engine dice must never reach
 * the popup (#2190), and `identifyDmRollRequests` assigns ids by position,
 * so filtering keeps the live ids identical to the live-generation and
 * reload-recovery ids for the same row.
 */
export function useLiveDmFallbackPush({ sessionId, messages }: UseLiveDmFallbackPushProps): void {
  const { processAiResponse, state } = useGame();

  useEffect(() => {
    const onFallback = (event: Event): void => {
      const detail = (event as CustomEvent<DmFallbackPersistedDetail>).detail ?? {};
      if (!sessionId || detail.sessionId !== sessionId) return;
      if (typeof detail.messageId !== 'string') return;
      if (state.diceRollQueue.pendingRolls.some((roll) => roll.status === 'pending')) return;
      const raw = Array.isArray(detail.rollRequests) ? detail.rollRequests : [];
      const requests = raw.filter(
        (request): request is RollRequest =>
          !!request &&
          typeof request === 'object' &&
          typeof (request as { type?: unknown }).type === 'string' &&
          isNarrativeRollRequest(request as { type?: string }),
      );
      if (requests.length === 0) return;
      const identified = identifyDmRollRequests(requests, detail.messageId);
      // The same answer rule dm-roll-recovery's unansweredRequestsAt applies,
      // restricted to id-matched answers: without the row in the list yet,
      // position-based "any later player message answers all" cannot run.
      const answeredIds = new Set<string>();
      for (const message of messages) {
        const intent = message.context?.intent;
        const rollRequestId = message.context?.rollRequestId;
        if (typeof rollRequestId !== 'string') continue;
        if (intent === 'dice_roll' || intent === ROLL_DECLINED_INTENT) {
          answeredIds.add(rollRequestId);
        }
      }
      const owed = identified.filter(
        (request) => request.rollRequestId && !answeredIds.has(request.rollRequestId),
      );
      if (owed.length === 0) return;
      processAiResponse(owed as unknown as Parameters<typeof processAiResponse>[0]);
    };
    window.addEventListener('dm-fallback-persisted', onFallback);
    return () => window.removeEventListener('dm-fallback-persisted', onFallback);
  }, [messages, processAiResponse, sessionId, state.diceRollQueue.pendingRolls]);
}
