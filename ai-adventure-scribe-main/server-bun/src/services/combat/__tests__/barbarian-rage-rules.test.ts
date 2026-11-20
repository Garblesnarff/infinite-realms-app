import { describe, expect, test } from 'bun:test';

import { rageDamageBonusAt } from '../../../../../shared/limited-feature-counts';
import { resolveAttackRules, type WeaponRuleProfile } from '../combat-rules.js';
import { calculateDamage } from '../damage-calculator.js';
import { withRageResistances } from '../resistance-resolver.js';

import type { DamageType } from '../../../types/combat.js';

// #1638: Rage's pure rules. The engine owns every number; these tests pin the 2014 SRD values.

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
  meleeWeapon: true,
};

const base = {
  strength: 16,
  dexterity: 12,
  level: 3,
  baseTargetAc: 12,
  weapon: longsword,
};

describe('Rage damage (+2 on a melee Strength weapon attack)', () => {
  test('adds the rage bonus to a melee Strength weapon attack', () => {
    const without = resolveAttackRules(base);
    const withRage = resolveAttackRules({ ...base, ragingDamageBonus: 2 });
    expect(withRage.damageBonus).toBe(without.damageBonus + 2);
    expect(withRage.attackBonus).toBe(without.attackBonus);
  });

  test('adds nothing without the rage input', () => {
    expect(resolveAttackRules({ ...base, ragingDamageBonus: 0 }).damageBonus).toBe(
      resolveAttackRules(base).damageBonus,
    );
  });

  test('adds nothing to a ranged weapon attack', () => {
    const bow = { ...longsword, ranged: true, meleeWeapon: false, normalRange: 80 };
    expect(resolveAttackRules({ ...base, weapon: bow, ragingDamageBonus: 2 }).damageBonus).toBe(
      resolveAttackRules({ ...base, weapon: bow }).damageBonus,
    );
  });

  test('adds nothing to a finesse attack that uses Dexterity', () => {
    const rapier = { ...longsword, finesse: true };
    const dexterous = { ...base, strength: 10, dexterity: 18, weapon: rapier };
    expect(resolveAttackRules({ ...dexterous, ragingDamageBonus: 2 }).ability).toBe('dexterity');
    expect(resolveAttackRules({ ...dexterous, ragingDamageBonus: 2 }).damageBonus).toBe(
      resolveAttackRules(dexterous).damageBonus,
    );
  });

  test('adds nothing to an unarmed strike or a monster attack (no melee weapon flag)', () => {
    const unarmed = { ...longsword, meleeWeapon: undefined };
    expect(resolveAttackRules({ ...base, weapon: unarmed, ragingDamageBonus: 2 }).damageBonus).toBe(
      resolveAttackRules({ ...base, weapon: unarmed }).damageBonus,
    );
  });

  test('is +2 at Barbarian levels 1 to 8, and none outside that band (reduced first scope)', () => {
    expect(rageDamageBonusAt(0)).toBe(0);
    expect(rageDamageBonusAt(1)).toBe(2);
    expect(rageDamageBonusAt(8)).toBe(2);
    // Was 0 while the +3 and +4 tiers were out of scope (#1654 item 5). The SRD value is +3 at 9th.
    expect(rageDamageBonusAt(9)).toBe(3);
    expect(rageDamageBonusAt(15)).toBe(3);
    expect(rageDamageBonusAt(16)).toBe(4);
    expect(rageDamageBonusAt(20)).toBe(4);
  });
});

describe('Rage resistance (bludgeoning, piercing, slashing)', () => {
  test('is a no-op when not raging', () => {
    const defenses = { resistances: ['fire'] as never[], vulnerabilities: [], immunities: [] };
    expect(withRageResistances(defenses as never, false)).toBe(defenses as never);
  });

  test('merges the three types with a racial resistance, which survives', () => {
    const merged = withRageResistances(
      { resistances: ['fire'], vulnerabilities: [], immunities: [] } as never,
      true,
    );
    const expected: DamageType[] = ['bludgeoning', 'fire', 'piercing', 'slashing'];
    expect([...merged.resistances].sort()).toEqual([...expected].sort());
  });

  test('lists a type once when the target already resists it, so the halving applies once', () => {
    const merged = withRageResistances(
      { resistances: ['slashing'], vulnerabilities: [], immunities: [] } as never,
      true,
    );
    expect(merged.resistances.filter((type) => type === 'slashing')).toHaveLength(1);
    const damage = calculateDamage({
      damageDice: '1d8',
      damageBonus: 0,
      damageType: 'slashing',
      resistances: merged.resistances,
      vulnerabilities: merged.vulnerabilities,
      immunities: merged.immunities,
      damageRoll: 8,
    });
    expect(damage.finalDamage).toBe(4);
  });

  test('halves a raging target’s slashing damage and leaves fire damage whole', () => {
    const merged = withRageResistances(
      { resistances: [], vulnerabilities: [], immunities: [] } as never,
      true,
    );
    const slash = calculateDamage({
      damageDice: '1d8',
      damageBonus: 0,
      damageType: 'slashing',
      resistances: merged.resistances,
      vulnerabilities: merged.vulnerabilities,
      immunities: merged.immunities,
      damageRoll: 8,
    });
    const fire = calculateDamage({
      damageDice: '1d8',
      damageBonus: 0,
      damageType: 'fire',
      resistances: merged.resistances,
      vulnerabilities: merged.vulnerabilities,
      immunities: merged.immunities,
      damageRoll: 8,
    });
    expect(slash.finalDamage).toBe(4);
    expect(fire.finalDamage).toBe(8);
  });
});
