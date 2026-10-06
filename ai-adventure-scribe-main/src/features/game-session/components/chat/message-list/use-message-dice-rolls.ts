import { useMemo, useRef, useCallback, useState } from 'react';

import type { MessageSendContext, DiceRollContext } from '../MessageList';
import type { RolledResultDetails } from '@/hooks/game/use-dice-roll-request';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { DiceRollRequest } from '@/utils/diceRolls';
import type { MutableRefObject } from 'react';

import { isEngineTaggedRoll } from '@/contexts/game/dice-queue-visibility';
import { useGame } from '@/contexts/GameContext';
import {
  formatDiceRoll as formatDiceRollUtil,
  getDiceRollOutcome,
} from '@/features/game-session/components/chat/message-list/utils/dice-roll-formatter';
import {
  settleCombatAttackRoll,
  settleCombatCheckRoll,
  settleCombatInitiativeRoll,
} from '@/hooks/combat/use-player-roll-host';
import logger from '@/lib/logger';
import { hasPendingPlayerRoll } from '@/services/combat/player-roll-bridge';
import { declinedRollMessage } from '@/utils/dm-roll-recovery';
import { handleAsyncError } from '@/utils/error-handler';
import { isEngineChannelRollType } from '@/utils/roll-request/engine-channel';

// Type for last roll metadata
export type LastRollMeta = {
  kind: 'attack' | 'skill_check' | 'save' | 'damage' | 'initiative' | 'generic';
  skill?: string;
  weapon?: string;
  label?: string;
  result: number;
  nat?: number;
  dc?: number;
  ac?: number;
  success?: boolean;
};

interface UseMessageDiceRollsProps {
  onSendMessage: (message: ChatMessage) => Promise<void>;
  onSendFullMessage?: (message: string, context?: MessageSendContext) => Promise<void>;
}

function getRollErrorMessage(error: unknown): string {
  return error instanceof Error && /timed out|timeout/i.test(error.message)
    ? 'Roll timed out. Please try again.'
    : 'Roll submission failed. Please try again.';
}

/**
 * Hook to manage dice roll queue and submission logic for MessageList
 */
