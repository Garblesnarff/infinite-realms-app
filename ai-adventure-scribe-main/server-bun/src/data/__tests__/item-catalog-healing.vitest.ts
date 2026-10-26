/**
 * #1147 FIX round: healing potions resolve as consumables with healing dice.
 *
 * The SRD rows carry no machine-readable healing field (their descriptions
 * spell it out in prose), and the catalog built properties from weapon/armor
 * stats only — so a story-granted Potion of Healing used to land as equipment
 * with no healingDice, and the offer filter never saw it. This pins the
 * name-keyed table: all four SRD potions, plus a non-potion control.
 */
import { describe, expect, test } from 'vitest';

import { resolveCatalogItem } from '../itemCatalog.js';

describe('resolveCatalogItem healing potions', () => {
  test.each([
    ['Potion of Healing', '2d4+2'],
    ['Potion of Greater Healing', '4d4+4'],
    ['Potion of Superior Healing', '8d4+8'],
    ['Potion of Supreme Healing', '10d4+20'],
  ])('%s resolves as a consumable with healingDice %s', (name, healingDice) => {
    const item = resolveCatalogItem(name);
    expect(item).not.toBeNull();
    expect(item!.itemType).toBe('consumable');
    expect(
      (JSON.parse(item!.properties ?? '{}') as { healingDice?: unknown }).healingDice,
    ).toBe(healingDice);
  });

  test('a non-potion catalog item keeps its category type and gains no healing dice', () => {
    const item = resolveCatalogItem('Longsword');
    expect(item).not.toBeNull();
    expect(item!.itemType).toBe('weapon');
    expect(
      (JSON.parse(item!.properties ?? '{}') as { healingDice?: unknown }).healingDice,
    ).toBeUndefined();
  });
});
