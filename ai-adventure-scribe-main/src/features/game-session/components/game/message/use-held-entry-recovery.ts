import { useEffect, useRef } from 'react';

import type { ChatMessage } from '@/types/game';

import { readAuthoritativeCombat } from '@/contexts/combat/use-authoritative-combat-sync';
import { checkDeclaredAttack, recentNarrationFrom } from '@/hooks/ai/combat-entry-hold';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { latestUnansweredDmRollRequest } from '@/utils/dm-roll-recovery';

interface UseHeldEntryRecoveryProps {
  sessionId?: string | null;
  messages: readonly ChatMessage[];
  messagesReady: boolean;
  characterRecord: Record<string, unknown> | null | undefined;
  /** Re-run the turn for the last player message, which is already saved. */
  resumeTurn: (playerInput: string) => Promise<void>;
  onUnansweredRoll?: (message: ChatMessage) => void;
  /**
   * #265: a plain player message orphaned by a dropped turn (e.g. a deploy mid-turn killed the
   * in-flight DM reply). Offered, not auto-resumed — the player may have moved on.
   */
  onOrphanedMessage?: (message: ChatMessage) => void;
}

/**
 * Resume a turn the combat-entry popup was holding when the page reloaded (#2341).
 *
 * The hold is client-only: the player message is saved, no DM has been called, and nothing on
 * the server remembers the popup. After a reload that message would sit with no reply and the
 * player would have no way forward. Once per session, on the first ready page, if the last
 * message is the player's and still declares an attack, the turn runs again and the popup
 * reopens. A message the server no longer reads as an attack is left alone: its turn may have
 * an answer in flight, and asking the DM again would answer it twice.
 *
 * Two more guards, both because resuming must never answer a turn a second time:
 * - An open encounter means the engine may already have acted on that message, so nothing is
 *   resumed; the combat path owns those turns. Only a read that says there is none counts: a
 *   read that failed (`unknown`) says nothing, and the local encounter is empty after a reload,
 *   so anything looser resumes a turn in a fight whenever the read hiccups.
 * - The loaded messages can be stale by the time the check returns (a DM call in flight at
 *   reload saves its reply under the turn's id). The newest saved message is read again from
 *   the server immediately before resuming, and the turn is skipped unless it is still the
 *   player's own. A read that fails skips too: a retyped message costs less than an answer twice.
 *
 * #265 extends this to a plain player message orphaned by a dropped turn: a deploy mid-turn
 * kills the in-flight DM reply, and after a reload the player's line sits with no reply under
 * it. That message is offered a Retry (not auto-resumed): the retry re-sends the already-saved
 * row once, with no duplicate player save.
 */
/** Whether the server's newest message for the session is still this player message. */
export async function playerMessageIsStillNewest(
  sessionId: string,
  messageId: string,
): Promise<boolean> {
  const { total } = await userDataApi.listSessionMessages(sessionId, 0, 1);
  for (let end = total; end > 0; ) {
    const offset = Math.max(0, end - 50);
    const { messages } = await userDataApi.listSessionMessages(sessionId, offset, end - offset);
    const newest = [...messages]
      .reverse()
      .find(
        (message) =>
          message.speaker_type !== 'system' ||
          (message.context as Record<string, unknown> | null)?.intent !== 'error_recovery',
      );
    if (newest) return newest.id === messageId && newest.speaker_type === 'player';
    end = offset;
  }
  return false;
}

export function useHeldEntryRecovery({
  sessionId,
  messages,
  messagesReady,
  characterRecord,
  resumeTurn,
  onUnansweredRoll,
  onOrphanedMessage,
}: UseHeldEntryRecoveryProps): void {
  const checkedSessionId = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId || !messagesReady || !characterRecord) return;
    if (checkedSessionId.current === sessionId) return;
    // Set before the async check so StrictMode's repeated effect setup cannot start it twice.
    checkedSessionId.current = sessionId;

    const last = [...messages]
      .reverse()
      .find(
        (message) => message.sender !== 'system' || message.context?.intent !== 'error_recovery',
      );
    if (!last || last.sender !== 'player' || !last.text) {
      return;
    }

    if (last.context?.intent === 'dice_roll' && latestUnansweredDmRollRequest(messages)) return;

    const skip = (reason: string): void =>
      logger.info('COMBAT_ENTRY_HOLD_RESUME_SKIPPED', { sessionId, reason });

    void (async () => {
      const combat = await readAuthoritativeCombat(sessionId);
      if (combat.state !== 'none') {
        if (combat.state === 'unknown' && last.context?.intent === 'dice_roll') {
          onUnansweredRoll?.(last);
        }
        return skip(combat.state === 'combat' ? 'encounter_active' : 'encounter_unknown');
      }
      const held =
        last.context?.intent === 'dice_roll' ||
        (await checkDeclaredAttack({
          sessionId,
          message: last.text,
          characterRecord,
          recentNarration: recentNarrationFrom(messages.slice(0, -1)),
        }));
      if (!held) {
        // #265: a plain player message the drop orphaned (not an attack, not a roll). Offer
        // Retry rather than resuming: the player may have moved on. The offer-time
        // newest check below only guards the offer decision; the send-time guard in
        // actualSendMessage re-verifies before the retry fires, so a reply that
        // lands in between can never be answered a second time.
        if (last.id && (await playerMessageIsStillNewest(sessionId, last.id))) {
          logger.info('ORPHANED_PLAYER_MESSAGE_OFFERED', { sessionId });
          onOrphanedMessage?.(last);
        } else {
          logger.debug('ORPHANED_PLAYER_MESSAGE_OFFER_SKIPPED', {
            sessionId,
            reason: !last.id ? 'missing_id' : 'no_longer_newest',
          });
        }
        return;
      }
      if (!last.id || !(await playerMessageIsStillNewest(sessionId, last.id))) {
        return skip('answered_or_superseded');
      }
      if (last.context?.intent === 'dice_roll' && onUnansweredRoll) {
        onUnansweredRoll(last);
        return;
      }
      logger.info('COMBAT_ENTRY_HOLD_RESUMED', { sessionId });
      await resumeTurn(last.text);
    })().catch((error) => {
      logger.warn('COMBAT_ENTRY_HOLD_RESUME_FAILED', { sessionId, error });
      if (last.context?.intent === 'dice_roll') onUnansweredRoll?.(last);
    });
  }, [sessionId, messagesReady, messages, characterRecord, resumeTurn, onUnansweredRoll, onOrphanedMessage]);
}
