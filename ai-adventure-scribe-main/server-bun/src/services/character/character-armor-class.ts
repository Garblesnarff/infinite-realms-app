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

import { isAlreadyOnSheet, sheetItemNameSet } from './sheet-item-names.js';
import { db } from '../../../../db/client';
import {
  characterEquipment,
  characterStats,
  characterSubclasses,
  characters,
  inventoryItems,
} from '../../../../db/schema/index';
import { abilityModifier } from '../../../../shared/ability-modifier';
import { computeArmorClass, type ArmorClassEquipmentItem } from '../../../../shared/armor-class';
import { isDraconicBloodline } from '../../../../shared/class-feature-choices';
import { logger } from '../../lib/logger.js';

/** `inventory_items` has no shield type; the legacy table does, so both are accepted. */
const ARMOR_ITEM_TYPES = ['armor', 'shield'];

/**
 * Whether the character holds the Draconic Bloodline subclass row — the
 * second carrier of the Draconic pick next to the wizard's `classFeatures`
 * choice string. A premade body carries the pick only in its `subclass`
 * field, so for a premade the row `CharacterService.create` records is the
 * ONLY place the bloodline exists; every derived-stat reader that consults
 * just `classFeatures` silently loses Draconic Resilience for premades
 * (#1019). Readers OR this check with `isDraconicBloodline(classFeatures)`.
 */
export async function hasDraconicBloodlineSubclass(characterId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: characterSubclasses.id })
    .from(characterSubclasses)
    .where(
      and(
        eq(characterSubclasses.characterId, characterId),
        eq(characterSubclasses.subclassName, 'Draconic Bloodline'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface RecomputedArmorClass {
  previousArmorClass: number | null;
  armorClass: number;
  changed: boolean;
}

/**
 * The equipment rows the armour-class rule reads, merged across the two
 * tables the sheet writes. Shared with the stats upsert (#620) so HP/AC
 * recomputation sees the same kit the equipment sync sees.
 */
export async function readArmorClassEquipment(
  characterId: string,
): Promise<ArmorClassEquipmentItem[]> {
  const [legacyRows, inventoryRows] = await Promise.all([
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

  const sheetNames = sheetItemNameSet(legacyRows.map((row) => row.name));
  const rows = [
    ...legacyRows,
    ...inventoryRows.filter((row) => !isAlreadyOnSheet(sheetNames, row.name)),
  ];
  return rows.map((row) => ({
    item_name: row.name,
    item_type: row.itemType,
    equipped: row.equipped,
  }));
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
  const [stats, equipment, character] = await Promise.all([
    db.query.characterStats.findFirst({
      where: eq(characterStats.characterId, characterId),
      columns: { dexterity: true, armorClass: true },
    }),
    readArmorClassEquipment(characterId),
    db.query.characters.findFirst({
      where: eq(characters.id, characterId),
      columns: { fightingStyles: true, class: true, classFeatures: true },
    }),
  ]);

  if (!stats) return null;

  // Creation stores SRD armour as item_type "equipment". A type-only check
  // skips Chain Mail and Shield, so Equip never moves the stored AC (#711).
  const wornByName = computeArmorClass(
    equipment.map((item) => ({ ...item, equipped: true })),
    0,
  );
  const ownsArmor =
    equipment.some((item) =>
      ARMOR_ITEM_TYPES.includes((item.item_type ?? '').trim().toLowerCase()),
    ) || wornByName !== computeArmorClass([], 0);
  if (!ownsArmor) return null;

  const armorClass = computeArmorClass(equipment, abilityModifier(stats.dexterity ?? 10), {
    fightingStyles: character?.fightingStyles,
    // A Draconic Bloodline sorcerer who takes their armour off falls back to
    // the Draconic Resilience base of 13, not 10. The pick is read from the
    // wizard's choice string OR the subclass row — a premade carries it only
    // in the row (#1019).
    draconicResilience:
      (character?.class ?? '').trim().toLowerCase() === 'sorcerer' &&
      (isDraconicBloodline(character?.classFeatures) ||
        (await hasDraconicBloodlineSubclass(characterId))),
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
