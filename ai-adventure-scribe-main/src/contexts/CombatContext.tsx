/**
 * Combat Context Provider
 *
 * Manages D&D 5e combat state in a tabletop-focused way.
 * Handles initiative order, turn management, HP tracking, and conditions
 * as they would be managed at a physical D&D table.
 */

import React, { createContext, useContext, useReducer, useCallback, useMemo, useRef } from 'react';

import { useCharacter } from './CharacterContext';
import {
  handleSpellCast,
  handleDivineSmite,
  handleRageActivation,
  handleRageDeactivation,
  handleShortRest,
  handleLongRest,
  handleHideAction,
} from './combat/action-handlers';
import { buildCharacterData } from './combat/character-data';
import { combatReducer, initialCombatState } from './combat/combat-reducer';
import { createCombatParticipant, sortByInitiative } from './combat/participant-factory';
import { saveEncounterToDatabase as saveToDb } from './combat/persistence';
import {
  createReactionHandlers,
  createParticipantReactionHandlers,
} from './combat/reaction-handlers';
import { createWeaponHandlers } from './combat/weapon-handlers';

import type { ActionHandlerResult } from './combat/action-handlers';
import type {
  CombatEncounter,
  CombatParticipant,
  CombatAction as CombatActionType,
  Condition,
  ConditionName,
  CombatContextValue,
  DamageType,
} from '@/types/combat';

import { applyConditionEffects, removeConditionEffects } from '@/utils/conditionEffects';
import { rollDie } from '@/utils/diceRolls';
import { calculateDamage } from '@/utils/diceUtils';
import { processMovementAction } from '@/utils/movementUtils';
import { checkReactionTriggers } from '@/utils/reactionTriggers';
import { checkConcentration } from '@/utils/spell-management';

// ===========================
// Action Dispatch Table
// ===========================

type ActionDispatchEntry = (
  action: Partial<CombatActionType>,
  participant: CombatParticipant,
) => ActionHandlerResult | undefined;

const actionDispatchTable: Record<string, ActionDispatchEntry> = {
  cast_spell: (action, participant) =>
    participant.participantType === 'player' ? handleSpellCast(action, participant) : undefined,
  divine_smite: (action, participant) => handleDivineSmite(action, participant),
  use_class_feature: (action, participant) =>
    action.featureUsed === 'rage' ? handleRageActivation(action, participant) : undefined,
  end_rage: (_action, participant) => handleRageDeactivation(participant),
  short_rest: (_action, participant) => handleShortRest(participant, 1),
  long_rest: (_action, participant) => handleLongRest(participant),
  hide: (_action, participant) => handleHideAction(participant),
};

// ===========================
// Context Creation
// ===========================

const CombatContext = createContext<CombatContextValue | undefined>(undefined);

export const useCombat = (): CombatContextValue => {
  const context = useContext(CombatContext);
  if (!context) {
    throw new Error('useCombat must be used within a CombatProvider');
  }
  return context;
};

// ===========================
// Provider Component
// ===========================

interface CombatProviderProps {
  children: React.ReactNode;
  sessionId?: string;
}

