import type { CombatEncounter } from '@/types/combat';

import logger from '@/lib/logger';
import { userDataApi, type CombatPersistencePayload } from '@/services/user-data-api';

/**
 * Saves a legacy combat encounter through the authenticated server boundary.
 *
 * The feature flag remains the compatibility switch for deployments where the legacy combat
 * snapshot tables have not been provisioned yet. The browser never receives a Supabase table
 * client for this path; ownership and the four-table transaction live in server-bun.
 */
export const saveEncounterToDatabase = async (encounter: CombatEncounter): Promise<void> => {
  try {
    const env = (import.meta as unknown as { env: Record<string, string> }).env || {};
    const processEnv = typeof process !== 'undefined' ? process.env : {};
    const enableCombatDB = ['true', '1', 'yes', 'on'].includes(
      String(env.VITE_ENABLE_COMBAT_DB || processEnv.VITE_ENABLE_COMBAT_DB || '').toLowerCase(),
    );

    if (!enableCombatDB) return;

    const currentTurnOrder = encounter.participants.findIndex(
      (participant) => participant.id === encounter.currentTurnParticipantId,
    );

    const participants = encounter.participants.map((participant, turnOrder) => ({
      id: participant.id,
      characterId: participant.characterId || null,
      npcId: null,
      name: participant.name,
      participantType: participant.participantType,
      initiative: participant.initiative,
      initiativeModifier: participant.initiativeBonus || 0,
      turnOrder,
      isActive: participant.currentHitPoints > 0,
      armorClass: participant.armorClass,
      maxHp: participant.maxHitPoints,
      speed: participant.speed,
      damageResistances: participant.damageResistances || [],
      damageImmunities: participant.damageImmunities || [],
      damageVulnerabilities: participant.damageVulnerabilities || [],
    }));

    const statuses = encounter.participants.map((participant) => ({
      participantId: participant.id,
      currentHp: participant.currentHitPoints,
      maxHp: participant.maxHitPoints,
      tempHp: participant.temporaryHitPoints || 0,
      isConscious: participant.currentHitPoints > 0,
      deathSavesSuccesses: participant.deathSaves?.successes || 0,
      deathSavesFailures: participant.deathSaves?.failures || 0,
    }));

    const conditions = encounter.participants.flatMap((participant) =>
      participant.conditions.map((condition) => {
        const legacyCondition = condition as typeof condition & {
          remainingDuration?: number;
          source?: string;
        };
        const durationRounds =
          legacyCondition.remainingDuration ??
          (condition.duration >= 0 ? condition.duration : null);

        return {
          participantId: participant.id,
          conditionName: condition.name,
          durationRounds,
          source: legacyCondition.sourceSpell ?? legacyCondition.source ?? null,
        };
      }),
    );

    const payload: CombatPersistencePayload = {
      sessionId: encounter.sessionId,
      status:
        encounter.phase === 'active'
          ? 'active'
          : encounter.phase === 'conclusion'
            ? 'completed'
            : 'paused',
      currentRound: encounter.currentRound,
      currentTurnOrder: currentTurnOrder >= 0 ? currentTurnOrder : 0,
      location: encounter.location || null,
      startedAt: encounter.startTime.toISOString(),
      participants,
      statuses,
      conditions,
    };

    await userDataApi.saveCombatEncounter(encounter.id, payload);
  } catch (error) {
    logger.error('Error saving encounter to database:', error);
  }
};
