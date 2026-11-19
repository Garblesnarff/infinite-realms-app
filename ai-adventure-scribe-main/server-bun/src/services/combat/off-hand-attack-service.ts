/**
 * The off-hand attack of Two-Weapon Fighting (#1639), 2014 SRD 5.1.
 *
 * After you take the Attack action with a light melee weapon, you may use a bonus action to attack
 * with a different light melee weapon held in your other hand. The rules this file enforces are the
 * refusals: the Attack action must come first this turn, the weapon must be light and melee, it must
 * differ from the weapon that took the Attack action, and the bonus action must still be free. The
 * bonus action itself is claimed inside `resolveAttack` (combat-attack-service.ts), before any roll.
 */
import { readLightAttackMark } from './combat-turn-flags.js';
import { BusinessLogicError } from '../../lib/errors.js';

import type { WeaponRuleProfile } from './combat-rules.js';

/**
 * Refuses an off-hand attack that the rules do not allow. It reads only, so a refusal spends nothing
 * and writes nothing. Each refusal carries a `reason` the client and the tests can name.
 */
export async function assertOffHandAttackAllowed(input: {
  encounterId: string;
  actorId: string;
  weaponId: string | undefined;
  equipped: WeaponRuleProfile[];
}): Promise<void> {
  const markedWeaponId = await readLightAttackMark(input.encounterId, input.actorId);
  if (!markedWeaponId) {
    throw new BusinessLogicError(
      'The off-hand attack is a bonus action. Take the Attack action with a light melee weapon first.',
      { reason: 'no_attack_action' },
    );
  }
  const weapon = input.equipped.find((profile) => profile.id === input.weaponId);
  if (!weapon) {
    throw new BusinessLogicError('The off-hand weapon is not equipped.', {
      reason: 'not_equipped',
    });
  }
  if (weapon.light !== true || weapon.meleeWeapon !== true) {
    throw new BusinessLogicError(
      `${weapon.name} is not a light melee weapon, so it cannot make the off-hand attack.`,
      { reason: 'not_light' },
    );
  }
  if (!isOffHandCandidate(weapon, markedWeaponId)) {
    throw new BusinessLogicError(
      'The off-hand attack needs a different weapon from the one that took the Attack action.',
      { reason: 'same_weapon' },
    );
  }
}

/**
 * A light melee weapon the other hand can hold: a different row, or a second copy of the row that took
 * the Attack action. A row that holds two or more copies is two weapons (a premade's two shortswords
 * are stored as one row of quantity 2).
 */
export function isOffHandCandidate(weapon: WeaponRuleProfile, markedWeaponId: string): boolean {
  if (weapon.light !== true || weapon.meleeWeapon !== true) return false;
  return weapon.id !== markedWeaponId || (weapon.quantity ?? 1) >= 2;
}
