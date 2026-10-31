/**
 * #1233: the exact bodies the client posts to
 * `POST /v1/class-features/characters/:id/features/:featureId/use` for the variable-cost
 * features. Shared on purpose (#2286 pattern): the client test asserts the sender sends
 * exactly `wireBody`, and the server test posts that same `wireBody` through the real
 * route schema, so a body the route refuses can never pass both.
 *
 * `option` is the canonical grammar from `shared/limited-feature-counts.ts`: a Metamagic
 * option name (`quickened`), `twinned:<spell level>` for Twinned Spell, or the slot level
 * as a string for Flexible Casting (the row itself names the direction).
 */

/** A level-3 Paladin spends a 1st-level slot on Divine Smite: +2d8 radiant damage. */
export const divineSmiteUseBody = { slotLevel: 1 };

/** A Sorcerer applies Quickened Spell: 2 sorcery points. */
export const quickenedMetamagicUseBody = { option: 'quickened' };

/** A Sorcerer converts a 1st-level slot into 1 sorcery point. */
export const flexibleCastingConvertUseBody = { option: '1' };

/** A Sorcerer creates a 2nd-level slot: 3 sorcery points. */
export const flexibleCastingCreateUseBody = { option: '2' };
