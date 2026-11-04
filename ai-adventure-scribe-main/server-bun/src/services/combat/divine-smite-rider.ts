/**
 * Divine Smite's decisions (#1362, 2014 PHB p.85).
 *
 * Pure, so the refusal order and the dice can be unit-tested without a database, the way
 * hex-rider.ts keeps Hex's decision pure. combat-attack-service reads the attacker's class,
 * the weapon and the slot row, then asks this module what applies.
 */
import { divineSmiteDice } from '../../../../shared/limited-feature-counts';

export type DivineSmiteRefusal = 'smite_not_paladin' | 'smite_not_melee' | 'smite_no_slot';

export interface DivineSmiteRefusalInput {
  attackerIsPaladin: boolean;
  isMeleeWeaponAttack: boolean;
  slotLevel: number;
  /** Slots of exactly `slotLevel` the attacker has left. */
  slotsRemaining: number;
}

/**
 * The first reason a Smite cannot be declared, or null when it may be. Checked before the
 * attack is claimed or its d20 is rolled, so a refusal leaves nothing behind.
 */
export function divineSmiteRefusal(input: DivineSmiteRefusalInput): DivineSmiteRefusal | null {
  if (!input.attackerIsPaladin) return 'smite_not_paladin';
  if (!input.isMeleeWeaponAttack) return 'smite_not_melee';
  if (input.slotsRemaining < 1) return 'smite_no_slot';
  return null;
}

/** The words after "Divine Smite refused: " for a refusal reason. */
export function divineSmiteRefusalText(reason: DivineSmiteRefusal, slotLevel: number): string {
  switch (reason) {
    case 'smite_not_paladin':
      return 'only a Paladin can smite';
    case 'smite_not_melee':
      return 'it needs a melee weapon attack';
    case 'smite_no_slot':
      return `no level ${slotLevel} spell slot left`;
  }
}

/**
 * The d8 count for a Smite that applies: the slot's base dice, plus 1d8 against undead or
 * fiends, with every die doubled on a critical hit.
 */
export function divineSmiteDieCount(
  slotLevel: number,
  creatureType: string | null | undefined,
  isCritical: boolean,
): number {
  const undeadOrFiend = /undead|fiend/i.test(creatureType ?? '');
  const base = divineSmiteDice(slotLevel) + (undeadOrFiend ? 1 : 0);
  return isCritical ? base * 2 : base;
}

/** The engine line for a hit whose Smite could not spend its slot: the weapon damage still lands. */
export function divineSmiteNotAppliedLine(slotLevel: number): string {
  return `Divine Smite not applied: no level ${slotLevel} slot.`;
}
