/**
 * The bodies a Second Wind / Action Surge puts on the wire (#975).
 *
 * Copied from the real producers, not invented for the tests:
 *
 *  - `fighterFeatureChipIntentBody` is what clicking the Second Wind / Action
 *    Surge option posts. `DynamicOptionsSection` calls
 *    `executeAuthoritativeCombatIntent(encounter.id, { type, actorId }, 'dm',
 *    Date.now(), 'typed')`, and the executor serialises exactly this: source
 *    `dm` (the dialect every inline combat option uses — the server is the
 *    sequencer and fills the encounter version itself), origin `typed`, and
 *    NO `expectedVersion` on the intent. The executor test asserts the posted
 *    body equals this fixture byte for byte, and `intent-schema.test.ts`
 *    parses it through the intent contract.
 *
 *  - `fighterFeaturePlayerIntentBody` is the player-dialect shape: a
 *    player-sourced call whose intent already carries the version it read
 *    (the executor fetches it first when absent — also pinned in the executor
 *    test). No option posts feature intents this way today; the body is
 *    pinned because the route contract accepts the dialect for these types
 *    and the player union's version requirement is part of that contract.
 */

export const FIGHTER_FEATURE_ENCOUNTER_ID = '3232069e-0000-4000-8000-000000000001';
export const FIGHTER_FEATURE_ACTOR_ID = 'e7e569df-0000-4000-8000-000000000001';
export const FIGHTER_FEATURE_ENCOUNTER_VERSION = 3;

export const fighterFeatureChipIntentBody = (type: 'second_wind' | 'action_surge') => ({
  intent: { type, actorId: FIGHTER_FEATURE_ACTOR_ID },
  source: 'dm' as const,
  dmStartedAt: 1_700_000_000_000,
  origin: 'typed' as const,
});

export const fighterFeaturePlayerIntentBody = (type: 'second_wind' | 'action_surge') => ({
  intent: {
    type,
    actorId: FIGHTER_FEATURE_ACTOR_ID,
    expectedVersion: FIGHTER_FEATURE_ENCOUNTER_VERSION,
  },
  source: 'player' as const,
  dmStartedAt: 1_700_000_000_000,
});
