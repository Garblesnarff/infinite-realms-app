/**
 * Weapon attack bonuses for the character sheet.
 *
 * The attack dialog shows the engine's number, so the sheet must derive the same number
 * the same way or the two disagree (issue #2519: Scholar quarterstaff sheet −1 vs
 * engine +1). The engine is server-bun/src/services/combat/data-access.ts
 * (`characterCanUseWeapon`) + combat-rules.ts (`resolveAttackRules`): DEX for ranged
 * weapons, the better of STR/DEX for finesse weapons, and the proficiency bonus only
 * when the character is proficient with the weapon.
 *
 * Proficiency comes from `shared/weapon-proficiency.ts`, which the engine reads too
 * (`characterCanUseWeapon` in server-bun/src/services/combat/data-access.ts), so the sheet and
 * the dialog cannot disagree about who is proficient with what (#2540, #2541). That module holds
 * the SRD 5.1 class lists plus the proficiencies the character record carries.
 *
 * @see /shared/weapon-proficiency.ts
 */

import { isWeaponProficient } from '../../../shared/weapon-proficiency';

import type { WeaponProficiencySubject } from '../../../shared/weapon-proficiency';
import type { Equipment } from '@/data/equipment/types';
import type { Character } from '@/types/character';

import { resolveEquipmentById, resolveEquipmentByName } from '@/data/equipment/resolver';

/**
 * The character as the shared rule reads it: class, race and subrace by the names the record
 * carries, plus every proficiency list the record itself carries.
 */
function proficiencySubject(character: Character): WeaponProficiencySubject {
  return {
    className: character.class?.name ?? character.class?.id,
    raceName: character.race?.name,
    subraceName: character.subrace?.name,
    carriedProficiencies: [
      ...(character.class?.weaponProficiencies ?? []),
      ...(character.subrace?.weaponProficiencies ?? []),
    ],
  };
}

function isProficient(character: Character, weapon: Equipment): boolean {
  // A magic weapon resolves through its base weapon (Sun Blade -> longsword),
  // so a Fighter is proficient with one. Rows with no baseWeaponId (e.g.
  // "Weapon (any sword)") keep the old behavior: not proficient.
  return isWeaponProficient(weapon.baseWeaponId ?? weapon.id, proficiencySubject(character));
}

export interface WeaponAttackBonus {
  /** Ability modifier + (proficiency bonus when proficient) + magic bonus. */
  bonus: number;
  proficient: boolean;
  ability: 'strength' | 'dexterity';
}

const abilityMod = (score?: number): number => Math.floor(((score ?? 10) - 10) / 2);

/**
 * The sheet's attack bonus for one inventory weapon, computed the way the
 * engine computes it. `weaponKey` is the inventory itemId, which the sheet
 * already treats as the weapon slug/name. Returns null when the key does not
 * resolve to a weapon at all.
 */
export function getWeaponAttackBonus(
  character: Character,
  weaponKey: string,
  proficiencyBonus: number,
  magicBonus = 0,
): WeaponAttackBonus | null {
  const weapon = resolveEquipmentById(weaponKey) ?? resolveEquipmentByName(weaponKey);
  if (!weapon || weapon.category !== 'weapon') return null;

  const strScore = character.abilityScores?.strength?.score ?? 10;
  const dexScore = character.abilityScores?.dexterity?.score ?? 10;
  const strMod = abilityMod(strScore);
  const dexMod = abilityMod(dexScore);
  const ranged = (weapon.range?.normal ?? 5) > 5;
  const ability =
    ranged || (weapon.weaponProperties?.finesse && dexScore > strScore) ? 'dexterity' : 'strength';
  const proficient = isProficient(character, weapon);

  return {
    bonus:
      (ability === 'dexterity' ? dexMod : strMod) +
      (proficient ? proficiencyBonus : 0) +
      magicBonus,
    proficient,
    ability,
  };
}
