import { describe, expect, it } from 'vitest';

import { calculateHitPoints } from '../basic-math';
import { getCharacterSheetHitPoints } from '../character-sheet-hit-points';
import { transformCharacterData } from '../data-transformers';

import type { Character } from '@/types/character';

describe('getCharacterSheetHitPoints', () => {
  it('displays stored current and max HP when they disagree with preview math', () => {
    const character = transformCharacterData(
      {
        id: 'char-123',
        user_id: 'user-456',
        name: 'The Apprentice',
        race: 'Human',
        class: 'Wizard',
        level: 1,
      },
      {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
        current_hit_points: 4,
        max_hit_points: 10,
      },
      [],
    );

    expect(calculateHitPoints(character)).toBe(6);
    expect(getCharacterSheetHitPoints(character)).toEqual({ current: 4, maximum: 10 });
  });

  it('preserves a stored zero current HP', () => {
    const character: Character = {
      class: { name: 'Wizard', hitDie: 6 } as Character['class'],
      character_stats: {
        current_hit_points: 0,
        max_hit_points: 10,
      },
    };

    expect(getCharacterSheetHitPoints(character)).toEqual({ current: 0, maximum: 10 });
  });

  it('accepts both normalized sheet stats and roster join arrays', () => {
    const sheetCharacter: Character = {
      character_stats: { current_hit_points: 4, max_hit_points: 10 },
    };
    const rosterCharacter: Character = {
      character_stats: [{ current_hit_points: 4, max_hit_points: 10 }],
    };

    expect(getCharacterSheetHitPoints(sheetCharacter)).toEqual({ current: 4, maximum: 10 });
    expect(getCharacterSheetHitPoints(rosterCharacter)).toEqual({ current: 4, maximum: 10 });
  });
});
