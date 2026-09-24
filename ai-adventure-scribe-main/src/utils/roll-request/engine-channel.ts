/**
 * Which DM roll requests belong to the combat engine rather than to the dice popup.
 *
 * `attack` and `initiative` entries in a DM response are a declaration channel: the combat
 * prompts (`rules-prompts.ts`, `combat-rules-prompts.ts`) ask for them so the pipeline can read
 * what the player declared, and `dm-actions-handler` strips both once `/enter` has seated the
 * encounter. The engine then issues its own prompts for those dice through
 * `player-roll-bridge`, which are the ones whose results it actually consumes.
 *
 * Showing a raw one to the player produces a die nobody settles: it takes the single visible
 * dice slot, the engine's real prompt waits behind it and auto-rolls, and the answer is posted
 * as a player message describing an attack the engine never resolved (#2190).
 */
export const ENGINE_CHANNEL_ROLL_TYPES = ['attack', 'initiative'] as const;

/** True for a roll type the combat engine owns and prompts for itself. */
export function isEngineChannelRollType(type: string | undefined): boolean {
  return type === 'attack' || type === 'initiative';
}

/** True for a roll request that is an ordinary narrative check the dice popup may own. */
export function isNarrativeRollRequest(request: { type?: string }): boolean {
  return !isEngineChannelRollType(request.type);
}
