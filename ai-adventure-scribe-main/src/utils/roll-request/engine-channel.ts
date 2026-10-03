import type { RollRequest } from '@/types/roll-request';

import logger from '@/lib/logger';

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

const LOGGABLE_ROLL_TYPES: ReadonlySet<string> = new Set([
  'attack',
  'save',
  'check',
  'damage',
  'damage_taken',
  'initiative',
  'skill_check',
]);

/** A roll type safe to log: the model writes the field, so anything off the list is `other`. */
export function loggableRollType(type: unknown): string {
  return typeof type === 'string' && LOGGABLE_ROLL_TYPES.has(type) ? type : 'other';
}

/**
 * Logs and drops every request in the list. Callers have already established that the engine
 * owns the dice, so the list never reaches the dice popup (#2530).
 */
export function dropEngineOwnedRollRequests(
  rollRequests: RollRequest[],
  encounterId: unknown,
): RollRequest[] {
  for (const request of rollRequests) {
    logger.warn('DM_ROLL_REQUEST_DROPPED', {
      encounterId: encounterId ?? null,
      type: loggableRollType(request.type),
      purpose: request.purpose,
    });
  }
  return [];
}
