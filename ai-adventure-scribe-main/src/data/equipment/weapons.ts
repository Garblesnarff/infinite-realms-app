import type { Equipment } from './types';

import data from '@/data/srd/weapons.json';

/** Deterministically generated from the 2014 SRD by scripts/import-srd-content.mjs. */
export const weapons = data as Equipment[];

export function getWeaponDamageDice(
  weapon: Equipment,
  wieldedTwoHanded = false,
): string | undefined {
  if (wieldedTwoHanded && weapon.weaponProperties?.versatile && weapon.versatileDamage) {
    return weapon.versatileDamage;
  }
  return weapon.damage?.dice;
}
