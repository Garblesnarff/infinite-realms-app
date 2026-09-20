import type { Character } from '@/types/character';

import logger from '@/lib/logger';

export const MISSING_ARMOR_CLASS_LABEL = '—';

const warnedMissingArmorClassIds = new Set<string>();
const warnedMissingArmorClassObjects = new WeakSet<object>();

const warnMissingArmorClass = (character: Character): void => {
  const characterId = character.id;
  if (characterId) {
    if (warnedMissingArmorClassIds.has(characterId)) return;
    warnedMissingArmorClassIds.add(characterId);
  } else {
    if (warnedMissingArmorClassObjects.has(character)) return;
    warnedMissingArmorClassObjects.add(character);
  }

  logger.warn('SHEET_STAT_MISSING', { stat: 'ac', characterId });
};

/**
 * Resolve the AC shown by an existing character sheet.
 *
 * `character_stats.armor_class` is the server-authoritative value also copied to
 * `combat_participants` when combat starts. A missing value stays missing so the
 * sheet cannot invent a number while the stored stats load or when the row is incomplete.
 */
export const getCharacterSheetArmorClass = (character: Character): number | null => {
  const stats = Array.isArray(character.character_stats)
    ? character.character_stats[0]
    : character.character_stats;
  const storedArmorClass = character.armorClass ?? stats?.armor_class;

  if (typeof storedArmorClass !== 'number') {
    warnMissingArmorClass(character);
    return null;
  }

  return storedArmorClass;
};
