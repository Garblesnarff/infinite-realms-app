import { findCatalogWeapon } from './weapon-catalog.js';

import type { WeaponRuleProfile } from './combat-rules.js';

/**
 * Builds the "(move closer first)" hint suffix, with or without the distance
 * ("(move closer first — 20 ft)"). The generator below and the strip share
 * this one definition so the two can never drift apart: if the label format
 * changes, the strip changes with it. (#2555, #2564)
 */
export function buildMoveCloserHint(distanceFeet?: number): string {
  return ` (move closer first${distanceFeet !== undefined ? ` — ${distanceFeet} ft` : ''})`;
}

/**
 * Matches the hint suffix built by `buildMoveCloserHint`, with or without the
 * distance. Used by `stripMoveCloserHint`.
 */
export const MOVE_CLOSER_HINT_PATTERN = /\s*\(move closer first(?: — \d+ ft)?\)\s*$/i;

/** Removes the "(move closer first)" hint suffix from an attack label, if present. */
export function stripMoveCloserHint(label: string): string {
  return label.replace(MOVE_CLOSER_HINT_PATTERN, '');
}

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
  distanceFeet?: number;
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
    const movementHint = needsMovement
      ? buildMoveCloserHint(meleeTargetsNeedingMovement[0].distanceFeet)
      : '';
    return [
      {
        type: 'attack' as const,
        label: `Attack with ${weapon.name}${movementHint}`,
        weaponId: weapon.id,
        targetIds,
      },
    ];
  });
}
