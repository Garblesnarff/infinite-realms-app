/**
 * Combat lifecycle callbacks: starting/ending encounters, turn advance,
 * initiative rolls, and encounter persistence.
 */

import { useCallback } from 'react';

import { buildCharacterData } from './character-data';
import { createCombatParticipant, sortByInitiative } from './participant-factory';
import { saveEncounterToDatabase as saveToDb } from './persistence';

import type { ReducerAction } from './combat-reducer';
import type { Character } from '@/types/character';
import type { CombatEncounter, CombatParticipant, CombatState } from '@/types/combat';

import { rollDie } from '@/utils/diceRolls';

type Dispatch = (action: ReducerAction) => void;

interface UseCombatLifecycleArgs {
  state: CombatState;
  dispatch: Dispatch;
  character: Character | null;
}

interface UseCombatLifecycleReturn {
  startCombat: (
    sessionId: string,
    initialParticipants: Partial<CombatParticipant>[],
  ) => Promise<void>;
  endCombat: () => Promise<void>;
  nextTurn: () => Promise<void>;
  rollInitiative: (participantId: string) => Promise<number>;
}

export function useCombatLifecycle({
  state,
  dispatch,
  character,
}: UseCombatLifecycleArgs): UseCombatLifecycleReturn {
  const saveEncounterToDatabase = useCallback(async (encounter: CombatEncounter) => {
    await saveToDb(encounter);
  }, []);

  const startCombat = useCallback(
    async (sessionId: string, initialParticipants: Partial<CombatParticipant>[]) => {
      const encounterId = crypto.randomUUID();
      const characterData = buildCharacterData(character);

      // Create participants using the factory function
      const participantsWithInitiative = initialParticipants.map((p) =>
        createCombatParticipant(p, { rollInitiative: true, characterData }),
      );

      // Sort by initiative (highest first)
      const sortedParticipants = sortByInitiative(participantsWithInitiative);

      const encounter: CombatEncounter = {
        id: encounterId,
        sessionId,
        phase: 'active',
        currentRound: 1,
        currentTurnParticipantId: sortedParticipants[0]?.id,
        participants: sortedParticipants,
        actions: [],
        roundsElapsed: 1,
        startTime: new Date(),
        // Client-side encounter: the server has not been told about this one, so the
        // authoritative sync leaves it alone instead of ending it as phantom combat.
        origin: 'local',
        location: 'Combat Location', // Will be enhanced later
        environmentalEffects: [],
        visibility: 'clear',
      };

      dispatch({ type: 'SET_ENCOUNTER', encounter });
      dispatch({ type: 'START_COMBAT' });

      await saveEncounterToDatabase(encounter);
    },
    [saveEncounterToDatabase, character, dispatch],
  );

  const endCombat = useCallback(async () => {
    if (state.activeEncounter) {
      const updatedEncounter = {
        ...state.activeEncounter,
        phase: 'conclusion' as const,
        endTime: new Date(),
      };

      await saveEncounterToDatabase(updatedEncounter);
    }

    dispatch({ type: 'END_COMBAT' });
  }, [state.activeEncounter, saveEncounterToDatabase, dispatch]);

  const nextTurn = useCallback(async () => {
    dispatch({ type: 'NEXT_TURN' });

    if (state.activeEncounter) {
      await saveEncounterToDatabase(state.activeEncounter);
    }
  }, [state.activeEncounter, saveEncounterToDatabase, dispatch]);

  const rollInitiative = useCallback(
    async (participantId: string): Promise<number> => {
      const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
      if (!participant) return 0;

      const initiative = rollDie(20) + (participant.initiativeBonus || 0);

      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates: { initiative },
      });

      return initiative;
    },
    [state.activeEncounter, dispatch],
  );

  return { startCombat, endCombat, nextTurn, rollInitiative };
}
