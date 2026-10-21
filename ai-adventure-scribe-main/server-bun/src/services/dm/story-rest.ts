/**
 * #264 (#218 step 5): a rest the DM grants in the story (`rest` in the reply) reaches the
 * sheet through the same server RestService the sheet's rest buttons use — one ruleset for
 * both paths, so a story rest is never narration-only.
 *
 * The server is the one writer: it runs RestService.takeShortRest / takeLongRest, which
 * persist HP, hit dice, spell slots, class features, conditions and the rest_events row.
 * A story short rest spends hit dice until the character is healed or out of dice
 * (#751): a rest declared in chat has no sheet hit-dice prompt to pick a count, and a
 * short rest that restores no HP is narration-only — the failure this module exists to
 * prevent. Once per player message, as the slot spend in
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

import type { ShortRestResult } from '../../types/rest.js';

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
      let shortRestResult: ShortRestResult | undefined;
      if (restType === 'short') {
        shortRestResult = await RestService.takeShortRest(
          character.id,
          userId,
          0,
          sessionId,
          'story rest',
          message.createdAt,
          { spendHitDiceUntilHealed: true },
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
      // #751 (#130's shape): the write landed server-side, but the live sheet
      // only refreshes on character_state_updated — without this publish it
      // keeps the pre-rest HP and conditions until a hard reload. A failed
      // broadcast must not fail the rest: the write already landed.
      try {
        const { publishStoryCharacterUpdate } = await import('./story-broadcast.js');
        publishStoryCharacterUpdate(sessionId, 'story_rest');
      } catch (broadcastError) {
        logger.warn({
          msg: 'DM_STORY_REST_BROADCAST_FAILED',
          sessionId,
          characterId: character.id,
          error:
            broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
        });
      }
      // #751 follow-up: the sheet refresh above is silent in chat — the player
      // saw HP move but never the Hit Die roll that produced it (Hark D2-002/003).
      // Post the engine line with the rolls, the story-XP notice's shape (#310).
      if (restType === 'short' && shortRestResult) {
        await ensureStoryRestNotice({
          sessionId,
          userId,
          characterId: character.id,
          since: message.createdAt,
          result: shortRestResult,
        });
      }
    } catch (error) {
      if (error instanceof StoryRestAlreadyRecorded) {
        outcome = 'already_applied';
      } else {
        logger.warn({ msg: 'DM_STORY_REST_FAILED', sessionId, characterId: character.id, error });
        outcome = 'rest_failed';
      }
    }
    // A retry of a rest whose line never landed (the first attempt threw after
    // the write, or the line post itself failed) re-posts it from the stored
    // event — counts and HP only: the individual rolls are not stored.
    if (outcome === 'already_applied' && restType === 'short') {
      await ensureStoryRestNotice({
        sessionId,
        userId,
        characterId: character.id,
        since: message.createdAt,
      });
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

function hitDiceRemainingText(rows: { totalDice: number; usedDice: number }[]): string {
  const total = rows.reduce((sum, row) => sum + row.totalDice, 0);
  const remaining = rows.reduce((sum, row) => sum + (row.totalDice - row.usedDice), 0);
  return `Hit dice: ${remaining} of ${total} remaining.`;
}

/**
 * #751 follow-up: posts the visible short-rest chat line, recoverably — the
 * story-XP notice's shape (ensureStoryXpNotice, #310). Idempotent: skips when
 * the line already exists. A fresh apply carries the result, so the line shows
 * every Hit Die roll; a retry rebuilds a summary from the stored rest_events
 * row (counts and HP, not the rolls — and only when the row records a spend,
 * which is what proves the rest finished). Never throws: a failed line never
 * fails the rest, and the next retry tries again.
 */
async function ensureStoryRestNotice(input: {
  sessionId: string;
  userId: string;
  characterId: string;
  since: Date;
  result?: ShortRestResult;
}): Promise<void> {
  const { sessionId, userId, characterId, since } = input;
  const idSeed = `story-rest:${sessionId}:${characterId}:${since.getTime()}`;
  try {
    const { engineChatLineExists, postEngineChatLine } = await import('../engine-chat-line.js');
    if (await engineChatLineExists(idSeed)) return;
    let text: string;
    if (input.result) {
      const { hitDieRolls, hpRestored, hitDiceRemaining } = input.result;
      const remainingText = hitDiceRemainingText(hitDiceRemaining);
      text =
        hitDieRolls.length > 0
          ? `⚙️ Engine: Short rest — Hit Dice: ${hitDieRolls
              .map((die) => `${die.dieType} rolled ${die.roll} (+${die.hpGained} HP)`)
              .join(', ')}. ${hpRestored} HP restored. ${remainingText}`
          : `⚙️ Engine: Short rest — no hit dice spent. ${remainingText}`;
    } else {
      const { db } = await import('../../../../db/client');
      const { and, eq, gte } = await import('drizzle-orm');
      const { restEvents } = await import('../../../../db/schema/index');
      const [event] = await db
        .select({ hpRestored: restEvents.hpRestored, hitDiceSpent: restEvents.hitDiceSpent })
        .from(restEvents)
        .where(
          and(
            eq(restEvents.characterId, characterId),
            eq(restEvents.sessionId, sessionId),
            eq(restEvents.restType, 'short'),
            gte(restEvents.startedAt, since),
          ),
        )
        .limit(1);
      // The claim row exists from the moment RestService claims the rest,
      // with hpRestored / hitDiceSpent still 0 until finishRestEvent fills
      // them — an in-progress rest, or one that threw after the claim and
      // kept it, is indistinguishable from a finished no-spend rest by the
      // row alone. Only a recorded spend proves the rest finished: posting
      // for a 0-spend row could lock in a false "0 hit dice spent, 0 HP
      // restored" under the deterministic id ahead of the real line. A
      // finished rest that spent nothing loses only this recovery line;
      // its fresh line (posted on the applied path) is unaffected.
      if (!event || (event.hitDiceSpent ?? 0) === 0) return;
      // No remaining-dice counter here: it would be read at recovery time,
      // not at rest time, and later rests change it.
      text = `⚙️ Engine: Short rest — ${event.hitDiceSpent} hit dice spent, ${event.hpRestored ?? 0} HP restored.`;
    }
    await postEngineChatLine({
      sessionId,
      userId,
      idSeed,
      text,
      context: { intent: 'story_rest' },
    });
  } catch (error) {
    logger.warn({
      msg: 'DM_STORY_REST_NOTICE_FAILED',
      sessionId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
