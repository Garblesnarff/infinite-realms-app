/**
 * The damage line the sheet shows beside an attack ("1d8+3 slashing").
 *
 * Same arithmetic as the engine's `resolveAttackRules` (server-bun/src/services/combat/
 * combat-rules.ts): damage dice from the weapon, plus the ability modifier of the ability the
 * attack uses (DEX for ranged, the better of STR/DEX for finesse, STR otherwise) plus the
 * weapon's magic bonus. No proficiency on damage.
 */

import { abilityModifier } from '../../../shared/ability-modifier';
import { duelingDamageBonus } from '../../../shared/fighting-style';

import type { Character } from '@/types/character';

import { resolveEquipmentById, resolveEquipmentByName } from '@/data/equipment/resolver';

const abilityMod = (score?: number): number => abilityModifier(score ?? 10);

/** Null when the key does not resolve to a catalog weapon with damage dice. */
export function getWeaponDamageText(
  character: Character,
  weaponKey: string,
  magicBonus = 0,
): string | null {
  const weapon = resolveEquipmentById(weaponKey) ?? resolveEquipmentByName(weaponKey);
  if (!weapon || weapon.category !== 'weapon' || !weapon.damage) return null;

  const strScore = character.abilityScores?.strength?.score ?? 10;
  const dexScore = character.abilityScores?.dexterity?.score ?? 10;
  const ranged = (weapon.range?.normal ?? 5) > 5;
  const useDex = ranged || (weapon.weaponProperties?.finesse && dexScore > strScore);
  const meleeWeapon = !(weapon.subcategory ?? '').toLowerCase().includes('ranged');
  // Count equipped weapon rows, not distinct catalog ids. Two Longswords share one id
  // and still occupy both hands. A stowed weapon is not wielded.
  const equippedWeaponCount = (character.inventory ?? []).filter((row) => {
    if (!row.equipped) return false;
    const other =
      resolveEquipmentById(row.itemId) ?? resolveEquipmentByName(row.itemName ?? row.itemId);
    return other?.category === 'weapon';
  }).length;
  const otherWeaponWielded = equippedWeaponCount >= 2;
  const bonus =
    abilityMod(useDex ? dexScore : strScore) +
    magicBonus +
    duelingDamageBonus(character.fightingStyles, {
      meleeWeapon,
      twoHanded: weapon.weaponProperties?.twoHanded === true,
      otherWeaponWielded,
    });
  const modifier = bonus === 0 ? '' : bonus > 0 ? `+${bonus}` : `${bonus}`;

  return `${weapon.damage.dice}${modifier} ${weapon.damage.type}`;
}
