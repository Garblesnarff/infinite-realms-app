import { describe, expect, it } from 'vitest';

import { proficiencyBonus } from '../shared/proficiency-bonus';
import { calculateProficiencyBonus } from '../src/utils/character/basic-math';

const LEVEL_BOUNDARIES = [
  [1, 2],
  [4, 2],
  [5, 3],
  [8, 3],
  [9, 4],
  [12, 4],
  [13, 5],
  [16, 5],
  [17, 6],
  [20, 6],
] as const;

describe('proficiency bonus', () => {
  it.each(LEVEL_BOUNDARIES)('uses the 2014 bonus at level %i', (level, expected) => {
    expect(proficiencyBonus(level)).toBe(expected);
    expect(calculateProficiencyBonus(level)).toBe(expected);
  });

  it('bounds defensive out-of-range levels to the 2014 table', () => {
    expect(proficiencyBonus(0)).toBe(2);
    expect(proficiencyBonus(21)).toBe(6);
  });
});
