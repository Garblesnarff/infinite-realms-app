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

import { gameReducer, initialGameState } from './game/game-reducer';
import { useAiRollProcessor, type AiRollRequest } from './game/use-ai-roll-processor';
import { useDamageAutoApplication } from './game/use-damage-auto-application';
import { useDiceRollManagement } from './game/use-dice-roll-management';

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
export const GameProvider: React.FC<{ children: ReactNode; characterId?: string | null }> = ({ children, characterId }) => {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  const { state: combatState, dealDamage } = useCombat();

  // Auto-apply damage from dice rolls using extracted hook
  useDamageAutoApplication(state, combatState, dealDamage, characterId);

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

  // Dice roll management using extracted hook
  const {
    requestDiceRoll,
    completeDiceRoll,
    cancelDiceRoll,
    getCurrentDiceRoll,
    isBatchComplete,
    getBatchResults,
    clearBatch,
  } = useDiceRollManagement(state, dispatch, stateRef);

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
export const useGame = (): GameContextValue => {
  const context = useContext(GameContext);
  if (context === undefined) {
    throw new Error('useGame must be used within a GameProvider');
  }
  return context;
};
