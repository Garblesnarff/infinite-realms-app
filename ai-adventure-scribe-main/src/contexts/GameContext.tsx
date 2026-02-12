/* eslint-disable max-lines */
/**
 * Game Context
 *
 * This context manages the overall game state, including dice roll deduplication,
 * combat awareness, and coordination between different game systems.
 * It acts as a central hub for game mechanics and state management.
 *
 * Key Features:
 * - Dice roll request deduplication to prevent multiple popups
 * - Combat state awareness and integration with CombatContext
 * - Turn management and initiative tracking
 * - Game phase management (exploration, combat, social interaction)
 *
 * @author AI Dungeon Master Team
 */

import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { v4 as uuidv4 } from 'uuid';

import { gameReducer, initialGameState } from './game/game-reducer';
import { useAiRollProcessor, type AiRollRequest } from './game/use-ai-roll-processor';

import type { GamePhase, GameState, GameAction } from './game/game-reducer';
import type { DiceRollRequest, DiceRoll } from '@/types/combat';
import type { ReactNode } from 'react';

import { useCombat } from '@/contexts/CombatContext';
import logger from '@/lib/logger';
import { throttle } from '@/lib/utils';

export type { GamePhase, GameState };

// Game context value interface
export interface GameContextValue {
  state: GameState;
  dispatch: React.Dispatch<GameAction>;

  // Dice roll management
  requestDiceRoll: (request: Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>) => string;
  completeDiceRoll: (rollId: string, result: DiceRoll) => void;
  cancelDiceRoll: (rollId: string) => void;
  getCurrentDiceRoll: () => DiceRollRequest | null;

  // Batch management
  isBatchComplete: () => boolean;
  getBatchResults: () => DiceRollRequest[];
  clearBatch: () => void;

  // Game phase management
  setGamePhase: (phase: GamePhase) => void;

  // AI integration
  processAiResponse: (rollRequests: AiRollRequest[]) => void;

  // Combat integration
  updateCombatState: (isInCombat: boolean, currentTurnPlayerId?: string) => void;
}

// Create context
const GameContext = createContext<GameContextValue | undefined>(undefined);

/**
 * Game Context Provider
 */
