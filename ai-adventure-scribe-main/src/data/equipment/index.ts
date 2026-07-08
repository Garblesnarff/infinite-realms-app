export type { Equipment } from './types';
export { weapons, getWeaponDamageDice } from './weapons';
export { armor } from './armor';
export { shields } from './shields';
export { adventuringGear } from './gear';

import { armor } from './armor';
import { adventuringGear } from './gear';
import { shields } from './shields';
import { weapons } from './weapons';
import magicItemData from '@/data/srd/magic-items.json';

import type { Equipment } from './types';

export const magicItems = magicItemData as Equipment[];
export const allEquipment: Equipment[] = [...weapons, ...armor, ...shields, ...adventuringGear, ...magicItems];

/**
 * ⚡ Bolt: Shared O(1) equipment lookup Map.
 * Used to avoid O(N) linear searches across the application.
 */
export const EQUIPMENT_LOOKUP = new Map<string, Equipment>(
  allEquipment.map((eq) => [eq.id, eq])
);
