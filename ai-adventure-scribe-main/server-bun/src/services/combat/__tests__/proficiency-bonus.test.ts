import { describe, expect, test } from 'bun:test';

import { proficiencyBonus } from '../../../../../shared/proficiency-bonus';
import { ProgressionMechanics } from '../../progression/progression-mechanics.js';
import { resolveAttackRules, type WeaponRuleProfile } from '../combat-rules.js';

const longsword: WeaponRuleProfile = {
  id: 'longsword',
  name: 'Longsword',
  damageDice: '1d8',
  damageType: 'slashing',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
};

describe('shared proficiency bonus', () => {
  test.each([
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
  ])('uses the 2014 bonus at level %i', (level, expected) => {
    expect(proficiencyBonus(level)).toBe(expected);
    expect(
      resolveAttackRules({
        strength: 10,
        dexterity: 10,
        level,
        baseTargetAc: 10,
        weapon: longsword,
      }).proficiencyBonus,
    ).toBe(expected);
  });

  test('bounds defensive out-of-range levels to the 2014 table', () => {
    expect(proficiencyBonus(0)).toBe(2);
    expect(proficiencyBonus(21)).toBe(6);
  });

  test('keeps the progression producer on the shared rule', () => {
    expect(ProgressionMechanics.calculateProficiencyBonus(1)).toBe(2);
    expect(ProgressionMechanics.calculateProficiencyBonus(5)).toBe(3);
    expect(ProgressionMechanics.calculateProficiencyBonus(20)).toBe(6);
  });
});
