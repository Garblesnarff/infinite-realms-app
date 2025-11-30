/**
 * Combat Damage Integrator
 * Bridges dice roll results to HP tracking and database persistence
 */

import type { AutoRollResult } from '@/services/combat/npc-auto-roller';
import type { DamageType } from '@/types/combat';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export interface DamageApplication {
  participantId: string;
  encounterId: string;
  damageAmount: number;
  damageType: DamageType;
  sourceParticipantId?: string;
  sourceDescription?: string;
  roundNumber: number;
}

export interface HealingApplication {
  participantId: string;
  healingAmount: number;
  sourceDescription?: string;
}

export interface HPUpdateResult {
  success: boolean;
  participantId: string;
  previousHP: number;
  newHP: number;
  maxHP: number;
  tempHP: number;
  damageDealt?: number;
  healingApplied?: number;
  becameUnconscious?: boolean;
  becameConscious?: boolean;
  error?: string;
}

/**
 * Get current HP status for a combat participant
 */
export async function getParticipantStatus(participantId: string): Promise<{
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  is_conscious: boolean;
  damage_resistances: string[];
  damage_immunities: string[];
  damage_vulnerabilities: string[];
} | null> {
  try {
    // Get status from combat_participant_status
    const { data: status, error: statusError } = await supabase
      .from('combat_participant_status')
      .select('current_hp, max_hp, temp_hp, is_conscious')
      .eq('participant_id', participantId)
      .single();

    if (statusError) throw statusError;
    if (!status) return null;

    // Get damage modifiers from combat_participants
    const { data: participant, error: participantError } = await supabase
      .from('combat_participants')
      .select('damage_resistances, damage_immunities, damage_vulnerabilities')
      .eq('id', participantId)
      .single();

    if (participantError) throw participantError;
    if (!participant) return null;

    return {
      ...status,
      damage_resistances: participant.damage_resistances || [],
      damage_immunities: participant.damage_immunities || [],
      damage_vulnerabilities: participant.damage_vulnerabilities || [],
    };
  } catch (error) {
    logger.error('[DamageIntegrator] Failed to get participant status:', error);
    return null;
  }
}

/**
 * Calculate actual damage after resistances, immunities, and vulnerabilities
 */
export function calculateModifiedDamage(
  baseDamage: number,
  damageType: DamageType,
  resistances: string[],
  immunities: string[],
  vulnerabilities: string[]
): number {
  // Immunity = 0 damage
  if (immunities.includes(damageType)) {
    logger.info(`[DamageIntegrator] Damage type ${damageType} is immune - 0 damage`);
    return 0;
  }

  // Resistance = half damage (rounded down)
  if (resistances.includes(damageType)) {
    const reduced = Math.floor(baseDamage / 2);
    logger.info(`[DamageIntegrator] Damage type ${damageType} is resisted - ${baseDamage} → ${reduced}`);
    return reduced;
  }

  // Vulnerability = double damage
  if (vulnerabilities.includes(damageType)) {
    const doubled = baseDamage * 2;
    logger.info(`[DamageIntegrator] Damage type ${damageType} is vulnerable - ${baseDamage} → ${doubled}`);
    return doubled;
  }

  // Normal damage
  return baseDamage;
}

/**
 * Apply damage to a combat participant
 * Handles temp HP, resistances/vulnerabilities, consciousness, and logging
 */
export async function applyDamageFromRoll(
  damage: DamageApplication
): Promise<HPUpdateResult> {
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
    logger.info(`[DamageIntegrator] Applying ${damageAmount} ${damageType} damage to ${participantId}`);

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
      status.damage_vulnerabilities
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
    const { error: updateError } = await supabase
      .from('combat_participant_status')
      .update({
        current_hp: newHP,
        temp_hp: newTempHP,
        is_conscious: isConscious,
        updated_at: new Date().toISOString(),
      })
      .eq('participant_id', participantId);

    if (updateError) throw updateError;

    // Log damage to combat_damage_log
    const { error: logError } = await supabase.from('combat_damage_log').insert({
      encounter_id: encounterId,
      participant_id: participantId,
      damage_amount: modifiedDamage,
      damage_type: damageType,
      source_participant_id: sourceParticipantId,
      source_description: sourceDescription,
      round_number: roundNumber,
    });

    if (logError) {
      logger.error('[DamageIntegrator] Failed to log damage:', logError);
      // Don't fail the whole operation if logging fails
    }

    logger.info(
      `[DamageIntegrator] ✓ Damage applied: ${status.current_hp} → ${newHP} HP` +
        (becameUnconscious ? ' (UNCONSCIOUS)' : '')
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
 * Apply healing to a combat participant
 */
export async function applyHealingFromRoll(
  healing: HealingApplication
): Promise<HPUpdateResult> {
  const { participantId, healingAmount, sourceDescription } = healing;

  try {
    logger.info(`[DamageIntegrator] Applying ${healingAmount} healing to ${participantId}`);

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

    // Calculate new HP (capped at max)
    const newHP = Math.min(status.max_hp, status.current_hp + healingAmount);
    const actualHealing = newHP - status.current_hp;

    // Determine consciousness
    const wasConscious = status.is_conscious;
    const isConscious = newHP > 0;
    const becameConscious = !wasConscious && isConscious;

    // Reset death saves if healing brings back from 0 HP
    let deathSavesReset = false;
    if (!wasConscious && isConscious) {
      deathSavesReset = true;
    }

    // Update database
    const updateData: any = {
      current_hp: newHP,
      is_conscious: isConscious,
      updated_at: new Date().toISOString(),
    };

    if (deathSavesReset) {
      updateData.death_saves_successes = 0;
      updateData.death_saves_failures = 0;
    }

    const { error: updateError } = await supabase
      .from('combat_participant_status')
      .update(updateData)
      .eq('participant_id', participantId);

    if (updateError) throw updateError;

    logger.info(
      `[DamageIntegrator] ✓ Healing applied: ${status.current_hp} → ${newHP} HP` +
        (becameConscious ? ' (CONSCIOUS)' : '')
    );

    return {
      success: true,
      participantId,
      previousHP: status.current_hp,
      newHP,
      maxHP: status.max_hp,
      tempHP: status.temp_hp,
      healingApplied: actualHealing,
      becameConscious,
    };
  } catch (error) {
    logger.error('[DamageIntegrator] Failed to apply healing:', error);
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
  roundNumber: number
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
