import { describe, expect, test } from 'bun:test';

import { ammunitionForWeapon, isAmmunition } from './ammunition';

describe('ammunition matching', () => {
  test('maps ammunition weapons and excludes containers', () => {
    for (const [weapon, ammo, container] of [
      ['Light Crossbow', 'Crossbow Bolts (20)', 'Case, crossbow bolt'],
      ['Longbow', 'Arrows (20)', 'Quiver'],
      ['Sling', 'Sling Bullets (20)', 'Case of bullets'],
      ['Blowgun', 'Blowgun Needles (50)', 'Case of needles'],
    ] as const) {
      const kind = ammunitionForWeapon(weapon);
      expect(kind).not.toBeNull();
      expect(isAmmunition(ammo, kind!)).toBe(true);
      expect(isAmmunition(container, kind!)).toBe(false);
    }
    expect(ammunitionForWeapon('Longsword')).toBeNull();
  });
});
