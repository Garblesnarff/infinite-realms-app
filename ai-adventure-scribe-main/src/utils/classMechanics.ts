/**
 * Class Mechanics Logic
 *
 * Handles the calculation logic for specific D&D 5e class features.
 * Extracted from classFeatures.ts
 */

import type {
  CombatParticipant,
  CombatEncounter,
  CharacterResources,
} from '@/types/combat';

/**
 * Calculate Barbarian rage damage bonus
 */
export function getRageDamageBonus(level: number): number {
  if (level < 9) return 2;
  if (level < 16) return 3;
  return 4;
}

/**
 * Calculate Bardic Inspiration die
 */
export function getBardicInspirationDie(level: number): number {
  if (level < 5) return 6;
  if (level < 10) return 8;
  if (level < 15) return 10;
  return 12;
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

  // For simplicity, we'll assume there's always an ally nearby in combat
  // In a real implementation, you'd check actual positioning
  const hasNearbyAlly = nearbyEnemies.length > 0;

  // Sneak attack can be used if there's an ally nearby or if attacker has advantage
  // For now, we'll just check if there's an ally nearby
  return hasNearbyAlly;
}

/**
 * Check if a participant is incapacitated
 */
export function isIncapacitated(participant: CombatParticipant): boolean {
  const incapacitatingConditions = ['stunned', 'paralyzed', 'unconscious', 'petrified'];
  return participant.conditions.some((c) => incapacitatingConditions.includes(c.name));
}

/**
 * Calculate Rogue sneak attack dice
 */
export function getSneakAttackDice(level: number): number {
  return Math.ceil(level / 2);
}

/**
 * Calculate Paladin divine smite damage based on spell slot level
 * @param spellSlotLevel - The level of the spell slot expended
 * @param isCritical - Whether this is a critical hit
 * @returns The damage dice string for divine smite
 */
export function getDivineSmiteDamage(spellSlotLevel: number, isCritical: boolean = false): string {
  // Divine Smite adds radiant damage equal to 2d8 + 1d8 for each spell slot level above 1st
  const baseDice = 2; // Base 2d8 for 1st level slot
  const additionalDice = Math.max(0, spellSlotLevel - 1); // Additional 1d8 per level above 1st
  const totalDice = baseDice + additionalDice;

  // For critical hits, double the dice count
  const finalDice = isCritical ? totalDice * 2 : totalDice;

  return `${finalDice}d8`;
}

/**
 * Calculate Monk martial arts die
 */
export function getMartialArtsDie(level: number): number {
  if (level < 5) return 4;
  if (level < 11) return 6;
  if (level < 17) return 8;
  return 10;
}

/**
 * Calculate unarmored defense AC for Barbarians and Monks
 * Barbarian: 10 + Dexterity modifier + Constitution modifier
 * Monk: 10 + Dexterity modifier + Wisdom modifier
 */
export function calculateUnarmoredDefenseAC(
  characterClass: string,
  abilityScores: { [key: string]: { modifier: number } },
): number {
  // Base AC without armor
  const baseAC = 10;

  // Get ability modifiers
  const dexMod = abilityScores.dexterity?.modifier || 0;

  // Different calculation based on class
  switch (characterClass.toLowerCase()) {
    case 'barbarian': {
      const conMod = abilityScores.constitution?.modifier || 0;
      return baseAC + dexMod + conMod;
    }
    case 'monk': {
      const wisMod = abilityScores.wisdom?.modifier || 0;
      return baseAC + dexMod + wisMod;
    }
    default:
      // For other classes, just return base + dex
      return baseAC + dexMod;
  }
}

/**
 * Check if character has unarmored defense feature
 */
export function hasUnarmoredDefense(characterClass: string, level: number): boolean {
  // Barbarians have unarmored defense starting at level 1
  if (characterClass.toLowerCase() === 'barbarian' && level >= 1) {
    return true;
  }

  // Monks have unarmored defense starting at level 1
  if (characterClass.toLowerCase() === 'monk' && level >= 1) {
    return true;
  }

  return false;
}

/**
 * Activate Barbarian rage
 */
export function activateRage(
  participant: CombatParticipant,
  resources: CharacterResources,
): {
  updatedParticipant: CombatParticipant;
  updatedResources: CharacterResources;
  rageDamageBonus: number;
} {
  // Check if participant can rage
  if (!participant.classFeatures?.some((f) => f.name === 'rage')) {
    throw new Error('Participant does not have the rage feature');
  }

  // Check if rage is already active
  if (participant.isRaging) {
    throw new Error('Participant is already raging');
  }

  // Check if rage uses are available
  if ((resources.rages?.current || 0) <= 0) {
    throw new Error('No rage uses remaining');
  }

  // Calculate rage damage bonus based on level
  const rageDamageBonus = getRageDamageBonus(participant.level || 1);

  // Apply damage resistances (bludgeoning, piercing, slashing)
  const damageResistances = [...participant.damageResistances];
  if (!damageResistances.includes('bludgeoning')) {
    damageResistances.push('bludgeoning');
  }
  if (!damageResistances.includes('piercing')) {
    damageResistances.push('piercing');
  }
  if (!damageResistances.includes('slashing')) {
    damageResistances.push('slashing');
  }

  // Decrement rage uses
  const updatedResources = {
    ...resources,
    rages: {
      ...resources.rages!,
      current: resources.rages!.current - 1,
    },
  };

  // Update participant with rage state and resistances
  const updatedParticipant = {
    ...participant,
    isRaging: true,
    damageResistances,
  };

  return { updatedParticipant, updatedResources, rageDamageBonus };
}

/**
 * Deactivate Barbarian rage
 */
export function deactivateRage(participant: CombatParticipant): CombatParticipant {
  // Remove damage resistances added by rage
  const damageResistances = participant.damageResistances.filter(
    (type) => type !== 'bludgeoning' && type !== 'piercing' && type !== 'slashing',
  );

  return {
    ...participant,
    isRaging: false,
    damageResistances,
  };
}