export const CombatProvider: React.FC<CombatProviderProps> = ({
  children,
  sessionId: _sessionId,
}) => {
  const [state, dispatch] = useReducer(combatReducer, initialCombatState);
  const { state: characterState } = useCharacter();

  // Ref to provide current state to extracted handlers without stale closures
  const stateRef = useRef(state);
  stateRef.current = state;

  // ===========================
  // Extracted Handlers (stable references - dispatch never changes)
  // ===========================

  const {
    addReactionOpportunity,
    removeReactionOpportunity,
    clearReactionOpportunities,
    setPendingReaction,
  } = useMemo(() => createReactionHandlers(dispatch), []);

  const {
    addParticipantReactionOpportunity,
    removeParticipantReactionOpportunity,
    clearParticipantReactionOpportunities,
  } = useMemo(() => createParticipantReactionHandlers(dispatch, () => stateRef.current), []);

  const { equipMainHandWeapon, equipOffHandWeapon, unequipMainHandWeapon, unequipOffHandWeapon } =
    useMemo(() => createWeaponHandlers(dispatch), []);

  // ===========================
  // Database Operations
  // ===========================

  const saveEncounterToDatabase = useCallback(async (encounter: CombatEncounter) => {
    await saveToDb(encounter);
  }, []);

  // ===========================
  // Combat Management
  // ===========================

  const startCombat = useCallback(
    async (sessionId: string, initialParticipants: Partial<CombatParticipant>[]) => {
      const encounterId = crypto.randomUUID();
      const characterData = buildCharacterData(characterState.character);

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
        location: 'Combat Location', // Will be enhanced later
        environmentalEffects: [],
        visibility: 'clear',
      };

      dispatch({ type: 'SET_ENCOUNTER', encounter });
      dispatch({ type: 'START_COMBAT' });

      await saveEncounterToDatabase(encounter);
    },
    [saveEncounterToDatabase, characterState.character],
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
  }, [state.activeEncounter, saveEncounterToDatabase]);

  // ===========================
  // Turn Management
  // ===========================

  const nextTurn = useCallback(async () => {
    dispatch({ type: 'NEXT_TURN' });

    if (state.activeEncounter) {
      await saveEncounterToDatabase(state.activeEncounter);
    }
  }, [state.activeEncounter, saveEncounterToDatabase]);

  const rollInitiative = useCallback(
    async (participantId: string): Promise<number> => {
      const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
      if (!participant) return 0;

      const initiative = rollDie(20) + (participant.initiative || 0);

      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates: { initiative },
      });

      return initiative;
    },
    [state.activeEncounter],
  );

  // ===========================
  // Actions & Damage
  // ===========================

  const takeAction = useCallback(
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
      const handlerResult = handler?.(action, participant);

      // Apply handler result if present
      if (handlerResult) {
        // For cast_spell, merge all action updates into fullAction
        if (action.actionType === 'cast_spell' && handlerResult.actionUpdates) {
          fullAction = { ...fullAction, ...handlerResult.actionUpdates };
        }

        dispatch({
          type: 'UPDATE_PARTICIPANT',
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

      // Apply damage if any
      if (action.damageDealt && action.targetParticipantId) {
        await dealDamage(action.targetParticipantId, action.damageDealt, action.damageType);
      }
    },
    [state.activeEncounter, addReactionOpportunity, addParticipantReactionOpportunity],
  );

  const dealDamage = useCallback(
    async (participantId: string, damage: number, damageType?: DamageType) => {
      const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
      if (!participant) return;

      // Calculate damage with resistances, immunities, and vulnerabilities
      let actualDamage = damage;
      if (damageType) {
        actualDamage = calculateDamage(
          damage,
          damageType,
          participant.damageResistances || [],
          participant.damageImmunities || [],
          participant.damageVulnerabilities || [],
        );
      }

      // Apply temporary HP first
      const tempHPDamage = Math.min(participant.temporaryHitPoints, actualDamage);
      actualDamage -= tempHPDamage;

      const newTempHP = participant.temporaryHitPoints - tempHPDamage;
      const newCurrentHP = Math.max(0, participant.currentHitPoints - actualDamage);

      // Check concentration if participant is concentrating
      const concentrationMaintained = checkConcentration(participant, damage);
      let concentrationUpdate = {};
      if (!concentrationMaintained) {
        concentrationUpdate = { activeConcentration: null };
      }

      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates: {
          currentHitPoints: newCurrentHP,
          temporaryHitPoints: newTempHP,
          ...concentrationUpdate,
        },
      });
    },
    [state.activeEncounter],
  );

  const healDamage = useCallback(
    async (participantId: string, healing: number) => {
      const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
      if (!participant) return;

      const newCurrentHP = Math.min(
        participant.maxHitPoints,
        participant.currentHitPoints + healing,
      );

      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates: { currentHitPoints: newCurrentHP },
      });
    },
    [state.activeEncounter],
  );

  // ===========================
  // Conditions
  // ===========================

  const applyCondition = useCallback(
    async (participantId: string, condition: Condition) => {
      const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
      if (!participant) return;

      // Apply condition effects using the centralized conditionEffects utility
      const updatedParticipant = applyConditionEffects(participant, condition);

      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates: {
          conditions: updatedParticipant.conditions,
          // Include any additional effects (like speed changes)
          speed:
            updatedParticipant.speed !== participant.speed ? updatedParticipant.speed : undefined,
          movementUsed:
            updatedParticipant.movementUsed !== participant.movementUsed
              ? updatedParticipant.movementUsed
              : undefined,
        },
      });
    },
    [state.activeEncounter],
  );

  const removeCondition = useCallback(
    async (participantId: string, conditionName: ConditionName) => {
      const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
      if (!participant) return;

      // Find the condition to remove for proper effect removal
      const conditionToRemove = participant.conditions.find((c) => c.name === conditionName);
      if (!conditionToRemove) return;

      // Remove condition effects using the centralized conditionEffects utility
      const updatedParticipant = removeConditionEffects(participant, conditionToRemove);

      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates: {
          conditions: updatedParticipant.conditions,
          // Restore any modified stats (like speed)
          speed:
            updatedParticipant.speed !== participant.speed ? updatedParticipant.speed : undefined,
          movementUsed:
            updatedParticipant.movementUsed !== participant.movementUsed
              ? updatedParticipant.movementUsed
              : undefined,
        },
      });
    },
    [state.activeEncounter],
  );

  // ===========================
  // Death Saves
  // ===========================

  const rollDeathSave = useCallback(
    async (participantId: string): Promise<'success' | 'failure' | 'critical'> => {
      const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
      if (!participant || participant.currentHitPoints > 0) return 'success';

      const roll = rollDie(20);
      let result: 'success' | 'failure' | 'critical';
      let updates: Partial<CombatParticipant> = {};

      if (roll === 20) {
        // Critical success - regain 1 HP
        result = 'critical';
        updates = {
          currentHitPoints: 1,
          deathSaves: { successes: 0, failures: 0 },
        };
      } else if (roll === 1) {
        // Critical failure - two failures
        result = 'failure';
        updates = {
          deathSaves: {
            successes: participant.deathSaves.successes,
            failures: Math.min(3, participant.deathSaves.failures + 2),
          },
        };
      } else if (roll >= 10) {
        // Success
        result = 'success';
        updates = {
          deathSaves: {
            successes: participant.deathSaves.successes + 1,
            failures: participant.deathSaves.failures,
          },
        };
      } else {
        // Failure
        result = 'failure';
        updates = {
          deathSaves: {
            successes: participant.deathSaves.successes,
            failures: participant.deathSaves.failures + 1,
          },
        };
      }

      dispatch({
        type: 'UPDATE_PARTICIPANT',
        participantId,
        updates,
      });

      return result;
    },
    [state.activeEncounter],
  );

  // ===========================
  // Participant Management
  // ===========================

  const addParticipant = useCallback(
    async (participant: Partial<CombatParticipant>) => {
      const characterData = buildCharacterData(characterState.character);

      const fullParticipant = createCombatParticipant(participant, {
        rollInitiative: !participant.initiative,
        characterData,
      });

      dispatch({ type: 'ADD_PARTICIPANT', participant: fullParticipant });
    },
    [characterState.character],
  );

  const removeParticipant = useCallback(async (participantId: string) => {
    dispatch({ type: 'REMOVE_PARTICIPANT', participantId });
  }, []);

  const updateParticipant = useCallback(
    async (participantId: string, updates: Partial<CombatParticipant>) => {
      dispatch({ type: 'UPDATE_PARTICIPANT', participantId, updates });
    },
    [],
  );

  // ===========================
  // Movement Actions
  // ===========================

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
    [state.activeEncounter, addReactionOpportunity, addParticipantReactionOpportunity],
  );

  // ===========================
  // Context Value
  // ===========================

  // Stabilize context value to prevent unnecessary re-renders of consumers.
  const contextValue: CombatContextValue = useMemo(
    () => ({
      state,
      startCombat,
      endCombat,
      nextTurn,
      rollInitiative,
      takeAction,
      dealDamage,
      healDamage,
      applyCondition,
      removeCondition,
      rollDeathSave,
      addParticipant,
      removeParticipant,
      updateParticipant,
      // Reaction management
      addReactionOpportunity,
      removeReactionOpportunity,
      clearReactionOpportunities,
      setPendingReaction,
      // Participant reaction opportunities
      addParticipantReactionOpportunity,
      removeParticipantReactionOpportunity,
      clearParticipantReactionOpportunities,
      // Movement actions
      moveParticipant,
      // Weapon management
      equipMainHandWeapon,
      equipOffHandWeapon,
      unequipMainHandWeapon,
      unequipOffHandWeapon,
    }),
    [
      state,
      startCombat,
      endCombat,
      nextTurn,
      rollInitiative,
      takeAction,
      dealDamage,
      healDamage,
      applyCondition,
      removeCondition,
      rollDeathSave,
      addParticipant,
      removeParticipant,
      updateParticipant,
      addReactionOpportunity,
      removeReactionOpportunity,
      clearReactionOpportunities,
      setPendingReaction,
      addParticipantReactionOpportunity,
      removeParticipantReactionOpportunity,
      clearParticipantReactionOpportunities,
      moveParticipant,
      equipMainHandWeapon,
      equipOffHandWeapon,
      unequipMainHandWeapon,
      unequipOffHandWeapon,
    ],
  );

  return <CombatContext.Provider value={contextValue}>{children}</CombatContext.Provider>;
};
