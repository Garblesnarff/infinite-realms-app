import type { AbilityScores, CharacterRace, Subrace } from '@/types/character';

import { calculateModifier } from '@/utils/abilityScoreUtils';

/**
 * Utility functions for calculating and applying racial ability score bonuses
 * Implements D&D 5E racial ability score increase rules
 */

export type AbilityScoreName =
  | 'strength'
  | 'dexterity'
  | 'constitution'
  | 'intelligence'
  | 'wisdom'
  | 'charisma';

export interface RacialBonus {
  ability: AbilityScoreName;
  bonus: number;
}

/**
 * Calculate total racial ability bonuses from race + subrace
 * Handles additive bonuses from both race and subrace
 * Also handles player choices for Half-Elf and Variant Human
 *
 * @param race - Character's selected race
 * @param subrace - Character's selected subrace (if any)
 * @param racialAbilityChoices - Player's ability choices (for Half-Elf, Variant Human)
 * @returns Array of racial bonuses by ability
 */
export function calculateRacialBonuses(
  race: CharacterRace | null,
  subrace: Subrace | null,
  racialAbilityChoices?: {
    halfElf?: [string, string];
    variantHuman?: [string, string];
  },
): RacialBonus[] {
  const bonuses: RacialBonus[] = [];

  if (!race) return bonuses;

  // Apply race bonuses
  if (race.abilityScoreIncrease) {
    Object.entries(race.abilityScoreIncrease).forEach(([ability, bonus]) => {
      const abilityKey = ability.toLowerCase() as AbilityScoreName;
      bonuses.push({
        ability: abilityKey,
        bonus: bonus as number,
      });
    });
  }

  // Apply subrace bonuses (additive with race bonuses)
  if (subrace?.abilityScoreIncrease) {
    Object.entries(subrace.abilityScoreIncrease).forEach(([ability, bonus]) => {
      const abilityKey = ability.toLowerCase() as AbilityScoreName;
      bonuses.push({
        ability: abilityKey,
        bonus: bonus as number,
      });
    });
  }

  // Apply Half-Elf player choices (+1 to two abilities)
  if (race.id === 'half-elf' && racialAbilityChoices?.halfElf) {
    racialAbilityChoices.halfElf.forEach((ability) => {
      bonuses.push({
        ability: ability as AbilityScoreName,
        bonus: 1,
      });
    });
  }

  // Apply Variant Human player choices (+1 to two abilities)
  if (subrace?.id === 'variant-human' && racialAbilityChoices?.variantHuman) {
    racialAbilityChoices.variantHuman.forEach((ability) => {
      bonuses.push({
        ability: ability as AbilityScoreName,
        bonus: 1,
      });
    });
  }

  return bonuses;
}

/**
 * Get total racial bonus for a specific ability
 * Sums all bonuses that apply to that ability
 *
 * @param ability - The ability score to check
 * @param racialBonuses - Array of all racial bonuses
 * @returns Total bonus for this ability
 */
export function getTotalRacialBonus(
  ability: AbilityScoreName,
  racialBonuses: RacialBonus[],
): number {
  return racialBonuses
    .filter((bonus) => bonus.ability === ability)
    .reduce((sum, bonus) => sum + bonus.bonus, 0);
}

/**
 * Apply racial bonuses to base ability scores
 * Caps final scores at 20 per D&D 5E rules
 *
 * @param baseScores - Base ability scores before racial bonuses
 * @param racialBonuses - Array of racial bonuses to apply
 * @returns Final ability scores with racial bonuses applied
 */
export function applyRacialBonuses(
  baseScores: Record<AbilityScoreName, number>,
  racialBonuses: RacialBonus[],
): Record<AbilityScoreName, number> {
  const finalScores = { ...baseScores };
  const abilities: AbilityScoreName[] = [
    'strength',
    'dexterity',
    'constitution',
    'intelligence',
    'wisdom',
    'charisma',
  ];

  abilities.forEach((ability) => {
    const totalBonus = getTotalRacialBonus(ability, racialBonuses);
    const finalScore = (finalScores[ability] || 0) + totalBonus;

    // Cap at maximum of 20 per D&D 5E rules
    finalScores[ability] = Math.min(finalScore, 20);
  });

  return finalScores;
}

const ABILITY_NAMES: AbilityScoreName[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/**
 * Fold racial bonuses into a character's base ability scores, producing final scores.
 * Capped at 20 and with modifiers recomputed from the final score, so HP, AC and saves
 * derive from the same numbers that are stored.
 *
 * Call this once, when the character is created. Stored scores are final: reads must
 * not add racial bonuses again.
 *
 * @param abilityScores - Base ability scores as entered in the wizard (before racial bonuses)
 * @param race - Character's selected race
 * @param subrace - Character's selected subrace (if any)
 * @param racialAbilityChoices - Player's ability choices (for Half-Elf, Variant Human)
 * @returns A new AbilityScores object with racial bonuses applied
 */
export function applyRacialBonusesToAbilityScores(
  abilityScores: AbilityScores,
  race: CharacterRace | null,
  subrace: Subrace | null,
  racialAbilityChoices?: {
    halfElf?: [string, string];
    variantHuman?: [string, string];
  },
): AbilityScores {
  const bonuses = calculateRacialBonuses(race, subrace, racialAbilityChoices);
  const finalScores: AbilityScores = { ...abilityScores };

  ABILITY_NAMES.forEach((ability) => {
    const current = abilityScores[ability];
    const bonus = getTotalRacialBonus(ability, bonuses);
    if (bonus === 0) return;

    const score = Math.min(current.score + bonus, 20);
    finalScores[ability] = { ...current, score, modifier: calculateModifier(score) };
  });

  return finalScores;
}

/**
 * Format racial bonus for display
 * Returns formatted string like "+2" or "+0"
 *
 * @param bonus - Numeric bonus value
 * @returns Formatted bonus string
 */
export function formatRacialBonus(bonus: number): string {
  return bonus > 0 ? `+${bonus}` : `${bonus}`;
}
