import { useMemo, useRef, useCallback, useState } from 'react';

import type { MessageSendContext, DiceRollContext } from '../MessageList';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { DiceRollRequest } from '@/utils/diceRolls';
import type { MutableRefObject } from 'react';

import { useGame } from '@/contexts/GameContext';
import {
  formatDiceRoll as formatDiceRollUtil,
  getDiceRollOutcome,
} from '@/features/game-session/components/chat/message-list/utils/dice-roll-formatter';
import {
  settleCombatAttackRoll,
  settleCombatInitiativeRoll,
} from '@/hooks/combat/use-player-roll-host';
import logger from '@/lib/logger';
import { hasPendingPlayerRoll } from '@/services/combat/player-roll-bridge';
import { rollDice } from '@/utils/diceUtils';
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
  handleDiceRoll: (formula: string, advantage?: boolean, disadvantage?: boolean) => Promise<void>;
  handleManualResult: (result: number) => Promise<void>;
  handleCancelRoll: () => void;
  lastRollRef: MutableRefObject<LastRollMeta | null>;
  pendingRollId: string | null;
  rollError: string | null;
} {
  const { state, getCurrentDiceRoll, completeDiceRoll, cancelDiceRoll, clearBatch } = useGame();

  const lastRollRef = useRef<LastRollMeta | null>(null);
  const pendingRollIdRef = useRef<string | null>(null);
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
    };
  }, [currentRoll]);

  /**
   * Memoized cancel callback
   */
  const handleCancelRoll = useCallback(() => {
    if (!currentRoll) return;
    // Cancelling a combat attack die does not cancel the attack: the turn is already in flight
    // and must resolve. The engine rolls it instead, and the transcript says so.
    settleCombatAttackRoll(currentRoll.id, null);
    settleCombatInitiativeRoll(currentRoll.id, null);
    cancelDiceRoll(currentRoll.id);
    if (pendingRollIdRef.current === currentRoll.id) {
      pendingRollIdRef.current = null;
      setPendingRollId(null);
    }
    setRollError(null);
  }, [currentRoll, cancelDiceRoll]);

  // Handle dice roll from queue with batching support
  const handleDiceRoll = useCallback(
    async (formula: string, advantage?: boolean, disadvantage?: boolean) => {
      logger.info('[useMessageDiceRolls] Handling dice roll from queue:', {
        formula,
        advantage,
        disadvantage,
      });

      const roll = getCurrentDiceRoll();
      if (!roll) {
        logger.warn('[useMessageDiceRolls] No current dice roll in queue');
        return;
      }

      // Keep the prompt latched to this queue id until the server accepts the result. The ref
      // closes the same-tick double-click window; the state keeps the disabled UI stable across
      // renders while the async response is in flight.
      if (pendingRollIdRef.current) return;
      pendingRollIdRef.current = roll.id;
      setPendingRollId(roll.id);
      setRollError(null);

      try {
        const diceMatch = formula.match(/(\d+)d(\d+)([+-]\d+)?/);
        if (!diceMatch) {
          logger.error('[useMessageDiceRolls] Invalid dice formula:', formula);
          return;
        }

        const count = parseInt(diceMatch[1]);
        const dieType = parseInt(diceMatch[2]);
        const modifier = diceMatch[3] ? parseInt(diceMatch[3]) : 0;

        const rollResult = rollDice(dieType, count, modifier, {
          advantage: advantage || false,
          disadvantage: disadvantage || false,
        });

        // CRITICAL FIX: Calculate batch completion status BEFORE dispatch
        let willCompleteBatch = true;
        if (roll.batchId) {
          const remainingPendingInBatch = state.diceRollQueue.pendingRolls.filter(
            (r) => r.batchId === roll.batchId && r.status === 'pending' && r.id !== roll.id,
          ).length;
          willCompleteBatch = remainingPendingInBatch === 0;
          logger.info('[useMessageDiceRolls] Batch status check:', {
            batchId: roll.batchId,
            remainingPendingInBatch,
            willCompleteBatch,
          });
        }

        const completedRoll = { ...roll, result: rollResult };
        const formattedRoll = formatDiceRoll(completedRoll);
        const outcome = getDiceRollOutcome(completedRoll);

        // A combat attack die belongs to a resolution already waiting on it. Hand it back and
        // stop: sending it to the DM as a new player message would put the same attack through
        // the engine a second time, which is the divergence this whole feature exists to avoid.
        if (settleCombatAttackRoll(roll.id, rollResult.naturalRoll ?? rollResult.total)) {
          completeDiceRoll(roll.id, rollResult);
          logger.info('[useMessageDiceRolls] combat attack die returned to the engine');
          lastRollRef.current = {
            kind: 'attack',
            label: roll.description,
            result: rollResult.total,
            nat: rollResult.naturalRoll,
          };
          return;
        }
        if (settleCombatInitiativeRoll(roll.id, rollResult.naturalRoll ?? rollResult.total)) {
          completeDiceRoll(roll.id, rollResult);
          logger.info('[useMessageDiceRolls] combat initiative die returned to the entry flow');
          lastRollRef.current = {
            kind: 'initiative',
            label: roll.description,
            result: rollResult.total,
            nat: rollResult.naturalRoll,
          };
          return;
        }

        // No engine settler owns this attack/initiative die and a fight is under way or being
        // seated: it came from a raw DM declaration request, not from the engine. Drop it — the
        // engine has resolved or will resolve that roll itself, and posting the number as a
        // player message would narrate an attack that never happened (#2190).
        if (shouldDropUnownedCombatRoll(roll.requestType)) {
          completeDiceRoll(roll.id, rollResult);
          logger.warn('[useMessageDiceRolls] dropped an unowned combat die; not sent to the DM', {
            requestType: roll.requestType,
            description: roll.description,
            total: rollResult.total,
          });
          lastRollRef.current = {
            kind: roll.requestType === 'initiative' ? 'initiative' : 'attack',
            label: roll.description,
            result: rollResult.total,
            nat: rollResult.naturalRoll,
          };
          return;
        }

        const diceRollMessage: ChatMessage = {
          text: formattedRoll,
          sender: 'player',
          timestamp: new Date().toISOString(),
          context: {
            intent: 'dice_roll',
            diceRoll: {
              formula,
              count,
              dieType,
              modifier,
              advantage: advantage || false,
              disadvantage: disadvantage || false,
              results: rollResult.results,
              keptResults: rollResult.keptResults,
              total: rollResult.total,
              naturalRoll: rollResult.naturalRoll,
              critical: rollResult.critical,
              requestType: roll.requestType,
              description: roll.description,
              dc: roll.dc,
              ac: roll.ac,
              success: outcome?.success,
              timestamp: new Date().toISOString(),
            },
          },
        };

        if (roll.batchId && !willCompleteBatch) {
          await onSendMessage(diceRollMessage);
          completeDiceRoll(roll.id, rollResult);
          logger.info('[useMessageDiceRolls] Batch roll persisted, waiting for remaining rolls');
        } else {
          if (onSendFullMessage) {
            logger.info('[useMessageDiceRolls] Triggering AI response after roll(s) complete');
            await onSendFullMessage(formattedRoll, {
              intent: 'dice_roll',
              diceRoll: diceRollMessage.context?.diceRoll,
            });
          } else {
            await onSendMessage(diceRollMessage);
          }

          completeDiceRoll(roll.id, rollResult);

          if (roll.batchId) {
            logger.info('[useMessageDiceRolls] Batch complete! Clearing batch state');
            clearBatch();
          }
        }

        // Capture last roll meta
        const mapKind = (t: string): LastRollMeta['kind'] => {
          if (t === 'attack') return 'attack';
          if (t === 'damage') return 'damage';
          if (t === 'initiative') return 'initiative';
          if (['saving_throw', 'death_save', 'concentration_save'].includes(t)) return 'save';
          if (['ability_check', 'skill_check'].includes(t)) return 'skill_check';
          return 'generic';
        };

        lastRollRef.current = {
          kind: mapKind(roll.requestType),
          label: roll.description,
          result: rollResult.total,
          nat: rollResult.naturalRoll,
        };
      } catch (error) {
        setRollError(getRollErrorMessage(error));
        handleAsyncError(error, {
          userMessage: 'Failed to process dice roll',
          context: { location: 'useMessageDiceRolls.handleDiceRoll' },
        });
      } finally {
        if (pendingRollIdRef.current === roll.id) {
          pendingRollIdRef.current = null;
          setPendingRollId(null);
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

  // Handle manual dice result input with batching support
  const handleManualResult = useCallback(
    async (result: number) => {
      const roll = getCurrentDiceRoll();
      if (!roll) {
        logger.warn('[useMessageDiceRolls] No current dice roll in queue');
        return;
      }

      if (pendingRollIdRef.current) return;
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

        if (
          roll.combatInitiativeRoll &&
          (!Number.isInteger(numericResult) || numericResult < 1 || numericResult > 20)
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

        const completedRoll = {
          ...roll,
          result: { total: numericResult },
        };
        const formattedRoll = formatDiceRoll(completedRoll);
        const outcome = getDiceRollOutcome(completedRoll);
        const diceRollContext: DiceRollContext = {
          intent: 'dice_roll',
          diceRoll: {
            formula: roll.rollConfig.abilityModifier
              ? `${roll.rollConfig.count}d${roll.rollConfig.dieType}+${roll.rollConfig.abilityModifier}`
              : `${roll.rollConfig.count}d${roll.rollConfig.dieType}${roll.rollConfig.modifier >= 0 ? '+' : ''}${roll.rollConfig.modifier}`,
            count: roll.rollConfig.count,
            dieType: roll.rollConfig.dieType,
            modifier: roll.rollConfig.modifier,
            advantage: roll.rollConfig.advantage,
            disadvantage: roll.rollConfig.disadvantage,
            total: numericResult,
            requestType: roll.requestType,
            description: roll.description,
            dc: roll.dc,
            ac: roll.ac,
            success: outcome?.success,
            timestamp: new Date().toISOString(),
          },
        };

        // Same diversion as the rolled path: a hand-entered attack die is still the player's
        // die for an attack already mid-resolution, and still must not reach the DM as a
        // message. The typed number IS the natural face, since the popup asks for a bare d20.
        if (settleCombatAttackRoll(roll.id, numericResult)) {
          completeDiceRoll(roll.id, { total: numericResult });
          logger.info('[useMessageDiceRolls] manual combat attack die returned to the engine');
          return;
        }
        if (settleCombatInitiativeRoll(roll.id, numericResult)) {
          completeDiceRoll(roll.id, { total: numericResult });
          logger.info(
            '[useMessageDiceRolls] manual combat initiative die returned to the entry flow',
          );
          return;
        }

        // Same drop rule as the rolled path: a hand-entered attack/initiative die with no engine
        // settler, during or just before an encounter, is a raw DM declaration request and must
        // not reach the DM as a message (#2190).
        if (shouldDropUnownedCombatRoll(roll.requestType)) {
          completeDiceRoll(roll.id, { total: numericResult });
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
          completeDiceRoll(roll.id, { total: numericResult });
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

          completeDiceRoll(roll.id, { total: numericResult });

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
        if (pendingRollIdRef.current === roll.id) {
          pendingRollIdRef.current = null;
          setPendingRollId(null);
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
    handleDiceRoll,
    handleManualResult,
    handleCancelRoll,
    lastRollRef,
    pendingRollId,
    rollError,
  };
}
