import { describe, expect, it } from 'vitest';

import { normalizeCharacter } from '@/services/user-data-payload-helpers';

type NormalizedCharacter = Record<string, unknown> & {
  hitDice?: { total: number; remaining: number; type: string };
};

/**
 * #264 (review finding 3): normalizeCharacter folds the GET's snake_case
 * hit_dice rows into the sheet's hitDice shape — the path the "sheet must
 * display hit dice" requirement depends on. The real-DB test proves the
 * server sends hit_dice; these prove the client maps them correctly.
 */
describe('normalizeCharacter hit_dice mapping (#264)', () => {
  it('aggregates snake_case rows into the sheet hitDice shape', () => {
    const normalized: NormalizedCharacter = normalizeCharacter({
      id: 'char-1',
      class: 'Fighter',
      hit_dice: [
        {
          id: 'hd-1',
          character_id: 'char-1',
          class_name: 'Fighter',
          die_type: 'd10',
          total_dice: 3,
          used_dice: 1,
        },
      ],
    });

    expect(normalized.hitDice).toEqual({ total: 3, remaining: 2, type: 'd10' });
  });

  it('renders a per-class label for multiclass rows', () => {
    const normalized: NormalizedCharacter = normalizeCharacter({
      id: 'char-2',
      class: 'Fighter',
      hit_dice: [
        {
          id: 'hd-2',
          character_id: 'char-2',
          class_name: 'Fighter',
          die_type: 'd10',
          total_dice: 2,
          used_dice: 0,
        },
        {
          id: 'hd-3',
          character_id: 'char-2',
          class_name: 'Wizard',
          die_type: 'd6',
          total_dice: 2,
          used_dice: 1,
        },
      ],
    });

    expect(normalized.hitDice).toEqual({ total: 4, remaining: 3, type: '2d10 + 2d6' });
  });

  it('leaves hitDice unset when there are no rows', () => {
    const normalized: NormalizedCharacter = normalizeCharacter({
      id: 'char-3',
      class: 'Rogue',
      hit_dice: [],
    });
    expect(normalized.hitDice).toBeUndefined();
  });

  it('leaves hitDice unset when hit_dice is absent', () => {
    const normalized: NormalizedCharacter = normalizeCharacter({ id: 'char-4', class: 'Rogue' });
    expect(normalized.hitDice).toBeUndefined();
  });
});
