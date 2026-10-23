/**
 * In-session equip (#1059).
 *
 * Until now the only way to equip a carried weapon was the standalone
 * character sheet's full-row save: in-session inventory rows were inert
 * text, so a weapon that shipped unequipped from its package (Hark
 * N23-008's shortbow, N23-009's light crossbow) could never be readied
 * during play, and the combat attack path refused it — 'not equipped'.
 *
 * Resolution mirrors attunement (the #619 pattern): the token is the
 * character_equipment row id (the sheet) or the item name (the game
 * loader sends the name), character_equipment first, inventory_items as
 * the fallback for a story grant that has no sheet row yet. The write
 * lands on BOTH tables for the resolved name, because the readers
 * disagree about which table is real: the sheet and the session sheet
 * read character_equipment, the combat weapon profiles read both.
 *
 * Equipping is deliberately permissive — any carried row can be
 * equipped, exactly like the sheet's toggle. Combat only ever reads
 * weapon rows, so equipping a lantern changes nothing but its flag.
 *
 * Armour class is stored, not derived on read, so — like the two
 * pre-existing equip write paths (the sheet save and
 * InventoryService.equipItem, #1858) — a successful equip re-syncs the
 * stored number from the new equipment state, and the result carries it
 * back so an in-session caller can show the AC the engine will use.
 */

import { and, eq } from 'drizzle-orm';

import { ownedBy, tokenMatch } from './attunement-token.js';
import { db } from '../../../../db/client';
import {
  characterEquipment,
  characterStats,
  inventoryItems,
} from '../../../../db/schema/index';
import { syncArmorClassAfterEquipmentChange } from '../character/character-armor-class.js';

type EquippableTable = typeof characterEquipment | typeof inventoryItems;

export interface EquipResult {
  success: boolean;
  item?: { id: string; name: string };
  /** The stored armor class after the post-equip re-sync. */
  armorClass?: number | null;
  error?: string;
}

function columns(table: EquippableTable): {
  id: typeof characterEquipment.id | typeof inventoryItems.id;
  name: typeof characterEquipment.itemName | typeof inventoryItems.name;
  characterId: typeof characterEquipment.characterId | typeof inventoryItems.characterId;
} {
  return table === characterEquipment
    ? {
        id: characterEquipment.id,
        name: characterEquipment.itemName,
        characterId: characterEquipment.characterId,
      }
    : {
        id: inventoryItems.id,
        name: inventoryItems.name,
        characterId: inventoryItems.characterId,
      };
}

async function findOwnedItem(
  table: EquippableTable,
  characterId: string,
  token: string,
  userId: string,
): Promise<{ id: string; name: string } | undefined> {
  const column = columns(table);
  const [row] = await db
    .select({ id: column.id, name: column.name })
    .from(table)
    .where(
      and(
        tokenMatch(column.id, column.name, token),
        eq(column.characterId, characterId),
        ownedBy(userId, column.characterId),
      ),
    )
    .limit(1);
  return row;
}

async function setEquippedByName(
  table: EquippableTable,
  characterId: string,
  userId: string,
  name: string,
): Promise<void> {
  const column = columns(table);
  const nameMatch = tokenMatch(column.id, column.name, name);
  if (table === characterEquipment) {
    await db
      .update(characterEquipment)
      .set({ equipped: true, updatedAt: new Date() })
      .where(
        and(nameMatch, eq(column.characterId, characterId), ownedBy(userId, column.characterId)),
      );
  } else {
    await db
      .update(inventoryItems)
      .set({ isEquipped: true, updatedAt: new Date() })
      .where(
        and(nameMatch, eq(column.characterId, characterId), ownedBy(userId, column.characterId)),
      );
  }
}

export class CharacterEquipService {
  /**
   * Equip one carried item for a character the user owns. Idempotent:
   * equipping an already-equipped item succeeds and changes nothing.
   */
  static async equipItem(
    characterId: string,
    userId: string,
    token: string,
  ): Promise<EquipResult> {
    const hit =
      (await findOwnedItem(characterEquipment, characterId, token, userId)) ??
      (await findOwnedItem(inventoryItems, characterId, token, userId));
    if (!hit) return { success: false, error: 'Item not found' };

    await setEquippedByName(characterEquipment, characterId, userId, hit.name);
    await setEquippedByName(inventoryItems, characterId, userId, hit.name);
    // The sync never throws (it logs and leaves the backfill script to
    // repair), so the equip still succeeds if the recompute cannot run.
    await syncArmorClassAfterEquipmentChange(characterId);
    const [stats] = await db
      .select({ armorClass: characterStats.armorClass })
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId))
      .limit(1);
    return { success: true, item: hit, armorClass: stats?.armorClass ?? null };
  }
}
