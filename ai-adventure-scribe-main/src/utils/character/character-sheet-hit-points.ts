import type { Character } from '@/types/character';

import { calculateHitPoints } from '@/utils/character/basic-math';

export interface CharacterSheetHitPoints {
  current: number;
  maximum: number;
}

/**
 * Resolve the HP values shown by a character sheet.
 *
 * Stored character_stats values are authoritative for an existing character.
 * The formula is only a fallback for previews or legacy objects without a
 * persisted stats row. Nullish checks intentionally preserve a stored zero.
 */
export const getCharacterSheetHitPoints = (character: Character): CharacterSheetHitPoints => {
  const stats = Array.isArray(character.character_stats)
    ? character.character_stats[0]
    : character.character_stats;
  const maximum = stats?.max_hit_points ?? calculateHitPoints(character);
  const current = stats?.current_hit_points ?? maximum;

  return { current, maximum };
};
