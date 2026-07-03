/**
 * Participant add/remove/update and battle-map movement callbacks.
 */

import { useCallback } from 'react';

import { buildCharacterData } from './character-data';
import { createCombatParticipant } from './participant-factory';

import type { ReducerAction } from './combat-reducer';
import type { Character } from '@/types/character';
import type { CombatParticipant, CombatState, ReactionOpportunity } from '@/types/combat';

import { processMovementAction } from '@/utils/movementUtils';

type Dispatch = (action: ReducerAction) => void;

interface UseParticipantManagementArgs {
  state: CombatState;
  dispatch: Dispatch;
  character: Character | null;
  addReactionOpportunity: (opportunity: ReactionOpportunity) => void;
  addParticipantReactionOpportunity: (
    participantId: string,
    opportunity: ReactionOpportunity,
  ) => void;
}

interface UseParticipantManagementReturn {
  addParticipant: (participant: Partial<CombatParticipant>) => Promise<void>;
  removeParticipant: (participantId: string) => Promise<void>;
  updateParticipant: (participantId: string, updates: Partial<CombatParticipant>) => Promise<void>;
  moveParticipant: (
    participantId: string,
    fromPosition: string,
    toPosition: string,
  ) => Promise<void>;
}

export function useParticipantManagement({
  state,
  dispatch,
  character,
  addReactionOpportunity,
  addParticipantReactionOpportunity,
}: UseParticipantManagementArgs): UseParticipantManagementReturn {
  const addParticipant = useCallback(
    async (participant: Partial<CombatParticipant>) => {
      const characterData = buildCharacterData(character);

      const fullParticipant = createCombatParticipant(participant, {
        rollInitiative: !participant.initiative,
        characterData,
      });

      dispatch({ type: 'ADD_PARTICIPANT', participant: fullParticipant });
    },
    [character, dispatch],
  );

  const removeParticipant = useCallback(
    async (participantId: string) => {
      dispatch({ type: 'REMOVE_PARTICIPANT', participantId });
    },
    [dispatch],
  );

  const updateParticipant = useCallback(
    async (participantId: string, updates: Partial<CombatParticipant>) => {
      dispatch({ type: 'UPDATE_PARTICIPANT', participantId, updates });
    },
    [dispatch],
  );

  const moveParticipant = useCallback(
    async (participantId: string, fromPosition: string, toPosition: string) => {
      if (!state.activeEncounter) return;

      // Process movement action
      const opportunities = processMovementAction(
        participantId,
        fromPosition,
        toPosition,
        state.activeEncounter,
      );

      // Add reaction opportunities
      opportunities.forEach((opportunity) => {
        addReactionOpportunity(opportunity);
        addParticipantReactionOpportunity(opportunity.participantId, opportunity);
      });

      // Update participant position
      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates: { position: toPosition },
      });
    },
    [state.activeEncounter, addReactionOpportunity, addParticipantReactionOpportunity, dispatch],
  );

  return { addParticipant, removeParticipant, updateParticipant, moveParticipant };
}
