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
    const processEnv = typeof process !== 'undefined' ? process.env : {};
    // Bolt: Support both Vite's import.meta.env and Node/test process.env safely in both browser and test runner environments.
    const enableCombatDB = ['true', '1', 'yes', 'on'].includes(
      String(env.VITE_ENABLE_COMBAT_DB || processEnv.VITE_ENABLE_COMBAT_DB || '').toLowerCase(),
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

    // ⚡ Bolt: Batched database insertions to prevent sequential N+1 network requests.
    // Instead of sequentially executing individual upsert queries for each participant
    // and condition in a loop, we collect all entries into separate arrays and upsert
    // them in a single batch request per table. This reduces maximum network round-trips from O(N) to O(1).
    const participantsData = [];
    const statusData = [];
    const conditionsData = [];

    for (let i = 0; i < encounter.participants.length; i++) {
      const participant = encounter.participants[i];

      // Prepare participant data
      participantsData.push({
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

      // Prepare status data
      statusData.push({
        participant_id: participant.id,
        current_hp: participant.currentHitPoints,
        max_hp: participant.maxHitPoints,
        temp_hp: participant.temporaryHitPoints || 0,
        is_conscious: participant.currentHitPoints > 0,
        death_saves_successes: participant.deathSaves?.successes || 0,
        death_saves_failures: participant.deathSaves?.failures || 0,
        updated_at: new Date().toISOString(),
      });

      // Prepare conditions data if any
      if (participant.conditions && participant.conditions.length > 0) {
        for (const condition of participant.conditions) {
          conditionsData.push({
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

    // ⚡ Bolt: Fire all batch updates concurrently to minimize total waiting time.
    const upsertPromises = [];

    if (participantsData.length > 0) {
      upsertPromises.push(supabase.from('combat_participants').upsert(participantsData));
    }
    if (statusData.length > 0) {
      upsertPromises.push(supabase.from('combat_participant_status').upsert(statusData));
    }
    if (conditionsData.length > 0) {
      upsertPromises.push(supabase.from('combat_participant_conditions').upsert(conditionsData));
    }

    if (upsertPromises.length > 0) {
      await Promise.all(upsertPromises);
    }
  } catch (error) {
    logger.error('Error saving encounter to database:', error);
  }
};
