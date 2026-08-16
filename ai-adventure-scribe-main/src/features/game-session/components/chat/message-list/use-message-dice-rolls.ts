import { useMemo, useRef, useCallback } from 'react';

import type { DiceRollContext } from '../MessageList';
import type { ChatMessage } from '@/types/game';
import type { RollRequest } from '@/types/roll-request';
import type { DiceRollRequest } from '@/utils/diceRolls';
import type { MutableRefObject } from 'react';

import { useGame } from '@/contexts/GameContext';
import {
  formatDiceRoll as formatDiceRollUtil,
  getDiceRollOutcome,
} from '@/features/game-session/components/chat/message-list/utils/dice-roll-formatter';
import { settleCombatAttackRoll } from '@/hooks/combat/use-player-roll-host';
import logger from '@/lib/logger';
import { rollDice } from '@/utils/diceUtils';
import { handleAsyncError } from '@/utils/error-handler';

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
  onSendFullMessage?: (message: string, context?: DiceRollContext) => Promise<void>;
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
} {
  const { state, getCurrentDiceRoll, completeDiceRoll, cancelDiceRoll, clearBatch } = useGame();

  const lastRollRef = useRef<LastRollMeta | null>(null);

  /**
   * Format a single dice roll with enhanced context for both AI and human readability
   * Returns: "Stealth Check: 15 (nat 13+2) vs DC 13 ✓"
   */
  const formatDiceRoll = useCallback((roll: DiceRollRequest): string => {
    return formatDiceRollUtil(roll);
  }, []);

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
    cancelDiceRoll(currentRoll.id);
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

        completeDiceRoll(roll.id, rollResult);

        const completedRoll = { ...roll, result: rollResult };
        const formattedRoll = formatDiceRoll(completedRoll);
        const outcome = getDiceRollOutcome(completedRoll);

        // A combat attack die belongs to a resolution already waiting on it. Hand it back and
        // stop: sending it to the DM as a new player message would put the same attack through
        // the engine a second time, which is the divergence this whole feature exists to avoid.
        if (settleCombatAttackRoll(roll.id, rollResult.naturalRoll ?? rollResult.total)) {
          logger.info('[useMessageDiceRolls] combat attack die returned to the engine');
          lastRollRef.current = {
            kind: 'attack',
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
        handleAsyncError(error, {
          userMessage: 'Failed to process dice roll',
          context: { location: 'useMessageDiceRolls.handleDiceRoll' },
        });
      }
    },
    [
      onSendMessage,
      onSendFullMessage,
      getCurrentDiceRoll,
      completeDiceRoll,
      clearBatch,
      formatDiceRoll,
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

        completeDiceRoll(roll.id, { total: numericResult });

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
          logger.info('[useMessageDiceRolls] manual combat attack die returned to the engine');
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

          if (roll.batchId) {
            logger.info('[useMessageDiceRolls] Batch complete (manual)! Clearing batch state');
            clearBatch();
          }
        }
      } catch (error) {
        handleAsyncError(error, {
          userMessage: 'Failed to process dice result',
          context: { location: 'useMessageDiceRolls.handleManualResult' },
        });
      }
    },
    [
      onSendMessage,
      onSendFullMessage,
      getCurrentDiceRoll,
      completeDiceRoll,
      clearBatch,
      formatDiceRoll,
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
  };
}
