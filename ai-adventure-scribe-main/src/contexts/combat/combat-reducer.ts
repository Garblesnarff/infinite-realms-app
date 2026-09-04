/**
 * Combat Reducer
 *
 * Manages the state transitions for D&D 5e combat encounters.
 * Extracted from CombatContext.tsx for better maintainability and testability.
 */

import type {
  CombatState,
  CombatEncounter,
  CombatParticipant,
  CombatAction as CombatActionType,
  ReactionOpportunity,
  ActionType,
} from '@/types/combat';

/**
 * Initial state for combat encounters
 */
export const initialCombatState: CombatState = {
  activeEncounter: null,
  isInCombat: false,
  selectedParticipantId: undefined,
  selectedTargetId: undefined,
  showInitiativeTracker: true,
  showCombatLog: true,
  pendingAction: undefined,
  activeReactionOpportunities: [],
  pendingReactionResponse: undefined,
};

/**
 * Actions that can be dispatched to the combat reducer
 */
export type ReducerAction =
  | { type: 'SET_ENCOUNTER'; encounter: CombatEncounter }
  | { type: 'START_COMBAT' }
  | { type: 'END_COMBAT' }
  | { type: 'UPDATE_PARTICIPANT'; participantId: string; updates: Partial<CombatParticipant> }
  | { type: 'ADD_PARTICIPANT'; participant: CombatParticipant }
  | { type: 'REMOVE_PARTICIPANT'; participantId: string }
  | { type: 'NEXT_TURN' }
  | { type: 'ADD_ACTION'; action: CombatActionType }
  | { type: 'SET_SELECTED_PARTICIPANT'; participantId?: string }
  | { type: 'SET_SELECTED_TARGET'; targetId?: string }
  | { type: 'TOGGLE_INITIATIVE_TRACKER' }
  | { type: 'TOGGLE_COMBAT_LOG' }
  | { type: 'ADD_REACTION_OPPORTUNITY'; opportunity: ReactionOpportunity }
  | { type: 'REMOVE_REACTION_OPPORTUNITY'; opportunityId: string }
  | { type: 'CLEAR_REACTION_OPPORTUNITIES' }
  | { type: 'SET_PENDING_REACTION'; opportunityId: string; selectedReaction: ActionType };

/**
 * Reducer function for combat state management
 *
 * @param state - Current combat state
 * @param action - Action to perform
 * @returns New combat state
 *
 * @example
 * const [state, dispatch] = useReducer(combatReducer, initialCombatState);
 * dispatch({ type: 'START_COMBAT' });
 */
export function combatReducer(state: CombatState, action: ReducerAction): CombatState {
  switch (action.type) {
    case 'SET_ENCOUNTER':
      return {
        ...state,
        activeEncounter: action.encounter,
        isInCombat: action.encounter.phase === 'active',
      };

    case 'START_COMBAT':
      return {
        ...state,
        isInCombat: true,
      };

    case 'END_COMBAT':
      return {
        ...state,
        isInCombat: false,
        activeEncounter: null,
        selectedParticipantId: undefined,
        selectedTargetId: undefined,
      };

    case 'UPDATE_PARTICIPANT':
      if (!state.activeEncounter) return state;

      return {
        ...state,
        activeEncounter: {
          ...state.activeEncounter,
          participants: state.activeEncounter.participants.map((p) =>
            p.id === action.participantId ? { ...p, ...action.updates } : p,
          ),
        },
      };

    case 'ADD_PARTICIPANT': {
      if (!state.activeEncounter) return state;
      // Insert participant in initiative order
      const newParticipants = [...state.activeEncounter.participants, action.participant].sort(
        (a, b) =>
          b.initiative - a.initiative || (b.initiativeBonus ?? 0) - (a.initiativeBonus ?? 0),
      );
      return {
        ...state,
        activeEncounter: {
          ...state.activeEncounter,
          participants: newParticipants,
        },
      };
    }

    case 'REMOVE_PARTICIPANT':
      if (!state.activeEncounter) return state;

      return {
        ...state,
        activeEncounter: {
          ...state.activeEncounter,
          participants: state.activeEncounter.participants.filter(
            (p) => p.id !== action.participantId,
          ),
        },
      };

    case 'NEXT_TURN': {
      if (!state.activeEncounter) return state;
      const currentIndex = state.activeEncounter.participants.findIndex(
        (p) => p.id === state.activeEncounter?.currentTurnParticipantId,
      );
      let nextIndex = currentIndex + 1;
      let newRound = state.activeEncounter.currentRound;
      // If we've gone through all participants, start new round
      if (nextIndex >= state.activeEncounter.participants.length) {
        nextIndex = 0;
        newRound += 1;
      }
      // Incapacitated participants cannot take turns. Search at most one full cycle.
      let checked = 0;
      while (checked < state.activeEncounter.participants.length) {
        const participant = state.activeEncounter.participants[nextIndex];
        if (
          participant &&
          participant.currentHitPoints > 0 &&
          !participant.isDead &&
          !participant.isUnconscious
        )
          break;
        nextIndex = (nextIndex + 1) % state.activeEncounter.participants.length;
        if (nextIndex === 0) newRound += 1;
        checked += 1;
      }
      const nextParticipant =
        checked === state.activeEncounter.participants.length
          ? undefined
          : state.activeEncounter.participants[nextIndex];
      return {
        ...state,
        activeEncounter: {
          ...state.activeEncounter,
          currentRound: newRound,
          currentTurnParticipantId: nextParticipant?.id,
          roundsElapsed: newRound,
          // Reset actions for new turn
          participants: state.activeEncounter.participants.map((p) =>
            p.id === nextParticipant?.id
              ? {
                  ...p,
                  actionTaken: false,
                  bonusActionTaken: false,
                  reactionTaken: false,
                  movementUsed: 0,
                  reactionOpportunities: [],
                }
              : p,
          ),
        },
        // Clear global reaction opportunities at end of turn
        activeReactionOpportunities: [],
      };
    }

    case 'ADD_ACTION':
      if (!state.activeEncounter) return state;

      return {
        ...state,
        activeEncounter: {
          ...state.activeEncounter,
          actions: [...state.activeEncounter.actions, action.action],
        },
      };

    case 'SET_SELECTED_PARTICIPANT':
      return {
        ...state,
        selectedParticipantId: action.participantId,
      };

    case 'SET_SELECTED_TARGET':
      return {
        ...state,
        selectedTargetId: action.targetId,
      };

    case 'TOGGLE_INITIATIVE_TRACKER':
      return {
        ...state,
        showInitiativeTracker: !state.showInitiativeTracker,
      };

    case 'TOGGLE_COMBAT_LOG':
      return {
        ...state,
        showCombatLog: !state.showCombatLog,
      };

    case 'ADD_REACTION_OPPORTUNITY':
      return {
        ...state,
        activeReactionOpportunities: [...state.activeReactionOpportunities, action.opportunity],
      };

    case 'REMOVE_REACTION_OPPORTUNITY':
      return {
        ...state,
        activeReactionOpportunities: state.activeReactionOpportunities.filter(
          (opportunity) => opportunity.id !== action.opportunityId,
        ),
      };

    case 'CLEAR_REACTION_OPPORTUNITIES':
      return {
        ...state,
        activeReactionOpportunities: [],
      };

    case 'SET_PENDING_REACTION':
      return {
        ...state,
        pendingReactionResponse: {
          opportunityId: action.opportunityId,
          selectedReaction: action.selectedReaction,
        },
      };

    default:
      return state;
  }
}