export const GameProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const { state: combatState, dealDamage } = useCombat();

  // Track previous combat state values to prevent infinite loops
  // This ref stores the last combat state values we synchronized with GameContext
  // Equality Strategy: Uses primitive comparison (=== for boolean and string)
  // - isInCombat: boolean primitive, compared by value
  // - currentTurnPlayerId: string | undefined primitive, compared by value
  // Deep equality is NOT needed because we only track primitive values, not nested objects
  const prevCombatStateRef = useRef({
    isInCombat: false,
    currentTurnPlayerId: undefined as string | undefined,
  });

  // Ref to always access latest state without causing useCallback dependencies to change
  // This prevents stale closure bugs in async operations and callbacks
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Sync with combat context - only dispatch when values actually change
  // Performance: This effect extracts primitives from combatState to avoid triggering
  // on activeEncounter object reference changes. Only the extracted primitive values
  // are compared, preventing unnecessary re-renders and infinite loops.
  useEffect(() => {
    const isInCombat = combatState.isInCombat;
    const currentTurnPlayerId = combatState.activeEncounter?.currentTurnParticipantId;

    // Only dispatch if values actually changed from the previous combat context values
    // Comparison Strategy:
    // - Uses !== for primitive values (boolean and string)
    // - Prevents infinite loops by storing previous values in ref
    // - No deep equality needed as we're only comparing primitives
    const prevState = prevCombatStateRef.current;
    if (
      prevState.isInCombat !== isInCombat ||
      prevState.currentTurnPlayerId !== currentTurnPlayerId
    ) {
      // Update ref to track new values
      prevCombatStateRef.current = { isInCombat, currentTurnPlayerId };

      dispatch({
        type: 'SET_COMBAT_STATE',
        payload: { isInCombat, currentTurnPlayerId },
      });
    }
  }, [combatState.isInCombat, combatState.activeEncounter?.currentTurnParticipantId]);

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
  }, [state.diceRollQueue.pendingRolls]);

  /**
   * Request a new dice roll with automatic deduplication
   *
   * Fixed: Properly memoized with useCallback and empty dependencies.
   * Only uses dispatch (stable) and local variables, so no external dependencies needed.
   * Dependencies: [] - no external dependencies, uses only dispatch and local scope
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
    [],
  ); // No dependencies - only uses dispatch and function parameters

  /**
   * Complete a dice roll with the result
   *
   * Fixed: Properly memoized with useCallback and empty dependencies.
   * Only uses dispatch (stable) and function parameters.
   * Dependencies: [] - no external dependencies, uses only dispatch and parameters
   */
  const completeDiceRoll = useCallback((rollId: string, result: DiceRoll) => {
    logger.info('🎯 Completing dice roll:', rollId, result);
    dispatch({ type: 'COMPLETE_DICE_ROLL', payload: { id: rollId, result } });
  }, []); // No dependencies - only uses dispatch and function parameters

  /**
   * Cancel a pending dice roll
   *
   * Fixed: Properly memoized with useCallback and empty dependencies.
   * Only uses dispatch (stable) and function parameters.
   * Dependencies: [] - no external dependencies, uses only dispatch and parameters
   */
  const cancelDiceRoll = useCallback((rollId: string) => {
    logger.info('❌ Cancelling dice roll:', rollId);
    dispatch({ type: 'CANCEL_DICE_ROLL', payload: rollId });
  }, []); // No dependencies - only uses dispatch and function parameters

  /**
   * Get the current dice roll that should be displayed to the user
   *
   * Fixed: Uses stateRef to access latest state without recreating callback on every state change.
   * This prevents stale closures while maintaining stable function reference.
   */
  const getCurrentDiceRoll = useCallback((): DiceRollRequest | null => {
    const currentState = stateRef.current;
    if (!currentState.diceRollQueue.currentRollId) return null;

    return (
      currentState.diceRollQueue.pendingRolls.find(
        (roll) => roll.id === currentState.diceRollQueue.currentRollId && roll.status === 'pending',
      ) || null
    );
  }, []); // Empty deps - uses stateRef to always get fresh state

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
  }, []);

  /**
   * Get all completed rolls from the current batch
   */
  const getBatchResults = useCallback((): DiceRollRequest[] => {
    const currentState = stateRef.current;
    return currentState.diceRollQueue.completedBatchRolls;
  }, []);

  /**
   * Clear the current batch state
   */
  const clearBatch = useCallback(() => {
    logger.info('🧹 Clearing batch state');
    dispatch({ type: 'CLEAR_BATCH' });
  }, []);

  /**
   * Set the current game phase
   *
   * Fixed: Properly memoized with useCallback and empty dependencies.
   * Only uses dispatch (stable) and function parameters.
   * Change Detection: Uses stateRef to check current phase before dispatching.
   * Comparison Strategy: Primitive comparison (===) for GamePhase string union type.
   * Dependencies: [] - no external dependencies, uses stateRef and dispatch
   */
  const setGamePhase = useCallback((phase: GamePhase) => {
    // Change Detection: Only dispatch if phase actually changes
    // Uses stateRef to access current state without adding dependencies
    if (stateRef.current.currentPhase === phase) {
      logger.info('🎮 Game phase unchanged, skipping dispatch:', phase);
      return; // Early return prevents unnecessary dispatch and re-render
    }
    logger.info('🎮 Setting game phase:', phase);
    dispatch({ type: 'SET_PHASE', payload: phase });
  }, []); // No dependencies - only uses dispatch and function parameters

  // AI integration using extracted hook
  const { throttledProcessAiResponse } = useAiRollProcessor(dispatch, requestDiceRoll);

  /**
   * Update combat state integration
   *
   * Fixed: Properly memoized with useCallback and empty dependencies.
   * Only uses dispatch (stable) and function parameters.
   * Change Detection: Uses stateRef to check combat state before dispatching.
   * Comparison Strategy: Primitive comparison (===) for boolean and string values.
   * Dependencies: [] - no external dependencies, uses stateRef and dispatch
   */
  const updateCombatState = useCallback((isInCombat: boolean, currentTurnPlayerId?: string) => {
    // Change Detection: Only dispatch if combat state values actually change
    // Uses stateRef to access current state without adding dependencies
    const currentState = stateRef.current;
    if (
      currentState.isInCombat === isInCombat &&
      currentState.currentTurnPlayerId === currentTurnPlayerId
    ) {
      logger.info('⚔️ Combat state unchanged, skipping dispatch:', {
        isInCombat,
        currentTurnPlayerId,
      });
      return; // Early return prevents unnecessary dispatch and re-render
    }
    dispatch({ type: 'SET_COMBAT_STATE', payload: { isInCombat, currentTurnPlayerId } });
  }, []); // No dependencies - only uses dispatch and function parameters

  /**
   * Throttled versions of frequently-called functions to prevent performance issues
   *
   * Throttle Strategy:
   * - updateCombatState: 100ms - Combat state updates need near-instant feedback but can be throttled slightly
   * - setGamePhase: 250ms - Phase transitions are less frequent but can happen during rapid state changes
   * - processAiResponse: 500ms - AI responses are async and don't need immediate processing
   *
   * Functions NOT throttled:
   * - requestDiceRoll: Already has deduplication logic in reducer, throttling could lose rolls
   * - completeDiceRoll: Must execute immediately to show results to user
   * - cancelDiceRoll: Must execute immediately for responsive user feedback
   * - getCurrentDiceRoll: Read-only getter, no state updates
   */
  const throttledUpdateCombatState = useMemo(
    () => throttle(updateCombatState, 100),
    [updateCombatState],
  ); // 100ms - Combat state updates should be near-instant but can be throttled slightly

  const throttledSetGamePhase = useMemo(() => throttle(setGamePhase, 250), [setGamePhase]); // 250ms - Phase transitions are less frequent but can happen during rapid state changes

  // Track which damage_taken rolls have been applied to prevent double-application
  const appliedDamageRollsRef = useRef<Set<string>>(new Set());

  /**
   * Auto-apply damage_taken rolls to player HP when they complete
   * This bridges the AI DM's damage requests with the combat HP system
   */
  useEffect(() => {
    // Find completed damage_taken rolls that haven't been applied yet
    const completedDamageRolls = state.diceRollQueue.pendingRolls.filter(
      (roll) =>
        roll.requestType === 'damage_taken' &&
        roll.status === 'completed' &&
        roll.target === 'player' &&
        roll.result?.total &&
        !appliedDamageRollsRef.current.has(roll.id),
    );

    // Apply each damage roll
    completedDamageRolls.forEach(async (roll) => {
      const damageAmount = roll.result?.total || 0;
      if (damageAmount > 0) {
        logger.info(
          `💔 Auto-applying damage_taken roll: ${damageAmount} ${roll.damageType || 'untyped'} damage to player`,
        );

        // Mark as applied to prevent double-application
        appliedDamageRollsRef.current.add(roll.id);

        // If in combat, apply via CombatContext
        if (combatState.isInCombat && combatState.activeEncounter) {
          // Find player participant
          const playerParticipant = combatState.activeEncounter.participants.find(
            (p) => p.participantType === 'player',
          );
          if (playerParticipant) {
            logger.info(
              `⚔️ Applying ${damageAmount} damage to ${playerParticipant.name} in combat via dealDamage`,
            );
            try {
              await dealDamage(playerParticipant.id, damageAmount, roll.damageType);
              logger.info(`✅ Damage applied successfully to ${playerParticipant.name}`);
            } catch (error) {
              logger.error(`❌ Failed to apply damage:`, error);
            }
          }
        } else {
          // Outside of combat, log for manual tracking
          // Future enhancement: Could update character HP directly in database
          logger.info(
            `📝 Damage taken outside combat: ${damageAmount} ${roll.damageType || 'untyped'} damage (HP tracking not active outside combat)`,
          );
        }
      }
    });
  }, [
    state.diceRollQueue.pendingRolls,
    combatState.isInCombat,
    combatState.activeEncounter,
    dealDamage,
  ]);

  // ⚡ Bolt: Stabilize context value to prevent unnecessary re-renders of consumers.
  // Using useMemo ensures that components consuming this context only re-render
  // when the actual state or dependent actions change.
  const contextValue: GameContextValue = useMemo(
    () => ({
      state,
      dispatch,
      requestDiceRoll,
      completeDiceRoll,
      cancelDiceRoll,
      getCurrentDiceRoll,
      isBatchComplete,
      getBatchResults,
      clearBatch,
      setGamePhase: throttledSetGamePhase,
      processAiResponse: throttledProcessAiResponse,
      updateCombatState: throttledUpdateCombatState,
    }),
    [
      state,
      dispatch,
      requestDiceRoll,
      completeDiceRoll,
      cancelDiceRoll,
      getCurrentDiceRoll,
      isBatchComplete,
      getBatchResults,
      clearBatch,
      throttledSetGamePhase,
      throttledProcessAiResponse,
      throttledUpdateCombatState,
    ],
  );

  return <GameContext.Provider value={contextValue}>{children}</GameContext.Provider>;
};

/**
 * Hook to use the Game Context
 */
export const useGame = () => {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};
