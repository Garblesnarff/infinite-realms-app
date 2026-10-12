/**
 * #264 (#218 step 5): a rest the DM grants in the story (`rest` in the reply) reaches the
 * sheet through the same server RestService the sheet's rest buttons use — one ruleset for
 * both paths, so a story rest is never narration-only.
 *
 * The server is the one writer: it runs RestService.takeShortRest / takeLongRest, which
 * persist HP, hit dice, spell slots, class features, conditions and the rest_events row.
 * A story short rest spends no hit dice on its own — spending is the player's choice, made
 * from the sheet's hit-dice prompt. Once per player message, as the slot spend in
 * story-spell-slots.ts: Retry re-sends the same saved message, so a second rest for it is
 * not applied. A rest RestService refuses (dying, dead, long rest at 0 HP) is logged and
 * reported, never thrown: a failed write never costs the player their turn.
 *
 * Database imports stay inside the functions, as in story-xp.ts: /v1/llm/generate imports
 * this module, and its route contract tests load without an application database.
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { playerMessage } from './story-spell-slots.js';
import { logger } from '../../lib/logger.js';

export type StoryRestOutcome =
  | 'applied'
  | 'already_applied'
  | 'invalid_rest'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending'
  | 'rest_failed';

/** A rest already recorded for this character and session at or after the player message. */
async function restAlreadyApplied(
  characterId: string,
  sessionId: string,
  since: Date,
): Promise<boolean> {
  const { db } = await import('../../../../db/client');
  const { and, eq, gte } = await import('drizzle-orm');
  const { restEvents } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ id: restEvents.id })
    .from(restEvents)
    .where(
      and(
        eq(restEvents.characterId, characterId),
        eq(restEvents.sessionId, sessionId),
        gte(restEvents.startedAt, since),
      ),
    )
    .limit(1);
  return !!row;
}

/** Reads the reply's `rest` and applies it for the session's own character. */
export async function applyStoryRest(input: {
  userId: string;
  sessionId: string;
  rest: unknown;
  /** The reply asks for a roll: the outcome is not known yet, so no rest is granted yet. */
  rollRequested?: boolean;
}): Promise<StoryRestOutcome> {
  const { userId, sessionId } = input;
  const rest = ((input.rest ?? {}) as { type?: unknown });
  const restType = rest.type === 'short' || rest.type === 'long' ? rest.type : null;
  const character = await ownedSessionCharacter(sessionId, userId);
  const message = character ? await playerMessage(sessionId) : null;
  let outcome: StoryRestOutcome;
  if (!character) outcome = 'no_character';
  // The rest belongs to the roll's result, which arrives as its own player message.
  else if (input.rollRequested) outcome = 'roll_pending';
  else if (!restType) outcome = 'invalid_rest';
  // No saved player message, no key to apply once against: the turn answers nothing the player did.
  else if (!message?.createdAt) outcome = 'no_player_message';
  else if (await restAlreadyApplied(character.id, sessionId, message.createdAt)) {
    outcome = 'already_applied';
  } else {
    try {
      const { RestService } = await import('../rest-service.js');
      if (restType === 'short') {
        await RestService.takeShortRest(character.id, userId, 0, sessionId, 'story rest');
      } else {
        await RestService.takeLongRest(character.id, userId, sessionId, 'story rest');
      }
      outcome = 'applied';
    } catch (error) {
      logger.warn({ msg: 'DM_STORY_REST_FAILED', sessionId, characterId: character.id, error });
      outcome = 'rest_failed';
    }
  }
  logger.info({
    msg: 'DM_STORY_REST',
    sessionId,
    characterId: character?.id ?? null,
    restType,
    outcome,
  });
  return outcome;
}
