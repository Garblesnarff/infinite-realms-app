import { describe, expect, it } from 'vitest';

import {
  MAX_CHARACTER_AGE,
  parseCharacterAge,
} from '../character-creation-input-bounds';

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
});
