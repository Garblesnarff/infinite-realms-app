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
 *
 * `canCloseDistance`, when provided, gates the "(move closer first)" offer per target: a
 * target the actor cannot actually move toward is not offered. Without the gate, an actor
 * with no movement left (or no closer cell) is offered an attack the engine answers with the
 * identical "no attack was rolled" every time — and the non-spending movement_only never
 * advances the turn, so the loop never resolves (#259).
 */
export function buildCombatWeaponOptions(
  weapons: WeaponRuleProfile[],
  targetsByWeapon: (weapon: WeaponRuleProfile) => WeaponTargetResolution[],
  options?: {
    canCloseDistance?: (targetId: string, weapon: WeaponRuleProfile) => boolean;
    /**
     * #1059: the weapons are carried but not equipped. The chip offers the
     * equip and the attack as one choice — drawing is the turn's free
     * object interaction — and the client equips (the same write the
     * sheet's Equip control makes) before it declares the attack, so the
     * attack intent finds the weapon equipped.
     */
    equipFirst?: boolean;
  },
): Array<{
  type: 'attack';
  label: string;
  weaponId: string;
  targetIds: string[];
  equipFirst?: boolean;
}> {
  return weapons.flatMap((weapon) => {
    const resolutions = targetsByWeapon(weapon);
    const legalTargets = resolutions.filter((target) => target.legal);
    const meleeTargetsNeedingMovement = resolutions.filter(
      (target) =>
        !target.legal &&
        target.refusal === 'out_of_range' &&
        !weapon.ranged &&
        (options?.canCloseDistance?.(target.targetId, weapon) ?? true),
    );
    const targetIds = [...legalTargets, ...meleeTargetsNeedingMovement].map(
      (target) => target.targetId,
    );
    if (!targetIds.length) return [];
    const needsMovement = legalTargets.length === 0 && meleeTargetsNeedingMovement.length > 0;
    return [
      {
        type: 'attack' as const,
        label: `${options?.equipFirst ? 'Equip and attack' : 'Attack'} with ${weapon.name}${needsMovement ? ' (move closer first)' : ''}`,
        weaponId: weapon.id,
        targetIds,
        ...(options?.equipFirst ? { equipFirst: true } : {}),
      },
    ];
  });
}
