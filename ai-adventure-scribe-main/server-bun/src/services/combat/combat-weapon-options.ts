import { findCatalogWeapon } from './weapon-catalog.js';

import type { WeaponRuleProfile } from './combat-rules.js';
import type { LegalActionType } from '../../../../shared/combat-legal-action-types';

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
 * Builds one attack chip per weapon. Ranged weapons must already be in range.
 * For melee weapons, canCloseDistance checks whether a target can be reached this turn.
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
  type: LegalActionType;
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
