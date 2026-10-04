import weaponCatalog from '../src/data/srd/weapons.json';

/** The shared name contract used by the character sheet and combat grounding. */
export const normalizeEquipmentName = (value: string): string =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES: Record<string, string> = {
  lightcrossbow: 'crossbow-light',
  heavycrossbow: 'crossbow-heavy',
  handcrossbow: 'crossbow-hand',
  twoshortswords: 'shortsword',
  handaxes: 'handaxe',
  handaxe: 'handaxe',
};

const CATALOG_IDS = new Set((weaponCatalog as Array<{ id: string }>).map((weapon) => weapon.id));

export function resolveWeaponName(value: string): string | undefined {
  const normalized = normalizeEquipmentName(value);
  const alias = ALIASES[normalized];
  if (alias) return alias;
  const dashed = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-');
  return CATALOG_IDS.has(dashed) ? dashed : undefined;
}

export function isCatalogWeaponName(value: string): boolean {
  return resolveWeaponName(value) !== undefined;
}
