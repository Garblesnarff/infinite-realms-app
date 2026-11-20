/**
 * Sneak Attack's extra damage rider (2014 SRD 5.1, Rogue, #1637).
 *
 * Once per turn, a Rogue's hit with a finesse or ranged weapon adds ⌈level/2⌉d6 of the weapon's
 * damage type when the attack has advantage, or when a non-incapacitated ally stands within 5 ft
 * of the target. Never with disadvantage from any source. A critical hit doubles the dice. Weapon
 * and rider share a damage type, so resistance applies once to their combined total.
 *
 * "Once per turn" is the turn in which the attack happens. The engine records a claim per turn
 * (round and turn order), so a reaction on another creature's turn is its own turn.
 *
 * The decision is pure so it can be unit-tested without a database. combat-attack-service reads
 * the turn state, the ally positions and the Rogue's level, then asks these functions what applies.
 */
import { calculateDamage } from './damage-calculator.js';

/** The reach an ally must stand within of the target for the flanking clause (2014 SRD). */
export const SNEAK_ATTACK_ALLY_REACH_FEET = 5;

/** The advantage source the client's Inspiration-style flag uses. It does not count (#1637 scope). */
const CLIENT_REQUESTED_SOURCE = 'requested';

/**
 * Whether a weapon can carry Sneak Attack: a finesse weapon, or a ranged weapon by the catalog's
 * category (bow, crossbow, dart, sling). A melee weapon with a throw range, such as a spear, is
 * neither.
 */
export function sneakAttackWeaponQualifies(weapon: {
  finesse: boolean;
  rangedWeapon?: boolean;
}): boolean {
  return weapon.finesse || weapon.rangedWeapon === true;
}

/**
 * The rider's dice: ⌈rogue level / 2⌉d6, doubled on a critical hit (2014 crit rule).
 * Null when the level grants no Sneak Attack (a level below 1).
 */
export function sneakAttackDice(rogueLevel: number, isCritical: boolean): string | null {
  if (!Number.isFinite(rogueLevel) || rogueLevel < 1) return null;
  const count = Math.ceil(rogueLevel / 2) * (isCritical ? 2 : 1);
  return `${count}d6`;
}

/**
 * Whether the rider applies to this hit. Advantage counts only from an engine source, so the
 * client's "requested" flag alone does not qualify. `disadvantage` is true for ANY disadvantage
 * source, not the net value: advantage and disadvantage cancelling does not lift the block. Once per
 * turn is enforced by the claim in combat-turn-flags.ts, which the caller passes as
 * `alreadyUsedThisTurn`.
 */
export function appliesSneakAttackRider(input: {
  advantage: boolean;
  disadvantage: boolean;
  advantageSources: readonly string[];
  allyWithinReachOfTarget: boolean;
  alreadyUsedThisTurn: boolean;
}): boolean {
  if (input.alreadyUsedThisTurn || input.disadvantage) return false;
  const engineAdvantage =
    input.advantage && input.advantageSources.some((source) => source !== CLIENT_REQUESTED_SOURCE);
  return engineAdvantage || input.allyWithinReachOfTarget;
}

/**
 * The weapon's part and the rider's part of one hit, resisted once on the combined total. Weapon
 * and rider share a damage type, so 7 weapon + 3 rider under resistance is 5 (floor of 10 / 2),
 * not 3 + 1. The rider's part is what the total gains over the weapon's part alone.
 */
export function splitResistedSneakTotal(input: {
  weaponRaw: number;
  riderRaw: number;
  damageType: string;
  resistances: readonly string[];
  vulnerabilities: readonly string[];
  immunities: readonly string[];
}): { weapon: number; rider: number } {
  const resisted = (amount: number): number =>
    calculateDamage({
      damageDice: '0',
      damageBonus: 0,
      damageType: input.damageType as never,
      damageRoll: amount,
      resistances: input.resistances as never,
      vulnerabilities: input.vulnerabilities as never,
      immunities: input.immunities as never,
    }).finalDamage;
  const weapon = resisted(input.weaponRaw);
  const combined = resisted(input.weaponRaw + input.riderRaw);
  return { weapon, rider: combined - weapon };
}
