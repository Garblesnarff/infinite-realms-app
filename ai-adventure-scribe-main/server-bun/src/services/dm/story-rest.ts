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
 * not applied. The claim is inside RestService (#777): it locks the character, re-checks
 * rest_events for this character, session, and player message, and inserts the event
 * before any restore. A throw that leaves HP unchanged deletes that event, so a
 * retry can apply once. A rest RestService refuses (dying, dead, long rest at 0 HP) is
 * logged and reported, never thrown: a failed write never costs the player their turn.
 *
 * Database imports stay inside the functions, as in story-xp.ts: /v1/llm/generate imports
 * this module, and its route contract tests load without an application database.
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { playerMessage } from './story-spell-slots.js';
import { typedRestType } from './typed-rest.js';
import { logger } from '../../lib/logger.js';
import { StoryRestAlreadyRecorded } from '../story-rest-already-recorded.js';

export type StoryRestOutcome =
  | 'applied'
  | 'already_applied'
  | 'invalid_rest'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending'
  | 'rest_failed';

/** Reads the reply's `rest` (or the player's typed rest) and applies it for the session's own character. */
export async function applyStoryRest(input: {
  userId: string;
  sessionId: string;
  rest: unknown;
  /** The reply asks for a roll: the outcome is not known yet, so no rest is granted yet. */
  rollRequested?: boolean;
}): Promise<StoryRestOutcome> {
  const { userId, sessionId } = input;
  const rest = (input.rest ?? {}) as { type?: unknown };
  const dmRestType = rest.type === 'short' || rest.type === 'long' ? rest.type : null;
  const character = await ownedSessionCharacter(sessionId, userId);
  const message = character ? await playerMessage(sessionId) : null;
  const typedType = dmRestType ? null : typedRestType(message?.message ?? '');
  const restType = dmRestType ?? typedType;
  const restSource = dmRestType ? 'dm' : typedType ? 'typed' : null;
  let outcome: StoryRestOutcome;
  if (!character) outcome = 'no_character';
  // The rest belongs to the roll's result, which arrives as its own player message.
  else if (input.rollRequested) outcome = 'roll_pending';
  else if (!restType) outcome = 'invalid_rest';
  // No saved player message, no key to apply once against: the turn answers nothing the player did.
  else if (!message?.createdAt) outcome = 'no_player_message';
  else {
    try {
      const { RestService } = await import('../rest-service.js');
      // The outside read is not the claim. RestService locks, re-checks, and
      // inserts the event before it restores anything.
      if (restType === 'short') {
        await RestService.takeShortRest(
          character.id,
          userId,
          0,
          sessionId,
          'story rest',
          message.createdAt,
        );
      } else {
        await RestService.takeLongRest(
          character.id,
          userId,
          sessionId,
          'story rest',
          message.createdAt,
        );
      }
      outcome = 'applied';
    } catch (error) {
      if (error instanceof StoryRestAlreadyRecorded) {
        outcome = 'already_applied';
      } else {
        logger.warn({ msg: 'DM_STORY_REST_FAILED', sessionId, characterId: character.id, error });
        outcome = 'rest_failed';
      }
    }
  }
  logger.info({
    msg: 'DM_STORY_REST',
    sessionId,
    characterId: character?.id ?? null,
    restType,
    restSource,
    outcome,
  });
  return outcome;
}