export function useMessageDiceRolls({
  onSendMessage,
  onSendFullMessage,
}: UseMessageDiceRollsProps): {
  currentRoll: DiceRollRequest | null;
  batchProgress: { current: number; total: number } | null;
  rollRequest: RollRequest | null;
  handleManualResult: (result: number, details?: RolledResultDetails) => Promise<void>;
  handleCancelRoll: () => void;
  lastRollRef: MutableRefObject<LastRollMeta | null>;
  pendingRollId: string | null;
  rollError: string | null;
} {
  const { state, getCurrentDiceRoll, completeDiceRoll, cancelDiceRoll, clearBatch } = useGame();

  const lastRollRef = useRef<LastRollMeta | null>(null);
  const pendingRollIdRef = useRef<string | null>(null);
  // Rolls whose result is being handled. A narrative roll's handler awaits the whole DM turn,
  // and that turn can open an engine prompt (combat-entry initiative) whose result arrives here
  // while the first handler is still running. The guard is per roll, never one global slot (#2587).
  const handlingRollIdsRef = useRef<Set<string>>(new Set());
  const cancelledRollIdRef = useRef<string | null>(null);
  const [pendingRollId, setPendingRollId] = useState<string | null>(null);
  const [rollError, setRollError] = useState<string | null>(null);

  /**
   * Format a single dice roll with enhanced context for both AI and human readability
   * Returns: "Stealth Check: 15 (nat 13+2) vs DC 13 ✓"
   */
  const formatDiceRoll = useCallback((roll: DiceRollRequest): string => {
    return formatDiceRollUtil(roll);
  }, []);

  /**
   * Whether an `attack` or `initiative` die that no engine settler claimed must be dropped
   * instead of sent to the DM.
   *
   * Once an encounter exists or is being seated, those dice belong to the engine: it prompts for
   * them itself and consumes the result. A leftover one is a prompt the engine never owned — a
   * raw DM declaration request that reached the popup. Sending its result as a player message
   * starts a turn for an attack the engine never resolved, which is exactly the fabricated
   * "attacks X with their longsword: 9 (nat 4+5) miss" line from #2190. `hasPendingPlayerRoll`
   * covers the seating window, where the engine's own prompt is already waiting but neither
   * context reports combat yet.
   */
  const shouldDropUnownedCombatRoll = useCallback(
    (requestType: string): boolean =>
      isEngineChannelRollType(requestType) &&
      (state.isInCombat || state.currentPhase === 'combat' || hasPendingPlayerRoll()),
    [state.isInCombat, state.currentPhase],
  );

  // Subscribe to current dice roll from queue state
  const currentRoll = useMemo(() => {
    if (!state.diceRollQueue.currentRollId) return null;

    return (
      state.diceRollQueue.pendingRolls.find(
        (roll) => roll.id === state.diceRollQueue.currentRollId && roll.status === 'pending',
      ) || null
    );
  }, [state.diceRollQueue.currentRollId, state.diceRollQueue.pendingRolls]);

  // Calculate batch progress for multi-roll scenarios
  const batchProgress = useMemo(() => {
    if (!currentRoll?.batchId) return null;

    const batchRolls = state.diceRollQueue.pendingRolls.filter(
      (roll) => roll.batchId === currentRoll.batchId,
    );
    const completedInBatch = batchRolls.filter((roll) => roll.status === 'completed').length;
    const currentPosition = completedInBatch + 1;
    const totalRolls = batchRolls.length;

    return { current: currentPosition, total: totalRolls };
  }, [currentRoll, state.diceRollQueue.pendingRolls]);

  /**
   * Memoized roll request object for DiceRollRequest stable props
   */
  const rollRequest = useMemo(() => {
    if (!currentRoll) return null;
    return {
      type: currentRoll.requestType as RollRequest['type'],
      formula: currentRoll.rollConfig.abilityModifier
        ? `${currentRoll.rollConfig.count}d${currentRoll.rollConfig.dieType}+${currentRoll.rollConfig.abilityModifier}`
        : `${currentRoll.rollConfig.count}d${currentRoll.rollConfig.dieType}${currentRoll.rollConfig.modifier >= 0 ? '+' : ''}${currentRoll.rollConfig.modifier}`,
      purpose: currentRoll.description,
      advantage: currentRoll.rollConfig.advantage,
      disadvantage: currentRoll.rollConfig.disadvantage,
      ...(currentRoll.dc !== undefined ? { dc: currentRoll.dc } : {}),
      ...(currentRoll.ac !== undefined ? { ac: currentRoll.ac } : {}),
    };
  }, [currentRoll]);

  /**
   * Memoized cancel callback
   */
  const handleCancelRoll = useCallback(() => {
    if (!currentRoll) return;
    // A double click can reach here twice against the same stale `currentRoll` before the queue
    // re-renders; the second call must not write a second declined-roll line (#2291).
    if (cancelledRollIdRef.current === currentRoll.id) return;
    cancelledRollIdRef.current = currentRoll.id;
    // Dismissing a combat attack prompt withdraws the attack: the resolution waiting on it skips
    // that action instead of rolling it for the player (#2234). Only a timeout lets the engine
    // roll. A dismissed initiative prompt still seats the encounter, with the engine's die.
    const attackSettled = settleCombatAttackRoll(currentRoll.id, null, { cancelled: true });
    const initiativeSettled = settleCombatInitiativeRoll(currentRoll.id, null);
    // A dismissed check prompt withdraws the check, like a dismissed attack (#2420).
    const checkSettled = settleCombatCheckRoll(currentRoll.id, null, { cancelled: true });
    cancelDiceRoll(currentRoll.id);
    // A cancelled narrative check is an answer too, so it goes in the transcript (#2291): the
    // DM's withheld reply shows, a reload does not re-open the popup, and the next DM turn
    // sees the choice. Engine-owned attack and initiative prompts keep #2237's behavior.
    const engineOwned =
      attackSettled ||
      initiativeSettled ||
      checkSettled ||
      isEngineTaggedRoll(currentRoll) ||
      isEngineChannelRollType(currentRoll.requestType);
    if (!engineOwned) {
      const declined = declinedRollMessage(currentRoll.description);
      Promise.resolve()
        .then(() => onSendMessage(declined))
        .catch((error: unknown) =>
          logger.warn('[useMessageDiceRolls] declined-roll line not saved', {
            rollId: currentRoll.id,
            error,
          }),
        );
    }
    if (pendingRollIdRef.current === currentRoll.id) {
      pendingRollIdRef.current = null;
      setPendingRollId(null);
    }
    setRollError(null);
  }, [currentRoll, cancelDiceRoll, onSendMessage]);

  // Handle manual dice result input with batching support
  const handleManualResult = useCallback(
    async (result: number, details?: RolledResultDetails) => {
      const roll = getCurrentDiceRoll();
      if (!roll) {
        logger.warn('[useMessageDiceRolls] No current dice roll in queue');
        return;
      }

      if (handlingRollIdsRef.current.has(roll.id)) return;
      handlingRollIdsRef.current.add(roll.id);
      pendingRollIdRef.current = roll.id;
      setPendingRollId(roll.id);
      setRollError(null);

      try {
        let numericResult: number;
        if (typeof result === 'number') {
          numericResult = result;
        } else if (typeof result === 'object' && result && 'total' in result) {
          numericResult = (result as { total: number }).total;
        } else {
          logger.error('[useMessageDiceRolls] Invalid result type:', result);
          return;
        }

        // The engine settlers take the bare d20. The popup's animated roll reports its natural
        // face alongside the total (#2210); a hand-entered number has no details and IS the face,
        // since the popup asks for a bare d20.
        const naturalFace = details?.naturalRoll ?? numericResult;

        if (
          roll.combatInitiativeRoll &&
          (!Number.isInteger(naturalFace) || naturalFace < 1 || naturalFace > 20)
        ) {
          logger.warn('[useMessageDiceRolls] initiative result must be a natural d20 (1-20)');
          return;
        }

        // CRITICAL FIX: Calculate batch completion status BEFORE dispatch
        let willCompleteBatch = true;
        if (roll.batchId) {
          const remainingPendingInBatch = state.diceRollQueue.pendingRolls.filter(
            (r) => r.batchId === roll.batchId && r.status === 'pending' && r.id !== roll.id,
          ).length;
          willCompleteBatch = remainingPendingInBatch === 0;
          logger.info('[useMessageDiceRolls] Manual roll batch status check:', {
            batchId: roll.batchId,
            remainingPendingInBatch,
            willCompleteBatch,
          });
        }

        // The animated popup reports its natural face alongside the total (#2210). Carry it
        // into the settled roll and the DM context so narrative rolls keep their "nat X" and the
        // DM can flag a natural 20/1 (#2219). A hand-entered number has no details and IS the
        // face, so nothing is added and the typed-entry format is unchanged.
        const settledResult =
          details?.naturalRoll !== undefined
            ? { total: numericResult, naturalRoll: details.naturalRoll }
            : { total: numericResult };

        // The queue stores modifier 0 for a save. The dialog total already includes the
        // character's bonus, so the saved modifier is total minus the natural face.
        const queuedModifier = roll.rollConfig.modifier;
        const recordedModifier =
          details?.naturalRoll !== undefined ? numericResult - details.naturalRoll : queuedModifier;
        const completedRoll = {
          ...roll,
          rollConfig: { ...roll.rollConfig, modifier: recordedModifier },
          result: settledResult,
        };
        const formattedRoll = formatDiceRoll(completedRoll);
        const outcome = getDiceRollOutcome(completedRoll);
        const signedModifier = `${recordedModifier >= 0 ? '+' : ''}${recordedModifier}`;
        const formula =
          recordedModifier === queuedModifier && roll.rollConfig.abilityModifier
            ? `${roll.rollConfig.count}d${roll.rollConfig.dieType}+${roll.rollConfig.abilityModifier}`
            : `${roll.rollConfig.count}d${roll.rollConfig.dieType}${signedModifier}`;
        const diceRollContext: DiceRollContext = {
          intent: 'dice_roll',
          diceRoll: {
            formula,
            count: roll.rollConfig.count,
            dieType: roll.rollConfig.dieType,
            modifier: recordedModifier,
            advantage: roll.rollConfig.advantage,
            disadvantage: roll.rollConfig.disadvantage,
            results: details?.results ?? [naturalFace],
            ...(details?.keptResults ? { keptResults: details.keptResults } : {}),
            total: numericResult,
            ...(details?.naturalRoll !== undefined ? { naturalRoll: details.naturalRoll } : {}),
            requestType: roll.requestType,
            description: roll.description,
            dc: roll.dc,
            ac: roll.ac,
            success: outcome?.success,
            timestamp: new Date().toISOString(),
          },
        };

        // The popup's die is the player's die for an attack already mid-resolution, and must
        // not reach the DM as a message.
        if (settleCombatAttackRoll(roll.id, naturalFace)) {
          completeDiceRoll(roll.id, settledResult);
          logger.info('[useMessageDiceRolls] manual combat attack die returned to the engine');
          return;
        }
        if (settleCombatInitiativeRoll(roll.id, naturalFace)) {
          completeDiceRoll(roll.id, settledResult);
          logger.info(
            '[useMessageDiceRolls] manual combat initiative die returned to the entry flow',
          );
          return;
        }

        // A mid-combat check's die returns to the engine for the same reason an attack's does:
        // the check is already mid-resolution (#2420).
        if (settleCombatCheckRoll(roll.id, naturalFace)) {
          completeDiceRoll(roll.id, settledResult);
          logger.info('[useMessageDiceRolls] manual combat check die returned to the engine');
          return;
        }

        // An attack/initiative die with no engine settler, during or just before an encounter,
        // is a raw DM declaration request and must not reach the DM as a message (#2190).
        if (shouldDropUnownedCombatRoll(roll.requestType)) {
          completeDiceRoll(roll.id, settledResult);
          logger.warn(
            '[useMessageDiceRolls] dropped an unowned manual combat die; not sent to the DM',
            {
              requestType: roll.requestType,
              description: roll.description,
              total: numericResult,
            },
          );
          return;
        }

        if (roll.batchId && !willCompleteBatch) {
          const playerMessage: ChatMessage = {
            text: formattedRoll,
            sender: 'player',
            timestamp: new Date().toISOString(),
            context: diceRollContext,
          };
          await onSendMessage(playerMessage);
          completeDiceRoll(roll.id, settledResult);
          logger.info(
            '[useMessageDiceRolls] Manual batch roll persisted, waiting for remaining rolls',
          );
        } else {
          if (onSendFullMessage) {
            logger.info(
              '[useMessageDiceRolls] Triggering AI response after manual roll(s) complete',
            );
            await onSendFullMessage(formattedRoll, diceRollContext);
          } else {
            const playerMessage: ChatMessage = {
              text: formattedRoll,
              sender: 'player',
              timestamp: new Date().toISOString(),
              context: diceRollContext,
            };
            await onSendMessage(playerMessage);
          }

          completeDiceRoll(roll.id, settledResult);

          if (roll.batchId) {
            logger.info('[useMessageDiceRolls] Batch complete (manual)! Clearing batch state');
            clearBatch();
          }
        }
      } catch (error) {
        setRollError(getRollErrorMessage(error));
        handleAsyncError(error, {
          userMessage: 'Failed to process dice result',
          context: { location: 'useMessageDiceRolls.handleManualResult' },
        });
      } finally {
        handlingRollIdsRef.current.delete(roll.id);
        if (pendingRollIdRef.current === roll.id) {
          // An earlier handler may still be running; the pending id falls back to it.
          const stillHandling = Array.from(handlingRollIdsRef.current).pop() ?? null;
          pendingRollIdRef.current = stillHandling;
          setPendingRollId(stillHandling);
        }
      }
    },
    [
      onSendMessage,
      onSendFullMessage,
      getCurrentDiceRoll,
      completeDiceRoll,
      clearBatch,
      formatDiceRoll,
      shouldDropUnownedCombatRoll,
      state.diceRollQueue.pendingRolls,
    ],
  );

  return {
    currentRoll,
    batchProgress,
    rollRequest,
    handleManualResult,
    handleCancelRoll,
    lastRollRef,
    pendingRollId,
    rollError,
  };
}
