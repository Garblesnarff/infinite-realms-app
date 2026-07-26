/**
 * What a character is actually holding and wearing.
 *
 * This exists so the DM prompt can be built from the character sheet instead of from a table
 * of class defaults. The weapons come back through `listEquippedWeaponProfiles` — the exact
 * function the attack engine resolves with — so the numbers the model is shown are the numbers
 * that will be rolled. Armour is reported by name with the sheet's own armour class; nothing
 * here derives an AC, because `character_stats.armor_class` is already the authoritative one.
 *
 * @module server/services/combat/equipped-loadout
 */
import { and, asc, eq, inArray } from 'drizzle-orm';

import { listEquippedWeaponProfiles, verifyCharacterOwnership } from './data-access.js';
import { db } from '../../../../db/client';
import { characterEquipment, characterStats, inventoryItems } from '../../../../db/schema/index';

import type { WeaponRuleProfile } from './combat-rules.js';

export type EquippedLoadout = {
  weapons: WeaponRuleProfile[];
  /** Equipped armour and shields, by the name on the sheet. */
  armor: string[];
  /** The sheet's armour class, or null when the character has no stats row yet. */
  armorClass: number | null;
};

/** `inventory_items` has no shield type; the legacy table does, so both are accepted. */
const ARMOR_TYPES = ['armor', 'shield'];

export async function getEquippedLoadout(
  characterId: string,
  userId: string,
): Promise<EquippedLoadout> {
  await verifyCharacterOwnership(characterId, userId);

  const [weapons, inventoryArmor, legacyArmor, stats] = await Promise.all([
    listEquippedWeaponProfiles({ characterId }),
    db
      .select({ name: inventoryItems.name })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.characterId, characterId),
          eq(inventoryItems.isEquipped, true),
          inArray(inventoryItems.itemType, ARMOR_TYPES),
        ),
      )
      .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.id)),
    db
      .select({ name: characterEquipment.itemName })
      .from(characterEquipment)
      .where(
        and(
          eq(characterEquipment.characterId, characterId),
          eq(characterEquipment.equipped, true),
          inArray(characterEquipment.itemType, ARMOR_TYPES),
        ),
      )
      .orderBy(asc(characterEquipment.itemName), asc(characterEquipment.id)),
    db.query.characterStats.findFirst({
      where: eq(characterStats.characterId, characterId),
      columns: { armorClass: true },
    }),
  ]);

  return {
    weapons,
    armor: [...inventoryArmor.map((row) => row.name), ...legacyArmor.map((row) => row.name)],
    armorClass: stats?.armorClass ?? null,
  };
}
