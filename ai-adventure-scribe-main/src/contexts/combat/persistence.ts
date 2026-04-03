import type { CombatEncounter } from '@/types/combat';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

/**
 * Saves a combat encounter and its participants' status to the database.
 *
 * @param encounter The combat encounter to save
 */
export const saveEncounterToDatabase = async (encounter: CombatEncounter): Promise<void> => {
  try {
    const env = (import.meta as unknown as { env: Record<string, string> }).env || {};
    const enableCombatDB = ['true', '1', 'yes', 'on'].includes(
      String(env.VITE_ENABLE_COMBAT_DB || '').toLowerCase(),
    );

    if (!enableCombatDB) {
      return; // Skip persistence when feature not enabled to avoid 400 errors on missing tables
    }

    // Find current turn order index
    const currentTurnOrder = encounter.participants.findIndex(
      (p) => p.id === encounter.currentTurnParticipantId,
    );

    // Save combat encounter (matches actual schema)
    await supabase.from('combat_encounters').upsert({
      id: encounter.id,
      session_id: encounter.sessionId,
      status: encounter.phase,
      current_round: encounter.currentRound,
      current_turn_order: currentTurnOrder >= 0 ? currentTurnOrder : 0,
      location: encounter.location || null,
      started_at: encounter.startTime.toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Save participants and their status
    for (let i = 0; i < encounter.participants.length; i++) {
      const participant = encounter.participants[i];

      // Save participant (static combat data)
      await supabase.from('combat_participants').upsert({
        id: participant.id,
        encounter_id: encounter.id,
        character_id: participant.characterId || null,
        npc_id: null, // Could be enhanced to support NPC references
        name: participant.name,
        participant_type: participant.participantType,
        initiative: participant.initiative,
        initiative_modifier: participant.initiativeBonus || 0,
        turn_order: i,
        is_active: participant.currentHitPoints > 0,
        armor_class: participant.armorClass,
        max_hp: participant.maxHitPoints,
        speed: 30, // Default speed
        damage_resistances: [],
        damage_immunities: [],
        damage_vulnerabilities: [],
        updated_at: new Date().toISOString(),
      });

      // Save participant status (HP, temp HP, death saves)
      await supabase.from('combat_participant_status').upsert({
        participant_id: participant.id,
        current_hp: participant.currentHitPoints,
        max_hp: participant.maxHitPoints,
        temp_hp: participant.temporaryHitPoints || 0,
        is_conscious: participant.currentHitPoints > 0,
        death_saves_successes: participant.deathSaves?.successes || 0,
        death_saves_failures: participant.deathSaves?.failures || 0,
        updated_at: new Date().toISOString(),
      });

      // Save conditions if any
      if (participant.conditions && participant.conditions.length > 0) {
        for (const condition of participant.conditions) {
          await supabase.from('combat_participant_conditions').upsert({
            participant_id: participant.id,
            condition_name: condition.name,
            source: condition.source || 'unknown',
            duration_rounds: condition.remainingDuration || null,
            save_dc: null,
            save_type: null,
            is_active: true,
            applied_at: new Date().toISOString(),
          });
        }
      }
    }
  } catch (error) {
    logger.error('Error saving encounter to database:', error);
  }
};
