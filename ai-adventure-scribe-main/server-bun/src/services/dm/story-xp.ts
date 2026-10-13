/**
 * #218 step 2: XP the DM awards in the story (`xp_award` in the reply) reaches the sheet. The
 * server is the one writer: it adds the award to `characters.experience_points`, which the sheet
 * reads on its next load (GET /v1/characters/:id), and records an `experience_events` row.
 *
 * Once per player message, as the slot spend in story-spell-slots.ts: Retry re-sends the same
 * saved message, so a second award for it is not written. No level-up happens here; the sheet
 * shows the XP and levelling stays the player's action. `level_progression` is not written.
 *
 * #273: total story XP per game session is capped at a quarter of the character's current
 * level's milestone band (`storyXpSessionCap`). An award that would exceed the cap is clamped
 * to what remains and logged (`DM_STORY_XP_CAPPED`); when the cap is already reached nothing
 * is written. Level-20 characters earn no story XP: 2014 5e has no XP use past 20, so their
 * cap is 0 rather than the 19→20 band.
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { playerMessage } from './story-spell-slots.js';
import { logger } from '../../lib/logger.js';
import {
  engineChatLineExists,
  postEngineChatLine,
  type EngineChatLineWriter,
} from '../engine-chat-line.js';
import { XP_THRESHOLDS } from '../progression/progression-mechanics.js';

export type StoryXpOutcome =
  | 'awarded'
  | 'already_awarded'
  | 'invalid_amount'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending'
  | 'capped';

/** One story beat never carries more than a whole level's worth of XP (PHB pg. 15 table). */
export function maxStoryXp(level: number): number {
  const from = Math.min(Math.max(Math.trunc(level) || 1, 1), 19);
  return (XP_THRESHOLDS[from + 1] ?? 0) - (XP_THRESHOLDS[from] ?? 0);
}

/**
 * #273: per-session story-XP cap — one quarter of the level's milestone band. Level-20
 * characters earn no story XP (2014 5e has no XP use past 20), so the cap is 0 rather than
 * the 19→20 band.
 */
export function storyXpSessionCap(level: number): number {
  if (level >= 20) return 0;
  return Math.floor(maxStoryXp(level) / 4);
}

export interface StoryXpGrant {
  outcome: 'awarded' | 'already_awarded' | 'no_character' | 'capped';
  /** XP actually written to the sheet by this call — 0 when nothing was written. */
  granted: number;
}

/**
 * The single writer. Locks the character row, so two turns for one message cannot both read
 * "nothing awarded yet" and both add; then adds the award unless an XP event for this character
 * and session already exists at or after the player message (`since`, the DB clock). Only story
 * awards (source 'other') count: a later combat or milestone event must not swallow one.
 */
export async function awardStoryXpOnce(input: {
  characterId: string;
  sessionId: string;
  since: Date;
  amount: number;
  reason: string;
}): Promise<StoryXpGrant> {
  const { db } = await import('../../../../db/client');
  const { and, eq, gte, sql } = await import('drizzle-orm');
  const { characters, experienceEvents } = await import('../../../../db/schema/index');
  const { characterId, sessionId, since, amount, reason } = input;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: characters.id, level: characters.level })
      .from(characters)
      .where(eq(characters.id, characterId))
      .for('update');
    if (!locked) return { outcome: 'no_character', granted: 0 };
    const [awarded] = await tx
      .select({ id: experienceEvents.id })
      .from(experienceEvents)
      .where(
        and(
          eq(experienceEvents.characterId, characterId),
          eq(experienceEvents.sessionId, sessionId),
          eq(experienceEvents.source, 'other'),
          gte(experienceEvents.timestamp, since),
        ),
      )
      .limit(1);
    if (awarded) return { outcome: 'already_awarded', granted: 0 };
    // #273: one quarter of the level's milestone band per session, clamped and logged.
    // Only story awards (source 'other') count toward the session total, as above.
    const [sumRow] = await tx
      .select({ total: sql<number>`coalesce(sum(${experienceEvents.xpGained}), 0)` })
      .from(experienceEvents)
      .where(
        and(
          eq(experienceEvents.characterId, characterId),
          eq(experienceEvents.sessionId, sessionId),
          eq(experienceEvents.source, 'other'),
        ),
      );
    const sessionCap = storyXpSessionCap(locked.level ?? 1);
    const granted = Math.min(amount, Math.max(0, sessionCap - Number(sumRow?.total ?? 0)));
    if (granted < amount) {
      logger.info({
        msg: 'DM_STORY_XP_CAPPED',
        sessionId,
        characterId,
        requested: amount,
        granted,
        sessionCap,
      });
    }
    if (granted <= 0) return { outcome: 'capped', granted: 0 };
    await tx
      .update(characters)
      .set({
        experiencePoints: sql`coalesce(${characters.experiencePoints}, 0) + ${granted}`,
        updatedAt: new Date(),
      })
      .where(eq(characters.id, characterId));
    await tx.insert(experienceEvents).values({
      characterId,
      sessionId,
      xpGained: granted,
      source: 'other',
      description: reason.slice(0, 500) || null,
    });
    return { outcome: granted < amount ? 'capped' : 'awarded', granted };
  });
}

