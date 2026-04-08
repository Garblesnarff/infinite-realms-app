import type { Character } from '@/types/character';

import { rollDie } from '@/utils/diceRolls';

/**
 * Calculate maximum hit dice for a character based on class levels
 */
export function calculateMaxHitDice(character: Character): number {
  if (!character.classLevels || character.classLevels.length === 0) {
    const level = character.level || 1;
    return Math.max(1, Math.floor(level / 2));
  }

  // For multiclass characters, take half of total level (minimum 1)
  const totalLevel = character.classLevels.reduce((sum, cls) => sum + cls.level, 0);
  return Math.max(1, Math.floor(totalLevel / 2));
}

/**
 * Roll hit dice to recover hit points
 * @param character - Character rolling hit dice
 * @param numDice - Number of hit dice to roll
 * @returns Object with hit points recovered and updated character
 */
export function rollHitDice(
  character: Character,
  numDice: number,
): {
  hitPointsRecovered: number;
  updatedCharacter: Character;
} {
  if (!character.hitDice || numDice <= 0) {
    return { hitPointsRecovered: 0, updatedCharacter: character };
  }

  const hitDiceType = character.hitDice.type.replace('d', '');
  const dieType = parseInt(hitDiceType) || 8;
  const conModifier = character.abilityScores?.constitution?.modifier || 0;

  let totalRecovered = 0;
  let remainingDice = character.hitDice.remaining;
  const diceToRoll = Math.min(numDice, remainingDice);

  // Roll hit dice
  for (let i = 0; i < diceToRoll; i++) {
    const roll = rollDie(dieType);
    const recovered = Math.max(1, roll + conModifier); // Minimum 1 HP recovered
    totalRecovered += recovered;
    remainingDice--;
  }

  // Update character hit dice
  const updatedCharacter = {
    ...character,
    hitDice: {
      ...character.hitDice,
      remaining: remainingDice,
    },
    hitPoints: {
      ...character.hitPoints,
      current: Math.min(
        character.hitPoints?.maximum || 1,
        (character.hitPoints?.current || 0) + totalRecovered,
      ),
    },
  };

  return {
    hitPointsRecovered: totalRecovered,
    updatedCharacter,
  };
}

/**
 * Recover hit dice on a long rest
 * @param character - Character to recover hit dice for
 * @returns Updated character with recovered hit dice
 */
export function recoverHitDice(character: Character): Character {
  if (!character.hitDice) {
    return character;
  }

  const maxHitDice = calculateMaxHitDice(character);
  const currentHitDice = character.hitDice.remaining;
  const maxHitDiceCount = character.hitDice.total;

  // Recover up to half of max hit dice (rounded down, minimum 1)
  const diceToRecover = Math.max(1, Math.floor(maxHitDice));
  const newHitDiceCount = Math.min(maxHitDiceCount, currentHitDice + diceToRecover);

  return {
    ...character,
    hitDice: {
      ...character.hitDice,
      remaining: newHitDiceCount,
    },
  };
}
