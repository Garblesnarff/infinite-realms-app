import type { CombatParticipant } from '@/types/combat';

/**
 * Checks if a participant needs to make a death saving throw.
 * A character needs to make death saves if they are at 0 HP and not yet stable or dead.
 * @param participant The combat participant to check.
 * @returns True if the participant needs to make a death save, false otherwise.
 */
export const needsDeathSaves = (participant: CombatParticipant): boolean => {
  return (participant.currentHitPoints ?? 0) <= 0 && !participant.isStable && !participant.isDead;
};
