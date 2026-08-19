/**
 * Keeps `character_stats.armor_class` equal to what the character is wearing.
 *
 * AC is stored, not computed on read — `services/combat/equipped-loadout.ts` treats the stored
 * value as authoritative and the combat engine never derives one — so the number has to be
 * rewritten whenever the equipment behind it changes. The rule itself lives in
 * `shared/armor-class.ts`; this module is only the database half of it: read what is equipped,
 * ask the rule, write the answer back (#1858).
 *
 * Deliberately narrow. A character with no armour or shield anywhere in their kit is never
 * touched: their stored AC may have been set by hand — a DM-authored NPC, a monk's or
 * barbarian's Unarmored Defense — and overwriting that with `10 + DEX` would be a downgrade
 * dressed up as a fix. Only characters whose AC is genuinely equipment-derived are rewritten,
 * which also means unequipping the last piece of armour still recomputes correctly.
 *
 * @module server/services/character/character-armor-class
 */
import { and, eq, inArray } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { characterEquipment, characterStats, inventoryItems } from '../../../../db/schema/index';
import {
  abilityScoreModifier,
  computeArmorClass,
  type ArmorClassEquipmentItem,
} from '../../../../shared/armor-class';
import { logger } from '../../lib/logger.js';

/** `inventory_items` has no shield type; the legacy table does, so both are accepted. */
const ARMOR_ITEM_TYPES = ['armor', 'shield'];

export interface RecomputedArmorClass {
  previousArmorClass: number | null;
  armorClass: number;
  changed: boolean;
}

/**
 * Recompute and store one character's armour class.
 *
 * Returns `null` when there is nothing to decide — no stats row, or no armour and no shield in
 * the character's kit — and never writes in that case.
 */
export async function recomputeStoredArmorClass(
  characterId: string,
): Promise<RecomputedArmorClass | null> {
  const [stats, legacyRows, inventoryRows] = await Promise.all([
    db.query.characterStats.findFirst({
      where: eq(characterStats.characterId, characterId),
      columns: { dexterity: true, armorClass: true },
    }),
    db
      .select({
        name: characterEquipment.itemName,
        itemType: characterEquipment.itemType,
        equipped: characterEquipment.equipped,
      })
      .from(characterEquipment)
      .where(eq(characterEquipment.characterId, characterId)),
    db
      .select({
        name: inventoryItems.name,
        itemType: inventoryItems.itemType,
        equipped: inventoryItems.isEquipped,
      })
      .from(inventoryItems)
      .where(
        and(
          eq(inventoryItems.characterId, characterId),
          inArray(inventoryItems.itemType, ARMOR_ITEM_TYPES),
        ),
      ),
  ]);

  if (!stats) return null;

  const rows = [...legacyRows, ...inventoryRows];
  const ownsArmor = rows.some((row) =>
    ARMOR_ITEM_TYPES.includes((row.itemType ?? '').trim().toLowerCase()),
  );
  if (!ownsArmor) return null;

  const equipment: ArmorClassEquipmentItem[] = rows.map((row) => ({
    item_name: row.name,
    item_type: row.itemType,
    equipped: row.equipped,
  }));

  const armorClass = computeArmorClass(equipment, abilityScoreModifier(stats.dexterity ?? 10), {
    warn: (msg, context) => logger.warn({ msg, characterId, ...context }),
  });

  if (armorClass === stats.armorClass) {
    return { previousArmorClass: stats.armorClass, armorClass, changed: false };
  }

  await db
    .update(characterStats)
    .set({ armorClass, updatedAt: new Date() })
    .where(eq(characterStats.characterId, characterId));

  logger.info({
    msg: 'Recomputed stored armor class from equipment',
    characterId,
    previousArmorClass: stats.armorClass,
    armorClass,
  });

  return { previousArmorClass: stats.armorClass, armorClass, changed: true };
}

/**
 * Fire-and-log wrapper for the write paths.
 *
 * Equipping a shield must not fail because a derived stat could not be written; the backfill
 * script exists to repair anything this misses, so the error is logged and swallowed.
 */
export async function syncArmorClassAfterEquipmentChange(characterId: string): Promise<void> {
  try {
    await recomputeStoredArmorClass(characterId);
  } catch (error) {
    logger.error({ msg: 'Failed to recompute stored armor class', characterId, error });
  }
}