/**
 * #310: posts the visible story-XP chat line, recoverably.
 *
 * Idempotent: skips when the notice row already exists. Reads the STORED award event —
 * never re-awards to repair a message — so a retry (already_awarded because an earlier
 * call stored the grant) re-posts a lost notice with the granted amount, including
 * partial #273 caps. A failed write is caught and logged; the next call retries.
 * Never throws.
 */
export async function ensureStoryXpNotice(
  input: {
    sessionId: string;
    userId: string;
    characterId: string;
    since: Date;
    reason: string;
  },
  writer: EngineChatLineWriter = postEngineChatLine,
): Promise<void> {
  const { sessionId, userId, characterId, since, reason } = input;
  const idSeed = `story-xp:${sessionId}:${characterId}:${since.getTime()}`;
  const { db } = await import('../../../../db/client');
  const { and, eq, gte } = await import('drizzle-orm');
  const { experienceEvents } = await import('../../../../db/schema/index');
  try {
    if (await engineChatLineExists(idSeed)) return;
    const [event] = await db
      .select({ xp: experienceEvents.xpGained, why: experienceEvents.description })
      .from(experienceEvents)
      .where(
        and(
          eq(experienceEvents.characterId, characterId),
          eq(experienceEvents.sessionId, sessionId),
          eq(experienceEvents.source, 'other'),
          gte(experienceEvents.timestamp, since),
        ),
      )
      .limit(1);
    if (!event) return;
    const why = event.why || reason || 'a story win';
    await writer({
      sessionId,
      userId,
      idSeed,
      text: `⚙️ Engine: Story XP — +${event.xp} XP (${why}). Already on your character sheet.`,
      context: {
        intent: 'story_xp',
        combatEngineBlocks: [{ sequence: 0, source: 'system', lines: [why], cards: [] }],
      },
    });
  } catch (error) {
    logger.warn({
      msg: 'STORY_XP_NOTICE_FAILED_WILL_RETRY',
      sessionId,
      characterId,
      error: error instanceof Error ? error.message : error,
    });
  }
}

/** Reads the reply's `xp_award` and applies it for the session's own character. */
export async function awardStoryXp(
  input: {
    userId: string;
    sessionId: string;
    xpAward: unknown;
    /** The reply asks for a roll: the outcome is not known yet, so nothing is earned yet. */
    rollRequested?: boolean;
  },
  deps: { noticeWriter?: EngineChatLineWriter } = {},
): Promise<StoryXpOutcome> {
  const { userId, sessionId } = input;
  const award = input.xpAward as { amount?: unknown; reason?: unknown };
  const character = await ownedSessionCharacter(sessionId, userId);
  const message = character ? await playerMessage(sessionId) : null;
  let outcome: StoryXpOutcome;
  if (!character) outcome = 'no_character';
  // The award belongs to the roll's result, which arrives as its own player message.
  else if (input.rollRequested) outcome = 'roll_pending';
  else if (
    typeof award.amount !== 'number' ||
    !Number.isInteger(award.amount) ||
    award.amount < 1 ||
    award.amount > maxStoryXp(character.level)
  )
    outcome = 'invalid_amount';
  // No saved player message, no key to award once against: the turn answers nothing the player did.
  else if (!message?.createdAt) outcome = 'no_player_message';
  else {
    const reason = typeof award.reason === 'string' ? award.reason : '';
    const grant = await awardStoryXpOnce({
      characterId: character.id,
      sessionId,
      since: message.createdAt,
      amount: award.amount,
      reason,
    });
    outcome = grant.outcome;
    // #310: the visible notice is recoverable, not fire-and-forget. On a retry
    // (already_awarded because an earlier call stored the grant) this re-posts a lost
    // notice from the stored event without awarding again.
    await ensureStoryXpNotice(
      {
        sessionId,
        userId,
        characterId: character.id,
        since: message.createdAt,
        reason,
      },
      deps.noticeWriter,
    );
  }
  logger.info({
    msg: 'DM_STORY_XP_AWARD',
    sessionId,
    characterId: character?.id ?? null,
    amount: award.amount,
    outcome,
  });
  return outcome;
}
