/**
 * Grounds a narrated weapon name against the character sheet.
 *
 * `weaponIdFromPurpose` and `weaponIdFromProse` read a weapon out of free narration. That is a
 * guess about prose, but `weapon_id` is consumed as a hard identity claim: it selects the
 * reach/range profile for the approach decision and it is handed to `getEquippedWeaponProfile`,
 * which throws `Requested weapon is not equipped` on a miss. So the DM writing "she looses an
 * arrow from her elvish bow" could 422 the whole attack — an unrecognized weapon name must not
 * be able to stop a fight.
 *
 * This is the floor, not the fix. The fix is that the DM is shown the character's real
 * equipment (see the `<equipment>` block in the frontend prompt builder) so it stops inventing
 * names in the first place. This module catches what still gets through, and says so out loud
 * via `DM_WEAPON_UNGROUNDED` rather than silently swapping the weapon.
 *
 * @module server/services/combat/weapon-grounding
 */
import {
  findCatalogWeapon,
  normalizeWeaponName,
  UNARMED_STRIKE,
  weaponProfileMatches,
} from './weapon-catalog.js';

import type { WeaponRuleProfile } from './combat-rules.js';

export type GroundedWeapon = {
  /** The weapon the engine will actually swing. */
  weapon: WeaponRuleProfile;
  /**
   * What to pass on as `weaponId`. Undefined when the resolution is the unarmed fallback,
   * which is a rules default rather than an equipped row and would not re-resolve by id.
   */
  weaponId: string | undefined;
  /** False when a name was claimed and the sheet does not back it. */
  grounded: boolean;
  /** The name that was claimed, kept for the log line. */
  requested: string | null;
};

/**
 * Picks the weapon a narrated name was reaching for.
 *
 * On a miss the substitute matches the *attack type* of the claim, not just position in the
 * list: "with her longbow" on a character carrying a shortbow and a shortsword resolves to the
 * shortbow, so the reach check still says ranged and approach does not walk her into melee.
 * When the claimed name is not in the SRD catalog at all there is no type to match, so the
 * default equipped weapon stands in.
 */
export function groundRequestedWeapon(
  requestedWeaponId: string | null | undefined,
  equipped: WeaponRuleProfile[],
): GroundedWeapon {
  const fallback = equipped[0];
  const asProfile = (weapon: WeaponRuleProfile | undefined): WeaponRuleProfile =>
    weapon ?? { ...UNARMED_STRIKE };
  const idFor = (weapon: WeaponRuleProfile | undefined): string | undefined => weapon?.id;

  // Nothing was claimed, so nothing can be ungrounded. The default weapon is the answer.
  if (!requestedWeaponId || !normalizeWeaponName(requestedWeaponId)) {
    return {
      weapon: asProfile(fallback),
      weaponId: idFor(fallback),
      grounded: true,
      requested: null,
    };
  }

  const exact = equipped.find((profile) => weaponProfileMatches(profile, requestedWeaponId));
  if (exact) {
    return { weapon: exact, weaponId: exact.id, grounded: true, requested: requestedWeaponId };
  }

  const catalog = findCatalogWeapon(requestedWeaponId);
  const wantsRanged = catalog ? Number(catalog.range?.normal ?? 5) > 5 : undefined;
  const byType =
    wantsRanged === undefined
      ? undefined
      : equipped.find((profile) => profile.ranged === wantsRanged);
  const substitute = byType ?? fallback;
  return {
    weapon: asProfile(substitute),
    weaponId: idFor(substitute),
    grounded: false,
    requested: requestedWeaponId,
  };
}
