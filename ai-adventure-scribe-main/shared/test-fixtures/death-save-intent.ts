/**
 * The body the client posts to `POST /v1/combat/:encounterId/intent` for the dying player's death
 * saving throw (#2518), shared by the client test that asserts the client sends exactly it and the
 * server test that posts it through the real route schema and the real dispatch.
 *
 * Shared on purpose (AGENTS.md §4): #2250's client tests mocked the API, so a body the route's
 * schema refused passed every test and 422'd in production. `dmStartedAt` is a clock reading, so
 * the fixture leaves it out and the tests compare everything else.
 *
 * Built from the real producer's arguments: `executeStructuredCombatActionWithBoundary` with a
 * `death_save` action, the die from the roll prompt, and origin `dice_roll` (the player's own
 * die: the server refuses a player action no player input made, #2305).
 */
export interface DeathSaveIntentWire {
  intent: { type: 'death_save'; actorId: string; d20?: number };
  source: 'dm';
  origin: 'dice_roll';
}

/** The save with the die the player rolled in the prompt. */
export function deathSaveIntentWire(actorId: string, d20: number): DeathSaveIntentWire {
  return { intent: { type: 'death_save', actorId, d20 }, source: 'dm', origin: 'dice_roll' };
}

/** The prompt timed out (45 s) or was dismissed: no die, the engine rolls it. */
export function deathSaveIntentWireAutoRolled(actorId: string): DeathSaveIntentWire {
  return { intent: { type: 'death_save', actorId }, source: 'dm', origin: 'dice_roll' };
}
