import { describe, it, expect } from 'vitest';

import {
  FALLBACK_HIT_DIE,
  computeLevel1MaxHitPoints,
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
