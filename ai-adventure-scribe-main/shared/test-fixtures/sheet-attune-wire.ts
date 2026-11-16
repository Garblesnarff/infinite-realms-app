/**
 * #619: the attune request the sheet sends.
 *
 * POST, no body. The path token is the row id (character_equipment.id or
 * inventory_items.id), not the item name. Client and server tests both build
 * the path with sheetAttunePath so the route sees the same request shape.
 */

/** A character_equipment row id. Not an item name. */
export const SHEET_ATTUNE_ROW_ID = 'c4e8a1b2-6d3f-4a5e-9b7c-1d2e3f4a5b6c';

export function sheetAttunePath(characterId: string, itemId: string): string {
  return `/v1/characters/${encodeURIComponent(characterId)}/attune/${encodeURIComponent(itemId)}`;
}
