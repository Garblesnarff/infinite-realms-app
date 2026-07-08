import { describe, expect, it } from 'vitest';

import { getStartingEquipmentChoices, magicItems } from '@/data/equipment/api';
import { getWeaponDamageDice, weapons } from '@/data/equipment/weapons';
import { getAllClassFeaturesUpToLevel } from '@/data/levelProgression';

describe('Wave 4 SRD content', () => {
  it('imports all SRD weapons and swaps versatile damage when wielded two-handed', () => {
    expect(weapons).toHaveLength(37);
    const longsword = weapons.find((weapon) => weapon.id === 'longsword')!;
    expect(getWeaponDamageDice(longsword)).toBe('1d8');
    expect(getWeaponDamageDice(longsword, true)).toBe('1d10');
    expect(weapons.find((weapon) => weapon.id === 'crossbow-heavy')?.weaponProperties).toMatchObject({ ammunition: true, loading: true });
  });

  it('seeds SRD magic items with rarity, attunement, and inferred effects', () => {
    expect(magicItems).toHaveLength(362);
    expect(magicItems.every((item) => item.magicItemRarity && item.magicEffects)).toBe(true);
    expect(magicItems.some((item) => item.requiresAttunement)).toBe(true);
  });

  it('provides every class progression through level 20', () => {
    const classes = ['barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue', 'sorcerer', 'warlock', 'wizard'];
    for (const className of classes) {
      const features = getAllClassFeaturesUpToLevel(className, 20);
      expect(features.length).toBeGreaterThan(0);
      expect(Math.max(...features.map((feature) => feature.level))).toBe(20);
    }
  });

  it('expands SRD starting equipment alternatives and quantities', () => {
    const barbarian = getStartingEquipmentChoices('barbarian');
    expect(barbarian.fixed.some((item) => item.equipment.id === 'javelin' && item.quantity === 4)).toBe(true);
    expect(barbarian.choices[0].alternatives.some((option) => option.items.some((item) => item.equipment.id === 'greataxe'))).toBe(true);
    expect(barbarian.choices[0].alternatives.some((option) => option.items.some((item) => item.equipment.id === 'longsword'))).toBe(true);
  });
});
