/**
 * Sneak Attack's extra damage rider (2014 SRD 5.1, Rogue, #1637).
 *
 * Once per turn, a Rogue's hit with a finesse or ranged weapon adds ⌈level/2⌉d6 of the weapon's
 * damage type when the attack has advantage, or when a non-incapacitated ally stands within 5 ft
 * of the target. Never with disadvantage. A critical hit doubles the dice.
 *
 * The decision is pure so it can be unit-tested without a database. combat-attack-service reads
 * the turn state, the ally positions and the Rogue's level, then asks these functions what applies.
 */

/** The reach an ally must stand within of the target for the flanking clause (2014 SRD). */
export const SNEAK_ATTACK_ALLY_REACH_FEET = 5;

/** The advantage source the client's Inspiration-style flag uses. It does not count (#1637 scope). */
const CLIENT_REQUESTED_SOURCE = 'requested';

/** Whether a weapon can carry Sneak Attack: a finesse or a ranged weapon (2014 SRD). */
export function sneakAttackWeaponQualifies(weapon: { finesse: boolean; ranged: boolean }): boolean {
  return weapon.finesse || weapon.ranged;
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
 * client's "requested" flag alone does not qualify. Disadvantage always blocks it. Once per turn
 * is enforced by the caller through `alreadyUsedThisTurn`.
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
