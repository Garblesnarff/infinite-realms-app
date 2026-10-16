import { eq, and, or, sql, exists, type AnyColumn, type SQL } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { inventoryItems, characterEquipment, characters } from '../../../../db/schema/index';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AttunableTable = typeof characterEquipment | typeof inventoryItems;

/** Sheet row id, or the item name the game loader sends. A name is never cast to uuid. */
export function tokenMatch(idColumn: AnyColumn, nameColumn: AnyColumn, token: string): SQL {
  const nameMatch = sql`lower(${nameColumn}) = ${token.trim().toLowerCase()}`;
  if (!UUID_PATTERN.test(token)) return nameMatch;
  return or(eq(idColumn, token), nameMatch) ?? nameMatch;
}

/**
 * Display name of the row the other table resolves for this token.
 * Unattune-by-UUID uses it so a same-name story grant loses the slot too.
 */
export function siblingName(
  nameColumn: AnyColumn,
  otherTable: AttunableTable,
  otherId: AnyColumn,
  otherName: AnyColumn,
  otherCharacterId: AnyColumn,
  characterId: string,
  token: string,
): SQL {
  return sql`lower(${nameColumn}) = (
    SELECT lower(${otherName}) FROM ${otherTable}
    WHERE ${otherCharacterId} = ${characterId}
      AND ${tokenMatch(otherId, otherName, token)}
    LIMIT 1
  )`;
}

/** Distinct attuned names across both tables. One shared name is one slot. */
export function attunedNameCount(characterId: string): SQL<number> {
  return sql<number>`(
    SELECT count(*)::int FROM (
      SELECT lower(${characterEquipment.itemName}) AS name
      FROM ${characterEquipment}
      WHERE ${characterEquipment.characterId} = ${characterId}
        AND ${characterEquipment.isAttuned} = true
      UNION
      SELECT lower(${inventoryItems.name}) AS name
      FROM ${inventoryItems}
      WHERE ${inventoryItems.characterId} = ${characterId}
        AND ${inventoryItems.isAttuned} = true
    ) attuned_names
  )`;
}

export function ownedBy(userId: string, characterIdColumn: AnyColumn): SQL {
  return exists(
    db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.id, characterIdColumn),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ),
      ),
  );
}
