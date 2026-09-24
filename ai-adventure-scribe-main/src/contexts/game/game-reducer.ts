/**
 * Game Reducer
 *
 * Manages the state transitions for the overall game state.
 * Extracted from GameContext.tsx for better maintainability and testability.
 */

import { nextVisibleRollId } from './dice-queue-visibility';

import type { DiceRollRequest, DiceRollQueue, DiceRoll } from '@/types/combat';

import logger from '@/lib/logger';

// Game phase types
export type GamePhase =
  | 'exploration' // General adventuring, skill checks, social interaction
  | 'combat' // Active combat with initiative order
  | 'social' // Heavy dialogue, negotiation, roleplay
  | 'puzzle' // Problem-solving, investigation
  | 'rest'; // Short/long rest periods

// Game state interface
export interface GameState {
  // Current game phase
  currentPhase: GamePhase;

  // Dice roll management
  diceRollQueue: DiceRollQueue;

  // Combat integration
  isInCombat: boolean;
  currentTurnPlayerId?: string;

  // Game flow
  lastActionTime?: Date;
  pendingActions: string[];

  // AI response tracking
  lastAiResponse?: {
    timestamp: Date;
    rollRequests: DiceRollRequest[];
  };
}

// Action types for game state updates
export type GameAction =
  | { type: 'SET_PHASE'; payload: GamePhase }
  | { type: 'ADD_DICE_ROLL_REQUEST'; payload: DiceRollRequest }
  | { type: 'COMPLETE_DICE_ROLL'; payload: { id: string; result: DiceRoll } }
  | { type: 'CANCEL_DICE_ROLL'; payload: string }
  | { type: 'CLEAR_DICE_ROLL_QUEUE' }
  | { type: 'SET_CURRENT_BATCH'; payload: string }
  | { type: 'CLEAR_BATCH' }
  | { type: 'SET_COMBAT_STATE'; payload: { isInCombat: boolean; currentTurnPlayerId?: string } }
  | { type: 'SET_AI_RESPONSE'; payload: { rollRequests: DiceRollRequest[] } }
  | { type: 'ADD_PENDING_ACTION'; payload: string }
  | { type: 'REMOVE_PENDING_ACTION'; payload: string };

// Initial game state
export const initialGameState: GameState = {
  currentPhase: 'exploration',
  diceRollQueue: {
    pendingRolls: [],
    isProcessingRoll: false,
    currentBatchId: undefined,
    completedBatchRolls: [],
  },
  isInCombat: false,
  pendingActions: [],
};

/**
 * Game state reducer
 *
 * @param state - Current game state
 * @param action - Action to perform
 * @returns New game state
 */
