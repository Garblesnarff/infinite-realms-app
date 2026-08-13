/**
 * Combat Damage Integrator
 * Bridges dice roll results to HP tracking and database persistence
 */

import { calculateModifiedDamage } from './damage-calculation';
import { getParticipantStatus } from './participant-status';

import type { DamageApplication, HPUpdateResult } from './damage-integrator-types';
import type { AutoRollResult } from '@/services/combat/npc-auto-roller';
import type { DamageType } from '@/types/combat';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

// Re-export for backward compatibility
export type {
  DamageApplication,
  HealingApplication,
  HPUpdateResult,
} from './damage-integrator-types';
export { calculateModifiedDamage } from './damage-calculation';
export { getParticipantStatus } from './participant-status';
export { applyHealingFromRoll } from './healing-applicator';

/**
 * Apply damage to a combat participant
 * Handles temp HP, resistances/vulnerabilities, consciousness, and logging
 */
export async function applyDamageFromRoll(damage: DamageApplication): Promise<HPUpdateResult> {
  const {
    participantId,
    encounterId,
    damageAmount,
    damageType,
    sourceParticipantId,
    sourceDescription,
    roundNumber,
  } = damage;

  try {
    logger.info(
      `[DamageIntegrator] Applying ${damageAmount} ${damageType} damage to ${participantId}`,
    );

    // Get current status
    const status = await getParticipantStatus(participantId);
    if (!status) {
      return {
        success: false,
        participantId,
        previousHP: 0,
        newHP: 0,
        maxHP: 0,
        tempHP: 0,
        error: 'Participant status not found',
      };
    }

    // Calculate modified damage
    const modifiedDamage = calculateModifiedDamage(
      damageAmount,
      damageType,
      status.damage_resistances,
      status.damage_immunities,
      status.damage_vulnerabilities,
    );

    if (modifiedDamage === 0) {
      logger.info('[DamageIntegrator] No damage dealt due to immunity');
      return {
        success: true,
        participantId,
        previousHP: status.current_hp,
        newHP: status.current_hp,
        maxHP: status.max_hp,
        tempHP: status.temp_hp,
        damageDealt: 0,
      };
    }

    // Apply damage to temp HP first, then real HP
    let remainingDamage = modifiedDamage;
    let newTempHP = status.temp_hp;
    let newHP = status.current_hp;

    if (newTempHP > 0) {
      if (remainingDamage >= newTempHP) {
        remainingDamage -= newTempHP;
        newTempHP = 0;
        logger.info(`[DamageIntegrator] Temp HP depleted, ${remainingDamage} damage remaining`);
      } else {
        newTempHP -= remainingDamage;
        remainingDamage = 0;
        logger.info(`[DamageIntegrator] Temp HP reduced to ${newTempHP}`);
      }
    }

    // Apply remaining damage to real HP
    if (remainingDamage > 0) {
      newHP = Math.max(0, newHP - remainingDamage);
      logger.info(`[DamageIntegrator] HP reduced from ${status.current_hp} to ${newHP}`);
    }

    // Determine consciousness
    const wasConscious = status.is_conscious;
    const isConscious = newHP > 0;
    const becameUnconscious = wasConscious && !isConscious;
    const becameConscious = !wasConscious && isConscious;

    // Update database
    await userDataApi.updateCombatParticipantStatus(participantId, {
      currentHp: newHP,
      tempHp: newTempHP,
      isConscious,
    });

    try {
      await userDataApi.logCombatDamage(encounterId, {
        participantId,
        damageAmount: modifiedDamage,
        damageType,
        sourceParticipantId: sourceParticipantId ?? null,
        sourceDescription: sourceDescription ?? null,
        roundNumber,
      });
    } catch (error) {
      logger.error('[DamageIntegrator] Failed to log damage:', error);
      // Don't fail the whole operation if logging fails.
    }

    logger.info(
      `[DamageIntegrator] ✓ Damage applied: ${status.current_hp} → ${newHP} HP` +
        (becameUnconscious ? ' (UNCONSCIOUS)' : ''),
    );

    return {
      success: true,
      participantId,
      previousHP: status.current_hp,
      newHP,
      maxHP: status.max_hp,
      tempHP: newTempHP,
      damageDealt: modifiedDamage,
      becameUnconscious,
      becameConscious,
    };
  } catch (error) {
    logger.error('[DamageIntegrator] Failed to apply damage:', error);
    return {
      success: false,
      participantId,
      previousHP: 0,
      newHP: 0,
      maxHP: 0,
      tempHP: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Apply damage from an auto-executed NPC damage roll
 * Extracts target and damage info from roll result
 */
export async function applyDamageFromAutoRoll(
  roll: AutoRollResult,
  encounterId: string,
  targetParticipantId: string,
  damageType: DamageType,
  roundNumber: number,
): Promise<HPUpdateResult> {
  const { request, result } = roll;

  return applyDamageFromRoll({
    participantId: targetParticipantId,
    encounterId,
    damageAmount: result.total,
    damageType,
    sourceParticipantId: undefined, // Could be enhanced to track NPC participant ID
    sourceDescription: `${request.actorName || 'Enemy'} - ${request.purpose}`,
    roundNumber,
  });
}
