import type { Character } from '@/types/character';

/**
 * Remove exhaustion levels on long rest
 * @param character - Character to remove exhaustion for
 * @param hadFoodAndWater - Whether character had food and water
 * @returns Updated character with reduced exhaustion
 */
export function recoverExhaustion(
  character: Character,
  hadFoodAndWater: boolean = true,
): Character {
  if (!character.conditions) {
    return character;
  }

  // Find exhaustion condition
  const exhaustionIndex = character.conditions.findIndex((c) => c.name === 'exhaustion');
  if (exhaustionIndex === -1) {
    return character;
  }

  const exhaustion = character.conditions[exhaustionIndex];
  let exhaustionLevel = exhaustion.level || 0;

  // Remove one level of exhaustion on long rest with food and water
  if (hadFoodAndWater && exhaustionLevel > 0) {
    exhaustionLevel = Math.max(0, exhaustionLevel - 1);
  }

  // Update or remove exhaustion condition
  const updatedConditions = [...character.conditions];
  if (exhaustionLevel > 0) {
    updatedConditions[exhaustionIndex] = {
      ...exhaustion,
      level: exhaustionLevel,
    };
  } else {
    updatedConditions.splice(exhaustionIndex, 1);
  }

  return {
    ...character,
    conditions: updatedConditions,
  };
}
