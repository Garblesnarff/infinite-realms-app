/**
 * Health and Condition Handlers
 *
 * Manages HP changes, conditions, and death saves for combat participants.
 * Extracted from CombatContext.tsx for modularity.
 */

import type { ReducerAction } from './combat-reducer';
import type { CombatState, DamageType } from '@/types/combat';

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

  return {
    dealDamage,
  };
}
