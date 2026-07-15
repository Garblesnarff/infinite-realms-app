import { describe, expect, test } from 'bun:test';

import { resolveAttackRules, type WeaponRuleProfile } from '../combat-rules.js';

const longsword: WeaponRuleProfile = {
  id: 'longsword', name: 'Longsword', damageDice: '1d8', damageType: 'slashing',
  normalRange: 5, magicBonus: 0, finesse: false, ranged: false, proficient: true,
};

describe('combat integrity rules', () => {
  test('uses real ability and proficiency modifiers and applies half cover', () => {
    const result = resolveAttackRules({
      strength: 16, dexterity: 12, level: 5, baseTargetAc: 14, weapon: longsword,
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 1 },
    });
    expect(result).toMatchObject({ legal: true, attackBonus: 6, damageBonus: 3, targetAc: 16 });
  });

  test('uses dexterity for finesse and ranged weapons', () => {
    const result = resolveAttackRules({
      strength: 8, dexterity: 18, level: 1, baseTargetAc: 12,
      weapon: { ...longsword, finesse: true },
    });
    expect(result).toMatchObject({ ability: 'dexterity', attackBonus: 6, damageBonus: 4 });
  });

  test('enforces line of sight, total cover, and maximum range', () => {
    const base = { strength: 16, dexterity: 12, level: 1, baseTargetAc: 12, weapon: longsword };
    expect(resolveAttackRules({ ...base, geometry: { distanceFeet: 5, hasLineOfSight: false, cover: 0 } }).refusal).toBe('no_line_of_sight');
    expect(resolveAttackRules({ ...base, geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 3 } }).refusal).toBe('total_cover');
    expect(resolveAttackRules({ ...base, geometry: { distanceFeet: 10, hasLineOfSight: true, cover: 0 } }).refusal).toBe('out_of_range');
  });

  test('long range imposes disadvantage and opposing sources cancel', () => {
    const bow = { ...longsword, ranged: true, normalRange: 80, longRange: 320 };
    const longRange = resolveAttackRules({
      strength: 10, dexterity: 16, level: 1, baseTargetAc: 12, weapon: bow,
      geometry: { distanceFeet: 100, hasLineOfSight: true, cover: 0 },
    });
    expect(longRange.disadvantage).toBe(true);
    const cancelled = resolveAttackRules({
      strength: 10, dexterity: 16, level: 1, baseTargetAc: 12, weapon: bow,
      requestedAdvantage: true,
      geometry: { distanceFeet: 100, hasLineOfSight: true, cover: 0 },
    });
    expect(cancelled).toMatchObject({ advantage: false, disadvantage: false });
  });

  test('ranged attacks within 5 feet have disadvantage', () => {
    const result = resolveAttackRules({
      strength: 10, dexterity: 16, level: 1, baseTargetAc: 12,
      weapon: { ...longsword, ranged: true, normalRange: 80, longRange: 320 },
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 0 },
    });
    expect(result).toMatchObject({ legal: true, disadvantage: true });
  });
});
