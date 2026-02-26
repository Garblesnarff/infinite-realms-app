import { type Dispatch, type MutableRefObject, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { GameAction, GameState } from './game-reducer';
import type { DiceRollRequest, DiceRoll } from '@/types/combat';

import logger from '@/lib/logger';

/**
 * Hook that encapsulates dice roll management logic.
 * Extracted from GameContext.tsx for better maintainability.
 *
 * @param state - Current game state
 * @param dispatch - Dispatch function from useReducer
 * @param stateRef - Ref to always access latest state without causing re-renders
 */
export const useDiceRollManagement = (
  state: GameState,
  dispatch: Dispatch<GameAction>,
  stateRef: MutableRefObject<GameState>,
): {
  requestDiceRoll: (request: Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>) => string;
  completeDiceRoll: (rollId: string, result: DiceRoll) => void;
  cancelDiceRoll: (rollId: string) => void;
  getCurrentDiceRoll: () => DiceRollRequest | null;
  isBatchComplete: () => boolean;
  getBatchResults: () => DiceRollRequest[];
  clearBatch: () => void;
} => {
  // Auto-cleanup completed/cancelled rolls after delay
  // Only clear when ALL rolls are done (no pending rolls remaining)
  useEffect(() => {
    const completedOrCancelled = state.diceRollQueue.pendingRolls.filter(
      (roll) => roll.status === 'completed' || roll.status === 'cancelled',
    );

    const stillPending = state.diceRollQueue.pendingRolls.filter(
      (roll) => roll.status === 'pending',
    );

    // Only clear if we have completed/cancelled rolls AND no pending rolls
    // This ensures batch rolls display sequentially without being prematurely cleared
    if (completedOrCancelled.length > 0 && stillPending.length === 0) {
      const timeoutId = setTimeout(() => {
        dispatch({
          type: 'CLEAR_DICE_ROLL_QUEUE',
        });
      }, 2000); // Clear after 2 seconds

      return () => clearTimeout(timeoutId);
    }
  }, [state.diceRollQueue.pendingRolls, dispatch]);

  /**
   * Request a new dice roll with automatic deduplication
   *
   * Dependencies: [dispatch] - only uses dispatch (stable)
   */
  const requestDiceRoll = useCallback(
    (request: Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>): string => {
      const rollRequest: DiceRollRequest = {
        ...request,
        id: uuidv4(),
        timestamp: new Date(),
        status: 'pending',
      };

      logger.info('🎲 Requesting dice roll:', rollRequest);
      dispatch({ type: 'ADD_DICE_ROLL_REQUEST', payload: rollRequest });

      return rollRequest.id;
    },
    [dispatch],
  );

  /**
   * Complete a dice roll with the result
   *
   * Dependencies: [dispatch] - only uses dispatch (stable)
   */
  const completeDiceRoll = useCallback(
    (rollId: string, result: DiceRoll) => {
      logger.info('🎯 Completing dice roll:', rollId, result);
      dispatch({ type: 'COMPLETE_DICE_ROLL', payload: { id: rollId, result } });
    },
    [dispatch],
  );

  /**
   * Cancel a pending dice roll
   *
   * Dependencies: [dispatch] - only uses dispatch (stable)
   */
  const cancelDiceRoll = useCallback(
    (rollId: string) => {
      logger.info('❌ Cancelling dice roll:', rollId);
      dispatch({ type: 'CANCEL_DICE_ROLL', payload: rollId });
    },
    [dispatch],
  );

  /**
   * Get the current dice roll that should be displayed to the user
   *
   * Uses stateRef to access latest state without recreating callback on every state change.
   */
  const getCurrentDiceRoll = useCallback((): DiceRollRequest | null => {
    const currentState = stateRef.current;
    if (!currentState.diceRollQueue.currentRollId) return null;

    return (
      currentState.diceRollQueue.pendingRolls.find(
        (roll) => roll.id === currentState.diceRollQueue.currentRollId && roll.status === 'pending',
      ) || null
    );
  }, [stateRef]);

  /**
   * Check if all rolls in the current batch are complete
   */
  const isBatchComplete = useCallback((): boolean => {
    const currentState = stateRef.current;
    const { currentBatchId, pendingRolls, completedBatchRolls } = currentState.diceRollQueue;

    if (!currentBatchId) return false;

    // Count pending rolls that belong to the current batch
    const pendingBatchRolls = pendingRolls.filter(
      (roll) => roll.batchId === currentBatchId && roll.status === 'pending',
    );

    // Batch is complete when no pending rolls remain with this batchId
    return pendingBatchRolls.length === 0 && completedBatchRolls.length > 0;
  }, [stateRef]);

  /**
   * Get all completed rolls from the current batch
   */
  const getBatchResults = useCallback((): DiceRollRequest[] => {
    const currentState = stateRef.current;
    return currentState.diceRollQueue.completedBatchRolls;
  }, [stateRef]);

  /**
   * Clear the current batch state
   */
  const clearBatch = useCallback(() => {
    logger.info('🧹 Clearing batch state');
    dispatch({ type: 'CLEAR_BATCH' });
  }, [dispatch]);

  return {
    requestDiceRoll,
    completeDiceRoll,
    cancelDiceRoll,
    getCurrentDiceRoll,
    isBatchComplete,
    getBatchResults,
    clearBatch,
  };
};
