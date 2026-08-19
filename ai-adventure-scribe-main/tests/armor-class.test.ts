/**
 * The rule behind #1858.
 *
 * "The Faithful" (Human Cleric 1, DEX 10) fought an entire encounter at AC 10 wearing Scale
 * Mail and a Shield, because `buildStarterCharacterSeed` wrote `10 + DEX` and nothing ever
 * looked at the equipment again. 14 + 0 + 2 = 16 is the number that should have been stored,
 * and the first test here is that exact loadout.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  SRD_ARMOR,
  abilityScoreModifier,
  computeArmorClass,
  describeArmorClass,
} from '../shared/armor-class';

import { armor as equipmentCatalogArmor } from '@/data/equipment/armor';

const worn = (itemName: string, itemType: string) => ({
  item_name: itemName,
  item_type: itemType,
  equipped: true,
});

describe('computeArmorClass', () => {
  it('gives The Faithful the 16 they should have been fighting at', () => {
    const equipment = [
      worn('Scale Mail', 'armor'),
      worn('Shield', 'shield'),
      worn('Mace', 'weapon'),
    ];

    expect(computeArmorClass(equipment, 0)).toBe(16);
  });

  it('caps the dexterity bonus of medium armour at +2 and keeps a penalty', () => {
    expect(computeArmorClass([worn('Scale Mail', 'armor')], 1)).toBe(15);
    expect(computeArmorClass([worn('Scale Mail', 'armor')], 4)).toBe(16);
    expect(computeArmorClass([worn('Scale Mail', 'armor')], -1)).toBe(13);
  });

  it('adds the whole dexterity bonus to light armour and none at all to heavy', () => {
    expect(computeArmorClass([worn('Leather Armor', 'armor')], 3)).toBe(14);
    expect(computeArmorClass([worn('Studded Leather', 'armor')], 3)).toBe(15);
    expect(computeArmorClass([worn('Chain Mail', 'armor')], 3)).toBe(16);
    expect(computeArmorClass([worn('Plate Armor', 'armor')], 3)).toBe(18);
  });

  it('is 10 + DEX unarmoured, and a shield is +2 either way', () => {
    expect(computeArmorClass([], 2)).toBe(12);
    expect(computeArmorClass(undefined, 2)).toBe(12);
    expect(computeArmorClass([worn('Shield', 'shield')], 2)).toBe(14);
    expect(computeArmorClass([worn('Half Plate', 'armor'), worn('Shield', 'shield')], 2)).toBe(19);
  });

  it('ignores armour that is carried but not worn', () => {
    expect(
      computeArmorClass([{ item_name: 'Plate Armor', item_type: 'armor', equipped: false }], 1),
    ).toBe(11);
  });

  it('reads the inventory_items shape as well as the character_equipment one', () => {
    expect(
      computeArmorClass([{ name: 'Chain Shirt', item_type: 'armor', is_equipped: true }], 3),
    ).toBe(15);
  });

  it('matches names through case, punctuation and SRD ids', () => {
    for (const name of ['scale mail', 'SCALE MAIL', 'scale-mail', 'Scale  Mail', 'scale_mail']) {
      expect(computeArmorClass([worn(name, 'armor')], 0)).toBe(14);
    }
  });

  it('never guesses at an unrecognized armour: it ignores it and warns', () => {
    const warn = vi.fn();

    expect(computeArmorClass([worn("Gastronomancer's Apron", 'armor')], 1, { warn })).toBe(11);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ itemName: "Gastronomancer's Apron" });
  });

  it('says nothing about equipment that was never armour in the first place', () => {
    const warn = vi.fn();

    expect(
      computeArmorClass([worn('Mace', 'weapon'), worn("Priest's Pack", 'gear')], 1, { warn }),
    ).toBe(11);
    expect(warn).not.toHaveBeenCalled();
  });

  it('wears the better of two equipped armours rather than stacking them', () => {
    expect(
      computeArmorClass([worn('Leather Armor', 'armor'), worn('Chain Mail', 'armor')], 3),
    ).toBe(16);
  });

  it('reports its working, which is what the backfill prints', () => {
    expect(describeArmorClass([worn('Scale Mail', 'armor'), worn('Shield', 'shield')], 0)).toEqual({
      armorClass: 16,
      armor: { name: 'Scale Mail', category: 'medium', base: 14 },
      dexterityBonus: 0,
      shieldBonus: 2,
      unrecognizedArmorNames: [],
    });
  });
});

describe('abilityScoreModifier', () => {
  it('is the 5e table', () => {
    expect(abilityScoreModifier(10)).toBe(0);
    expect(abilityScoreModifier(11)).toBe(0);
    expect(abilityScoreModifier(18)).toBe(4);
    expect(abilityScoreModifier(8)).toBe(-1);
    expect(abilityScoreModifier(7)).toBe(-2);
  });
});

describe('the shared SRD armour table', () => {
  /**
   * `shared/armor-class.ts` restates the armour table rather than importing
   * `src/data/equipment/armor.ts`, so that it stays dependency-free and importable from the
   * browser, the Bun server and a script alike. This is the pin that keeps the restatement
   * honest: if either side gains, loses or renumbers an entry, this fails.
   */
  it('agrees with the character sheet catalog entry for entry', () => {
    for (const entry of equipmentCatalogArmor) {
      const shared = SRD_ARMOR.find((row) => row.name === entry.name);
      expect(shared, `${entry.name} is missing from shared/armor-class.ts`).toBeDefined();
      expect(shared).toMatchObject({
        base: entry.armorClass?.base,
        category: entry.armorType,
      });
    }

    expect(SRD_ARMOR).toHaveLength(equipmentCatalogArmor.length);
  });
});
