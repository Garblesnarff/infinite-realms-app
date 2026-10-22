import { describe, it, expect } from 'vitest';

import {
  FALLBACK_HIT_DIE,
  computeLevel1MaxHitPoints,
  computeMaxHitPointsForLevel,
  dwarvenToughnessBonus,
  findSrdClassForHitPoints,
} from '../level-1-hit-points';

/**
 * #620: level-1 HP has one owner — `shared/level-1-hit-points.ts` — called by
 * the server create/upsert path and by the creation preview.
 *
 * Fixture fidelity: class hit dice come from the real SRD table
 * (`shared/srd-class-data.ts`) through `findSrdClassForHitPoints`, the same
 * resolution the server uses — no hand-copied dice.
 */
describe('computeLevel1MaxHitPoints (#620)', () => {
  it('computes Fighter HP: d10 + CON mod + Dwarven Toughness', () => {
    // Hill Dwarf: base CON 14 -> 16 (+3), +1 toughness = 14.
    expect(computeLevel1MaxHitPoints('Fighter', 16, 'Hill Dwarf')).toBe(14);
  });

  it('computes Wizard HP: d6 + CON mod + Dwarven Toughness', () => {
    expect(computeLevel1MaxHitPoints('Wizard', 16, 'Hill Dwarf')).toBe(10);
  });

  it('computes Barbarian HP: d12 + CON mod + Dwarven Toughness', () => {
    expect(computeLevel1MaxHitPoints('Barbarian', 16, 'Hill Dwarf')).toBe(16);
  });

  it('omits the toughness bonus for a non-Hill Dwarf', () => {
    expect(computeLevel1MaxHitPoints('Fighter', 12, 'Mountain Dwarf')).toBe(11);
    expect(computeLevel1MaxHitPoints('Fighter', 12, null)).toBe(11);
  });

  it('floors at 1 HP', () => {
    // d6 - 5 (CON 1) = 1; the floor keeps pathological inputs legal.
    expect(computeLevel1MaxHitPoints('Wizard', 1, null)).toBe(1);
  });

  it('throws on a non-empty unresolvable class name — bad data is loud', () => {
    expect(() => computeLevel1MaxHitPoints('Wizzard', 14, null)).toThrow(
      /unresolvable class "Wizzard"/,
    );
    expect(() => computeLevel1MaxHitPoints('Paladin ', 14, null)).not.toThrow();
  });

  it('falls back to a d8 for a missing class instead of failing (classless creates are valid)', () => {
    expect(FALLBACK_HIT_DIE).toBe(8);
    expect(computeLevel1MaxHitPoints(undefined, 14, null)).toBe(10);
    expect(computeLevel1MaxHitPoints(null, 14, null)).toBe(10);
    expect(computeLevel1MaxHitPoints('', 14, null)).toBe(10);
    expect(computeLevel1MaxHitPoints('   ', 14, null)).toBe(10);
  });

  it('follows known subclasses to their parent hit die', () => {
    expect(findSrdClassForHitPoints('Eldritch Knight')?.hitDie).toBe(10);
    expect(findSrdClassForHitPoints('Arcane Trickster')?.hitDie).toBe(8);
    expect(computeLevel1MaxHitPoints('Eldritch Knight', 14, null)).toBe(12);
  });
});

describe('Draconic Resilience (#899)', () => {
  it('adds +1 HP for a Draconic Bloodline sorcerer', () => {
    // Hark D20-011: a CON 14 sorcerer showed HP 8; Draconic Resilience
    // makes it d6 + 2 (CON) + 1 = 9.
    expect(computeLevel1MaxHitPoints('Sorcerer', 14, null, { draconicBloodline: true })).toBe(9);
    expect(computeLevel1MaxHitPoints('Sorcerer', 14, null)).toBe(8);
    expect(computeLevel1MaxHitPoints('Sorcerer', 14, null, { draconicBloodline: false })).toBe(8);
  });

  it('stacks with Dwarven Toughness', () => {
    expect(
      computeLevel1MaxHitPoints('Sorcerer', 16, 'Hill Dwarf', { draconicBloodline: true }),
    ).toBe(11);
  });

  it('never applies to another class, even with the flag set', () => {
    expect(computeLevel1MaxHitPoints('Wizard', 14, null, { draconicBloodline: true })).toBe(8);
    expect(computeLevel1MaxHitPoints('Fighter', 14, null, { draconicBloodline: true })).toBe(12);
  });
});

