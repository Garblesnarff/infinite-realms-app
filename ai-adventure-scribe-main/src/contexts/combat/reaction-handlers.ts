/**
 * Reaction Handlers
 * Manages encounter-level and participant-level reaction opportunities.
 * Extracted from CombatContext.tsx for modularity.
 */

import type { ReducerAction } from './combat-reducer';
import type { CombatState, ReactionOpportunity, ActionType } from '@/types/combat';

type Dispatch = (action: ReducerAction) => void;

/**
 * Creates encounter-level reaction opportunity handlers.
 * These manage the global list of active reaction opportunities.
 */
export function createReactionHandlers(dispatch: Dispatch) {
  const addReactionOpportunity = (opportunity: ReactionOpportunity) => {
    dispatch({ type: 'ADD_REACTION_OPPORTUNITY', opportunity });
  };

  const removeReactionOpportunity = (opportunityId: string) => {
    dispatch({ type: 'REMOVE_REACTION_OPPORTUNITY', opportunityId });
  };

  const clearReactionOpportunities = () => {
    dispatch({ type: 'CLEAR_REACTION_OPPORTUNITIES' });
  };

  const setPendingReaction = (opportunityId: string, selectedReaction: ActionType) => {
    dispatch({ type: 'SET_PENDING_REACTION', opportunityId, selectedReaction });
  };

  return {
    addReactionOpportunity,
    removeReactionOpportunity,
    clearReactionOpportunities,
    setPendingReaction,
  };
}

/**
 * Creates participant-level reaction opportunity handlers.
 * These manage reaction opportunities on individual participants.
 */
export function createParticipantReactionHandlers(dispatch: Dispatch, getState: () => CombatState) {
  const addParticipantReactionOpportunity = (
    participantId: string,
    opportunity: ReactionOpportunity,
  ) => {
    const state = getState();
    dispatch({
      type: 'UPDATE_PARTICIPANT',
      participantId,
      updates: {
        reactionOpportunities: [
          ...(state.activeEncounter?.participants.find((p) => p.id === participantId)
            ?.reactionOpportunities || []),
          opportunity,
        ],
      },
    });
  };

  const removeParticipantReactionOpportunity = (participantId: string, opportunityId: string) => {
    const state = getState();
    dispatch({
      type: 'UPDATE_PARTICIPANT',
      participantId,
      updates: {
        reactionOpportunities: (
          state.activeEncounter?.participants.find((p) => p.id === participantId)
            ?.reactionOpportunities || []
        ).filter((opp) => opp.id !== opportunityId),
      },
    });
  };

  const clearParticipantReactionOpportunities = (participantId: string) => {
    dispatch({
      type: 'UPDATE_PARTICIPANT',
      participantId,
      updates: { reactionOpportunities: [] },
    });
  };

  return {
    addParticipantReactionOpportunity,
    removeParticipantReactionOpportunity,
    clearParticipantReactionOpportunities,
  };
}
