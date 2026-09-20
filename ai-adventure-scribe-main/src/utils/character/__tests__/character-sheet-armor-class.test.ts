import { afterEach, describe, expect, it, vi } from 'vitest';

import { getCharacterSheetArmorClass } from '../character-sheet-armor-class';
import {
  type CharacterEquipmentRow,
  type CharacterStatsRow,
  transformCharacterData,
} from '../data-transformers';

import type { Character } from '@/types/character';

import { buildCharacterSheet } from '@/features/game-session/components/game/overhaul/useOverhaulViewModel';
import logger from '@/lib/logger';
import { buildStarterCharacterSeed } from '@/services/character/starter-character-seeding';

const characterRow = {
  id: 'character-2079',
  user_id: 'user-2079',
  name: 'The Veteran',
  race: 'Human',
  class: 'Fighter',
  level: 1,
};

const buildCharacter = (stats: CharacterStatsRow) =>
  transformCharacterData(characterRow, stats, [] as CharacterEquipmentRow[]);

describe('character sheet armor class', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the premade Veteran at the stored AC from chain mail and shield', () => {
    const seed = buildStarterCharacterSeed(
      {
        name: 'The Veteran',
        race: 'Human',
        class: 'Fighter',
        level: 1,
        ability_scores: {
          strength: 16,
          dexterity: 12,
          constitution: 14,
          intelligence: 10,
          wisdom: 13,
          charisma: 10,
        },
        equipment: ['chain mail', 'shield'],
      },
      'abyssal-descent',
    );
    const stats = seed.stats as CharacterStatsRow;
    const character = buildCharacter(stats);

    expect(stats.armor_class).toBe(18);
    expect(character.armorClass).toBe(18);
    expect(buildCharacterSheet(character).ac).toBe(18);
  });

  it('reads a stored unarmored AC of 13', () => {
    const character = buildCharacter({
      strength: 10,
      dexterity: 16,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
      armor_class: 13,
      max_hit_points: 10,
      current_hit_points: 10,
    });

    expect(getCharacterSheetArmorClass(character)).toBe(13);
    expect(buildCharacterSheet(character).ac).toBe(13);
  });

  it('returns null and logs a structured warning when stored AC is missing', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const character = {
      id: 'missing-ac',
      character_stats: { armor_class: null },
    } as Character;

    expect(getCharacterSheetArmorClass(character)).toBeNull();
    expect(warn).toHaveBeenCalledWith('SHEET_STAT_MISSING', {
      stat: 'ac',
      characterId: 'missing-ac',
    });
  });
});
