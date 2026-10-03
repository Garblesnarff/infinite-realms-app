/**
 * Weapon attack bonuses for the character sheet.
 *
 * The attack dialog shows the engine's number, so the sheet must derive the same number
 * the same way or the two disagree (issue #2519: Scholar quarterstaff sheet −1 vs
 * engine +1). The engine is server-bun/src/services/combat/data-access.ts
 * (`characterCanUseWeapon`) + combat-rules.ts (`resolveAttackRules`): DEX for ranged
 * weapons, the better of STR/DEX for finesse weapons, and the proficiency bonus only
 * when the character is proficient with the weapon. This helper is the client mirror of
 * that rule; when the engine's rule changes, change this with it.
 *
 * The engine's proficiency rule is broader than the SRD class lists in one place: it
 * grants every simple weapon to every class, where SRD 5.1 gives Wizards, Sorcerers and
 * Druids a short named list. Mirroring the engine keeps sheet and dialog equal for
 * every weapon a character can hold; narrowing the engine to the SRD lists is a server
 * fix (noted in the #2519 PR), after which this helper narrows with it.
 *
 * Beyond the class rule, any weapon proficiencies the character data itself carries
 * (subrace lists) also count, matching how the character was built.
 */

import type { Equipment } from '@/data/equipment/types';
import type { Character } from '@/types/character';

import { resolveEquipmentById, resolveEquipmentByName } from '@/data/equipment/resolver';

const normalizeKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/**
 * True when a carried proficiency list entry covers this weapon: a category entry
 * ("Simple weapons" / "Martial weapons") or the weapon's own name in either
 * form the lists use ("Daggers", "Light crossbows", "Hand crossbows").
 */
function proficiencyListCovers(entry: string, weapon: Equipment): boolean {
  const key = normalizeKey(entry);
  if (key === 'simpleweapons' || key === 'simple') return weapon.weaponType === 'simple';
  if (key === 'martialweapons' || key === 'martial') return weapon.weaponType === 'martial';
  const resolved = resolveEquipmentByName(entry) ?? resolveEquipmentById(entry);
  return resolved?.id === weapon.id;
}

/**
 * The engine's class proficiency rule (characterCanUseWeapon), by class name:
 * every simple weapon for every class; martial weapons for the martial classes;
 * the Bard/Rogue short list; scimitar for Druids; shortsword for Monks.
 * The server's Bard/Rogue list also names 'hand-crossbow', which never matches the
 * catalog id 'crossbow-hand', so the engine grants no hand-crossbow proficiency
 * today — mirrored here so the sheet stays equal to the dialog (see #2519 PR).
 */
function engineClassProficiency(className: string, weapon: Equipment): boolean {
  if (weapon.weaponType === 'simple') return true;
  const cls = className.toLowerCase();
  if (['barbarian', 'fighter', 'paladin', 'ranger'].some((name) => cls.includes(name))) {
    return true;
  }
  if (
    (cls.includes('bard') || cls.includes('rogue')) &&
    ['longsword', 'rapier', 'shortsword'].includes(weapon.id)
  ) {
    return true;
  }
  if (cls.includes('druid') && weapon.id === 'scimitar') return true;
  return cls.includes('monk') && weapon.id === 'shortsword';
}

function isProficient(character: Character, weapon: Equipment): boolean {
  const className = character.class?.name ?? character.class?.id ?? '';
  if (engineClassProficiency(className, weapon)) return true;
  return (character.subrace?.weaponProficiencies ?? []).some((entry) =>
    proficiencyListCovers(entry, weapon),
  );
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
