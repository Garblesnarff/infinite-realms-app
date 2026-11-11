/**
 * The body a Flexible Casting chip puts on the wire (#1233).
 *
 * The bar calls `executeAuthoritativeCombatIntent(encounter.id, { type, direction, slotLevel,
 * actorId }, 'player', Date.now(), 'action_bar')`. The executor fills `expectedVersion` from the
 * encounter status first (player dialect), then serialises `{ intent, source, dmStartedAt,
 * origin }`. The hook test asserts the posted body contains this fixture; the real-route test
 * posts it through the intent route. `dmStartedAt` is a clock value, so it is left out here.
 */

export const FLEXIBLE_CASTING_ACTOR_ID = '5f1e0c7a-0000-4000-8000-00000000f1c0';
export const FLEXIBLE_CASTING_ENCOUNTER_VERSION = 1;

export const flexibleCastingIntentBody = (
  direction: 'convert' | 'create',
  slotLevel: number,
  actorId: string = FLEXIBLE_CASTING_ACTOR_ID,
  expectedVersion: number = FLEXIBLE_CASTING_ENCOUNTER_VERSION,
) => ({
  intent: {
    type: 'flexible_casting' as const,
    actorId,
    direction,
    slotLevel,
    expectedVersion,
  },
  source: 'player' as const,
  origin: 'action_bar' as const,
});
