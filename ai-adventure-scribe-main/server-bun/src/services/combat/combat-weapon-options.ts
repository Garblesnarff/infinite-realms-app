import { findCatalogWeapon } from './weapon-catalog.js';

import type { WeaponRuleProfile } from './combat-rules.js';

export function isEquippedWeaponCandidate(candidate: {
  itemType: string | null | undefined;
  name: string;
  properties?: Record<string, unknown>;
}): boolean {
  const damage = candidate.properties?.damage;
  const customWeaponShape =
    candidate.itemType === 'custom' &&
    Boolean(damage && typeof damage === 'object' && !Array.isArray(damage));
  return (
    candidate.itemType === 'weapon' ||
    customWeaponShape ||
    Boolean(findCatalogWeapon(candidate.name))
  );
}

export type WeaponTargetResolution = {
  targetId: string;
  legal: boolean;
  refusal?: 'no_line_of_sight' | 'out_of_range' | 'total_cover';
};

/**
 * Builds the one attack chip per carried weapon. Out-of-range melee targets stay selectable so
 * the menu never disappears at entry range; the label tells the player to close first. Ranged
 * weapons remain gated by their long range.
 */
export function buildCombatWeaponOptions(
  weapons: WeaponRuleProfile[],
  targetsByWeapon: (weapon: WeaponRuleProfile) => WeaponTargetResolution[],
): Array<{ type: 'attack'; label: string; weaponId: string; targetIds: string[] }> {
  return weapons.flatMap((weapon) => {
    const resolutions = targetsByWeapon(weapon);
    const legalTargets = resolutions.filter((target) => target.legal);
    const meleeTargetsNeedingMovement = resolutions.filter(
      (target) => !target.legal && target.refusal === 'out_of_range' && !weapon.ranged,
    );
    const targetIds = [...legalTargets, ...meleeTargetsNeedingMovement].map(
      (target) => target.targetId,
    );
    if (!targetIds.length) return [];
    const needsMovement = legalTargets.length === 0 && meleeTargetsNeedingMovement.length > 0;
    return [
      {
        type: 'attack' as const,
        label: `Attack with ${weapon.name}${needsMovement ? ' (move closer first)' : ''}`,
        weaponId: weapon.id,
        targetIds,
      },
    ];
  });
}
