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

import type { LongRestResult, ShortRestResult } from '../../types/rest.js';

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
  // #751 (D23-002): the player's explicit typed declaration wins over the DM
  // reply's `rest` field. The DM field exists for a rest the story grants
  // that the player did not declare; when the player DID declare one, the
  // DM's field is the model's reading of the same fiction, and it can read
  // it wrong — a post-combat breather narration filled `short` while the
  // player typed a long rest, and the old DM-wins rule silently applied the
  // short rest and left the spent slot unrestored. When both agree, or only
  // one is present, this changes nothing.
  const typedType = typedRestType(message?.message ?? '');
  const restType = typedType ?? dmRestType;
  const restSource = typedType ? 'typed' : dmRestType ? 'dm' : null;
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
      let longRestResult: LongRestResult | undefined;
      let spellSlotsRestored = false;
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
        // The long-rest result carries no spell-slot delta (its
        // resourcesRestored is a static capability list), so snapshot the
        // used-slot total around the rest: the engine line's
        // "(nothing to restore)" must be exact, not a guess. The snapshots
        // are advisory wording only — wrapped apart so a snapshot failure
        // degrades the line, never the rest itself.
        let usedSlotsBefore: number | null = null;
        try {
          usedSlotsBefore = await usedSpellSlots(character.id);
        } catch {
          usedSlotsBefore = null;
        }
        longRestResult = await RestService.takeLongRest(
          character.id,
          userId,
          sessionId,
          'story rest',
          message.createdAt,
        );
        if (usedSlotsBefore !== null) {
          try {
            spellSlotsRestored = (await usedSpellSlots(character.id)) < usedSlotsBefore;
          } catch {
            spellSlotsRestored = false;
          }
        }
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
      // #751: a long rest posts its engine line too — until now only short
      // rests did, so a typed long rest moved the sheet with no chat line at
      // all, and at full HP (nothing to restore) the turn looked ignored.
      if (restType === 'long' && longRestResult) {
        await ensureStoryLongRestNotice({
          sessionId,
          userId,
          characterId: character.id,
          since: message.createdAt,
          result: longRestResult,
          spellSlotsRestored,
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
    if (outcome === 'already_applied' && restType === 'long') {
      await ensureStoryLongRestNotice({
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

/** Total used spell slots across all levels — the before/after snapshot for the long-rest line. */
async function usedSpellSlots(characterId: string): Promise<number> {
  const { db } = await import('../../../../db/client');
  const { eq } = await import('drizzle-orm');
  const { characterSpellSlots } = await import('../../../../db/schema/index');
  const rows = await db
    .select({ usedSlots: characterSpellSlots.usedSlots })
    .from(characterSpellSlots)
    .where(eq(characterSpellSlots.characterId, characterId));
  return rows.reduce((sum, row) => sum + (row.usedSlots ?? 0), 0);
}

function longRestLineText(input: {
  hpRestored: number;
  hitDiceRestored: number;
  spellSlotsRestored: boolean;
}): string {
  const parts: string[] = [];
  if (input.hpRestored > 0) parts.push(`${input.hpRestored} HP restored`);
  if (input.spellSlotsRestored) parts.push('spell slots restored');
  if (input.hitDiceRestored > 0) parts.push(`${input.hitDiceRestored} hit dice regained`);
  return parts.length === 0
    ? '⚙️ Engine: Long rest — HP and spell slots restored (nothing to restore)'
    : `⚙️ Engine: Long rest — ${parts.join(', ')}.`;
}

/**
 * The recovered line, from the stored event alone. The slot and hit-dice
 * deltas are not stored, so this never claims "(nothing to restore)" — a
 * rest that restored only slots would make that an exact falsehood. It
 * states the completed rest's canonical effect plus the one stored actual.
 */
function longRestRecoveryLineText(hpRestored: number): string {
  return hpRestored > 0
    ? `⚙️ Engine: Long rest — ${hpRestored} HP restored, spell slots restored.`
    : '⚙️ Engine: Long rest — HP and spell slots restored.';
}

/**
 * #751: posts the visible long-rest chat line, recoverably — the short-rest
 * notice's shape. Idempotent: skips when the line already exists. A fresh
 * apply carries the result (and the spell-slot snapshot), so the line is
 * exact — including "(nothing to restore)" for a rest at full everything,
 * the case that used to look ignored. A retry rebuilds the line from the
 * stored rest_events row. The finished proof is the row's
 * `resourcesRestored`: the claim insert writes '[]' and only
 * finishRestEvent overwrites it with the rest's resource list, while
 * `completedAt` is stamped at claim time and proves nothing. The slot and
 * hit-dice deltas are not stored, so a recovered line states the completed
 * rest's canonical effect plus the stored HP actual — and never the
 * "(nothing to restore)" string, which the stored row cannot support.
 * Never throws: a failed line never fails the rest, and the next retry
 * tries again.
 */
async function ensureStoryLongRestNotice(input: {
  sessionId: string;
  userId: string;
  characterId: string;
  since: Date;
  result?: LongRestResult;
  spellSlotsRestored?: boolean;
}): Promise<void> {
  const { sessionId, userId, characterId, since } = input;
  const idSeed = `story-rest:${sessionId}:${characterId}:${since.getTime()}`;
  try {
    const { engineChatLineExists, postEngineChatLine } = await import('../engine-chat-line.js');
    if (await engineChatLineExists(idSeed)) return;
    let text: string;
    if (input.result) {
      text = longRestLineText({
        hpRestored: input.result.hpRestored,
        hitDiceRestored: input.result.hitDiceRestored,
        spellSlotsRestored: input.spellSlotsRestored ?? false,
      });
    } else {
      const { db } = await import('../../../../db/client');
      const { and, asc, eq, gte, ne } = await import('drizzle-orm');
      const { restEvents } = await import('../../../../db/schema/index');
      const [event] = await db
        .select({
          hpRestored: restEvents.hpRestored,
          resourcesRestored: restEvents.resourcesRestored,
        })
        .from(restEvents)
        .where(
          and(
            eq(restEvents.characterId, characterId),
            eq(restEvents.sessionId, sessionId),
            eq(restEvents.restType, 'long'),
            gte(restEvents.startedAt, since),
            // The finished proof: the claim row carries '[]'; only
            // finishRestEvent replaces it with the rest's resource list.
            ne(restEvents.resourcesRestored, '[]'),
          ),
        )
        .orderBy(asc(restEvents.startedAt))
        .limit(1);
      // No finished event, no line: the claim row alone cannot prove the
      // rest landed, and a false line under the deterministic id would
      // block the real one.
      if (!event) return;
      text = longRestRecoveryLineText(event.hpRestored ?? 0);
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
      msg: 'DM_STORY_LONG_REST_NOTICE_FAILED',
      sessionId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
