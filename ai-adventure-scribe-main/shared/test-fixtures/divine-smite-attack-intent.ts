/**
 * The attack intent the combat action bar sends when a Paladin declares Divine Smite after a
 * melee hit (#1362). Shared so the client test asserts it sends exactly this, and the server
 * test posts exactly this body through the real intent route.
 *
 * Producer: `src/hooks/use-combat-mechanics.ts` `handleEnhancedAttack`, reached from the
 * SpecialActionsSection "Divine Smite (1st)" button, calls
 * `executeAuthoritativeCombatIntent(encounterId, DIVINE_SMITE_ATTACK_INTENT)`. The executor
 * adds `expectedVersion` from the status read (source 'player') and posts `{ intent, source }`.
 */
export const DIVINE_SMITE_ACTOR_ID = 'paladin-1';
export const DIVINE_SMITE_TARGET_ID = 'orc-1';

export const DIVINE_SMITE_ATTACK_INTENT = {
  type: 'attack' as const,
  actorId: DIVINE_SMITE_ACTOR_ID,
  targetId: DIVINE_SMITE_TARGET_ID,
  advantage: false,
  disadvantage: false,
  divineSmiteSlotLevel: 1,
};

/** The wire body the executor posts for the Smite attack, given the encounter version it read. */
export function divineSmiteAttackBody(expectedVersion: number) {
  return {
    intent: { ...DIVINE_SMITE_ATTACK_INTENT, expectedVersion },
    source: 'player' as const,
  };
}
