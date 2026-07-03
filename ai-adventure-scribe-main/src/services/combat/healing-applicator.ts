/**
 * Applies healing rolls to combat participants and persists HP changes.
 */

import { getParticipantStatus } from './participant-status';

import type { HealingApplication, HPUpdateResult } from './damage-integrator-types';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

/**
 * Apply healing to a combat participant
 */
export async function applyHealingFromRoll(healing: HealingApplication): Promise<HPUpdateResult> {
  const { participantId, healingAmount } = healing;

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
    const updateData: {
      current_hp: number;
      is_conscious: boolean;
      updated_at: string;
      death_saves_successes?: number;
      death_saves_failures?: number;
    } = {
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
        (becameConscious ? ' (CONSCIOUS)' : ''),
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