export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'SET_PHASE':
      // Change Detection: Primitive comparison (===)
      // Only update state if phase actually changes
      if (state.currentPhase === action.payload) {
        return state; // No change, return same reference to prevent re-render
      }
      return {
        ...state,
        currentPhase: action.payload,
      };

    case 'ADD_DICE_ROLL_REQUEST': {
      // Check for duplicates based on type, purpose, and participant
      const isDuplicate = state.diceRollQueue.pendingRolls.some(
        (roll) =>
          roll.requestType === action.payload.requestType &&
          roll.description === action.payload.description &&
          roll.participantId === action.payload.participantId &&
          roll.status === 'pending',
      );

      if (isDuplicate) {
        logger.info('🎲 Duplicate dice roll request detected, ignoring:', action.payload);
        return state;
      }

      // An engine roll request takes the single visible slot from an ordinary narrative roll; see
      // `dice-queue-visibility` for why the order is load-bearing (#2190).
      return {
        ...state,
        diceRollQueue: {
          ...state.diceRollQueue,
          pendingRolls: [...state.diceRollQueue.pendingRolls, action.payload],
          currentRollId: nextVisibleRollId(state.diceRollQueue, action.payload),
        },
      };
    }

    case 'COMPLETE_DICE_ROLL': {
      const completedRolls = state.diceRollQueue.pendingRolls.map((roll) =>
        roll.id === action.payload.id
          ? { ...roll, status: 'completed' as const, result: action.payload.result }
          : roll,
      );

      // Find the completed roll
      const completedRoll = completedRolls.find((roll) => roll.id === action.payload.id);

      // If this roll is part of a batch, add to completedBatchRolls
      const updatedBatchRolls =
        completedRoll?.batchId === state.diceRollQueue.currentBatchId && completedRoll
          ? [...state.diceRollQueue.completedBatchRolls, completedRoll]
          : state.diceRollQueue.completedBatchRolls;

      // Remove completed rolls after a short delay and set next current roll
      const remainingPendingRolls = completedRolls.filter((roll) => roll.status === 'pending');
      const nextCurrentRollId =
        remainingPendingRolls.length > 0 ? remainingPendingRolls[0].id : undefined;

      return {
        ...state,
        diceRollQueue: {
          ...state.diceRollQueue,
          pendingRolls: completedRolls,
          currentRollId: nextCurrentRollId,
          isProcessingRoll: false,
          completedBatchRolls: updatedBatchRolls,
        },
      };
    }

    case 'CANCEL_DICE_ROLL': {
      const cancelledRolls = state.diceRollQueue.pendingRolls.map((roll) =>
        roll.id === action.payload ? { ...roll, status: 'cancelled' as const } : roll,
      );

      const remainingAfterCancel = cancelledRolls.filter((roll) => roll.status === 'pending');
      const nextAfterCancel =
        remainingAfterCancel.length > 0 ? remainingAfterCancel[0].id : undefined;

      return {
        ...state,
        diceRollQueue: {
          ...state.diceRollQueue,
          pendingRolls: cancelledRolls,
          currentRollId: nextAfterCancel,
          isProcessingRoll: false,
        },
      };
    }

    case 'SET_CURRENT_BATCH':
      return {
        ...state,
        diceRollQueue: {
          ...state.diceRollQueue,
          currentBatchId: action.payload,
          completedBatchRolls: [],
        },
      };

    case 'CLEAR_BATCH':
      return {
        ...state,
        diceRollQueue: {
          ...state.diceRollQueue,
          currentBatchId: undefined,
          completedBatchRolls: [],
        },
      };

    case 'CLEAR_DICE_ROLL_QUEUE':
      // Change Detection: Check if queue is already empty
      if (
        state.diceRollQueue.pendingRolls.length === 0 &&
        state.diceRollQueue.isProcessingRoll === false &&
        !state.diceRollQueue.currentBatchId &&
        state.diceRollQueue.completedBatchRolls.length === 0
      ) {
        return state; // Queue already cleared, return same reference to prevent re-render
      }
      return {
        ...state,
        diceRollQueue: {
          pendingRolls: [],
          isProcessingRoll: false,
          currentBatchId: undefined,
          completedBatchRolls: [],
        },
      };

    case 'SET_COMBAT_STATE': {
      // Change Detection: Primitive comparison (===)
      // Only update state if combat state values actually change
      const newPhase = action.payload.isInCombat ? 'combat' : 'exploration';
      if (
        state.isInCombat === action.payload.isInCombat &&
        state.currentTurnPlayerId === action.payload.currentTurnPlayerId &&
        state.currentPhase === newPhase
      ) {
        return state; // No change, return same reference to prevent re-render
      }
      return {
        ...state,
        isInCombat: action.payload.isInCombat,
        currentTurnPlayerId: action.payload.currentTurnPlayerId,
        currentPhase: newPhase,
      };
    }

    case 'SET_AI_RESPONSE':
      return {
        ...state,
        lastAiResponse: {
          timestamp: new Date(),
          rollRequests: action.payload.rollRequests,
        },
      };

    case 'ADD_PENDING_ACTION':
      // Change Detection: Check if action already exists in pendingActions
      if (state.pendingActions.includes(action.payload)) {
        return state; // Action already pending, return same reference to prevent re-render
      }
      return {
        ...state,
        pendingActions: [...state.pendingActions, action.payload],
      };

    case 'REMOVE_PENDING_ACTION':
      // Change Detection: Check if action exists before filtering
      if (!state.pendingActions.includes(action.payload)) {
        return state; // Action not in list, return same reference to prevent re-render
      }
      return {
        ...state,
        pendingActions: state.pendingActions.filter((action) => action !== action.payload),
      };

    default:
      return state;
  }
}
