/**
 * The takeAction orchestrator: builds the full CombatAction record,
 * routes it through the action dispatch table, records it, checks
 * reaction triggers, and applies any resulting damage.
 */

import { useCallback } from 'react';

import { actionDispatchTable } from './action-dispatch-table';

import type { ReducerAction } from './combat-reducer';
import type {
  CombatAction as CombatActionType,
  CombatState,
  ReactionOpportunity,
} from '@/types/combat';

import { checkReactionTriggers } from '@/utils/reactionTriggers';

type Dispatch = (action: ReducerAction) => void;

interface UseTakeActionArgs {
  state: CombatState;
  dispatch: Dispatch;
  addReactionOpportunity: (opportunity: ReactionOpportunity) => void;
  addParticipantReactionOpportunity: (
    participantId: string,
    opportunity: ReactionOpportunity,
  ) => void;
}

export function useTakeAction({
  state,
  dispatch,
  addReactionOpportunity,
  addParticipantReactionOpportunity,
}: UseTakeActionArgs): (action: Partial<CombatActionType>) => Promise<void> {
  return useCallback(
    async (action: Partial<CombatActionType>) => {
      if (!state.activeEncounter) return;

      let fullAction: CombatActionType = {
        id: crypto.randomUUID(),
        encounterId: state.activeEncounter.id,
        participantId: action.participantId || '',
        targetParticipantId: action.targetParticipantId,
        round: state.activeEncounter.currentRound,
        turnOrder:
          state.activeEncounter.participants.findIndex((p) => p.id === action.participantId) + 1,
        actionType: action.actionType || 'attack',
        description: action.description || 'Unknown action',
        attackRoll: action.attackRoll,
        damageRolls: action.damageRolls,
        savingThrows: action.savingThrows,
        hit: action.hit,
        damageDealt: action.damageDealt,
        damageType: action.damageType,
        conditionsApplied: action.conditionsApplied,
        dmNarration: action.dmNarration,
        timestamp: new Date(),
      };

      const participant = state.activeEncounter.participants.find(
        (p) => p.id === action.participantId,
      );
      if (!participant) return;

      // Handle action based on type using dispatch table
      const handler = action.actionType ? actionDispatchTable[action.actionType] : undefined;
      const handlerResult = await handler?.(action, participant);

      // Apply handler result if present
      if (handlerResult) {
        // For cast_spell, merge all action updates into fullAction
        if (action.actionType === 'cast_spell' && handlerResult.actionUpdates) {
          fullAction = { ...fullAction, ...handlerResult.actionUpdates };
        }

        dispatch({
          type: 'UPDATE_PARTICIPANT',
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- pre-existing; participant lookup above guarantees the id
          participantId: action.participantId!,
          updates: handlerResult.participantUpdates,
        });
        if (handlerResult.actionUpdates.description) {
          fullAction.description = handlerResult.actionUpdates.description;
        }
        if (handlerResult.actionUpdates.attackRoll) {
          fullAction.attackRoll = handlerResult.actionUpdates.attackRoll;
        }
      } else if (action.participantId) {
        // Default: mark participant as having taken action
        dispatch({
          type: 'UPDATE_PARTICIPANT',
          participantId: action.participantId,
          updates: { actionTaken: true },
        });
      }

      dispatch({ type: 'ADD_ACTION', action: fullAction });

      // Check for reaction triggers
      if (state.activeEncounter) {
        const reactionOpportunities = checkReactionTriggers(fullAction, state.activeEncounter);
        reactionOpportunities.forEach((opportunity) => {
          addReactionOpportunity(opportunity);
          addParticipantReactionOpportunity(opportunity.participantId, opportunity);
        });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispatch is stable and intentionally omitted
    [state.activeEncounter, addReactionOpportunity, addParticipantReactionOpportunity],
  );
}
