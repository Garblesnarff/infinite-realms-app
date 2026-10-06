/**
 * The bodies a player-side Flee / Yield puts on the wire (#2580).
 *
 * Copied from the real producers, not invented for the tests:
 *
 *  - `playerExitIntentBody` is what `executeAuthoritativeCombatIntent` posts to
 *    `/v1/combat/:encounterId/intent`: the intent under `intent`, the dialect under `source`,
 *    `origin` naming the action bar that produced it, and `dmStartedAt`. The client test asserts
 *    the executor sends exactly this, and `intent-schema.test.ts` parses exactly this through the
 *    intent contract. No test posts it through the HTTP route.
 *    `expectedVersion` is included because the player dialect requires it on a versioned intent.
 *
 *  - `playerExitDmEnvelope` is a full DM envelope as `dm-response-schema` emits it, including
 *    `combat_transition: 'end'` and `combat_exits` — the shape the end guard and the exit
 *    narration are judged against. `player-exit-intent.real-db.test.ts` hands it to the
 *    generation-time enforcement. Every field the schema declares is present, because #2349
 *    shipped an inert fixture for omitting one.
 */

/** Ids from the D5 fight (#2563), reused so the fixture names creatures the DM knows. */
export const EXIT_ENCOUNTER_ID = '3232069e-0000-4000-8000-000000000001';
export const EXIT_SESSION_ID = '6c31c0c7-0000-4000-8000-000000000002';
export const EXIT_SCHOLAR_ID = 'e7e569df-0000-4000-8000-000000000001';
export const EXIT_SWARM_1_ID = 'faea28f4-0000-4000-8000-000000000002';
export const EXIT_SWARM_1_SLUG = 'light-eater-swarm-1';
export const EXIT_ENCOUNTER_VERSION = 3;

export const playerExitIntentBody = (type: 'flee' | 'yield') => ({
  intent: { type, actorId: EXIT_SCHOLAR_ID, expectedVersion: EXIT_ENCOUNTER_VERSION },
  source: 'player' as const,
  dmStartedAt: 1_700_000_000_000,
  origin: 'action_bar' as const,
});

/**
 * The DM's `end` on the turn after the player left, declaring the encounter over with the exit
 * the DM can see. `combat_exits` is present and well-formed: the guard honours a declared exit,
 * and an omitted field would have made this fixture pass for the wrong reason.
 */
export const playerExitDmEnvelope = (overrides: Record<string, unknown> = {}) => ({
  text: 'You get clear of the swarm and the gallery goes quiet behind you.',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'end',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
  combat_exits: [{ participant_id: EXIT_SWARM_1_SLUG, exit: 'fled' }],
  ...overrides,
});
