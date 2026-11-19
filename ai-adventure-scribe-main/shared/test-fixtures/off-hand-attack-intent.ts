/**
 * The off-hand attack the combat action bar sends (#1639, Two-Weapon Fighting). Shared so the client
 * test asserts it sends exactly this body, and the server test posts exactly this body through the
 * real intent route.
 *
 * Producer: the `off_hand_attack` legal action chip in `use-combat-legal-actions.ts` sends a structured
 * `attack` action with `off_hand: true`; `combat-action-executor.ts` turns that into this intent.
 */
export const OFF_HAND_ACTOR_ID = 'fighter-1';
export const OFF_HAND_TARGET_ID = 'orc-1';
export const OFF_HAND_WEAPON_ID = 'dagger';

export const OFF_HAND_ATTACK_INTENT = {
  type: 'attack' as const,
  actorId: OFF_HAND_ACTOR_ID,
  targetId: OFF_HAND_TARGET_ID,
  weaponId: OFF_HAND_WEAPON_ID,
  offHand: true,
};

/**
 * The wire body the executor posts for the off-hand swing. The chip is a DM-path structured attack from
 * the action bar, so the body carries `source: 'dm'` and no `expectedVersion`; the server reads the
 * encounter's current version for a DM-sourced attack, as it does for an ordinary attack chip.
 * `dmStartedAt` is the client clock, so the client test checks it as a number and leaves it out of the
 * comparison.
 */
export function offHandAttackBody() {
  return {
    intent: { ...OFF_HAND_ATTACK_INTENT },
    source: 'dm' as const,
  };
}

/**
 * The proposal the action bar posts before the off-hand roll (#1639): the same attack body with
 * `phase: 'propose'`, which is what `askPlayerForAttackDie` sends for the off-hand chip.
 */
export function offHandProposeBody() {
  return { ...offHandAttackBody(), phase: 'propose' as const };
}
