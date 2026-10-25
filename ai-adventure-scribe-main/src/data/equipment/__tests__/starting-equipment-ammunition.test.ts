import { describe, expect, it } from 'vitest';

import { getStartingEquipment } from '@/data/equipment/api';

const classes = [
  'fighter',
  'wizard',
  'rogue',
  'cleric',
  'barbarian',
  'bard',
  'druid',
  'monk',
  'paladin',
  'ranger',
  'sorcerer',
  'warlock',
];

describe('starting equipment ammunition bundles', () => {
  for (const className of classes) {
    it(`${className} package includes matching ammo bundle for ranged weapons`, () => {
      const items = getStartingEquipment(className);
      const ranged = items.filter((item) => item.weaponProperties?.ammunition);
      for (const weapon of ranged) {
        const isCrossbow = /crossbow/i.test(weapon.name) || /crossbow/i.test(weapon.id);
        const bundleId = isCrossbow ? 'bolts-20' : 'arrows-20';
        expect(items.some((item) => item.id === bundleId)).toBe(true);
      }
    });
  }
});
