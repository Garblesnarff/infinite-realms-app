/**
 * Fighter fighting styles the sheet and the attack engine both read (#824).
 *
 * Defense, Archery, Dueling, and Great Weapon Fighting. Protection and
 * Two-Weapon Fighting are different options and are not decided here.
 *
 * Stored values arrive as "Defense", "defense", or "great_weapon_fighting".
 * One normalizer keeps those from becoming four different bonuses.
 */

export type FightingStyleId = 'defense' | 'archery' | 'dueling' | 'great_weapon_fighting';

/** "Great Weapon Fighting" and "great-weapon-fighting" both become the stored key. */
export function normalizeFightingStyle(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return key.length > 0 ? key : undefined;
}

export function hasFightingStyle(styles: unknown, id: FightingStyleId): boolean {
  if (!Array.isArray(styles)) return false;
  return styles.some((style) => normalizeFightingStyle(style) === id);
}

/**
 * +1 AC while wearing armor. A shield is not armor, and the bonus does not
 * stack when the same style is stored twice.
 */
export function defenseArmorClassBonus(styles: unknown, wearingArmor: boolean): number {
  return wearingArmor && hasFightingStyle(styles, 'defense') ? 1 : 0;
}

/**
 * +2 to attack rolls with a ranged weapon. A thrown melee weapon is a ranged
 * attack with a melee weapon, so the caller passes false for it.
 */
export function archeryAttackBonus(styles: unknown, rangedWeapon: boolean): number {
  return rangedWeapon && hasFightingStyle(styles, 'archery') ? 2 : 0;
}

export type DuelingGrip = {
  /** The attack is with a melee weapon, including a melee weapon that is thrown. */
  meleeWeapon: boolean;
  /** The weapon has the two-handed property, so it is not in one hand. */
  twoHanded: boolean;
  /** A second weapon is wielded. A shield is not a weapon and leaves this false. */
  otherWeaponWielded: boolean;
};

/** +2 damage when a melee weapon is in one hand and no other weapon is wielded. */
export function duelingDamageBonus(styles: unknown, grip: DuelingGrip): number {
  return hasFightingStyle(styles, 'dueling') &&
    grip.meleeWeapon &&
    !grip.twoHanded &&
    !grip.otherWeaponWielded
    ? 2
    : 0;
}

/**
 * The weapon's own damage dice may be rerolled. A versatile weapon in one hand
 * does not qualify; the caller passes twoHanded only when the weapon has that
 * property or is actually gripped in two hands.
 */
export function greatWeaponFightingApplies(
  styles: unknown,
  weapon: { meleeWeapon: boolean; twoHanded: boolean },
): boolean {
  return (
    hasFightingStyle(styles, 'great_weapon_fighting') && weapon.meleeWeapon && weapon.twoHanded
  );
}

/**
 * Reroll a 1 or a 2 once. The new face stands, even when it is a 1 or a 2.
 * The flat ability modifier and a magic weapon's flat bonus are not dice.
 */
export function rerollGreatWeaponFace(face: number, roll: () => number): number {
  return face === 1 || face === 2 ? roll() : face;
}
