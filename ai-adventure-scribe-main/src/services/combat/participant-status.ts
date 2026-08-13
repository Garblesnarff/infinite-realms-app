/**
 * Combat participant HP/consciousness status retrieval.
 */

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * Get current HP status for a combat participant
 * The server performs the ownership-scoped participant/status join.
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
    const status = await userDataApi.getCombatParticipantStatus(participantId);

    return {
      current_hp: status.current_hp,
      max_hp: status.max_hp,
      temp_hp: status.temp_hp,
      is_conscious: status.is_conscious,
      damage_resistances: status.damage_resistances,
      damage_immunities: status.damage_immunities,
      damage_vulnerabilities: status.damage_vulnerabilities,
    };
  } catch (error) {
    logger.error('[DamageIntegrator] Failed to get participant status:', error);
    return null;
  }
}
