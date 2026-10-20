/**
 * Hex's extra damage rider (2014 5e, #754).
 *
 * While a caster concentrates on Hex, every attack that hits the cursed creature deals an
 * extra 1d6 necrotic damage. The decision is pure so it can be unit-tested without a database,
 * and both the weapon-attack and spell-attack damage paths call it before adding the rider.
 *
 * This module is deliberately database-free: combat-attack-service imports it at module load,
 * and pulling concentration-service (which reaches db/client) in here would break the unit
 * tests that mock the database-facing leaves.
 */

export const HEX_SPELL_NAME = 'Hex';

/** The shape this decision needs from a concentration row; ConcentrationState satisfies it. */
export interface HexConcentration {
  spellName: string;
  targetParticipantId: string | null;
}

/**
 * Whether the rider applies: the attacker must be concentrating on Hex, and the attack must be
 * aimed at the participant the Hex was cast on. Null concentration, a different spell, a Hex
 * with no stored target, or a different target all return false.
 */
export function appliesHexRider(
  concentration: HexConcentration | null | undefined,
  targetParticipantId: string | null | undefined,
): boolean {
  if (!concentration) return false;
  if (concentration.spellName.trim().toLowerCase() !== HEX_SPELL_NAME.toLowerCase()) return false;
  if (!targetParticipantId) return false;
  return concentration.targetParticipantId === targetParticipantId;
}

/** Hex's rider dice: 1d6, doubled to 2d6 on a critical hit (2014: a crit doubles all the hit's damage dice). */
export function hexRiderDice(isCritical: boolean): string {
  return isCritical ? '2d6' : '1d6';
}
