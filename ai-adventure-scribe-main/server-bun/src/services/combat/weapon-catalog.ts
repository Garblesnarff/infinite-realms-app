/**
 * The SRD weapon catalog, and the name-matching rules everything else agrees on.
 *
 * This used to live inside `data-access.ts`, which meant only code with a database handle
 * could ask "is 'longbow' a real weapon, and is it ranged?". Grounding a DM's narrated weapon
 * name needs exactly that question answered without a query, so the catalog lives here and
 * `data-access` imports it like everyone else.
 *
 * @module server/services/combat/weapon-catalog
 */
import weaponCatalog from '../../../../src/data/srd/weapons.json';

export type CatalogWeapon = {
  id: string;
  name: string;
  subcategory?: string;
  damage?: { dice?: string; type?: string };
  range?: { normal?: number; long?: number };
  weaponProperties?: { finesse?: boolean };
};

const catalogWeapons = weaponCatalog as CatalogWeapon[];

/** Collapses "Shortsword", "short-sword", and "SHORT SWORD" onto one key. */
export const normalizeWeaponName = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const findCatalogWeapon = (value: string): CatalogWeapon | undefined => {
  const key = normalizeWeaponName(value);
  return catalogWeapons.find(
    (weapon) => normalizeWeaponName(weapon.id) === key || normalizeWeaponName(weapon.name) === key,
  );
};

/**
 * True when `requestedWeaponId` names this equipped weapon — by row id, display name, or SRD
 * id. Structural on purpose: grounding asks this question with no database handle in reach.
 */
export function weaponProfileMatches(
  profile: { id: string; name: string },
  requestedWeaponId: string,
): boolean {
  if (profile.id === requestedWeaponId) return true;
  const requested = normalizeWeaponName(requestedWeaponId);
  if (!requested) return false;
  if (normalizeWeaponName(profile.name) === requested) return true;
  return normalizeWeaponName(findCatalogWeapon(profile.name)?.id ?? '') === requested;
}

/**
 * Unarmed strike is a real rules fallback, not a fabricated weapon record. It is shared so the
 * "no weapon equipped" answer is the same object wherever the question is asked.
 */
const UNARMED_CLAIMS = new Set([
  'unarmedstrike',
  'unarmed',
  'punch',
  'fist',
  'fists',
  'kick',
  'headbutt',
  'shove',
  'grapple',
  'slap',
  'elbow',
]);

/** A punch, kick, or explicit unarmed strike — not "whatever is equipped". */
export function isUnarmedWeaponClaim(value: string | null | undefined): boolean {
  if (!value) return false;
  return UNARMED_CLAIMS.has(normalizeWeaponName(value));
}

export const UNARMED_STRIKE = {
  id: 'unarmed-strike',
  name: 'Unarmed Strike',
  damageDice: '1d1',
  damageType: 'bludgeoning',
  normalRange: 5,
  magicBonus: 0,
  finesse: false,
  ranged: false,
  proficient: true,
} as const;
