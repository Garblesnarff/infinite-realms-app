import type { Character } from '@/types/character';

export interface CharacterSheetHitPoints {
  current: number | null;
  maximum: number | null;
}

export const MISSING_HIT_POINTS_LABEL = '—';

const warnedMissingMaxHitPointsIds = new Set<string>();
const warnedMissingMaxHitPointsObjects = new WeakSet<object>();

const warnMissingMaxHitPoints = (character: Character): void => {
  const characterId = character.id;
  if (characterId) {
    if (warnedMissingMaxHitPointsIds.has(characterId)) return;
    warnedMissingMaxHitPointsIds.add(characterId);
  } else {
    if (warnedMissingMaxHitPointsObjects.has(character)) return;
    warnedMissingMaxHitPointsObjects.add(character);
  }

  console.warn('Character sheet max HP is unavailable; rendering — until stored HP loads.', {
    characterId,
  });
};

/**
 * Resolve the HP values shown by a character sheet.
 *
 * Stored character_stats values are authoritative for an existing character. A
 * missing value stays missing so the sheet cannot invent a number while data is
 * loading or when the stored row is incomplete.
 */
export const getCharacterSheetHitPoints = (character: Character): CharacterSheetHitPoints => {
  const stats = Array.isArray(character.character_stats)
    ? character.character_stats[0]
    : character.character_stats;
  const maximum = stats?.max_hit_points ?? null;
  const current = stats?.current_hit_points ?? null;

  if (maximum === null) {
    warnMissingMaxHitPoints(character);
  }

  return { current, maximum };
};

export const formatCharacterSheetHitPoints = ({
  current,
  maximum,
}: CharacterSheetHitPoints): string => {
  if (maximum === null) return MISSING_HIT_POINTS_LABEL;
  return `${current ?? MISSING_HIT_POINTS_LABEL}/${maximum}`;
};
