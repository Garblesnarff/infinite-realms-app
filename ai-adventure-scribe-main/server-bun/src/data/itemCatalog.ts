/**
 * #218 FIX round 3: server-side item catalog for story-granted items.
 *
 * The client owns the equipment data (src/data/equipment + src/data/srd); the
 * server reads the same files through relative imports, the way spellData.ts
 * reads src/data/srd/spells.json. There is no @/ alias on the server, so the
 * client resolver (which imports through @/) is not reusable here.
 *
 * A found "Longsword" resolves to the catalog row — right type and stats on the
 * inventory row. A name the catalog does not hold falls back to a free-text
 * "equipment" row (the caller handles that).
 */

import { armor } from '../../../src/data/equipment/armor.js';
import { adventuringGear } from '../../../src/data/equipment/gear.js';
import { shields } from '../../../src/data/equipment/shields.js';
import magicItemsData from '../../../src/data/srd/magic-items.json';
import weaponsData from '../../../src/data/srd/weapons.json';

import type { Equipment } from '../../../src/data/equipment/types.js';

export type CatalogItem = {
  /** Canonical catalog name ("Longsword"), used for quantity merging. */
  name: string;
  /** One of inventory_items.item_type's values. */
  itemType: string;
  weight: number;
  description: string;
  /** JSON string of the stats that matter on the sheet, or null. */
  properties: string | null;
  requiresAttunement: boolean;
};

const byName = new Map<string, Equipment>();
for (const item of [
  ...(weaponsData as Equipment[]),
  ...armor,
  ...shields,
  ...adventuringGear,
  ...(magicItemsData as Equipment[]),
]) {
  const key = item.name.trim().toLowerCase();
  if (!byName.has(key)) byName.set(key, item);
}

function toItemType(category: Equipment['category']): string {
  switch (category) {
    case 'weapon':
      return 'weapon';
    case 'armor':
    case 'shield':
      return 'armor';
    case 'consumable':
      return 'consumable';
    case 'trinket':
      return 'treasure';
    default:
      return 'equipment';
  }
}

/** Case-insensitive catalog lookup. Null when the name is not cataloged. */
export function resolveCatalogItem(name: string): CatalogItem | null {
  const item = byName.get(name.trim().toLowerCase());
  if (!item) return null;
  const stats: Record<string, unknown> = {};
  if (item.damage) stats.damage = item.damage;
  if (item.versatileDamage) stats.versatileDamage = item.versatileDamage;
  if (item.properties?.length) stats.properties = item.properties;
  if (item.weaponType) stats.weaponType = item.weaponType;
  if (item.range) stats.range = item.range;
  if (item.armorClass) stats.armorClass = item.armorClass;
  if (item.armorType) stats.armorType = item.armorType;
  if (item.isMagic) stats.isMagic = true;
  if (item.magicItemRarity) stats.magicItemRarity = item.magicItemRarity;
  return {
    name: item.name,
    itemType: toItemType(item.category),
    weight: typeof item.weight === 'number' ? item.weight : 0,
    description: item.description || 'Found in the story',
    properties: Object.keys(stats).length ? JSON.stringify(stats) : null,
    requiresAttunement: item.requiresAttunement === true,
  };
}
