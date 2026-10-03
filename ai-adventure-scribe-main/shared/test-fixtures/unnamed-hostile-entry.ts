/**
 * Run 20 (#2532): the player typed a shout, the DM asked for `combat_transition: 'start'`, and
 * its text named no creature. The popup read "Strike at Hostile Creature?" and the engine seated
 * "Unknown creature".
 *
 * Shared on purpose (AGENTS.md §4, the #2286 pattern). The server test posts `unnamedHostileTurn`
 * through the real `/v1/llm/generate` route and asserts the envelope it returns carries exactly
 * `namedHostilePending`; the client test builds the popup from that same object.
 */

export const UNNAMED_HOSTILE_SESSION_ID = '8aa34c36-567d-4681-9b35-35e974396bd9';

export const UNNAMED_HOSTILE_PLAYER_INPUT = 'I shout into the dark: "Come out and face me!"';

/** The DM's text when it names the creature. */
export const CHITINOUS_HUNTER_PROSE =
  'Your shout rolls down the tunnel. A chitinous hunter drops from the ceiling, mandibles clicking.';

/** The DM's text when it names nothing: the case the engine used to paper over. */
export const UNNAMED_THREAT_PROSE =
  'Your shout rolls down the tunnel. Something shifts in the dark beyond the torchlight.';

/** A DM turn in the full envelope shape the generate route returns. */
export const unnamedHostileTurn = (text: string, overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    text,
    narration_segments: [],
    roll_requests: [],
    combat_transition: 'start',
    scene_spec: null,
    map_actions: [],
    handout_actions: [],
    combatants: [],
    combat_actions: [],
    ...overrides,
  });

/**
 * `combat_entry_pending` as the server hands it to the client when the prose is
 * `CHITINOUS_HUNTER_PROSE`: the creature is named, and the scene is the one the gate synthesises
 * for a reply that carried none.
 */
export const namedHostilePending = {
  trigger: 'combat_transition' as const,
  detail: 'combat_transition="start"',
  combatants: [{ name: 'Chitinous Hunter', count: 1 }],
  sceneSpec: {
    sessionId: UNNAMED_HOSTILE_SESSION_ID,
    environment: 'dungeon_room',
    size: 'small',
    enemyPlacement: 'guarding',
    sceneDescription: CHITINOUS_HUNTER_PROSE,
  },
  sceneSpecSynthesized: true,
};
