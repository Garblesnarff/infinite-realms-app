import { fetchWithAuth } from '@/infrastructure/api/rest-client';

/**
 * Equip a carried item in-session (#1059): POST /v1/characters/:id/equip/:itemId.
 * The token is the equipment row id or the item name — the in-session
 * sheet's rows carry the name, and the combat picker's equip-and-attack
 * choice carries the weapon profile's row id; the route resolves both.
 * The call has no request body: the equip is the whole call. Resolves
 * with the stored armor class the server re-synced after the equip
 * (armor is stored, not derived, so donning a shield moves it); throws
 * an Error the caller can show on failure.
 */
export interface EquipCharacterItemResult {
  armorClass: number | null;
}

export async function equipCharacterItem(
  characterId: string,
  itemToken: string,
): Promise<EquipCharacterItemResult> {
  const response = await fetchWithAuth(
    `/v1/characters/${encodeURIComponent(characterId)}/equip/${encodeURIComponent(itemToken)}`,
    { method: 'POST' },
  );
  if (!response.ok) {
    throw new Error(`Unable to equip ${itemToken}.`);
  }
  const body = (await response.json().catch(() => null)) as { armorClass?: unknown } | null;
  return { armorClass: typeof body?.armorClass === 'number' ? body.armorClass : null };
}
