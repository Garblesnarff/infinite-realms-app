import { describe, expect, it } from 'vitest';

import {
  MAX_CHARACTER_AGE,
  parseCharacterAge,
  parseStartingGoldDice,
} from '../character-creation-input-bounds';

import { startingGoldByClass } from '@/data/equipmentOptions';

describe('character creation numeric input bounds', () => {
  it('accepts complete integer ages and clamps the supported range', () => {
    expect(parseCharacterAge('25')).toBe(25);
    expect(parseCharacterAge('-1')).toBe(0);
    expect(parseCharacterAge('10001')).toBe(MAX_CHARACTER_AGE);
  });

  it.each(['', '25years', '25.5', 'Infinity', '9007199254740992'])(
    'rejects the invalid age %j',
    (age) => {
      expect(parseCharacterAge(age)).toBe(0);
    },
  );

  it('parses every configured starting-gold formula', () => {
    for (const { dice } of Object.values(startingGoldByClass)) {
      expect(parseStartingGoldDice(dice)).toEqual(
        expect.objectContaining({ count: expect.any(Number), sides: expect.any(Number) }),
      );
    }
  });

  it.each(['5d4gold', '0d4', '101d4', '5d1', '5d101', '1.5d4', '9007199254740992d4'])(
    'rejects the invalid starting-gold formula %j',
    (notation) => {
      expect(parseStartingGoldDice(notation)).toBeNull();
    },
  );
});
