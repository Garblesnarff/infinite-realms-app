/**
 * #218 step 2: XP the DM awards in the story (`xp_award` in the reply) reaches the sheet. The
 * server is the one writer: it adds the award to `characters.experience_points`, which the sheet
 * reads on its next load (GET /v1/characters/:id), and records an `experience_events` row.
 *
 * Once per player message, as the slot spend in story-spell-slots.ts: Retry re-sends the same
 * saved message, so a second award for it is not written. No level-up happens here; the sheet
 * shows the XP and levelling stays the player's action. `level_progression` is not written.
 */

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { playerMessage } from './story-spell-slots.js';
import { logger } from '../../lib/logger.js';
import { XP_THRESHOLDS } from '../progression/progression-mechanics.js';

export type StoryXpOutcome =
  | 'awarded'
  | 'already_awarded'
  | 'invalid_amount'
  | 'no_character'
  | 'no_player_message';

/** One story beat never carries more than a whole level's worth of XP (PHB pg. 15 table). */
export function maxStoryXp(level: number): number {
  const from = Math.min(Math.max(Math.trunc(level) || 1, 1), 19);
  return (XP_THRESHOLDS[from + 1] ?? 0) - (XP_THRESHOLDS[from] ?? 0);
}

/**
 * The single writer. Locks the character row, so two turns for one message cannot both read
 * "nothing awarded yet" and both add; then adds the award unless an XP event for this character
 * and session already exists at or after the player message (`since`, the DB clock).
 */
export async function awardStoryXpOnce(input: {
  characterId: string;
  sessionId: string;
  since: Date;
  amount: number;
  reason: string;
}): Promise<'awarded' | 'already_awarded' | 'no_character'> {
  const { db } = await import('../../../../db/client');
  const { and, eq, gte, sql } = await import('drizzle-orm');
  const { characters, experienceEvents } = await import('../../../../db/schema/index');
  const { characterId, sessionId, since, amount, reason } = input;
  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .for('update');
    if (!locked) return 'no_character';
    const [awarded] = await tx
      .select({ id: experienceEvents.id })
      .from(experienceEvents)
      .where(
        and(
          eq(experienceEvents.characterId, characterId),
          eq(experienceEvents.sessionId, sessionId),
          gte(experienceEvents.timestamp, since),
        ),
      )
      .limit(1);
    if (awarded) return 'already_awarded';
    await tx
      .update(characters)
      .set({
        experiencePoints: sql`coalesce(${characters.experiencePoints}, 0) + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(characters.id, characterId));
    await tx.insert(experienceEvents).values({
      characterId,
      sessionId,
      xpGained: amount,
      source: 'other',
      description: reason.slice(0, 500) || null,
    });
    return 'awarded';
  });
}

/** Reads the reply's `xp_award` and applies it for the session's own character. */
export async function awardStoryXp(input: {
  userId: string;
  sessionId: string;
  xpAward: unknown;
}): Promise<StoryXpOutcome> {
  const { userId, sessionId } = input;
  const award = input.xpAward as { amount?: unknown; reason?: unknown };
  const character = await ownedSessionCharacter(sessionId, userId);
  const message = character ? await playerMessage(sessionId) : null;
  let outcome: StoryXpOutcome;
  if (!character) outcome = 'no_character';
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
    outcome = await awardStoryXpOnce({
      characterId: character.id,
      sessionId,
      since: message.createdAt,
      amount: award.amount,
      reason: typeof award.reason === 'string' ? award.reason : '',
    });
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