describe('computeMaxHitPointsForLevel (#829)', () => {
  it('pins level-1 output: identical to computeLevel1MaxHitPoints for every case', () => {
    // Level 1 must not change (#829): the for-level function at level 1 is
    // the level-1 function, case for case — including the Hill Dwarf, the
    // Draconic Bloodline sorcerer, the subclass parent die, the d8 fallback
    // and the 1 HP floor.
    const cases: Array<{
      cls: string | null | undefined;
      con: number;
      subrace: string | null;
      options?: { draconicBloodline?: boolean };
    }> = [
      { cls: 'Fighter', con: 16, subrace: 'Hill Dwarf' },
      { cls: 'Wizard', con: 16, subrace: 'Hill Dwarf' },
      { cls: 'Barbarian', con: 16, subrace: 'Hill Dwarf' },
      { cls: 'Fighter', con: 12, subrace: 'Mountain Dwarf' },
      { cls: 'Fighter', con: 12, subrace: null },
      { cls: 'Wizard', con: 1, subrace: null },
      { cls: 'Eldritch Knight', con: 14, subrace: null },
      { cls: undefined, con: 14, subrace: null },
      { cls: null, con: 14, subrace: null },
      { cls: '', con: 14, subrace: null },
      { cls: 'Sorcerer', con: 14, subrace: null, options: { draconicBloodline: true } },
      { cls: 'Sorcerer', con: 16, subrace: 'Hill Dwarf', options: { draconicBloodline: true } },
      { cls: 'Wizard', con: 14, subrace: null, options: { draconicBloodline: true } },
    ];
    for (const { cls, con, subrace, options } of cases) {
      expect(computeMaxHitPointsForLevel(cls, con, subrace, 1, options)).toBe(
        computeLevel1MaxHitPoints(cls, con, subrace, options),
      );
    }
  });

  it("computes the issue's proving case: a level-3 Fighter with CON 14 gets 28", () => {
    // Level 1: 10 (d10) + 2 (CON) = 12; two more levels at the fixed
    // average: 2 × (6 + 2) = 16; total 28.
    expect(computeMaxHitPointsForLevel('Fighter', 14, null, 3)).toBe(28);
    expect(computeMaxHitPointsForLevel('Fighter', 14, null, 2)).toBe(20);
    expect(computeMaxHitPointsForLevel('Fighter', 14, null, 1)).toBe(12);
  });

  it('adds Dwarven Toughness once per level', () => {
    // Level 1: 10 + 3 (CON 16) + 1 = 14; each further level: 6 + 3 + 1 = 10.
    expect(computeMaxHitPointsForLevel('Fighter', 16, 'Hill Dwarf', 3)).toBe(34);
  });

  it('adds Draconic Resilience once per level for a Draconic Bloodline sorcerer', () => {
    // Level 1: 6 + 2 (CON 14) + 1 = 9; each further level: 4 + 2 + 1 = 7.
    expect(computeMaxHitPointsForLevel('Sorcerer', 14, null, 3, { draconicBloodline: true })).toBe(
      23,
    );
    // A Wild Magic sorcerer (no flag) gains no resilience at any level:
    // level 1 is 6 + 2 = 8, each further level 4 + 2 = 6.
    expect(computeMaxHitPointsForLevel('Sorcerer', 14, null, 3)).toBe(20);
  });

  it('keeps the 1 HP per level floor with a negative CON modifier', () => {
    // Wizard CON 5 (mod −3): level 1 is 6 − 3 = 3; each further level is
    // the fixed average 4 − 3 = 1, already at the floor.
    expect(computeMaxHitPointsForLevel('Wizard', 5, null, 3)).toBe(5);
    // Wizard CON 1 (mod −5): level 1 floors at 1 (6 − 5) and each further
    // level floors at 1 (4 − 5 < 1), so level 3 is 3, never negative.
    expect(computeMaxHitPointsForLevel('Wizard', 1, null, 3)).toBe(3);
  });

  it('uses the d8 fallback per level for a missing class', () => {
    // Level 1: 8 + 2 = 10; each further level: 5 + 2 = 7.
    expect(computeMaxHitPointsForLevel(undefined, 14, null, 3)).toBe(24);
  });

  it('treats level 0 or a missing level as level 1', () => {
    expect(computeMaxHitPointsForLevel('Fighter', 14, null, 0)).toBe(12);
    expect(computeMaxHitPointsForLevel('Fighter', 14, null, undefined)).toBe(12);
  });

  it('still throws on a non-empty unresolvable class at higher levels', () => {
    expect(() => computeMaxHitPointsForLevel('Wizzard', 14, null, 3)).toThrow(
      /unresolvable class "Wizzard"/,
    );
  });
});

describe('dwarvenToughnessBonus (#620)', () => {
  it('grants +1 HP for a Hill Dwarf, case-insensitively', () => {
    expect(dwarvenToughnessBonus('Hill Dwarf')).toBe(1);
    expect(dwarvenToughnessBonus('hill dwarf')).toBe(1);
  });

  it('grants nothing otherwise', () => {
    expect(dwarvenToughnessBonus('Mountain Dwarf')).toBe(0);
    expect(dwarvenToughnessBonus(null)).toBe(0);
    expect(dwarvenToughnessBonus(undefined)).toBe(0);
  });
});

describe('#989 Tough', () => {
  it('adds two HP per level exactly once', () => {
    expect(computeLevel1MaxHitPoints('Fighter', 14, 'Variant Human', { tough: true })).toBe(14);
    expect(computeMaxHitPointsForLevel('Fighter', 14, 'Variant Human', 3, { tough: true })).toBe(
      34,
    );
    expect(computeLevel1MaxHitPoints('Fighter', 14, 'Variant Human')).toBe(12);
  });
});
