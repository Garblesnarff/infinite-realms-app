/**
 * Combat participant HP/consciousness status retrieval.
 */

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

/**
 * Get current HP status for a combat participant
 * ⚡ Bolt: Consolidated two sequential queries into a single joined query
 * to reduce network round-trips during combat HP status retrieval.
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
    // ⚡ Bolt: Use a single joined query to fetch both participant info and status
    const { data: participant, error } = await supabase
      .from('combat_participants')
      .select(
        `
        damage_resistances,
        damage_immunities,
        damage_vulnerabilities,
        combat_participant_status!inner(
          current_hp,
          max_hp,
          temp_hp,
          is_conscious
        )
      `,
      )
      .eq('id', participantId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }

    if (!participant || !participant.combat_participant_status) return null;

    // PostgREST returns inner joined single relations as objects
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pre-existing; PostgREST joined-relation typing gap
    const status = participant.combat_participant_status as any;

    return {
      current_hp: status.current_hp,
      max_hp: status.max_hp,
      temp_hp: status.temp_hp,
      is_conscious: status.is_conscious,
      damage_resistances: participant.damage_resistances || [],
      damage_immunities: participant.damage_immunities || [],
      damage_vulnerabilities: participant.damage_vulnerabilities || [],
    };
  } catch (error) {
    logger.error('[DamageIntegrator] Failed to get participant status:', error);
    return null;
  }
}
