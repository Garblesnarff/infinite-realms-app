/**
 * Health and Condition Handlers
 *
 * Manages HP changes, conditions, and death saves for combat participants.
 * Extracted from CombatContext.tsx for modularity.
 */

import type { ReducerAction } from './combat-reducer';
import type { CombatState, DamageType, Condition, ConditionName } from '@/types/combat';

import { rollDeathSave as resolveDeathSave } from '@/utils/combat/deathSaves';
import { applyConditionEffects, removeConditionEffects } from '@/utils/conditionEffects';
import { calculateDamage } from '@/utils/diceUtils';
import { checkConcentration } from '@/utils/spell-management';

type Dispatch = (action: ReducerAction) => void;

/**
 * Creates handlers for managing participant health and conditions.
 */
export function createHealthHandlers(dispatch: Dispatch, getState: () => CombatState) {
  const dealDamage = async (participantId: string, damage: number, damageType?: DamageType) => {
    const state = getState();
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
    const concentrationMaintained = checkConcentration(participant, actualDamage);
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
  };

  const healDamage = async (participantId: string, healing: number) => {
    const state = getState();
    const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
    if (!participant) return;

    const newCurrentHP = Math.min(participant.maxHitPoints, participant.currentHitPoints + healing);

    dispatch({
      type: 'UPDATE_PARTICIPANT',
      participantId,
      updates: { currentHitPoints: newCurrentHP },
    });
  };

  const applyCondition = async (participantId: string, condition: Condition) => {
    const state = getState();
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
  };

  const removeCondition = async (participantId: string, conditionName: ConditionName) => {
    const state = getState();
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
  };

  const rollDeathSave = async (
    participantId: string,
  ): Promise<'success' | 'failure' | 'critical'> => {
    const state = getState();
    const participant = state.activeEncounter?.participants.find((p) => p.id === participantId);
    if (!participant || participant.currentHitPoints > 0) return 'success';

    const { updatedParticipant, roll } = resolveDeathSave(participant);
    const result: 'success' | 'failure' | 'critical' =
      roll === 20 ? 'critical' : roll >= 10 ? 'success' : 'failure';

    dispatch({
      type: 'UPDATE_PARTICIPANT',
      participantId,
      updates: updatedParticipant,
    });

    return result;
  };

  return {
    dealDamage,
    healDamage,
    applyCondition,
    removeCondition,
    rollDeathSave,
  };
}
