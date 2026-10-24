import { describe, expect, test } from 'bun:test';

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

describe('combat integrity rules', () => {
  test('uses real ability and proficiency modifiers and applies half cover', () => {
    const result = resolveAttackRules({
      strength: 16,
      dexterity: 12,
      level: 5,
      baseTargetAc: 14,
      weapon: longsword,
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 1 },
    });
    expect(result).toMatchObject({ legal: true, attackBonus: 6, damageBonus: 3, targetAc: 16 });
  });

  test('uses dexterity for finesse and ranged weapons', () => {
    const result = resolveAttackRules({
      strength: 8,
      dexterity: 18,
      level: 1,
      baseTargetAc: 12,
      weapon: { ...longsword, finesse: true },
    });
    expect(result).toMatchObject({ ability: 'dexterity', attackBonus: 6, damageBonus: 4 });
  });

  test('enforces line of sight, total cover, and maximum range', () => {
    const base = { strength: 16, dexterity: 12, level: 1, baseTargetAc: 12, weapon: longsword };
    expect(
      resolveAttackRules({
        ...base,
        geometry: { distanceFeet: 5, hasLineOfSight: false, cover: 0 },
      }).refusal,
    ).toBe('no_line_of_sight');
    expect(
      resolveAttackRules({ ...base, geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 3 } })
        .refusal,
    ).toBe('total_cover');
    expect(
      resolveAttackRules({
        ...base,
        geometry: { distanceFeet: 10, hasLineOfSight: true, cover: 0 },
      }).refusal,
    ).toBe('out_of_range');
  });

  test('long range imposes disadvantage and opposing sources cancel', () => {
    const bow = { ...longsword, ranged: true, normalRange: 80, longRange: 320 };
    const longRange = resolveAttackRules({
      strength: 10,
      dexterity: 16,
      level: 1,
      baseTargetAc: 12,
      weapon: bow,
      geometry: { distanceFeet: 100, hasLineOfSight: true, cover: 0 },
    });
    expect(longRange.disadvantage).toBe(true);
    const cancelled = resolveAttackRules({
      strength: 10,
      dexterity: 16,
      level: 1,
      baseTargetAc: 12,
      weapon: bow,
      requestedAdvantage: true,
      geometry: { distanceFeet: 100, hasLineOfSight: true, cover: 0 },
    });
    expect(cancelled).toMatchObject({ advantage: false, disadvantage: false });
  });

  test('ranged attacks within 5 feet have disadvantage', () => {
    const result = resolveAttackRules({
      strength: 10,
      dexterity: 16,
      level: 1,
      baseTargetAc: 12,
      weapon: { ...longsword, ranged: true, normalRange: 80, longRange: 320 },
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 0 },
    });
    expect(result).toMatchObject({ legal: true, disadvantage: true });
  });

  test('names the source of a ranged-in-melee disadvantage (#603)', () => {
    const result = resolveAttackRules({
      strength: 10,
      dexterity: 16,
      level: 1,
      baseTargetAc: 12,
      weapon: { ...longsword, ranged: true, normalRange: 80, longRange: 320 },
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 0 },
    });
    expect(result.disadvantageSources).toEqual(['ranged attack with a hostile within 5 ft']);
    expect(result.advantageSources).toEqual([]);
  });

  test('names the source of a condition disadvantage (#603)', () => {
    const result = resolveAttackRules({
      strength: 16,
      dexterity: 12,
      level: 1,
      baseTargetAc: 12,
      weapon: longsword,
      attackerConditions: ['poisoned'],
    });
    expect(result.disadvantage).toBe(true);
    expect(result.disadvantageSources).toEqual(['you are poisoned']);
  });

  test('reports no sources when nothing grants an edge (#603)', () => {
    const result = resolveAttackRules({
      strength: 16,
      dexterity: 12,
      level: 1,
      baseTargetAc: 12,
      weapon: longsword,
      geometry: { distanceFeet: 5, hasLineOfSight: true, cover: 0 },
    });
    expect(result).toMatchObject({ advantage: false, disadvantage: false });
    expect(result.advantageSources).toEqual([]);
    expect(result.disadvantageSources).toEqual([]);
  });

  test('names the dodge and requested sources (#603)', () => {
    const result = resolveAttackRules({
      strength: 16,
      dexterity: 12,
      level: 1,
      baseTargetAc: 12,
      weapon: longsword,
      requestedDisadvantage: true,
      targetDodging: true,
    });
    expect(result.disadvantageSources).toEqual(['requested', 'target is dodging']);
  });

  test('names the long-range source (#603)', () => {
    const bow = { ...longsword, ranged: true, normalRange: 80, longRange: 320 };
    const result = resolveAttackRules({
      strength: 10,
      dexterity: 16,
      level: 1,
      baseTargetAc: 12,
      weapon: bow,
      geometry: { distanceFeet: 100, hasLineOfSight: true, cover: 0 },
    });
    expect(result.disadvantageSources).toEqual(['long range']);
  });
});

describe('fighting styles (#824)', () => {
  const fighter = { strength: 16, dexterity: 14, level: 1, baseTargetAc: 10 };

  test('Archery adds +2 to a ranged weapon and not to a thrown melee weapon', () => {
    const crossbow = {
      ...longsword,
      name: 'Crossbow, light',
      ranged: true,
      rangedWeapon: true,
      normalRange: 80,
      longRange: 320,
    };
    // DEX +2, proficiency +2, Archery +2. The sheet showed +4 before this.
    expect(
      resolveAttackRules({ ...fighter, weapon: crossbow, fightingStyles: ['Archery'] }).attackBonus,
    ).toBe(6);
    const javelin = {
      ...longsword,
      name: 'Javelin',
      ranged: true,
      rangedWeapon: false,
      normalRange: 30,
    };
    // Thrown melee still uses the ranged-attack ability when `ranged` is set, but Archery does not apply.
    expect(
      resolveAttackRules({ ...fighter, weapon: javelin, fightingStyles: ['archery'] }).attackBonus,
    ).toBe(4);
  });

  test('Dueling adds +2 damage in one hand, not with a second weapon or a two-handed weapon', () => {
    const oneHand = { ...longsword, meleeWeapon: true };
    expect(
      resolveAttackRules({ ...fighter, weapon: oneHand, fightingStyles: ['dueling'] }).damageBonus,
    ).toBe(5);
    expect(
      resolveAttackRules({
        ...fighter,
        weapon: { ...oneHand, otherWeaponWielded: true },
        fightingStyles: ['Dueling'],
      }).damageBonus,
    ).toBe(3);
    expect(
      resolveAttackRules({
        ...fighter,
        weapon: { ...oneHand, twoHanded: true, name: 'Greataxe' },
        fightingStyles: ['dueling'],
      }).damageBonus,
    ).toBe(3);
  });

  test('a monster fixed bonus stays verbatim when styles are also present', () => {
    const golem = {
      ...longsword,
      ranged: true,
      rangedWeapon: true,
      meleeWeapon: true,
      fixedAttackBonus: 10,
      fixedDamageBonus: 6,
    };
    expect(
      resolveAttackRules({
        ...fighter,
        weapon: golem,
        fightingStyles: ['archery', 'dueling'],
      }),
    ).toMatchObject({ attackBonus: 10, damageBonus: 6 });
  });
});
