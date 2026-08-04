/**
 * Sneak Attack Logic and Utilities
 *
 * Handles the calculation logic for Rogue sneak attack features.
 * Extracted from classMechanics.ts
 */

import type {
  CombatParticipant,
  CombatEncounter,
} from '@/types/combat';

/**
 * Check if a participant is incapacitated
 */
export function isIncapacitated(participant: CombatParticipant): boolean {
  const incapacitatingConditions = [
    'stunned',
    'paralyzed',
    'unconscious',
    'petrified',
    'incapacitated',
  ];
  return participant.conditions.some((c) => incapacitatingConditions.includes(c.name));
}

/**
 * Check if sneak attack conditions are met
 * Sneak attack can be used once per turn when you have advantage on the attack roll
 * or when another enemy is within 5 feet of the target and isn't incapacitated
 */
export function canUseSneakAttack(
  attacker: CombatParticipant,
  target: CombatParticipant,
  encounter: CombatEncounter,
): boolean {
  // Check if attacker is a rogue with sneak attack feature
  if (
    attacker.characterClass !== 'rogue' ||
    !attacker.classFeatures?.some((f) => f.name === 'sneak_attack')
  ) {
    return false;
  }

  // Sneak attack cannot be used if you have disadvantage
  const hasDisadvantage = attacker.conditions.some((c) =>
    ['blinded', 'poisoned', 'restrained'].includes(c.name),
  );
  if (hasDisadvantage) {
    return false;
  }

  // Check for advantage
  const hasAdvantage =
    attacker.conditions.some((c) => c.name === 'invisible') ||
    target.conditions.some((c) =>
      ['blinded', 'paralyzed', 'stunned', 'unconscious', 'prone'].includes(c.name),
    );

  if (hasAdvantage) {
    return true;
  }

  // Check if target is within 5 feet of another enemy of the target
  // (not including the attacker or incapacitated allies)
  const nearbyEnemies = encounter.participants.filter(
    (p) =>
      p.id !== attacker.id &&
      p.id !== target.id &&
      p.participantType !== target.participantType &&
      p.currentHitPoints > 0 &&
      !isIncapacitated(p),
  );

  const hasNearbyAlly = nearbyEnemies.length > 0;

  return hasNearbyAlly;
}

/**
 * Calculate Rogue sneak attack dice
 */
export function getSneakAttackDice(level: number): number {
  return Math.ceil(level / 2);
}
