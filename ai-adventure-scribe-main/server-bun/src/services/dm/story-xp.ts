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
 *
 * #1139: an award whose reason names the ending, on a one-shot whose ending has not
 * fired yet, does NOT pay at once — it would land on a mid-story turn while the
 * ending turn itself carries no XP (Hark's run: +450 naming the ending, then a
 * `campaign_ending` reply with no award). It is deferred in the session's
 * `session_state` (`pendingEndingXp`, first one wins) and paid by story-ending.ts
 * when the ending applies, before the session completes — so the event lands on
 * the ending turn, and the ending turn's own award, if it has one, wins the
 * once-per-message dedupe instead (never paid twice).
 */

import { sql, type SQL } from 'drizzle-orm';

import { ownedSessionCharacter } from './dm-feature-gate.js';
import { playerMessage } from './story-spell-slots.js';
import { gameSessions } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';
import {
  engineChatLineExists,
  engineLineUuid,
  postEngineChatLine,
  type EngineChatLineWriter,
} from '../engine-chat-line.js';
import { XP_THRESHOLDS } from '../progression/progression-mechanics.js';

export type StoryXpOutcome =
  | 'awarded'
  | 'already_awarded'
  | 'victory_already_paid'
  | 'invalid_amount'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending'
  | 'capped'
  | 'deferred';

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
  outcome: 'awarded' | 'already_awarded' | 'victory_already_paid' | 'no_character' | 'capped';
  /** XP actually written to the sheet by this call — 0 when nothing was written. */
  granted: number;
}

/** Words that make a name token useless for spotting a defeat ("The Manager" → "manager"). */
const DEFEAT_NAME_STOPWORDS = new Set(['the', 'and', 'for', 'with']);

/** Verb stems a story-award reason uses when it is awarding a kill, not a new deed. */
const DEFEAT_VERBS = [
  'defeat',
  'kill',
  'slay',
  'slain',
  'slew',
  'vanquish',
  'destroy',
  'felled',
  'dispatched',
  'banished',
];

/**
 * #615: does this story award's reason award the defeat a victory row already paid?
 * The victory description is `Victory XP [<encounterId>]: <defeated names>` (the shape
 * `awardCombatVictoryXp` writes). A reason that speaks of defeating/killing at all, or
 * that names one of the defeated, is the DM echoing that kill; a reason for a different
 * deed ("Solved the logbook") matches neither and pays. Prefix match, so inflections
 * ("Defeating", "killed", "Remy's") count.
 */
export function reasonReferencesDefeat(
  reason: string,
  victoryDescription: string | null,
): boolean {
  if (!reason) return false;
  const text = reason.toLowerCase();
  const hasWord = (word: string) => new RegExp(`\\b${word}`).test(text);
  if (DEFEAT_VERBS.some(hasWord)) return true;
  const namesPart = victoryDescription?.split(']: ')[1];
  if (!namesPart || namesPart === 'the encounter') return false;
  return namesPart
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word.length >= 3 && !DEFEAT_NAME_STOPWORDS.has(word))
    .some(hasWord);
}

/**
 * #1139: does this award's reason name the ending? The real producer's shape is
 * the ending turn's own award ("Completed the Gardener's Heir one-shot") — the
 * DM reaches for completion language when it means the adventure's end, not a
 * deed inside it. "final" alone is deliberately NOT here: "final blow" and
 * "final confrontation" are mid-story deeds, and a false positive strands the
 * award until an ending that may never fire.
 */
export function reasonNamesEnding(reason: string): boolean {
  if (!reason) return false;
  // Negations are excluded: "incomplete", "unfinished", "never-ending" are
  // mid-story states, not the adventure's end, and deferring on them would
  // strand the award. The lookbehinds block only the negated form — a reason
  // that also names a real completion elsewhere still matches.
  return (
    /(?<!in|un)complet/i.test(reason) ||
    /(?<!un)finish/i.test(reason) ||
    /(?<!in)conclud/i.test(reason) ||
    /(?<!never-)\bending\b/i.test(reason)
  );
}

/** The `session_state` key holding a deferred ending award, if one is owed. */
export const PENDING_ENDING_XP_KEY = 'pendingEndingXp';

export interface PendingEndingXpAward {
  amount: number;
  reason: string;
}

/**
 * #1139: the deferred ending awards on a session's `session_state`. A list,
 * not a single award: `reasonNamesEnding` matches any completion language,
 * so two distinct sub-goal completions ("Completed the Root Stair" after
 * "Completed the Gardener's Heir one-shot") are two real awards, and the
 * second must not be dropped the way a same-reason retry is. The ending
 * turn pays the list as one summed event (the once-per-message dedupe
 * forbids paying them as separate events with the same `since`).
 */
export interface PendingEndingXp {
  characterId: string;
  awards: PendingEndingXpAward[];
}

/** #1139: the total XP a pending list will pay (before the session cap). */
export function pendingEndingXpTotal(pending: PendingEndingXp): number {
  return pending.awards.reduce((sum, award) => sum + award.amount, 0);
}

/**
 * Client `session_state` writes replace the blob; the deferred ending awards
 * are engine-owned, so the live row's value wins — the same single-UPDATE
 * preservation as the tracker state (#1042) and the Action Surge mark
 * (#975). A stored valid value replaces the incoming key; without one, the
 * incoming key is stripped — a client can neither erase deferred awards
 * with a stale snapshot nor forge them, and a forged amount can never
 * reach the ending turn's payment. The SQL test is structural (object +
 * characterId + non-empty awards array + a valid first element); the
 * strict element-by-element test lives in `validPendingEndingXp`, which
 * SQL cannot express without a subquery. The only server writer is
 * `deferEndingXp`, which always writes a valid list, so a stored value
 * that fails the strict test can only come from a direct database write.
 */
export function pendingEndingXpPreservingState(merged: SQL): SQL {
  const stored = sql`${gameSessions.sessionState} -> ${PENDING_ENDING_XP_KEY}`;
  const first = sql`${stored} -> 'awards' -> 0`;
  // The first amount must be an integer >= 1. The CASE gate runs before the
  // cast, so a non-numeric stored amount can never make the cast throw —
  // the regex admits only digit strings.
  const validStored = sql`jsonb_typeof(${stored}) = 'object'
    AND jsonb_typeof(${stored} -> 'characterId') = 'string'
    AND jsonb_typeof(${stored} -> 'awards') = 'array'
    AND jsonb_array_length(${stored} -> 'awards') >= 1
    AND jsonb_typeof(${first} -> 'amount') = 'number'
    AND jsonb_typeof(${first} -> 'reason') = 'string'
    AND CASE WHEN (${first} ->> 'amount') ~ '^-?[0-9]+$'
      THEN (${first} ->> 'amount')::numeric >= 1 ELSE false END`;
  return sql`CASE WHEN ${validStored}
    THEN (${merged} - ${PENDING_ENDING_XP_KEY}) || jsonb_build_object(${PENDING_ENDING_XP_KEY}::text, ${stored})
    ELSE ${merged} - ${PENDING_ENDING_XP_KEY} END`;
}

/** #1139: the shape test a stored deferred-awards value must pass, on read and in a transaction. */
export function validPendingEndingXp(value: unknown): value is PendingEndingXp {
  if (!value || typeof value !== 'object') return false;
  const { characterId, awards } = value as Record<string, unknown>;
  if (typeof characterId !== 'string') return false;
  if (!Array.isArray(awards) || awards.length < 1) return false;
  return awards.every((award) => {
    if (!award || typeof award !== 'object') return false;
    const { amount, reason } = award as Record<string, unknown>;
    return (
      typeof amount === 'number' &&
      Number.isInteger(amount) &&
      amount >= 1 &&
      typeof reason === 'string'
    );
  });
}

/**
 * #1139: the deferred ending award on this session's `session_state`, or null.
 * The column is client-writable through the sessions route, so the shape is
 * validated on read: a malformed value reads as absent, never as an award.
 */
export async function readPendingEndingXp(sessionId: string): Promise<PendingEndingXp | null> {
  const { db } = await import('../../../../db/client');
  const { eq } = await import('drizzle-orm');
  const { gameSessions } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ sessionState: gameSessions.sessionState })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  const pending = (row?.sessionState as Record<string, unknown> | null)?.[PENDING_ENDING_XP_KEY];
  return validPendingEndingXp(pending) ? pending : null;
}

/**
 * #1139: clears a deferred ending award with a single key-removing UPDATE —
 * atomic, and it cannot lose unrelated keys a client wrote between a read and
 * a write the way a read-modify-write could. Runs after the ending fires —
 * whether the pending award paid, lost the dedupe to the ending turn's own
 * award, or capped out — so it can never pay a second time. A malformed
 * value is cleared the same way.
 */
export async function clearPendingEndingXp(sessionId: string): Promise<void> {
  const { db } = await import('../../../../db/client');
  const { eq, sql } = await import('drizzle-orm');
  const { gameSessions } = await import('../../../../db/schema/index');
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`${gameSessions.sessionState} - ${PENDING_ENDING_XP_KEY}`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionId));
}

export type DeferEndingXpOutcome = 'deferred' | 'already_pending' | 'not_one_shot' | 'already_ended';

/**
 * #1139: defers an ending-named award to the ending turn. Only a one-shot
 * whose ending row does not exist yet defers: a multi-session campaign never
 * fires `campaign_ending`, so deferring there would strand the award, and an
 * ending that already applied means the session is complete. A retried turn
 * re-defers the same award (same reason: first-wins, nothing added), but a
 * second award with a DIFFERENT reason is a distinct deed — completion
 * language also names sub-goal completions — so it is appended to the
 * pending list instead of dropped. Every check runs inside one transaction
 * that locks the character row and then the session row — the same lock
 * order `awardStoryXpOnce` uses, so no deadlock, and no window where an
 * ending claim lands between the ending-row check and the write. A missing
 * session or character falls through to the normal immediate path, as
 * before.
 */
export async function deferEndingXp(input: {
  sessionId: string;
  characterId: string;
  amount: number;
  reason: string;
}): Promise<DeferEndingXpOutcome> {
  const { sessionId, characterId, amount, reason } = input;
  const { db } = await import('../../../../db/client');
  const { eq } = await import('drizzle-orm');
  const { campaigns, characters, dialogueHistory, gameSessions } = await import(
    '../../../../db/schema/index'
  );
  return db.transaction(async (tx) => {
    const [lockedCharacter] = await tx
      .select({ id: characters.id })
      .from(characters)
      .where(eq(characters.id, characterId))
      .for('update');
    if (!lockedCharacter) return 'not_one_shot';
    const [locked] = await tx
      .select({ sessionState: gameSessions.sessionState, campaignId: gameSessions.campaignId })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .for('update');
    if (!locked || !locked.campaignId) return 'not_one_shot';
    const [campaign] = await tx
      .select({ campaignLength: campaigns.campaignLength })
      .from(campaigns)
      .where(eq(campaigns.id, locked.campaignId));
    if (!campaign || campaign.campaignLength !== 'one-shot') return 'not_one_shot';
    const [endingRow] = await tx
      .select({ id: dialogueHistory.id })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.id, engineLineUuid(`campaign-ending:${sessionId}`)))
      .limit(1);
    if (endingRow) return 'already_ended';
    const state = { ...((locked.sessionState as Record<string, unknown> | null) ?? {}) };
    const existing = state[PENDING_ENDING_XP_KEY];
    if (validPendingEndingXp(existing)) {
      // Same reason: the DM repeating the award (or a retried turn) — first
      // wins, nothing is added. A different reason is a distinct deed, so it
      // joins the list the ending turn pays as one summed event.
      if (existing.awards.some((award) => award.reason === reason)) {
        return 'already_pending';
      }
      state[PENDING_ENDING_XP_KEY] = {
        characterId,
        awards: [...existing.awards, { amount, reason }],
      };
    } else {
      // Nothing valid stored (absent, or malformed by a direct database
      // write — it would read as absent anyway): start a fresh list.
      state[PENDING_ENDING_XP_KEY] = { characterId, awards: [{ amount, reason }] };
    }
    await tx
      .update(gameSessions)
      .set({ sessionState: state, updatedAt: new Date() })
      .where(eq(gameSessions.id, sessionId));
    return 'deferred';
  });
}

/**
 * The single writer. Locks the character row, so two turns for one message cannot both read
 * "nothing awarded yet" and both add; then adds the award unless an XP event for this character
 * and session already exists at or after the player message (`since`, the DB clock). Story
 * awards (source 'other') dedupe against each other. #615: a combat-victory award
 * (source 'combat' with the `Victory XP [...]` description `awardCombatVictoryXp` writes)
 * at or after the message also blocks the story award — the deterministic victory XP is
 * authoritative, and the model demonstrably emits `xp_award` for the same kill despite the
 * prompt-level "Never use for combat victories" rule, so the guard lives here, not in the
 * prompt. The same block applies to a victory from the immediately previous turn when
 * this award's reason is for that defeat (the next-turn echo; see the check below). A
 * combat-source event from elsewhere (ProgressionService.awardXP's generic shape)
 * still does not swallow one.
 */
export async function awardStoryXpOnce(input: {
  characterId: string;
  sessionId: string;
  since: Date;
  amount: number;
  reason: string;
  /**
   * #1139: true only when paying a deferred ending award. A deferred award
   * was earned first, so ordinary awards computed while it is outstanding
   * must reserve its amount against the session cap — otherwise later deeds
   * eat the cap and the ending turn pays 0. The pending payment itself does
   * not reserve against itself.
   */
  forPendingPayment?: boolean;
  /**
   * #1139: true when this award itself names the ending — i.e. the ending
   * turn's own award. It is the ending XP, not a competing deed, so it pays
   * ahead of the reservation and the pending payment then drops to the
   * once-per-message dedupe.
   */
  isEndingAward?: boolean;
}): Promise<StoryXpGrant> {
  const { db } = await import('../../../../db/client');
  const { and, desc, eq, gte, like, lt, sql } = await import('drizzle-orm');
  const { characters, dialogueHistory, experienceEvents, gameSessions } = await import(
    '../../../../db/schema/index'
  );
  const { characterId, sessionId, since, amount, reason, forPendingPayment, isEndingAward } =
    input;
  // #130: captured (not returned directly) so the invalidation broadcast below
  // runs after the transaction commits.
  const grant = await db.transaction(async (tx): Promise<StoryXpGrant> => {
    const [locked] = await tx
      .select({ id: characters.id, level: characters.level })
      .from(characters)
      .where(eq(characters.id, characterId))
      .for('update');
    if (!locked) return { outcome: 'no_character', granted: 0 };
    // #1139: the session row is locked second (character first, the same
    // order `deferEndingXp` uses), so a concurrent defer cannot slip a
    // pending award in between this cap computation and the write.
    const [lockedSession] = await tx
      .select({ sessionState: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .for('update');
    const pending = validPendingEndingXp(
      (lockedSession?.sessionState as Record<string, unknown> | null)?.[PENDING_ENDING_XP_KEY],
    )
      ? ((lockedSession?.sessionState as Record<string, unknown>)[PENDING_ENDING_XP_KEY] as PendingEndingXp)
      : null;
    const reserved =
      forPendingPayment || isEndingAward ? 0 : pending ? pendingEndingXpTotal(pending) : 0;
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
    // #615: the kill already paid. A combat-victory award — the `Victory XP [...]`
    // description `awardCombatVictoryXp` writes — at or after the player message means
    // the deterministic victory XP covered this turn's kill; the DM's `xp_award` for it
    // is the duplicate the issue reports, so nothing is written and no notice follows
    // (`ensureStoryXpNotice` finds no story event). Only victory awards block: a
    // combat-source event from elsewhere (ProgressionService.awardXP's generic shape)
    // still does not swallow one (#218). Checked inside the same transaction as the
    // story-event check above: in production the victory always lands before the
    // DM's reply is processed, so the award it wrote is visible to this check.
    const [victoryPaid] = await tx
      .select({ id: experienceEvents.id })
      .from(experienceEvents)
      .where(
        and(
          eq(experienceEvents.characterId, characterId),
          eq(experienceEvents.sessionId, sessionId),
          eq(experienceEvents.source, 'combat'),
          like(experienceEvents.description, 'Victory XP [%'),
          gte(experienceEvents.timestamp, since),
        ),
      )
      .limit(1);
    if (victoryPaid) return { outcome: 'victory_already_paid', granted: 0 };
    // #615, the next-turn echo: the check above only sees a victory at or after THIS
    // message, but the duplicate Hark reported (N3-104) arrives one turn later. The
    // conclusion plants a tactical fact in the next turn's context naming the award
    // ("COMBAT XP: the game awarded … Do not set xp_award for this victory"), and the
    // model still emits `xp_award` for the same defeat on that turn — keyed to a new
    // player message saved after the victory event, so the check above is blind to
    // it. A victory that landed during the immediately previous turn (at or after the
    // previous player message, before this one) therefore also blocks — but only
    // when this award's reason is for that defeat (`reasonReferencesDefeat`): a new
    // deed on the same turn pays in full. One turn is the bound: the tactical fact
    // is consumed on the next turn, which is where the echo pressure lives.
    const [prevMessage] = await tx
      .select({ createdAt: dialogueHistory.createdAt })
      .from(dialogueHistory)
      .where(
        and(
          eq(dialogueHistory.sessionId, sessionId),
          eq(dialogueHistory.speakerType, 'player'),
          lt(dialogueHistory.createdAt, since),
        ),
      )
      .orderBy(desc(dialogueHistory.createdAt), desc(dialogueHistory.sequenceNumber))
      .limit(1);
    if (prevMessage?.createdAt) {
      const recentVictories = await tx
        .select({ description: experienceEvents.description })
        .from(experienceEvents)
        .where(
          and(
            eq(experienceEvents.characterId, characterId),
            eq(experienceEvents.sessionId, sessionId),
            eq(experienceEvents.source, 'combat'),
            like(experienceEvents.description, 'Victory XP [%'),
            gte(experienceEvents.timestamp, prevMessage.createdAt),
            lt(experienceEvents.timestamp, since),
          ),
        )
        .orderBy(desc(experienceEvents.timestamp))
        .limit(5);
      if (recentVictories.some((row) => reasonReferencesDefeat(reason, row.description))) {
        return { outcome: 'victory_already_paid', granted: 0 };
      }
    }
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
    // #1139: the reserved pending amount counts against the cap for ordinary
    // awards, so the first-earned ending award keeps its share. The pending
    // payment itself and the ending turn's own award (both reserved 0) pay
    // up to the remainder — the own award first, then the pending drops to
    // the dedupe.
    const granted = Math.min(
      amount,
      Math.max(0, sessionCap - Number(sumRow?.total ?? 0) - reserved),
    );
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
  // #130: broadcast after the transaction commits, so the sheet's refetch
  // sees the new XP total. 'capped' with granted 0 wrote nothing. A failed
  // broadcast must not fail the award: the write already landed.
  if (grant.granted > 0) {
    try {
      const { publishStoryCharacterUpdate } = await import('./story-broadcast.js');
      publishStoryCharacterUpdate(sessionId, 'story_xp');
    } catch (broadcastError) {
      logger.warn({
        msg: 'DM_STORY_XP_BROADCAST_FAILED',
        sessionId,
        characterId,
        error:
          broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
      });
    }
  }
  return grant;
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

export type PayPendingEndingXpOutcome = 'paid' | 'dropped' | 'none' | 'failed';

/**
 * #1139: pays deferred ending awards, if any are outstanding. Shared by the
 * ending turn (`applyStoryEnding`), the already-applied retry path, and the
 * manual-end route — every path that can resolve a session. The list pays
 * as one summed event (the once-per-message dedupe forbids separate events
 * with the same `since`), through `awardStoryXpOnce` with
 * `forPendingPayment`, so the session cap reservation does not count the
 * awards against themselves, and the once-per-turn dedupe still blocks a
 * double pay against the ending turn's own award. The pending key is
 * cleared whenever the payment attempt resolves (paid, capped out, or
 * deduped) — never on a failure, where the awards are left in place for a
 * later path to recover. Never throws: a payment failure must not block
 * the ending or the manual end it rides on.
 */
export async function payPendingEndingXp(input: {
  sessionId: string;
  userId: string;
  since: Date;
}): Promise<{ outcome: PayPendingEndingXpOutcome; granted: number }> {
  const { sessionId, userId, since } = input;
  // The read is inside the try: callers rely on this helper never throwing
  // (the ending applier and the manual-end route both call it unguarded),
  // and a read failure must degrade to "left in place", not to a 500. The
  // character id is only known once the read succeeds, so the failure log
  // carries it when available and null otherwise.
  let characterId: string | null = null;
  try {
    const pending = await readPendingEndingXp(sessionId);
    if (!pending) return { outcome: 'none', granted: 0 };
    characterId = pending.characterId;
    // One summed event with the joined reasons, so every deferred deed is
    // attributed; the session cap still clamps the total at pay time.
    const amount = pendingEndingXpTotal(pending);
    const reason = pending.awards.map((award) => award.reason).join('; ');
    const grant = await awardStoryXpOnce({
      characterId: pending.characterId,
      sessionId,
      since,
      amount,
      reason,
      forPendingPayment: true,
    });
    if (grant.granted > 0) {
      await ensureStoryXpNotice({
        sessionId,
        userId,
        characterId: pending.characterId,
        since,
        reason,
      });
    }
    await clearPendingEndingXp(sessionId);
    return { outcome: grant.granted > 0 ? 'paid' : 'dropped', granted: grant.granted };
  } catch (error) {
    logger.warn({
      msg: 'DM_STORY_PENDING_XP_PAYMENT_FAILED',
      sessionId,
      characterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { outcome: 'failed', granted: 0 };
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
    /**
     * #1139: the same reply declares `campaign_ending` — this IS the ending
     * turn, so its award pays at once instead of deferring to an ending that
     * is already here.
     */
    endingDeclared?: boolean;
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
    // #1139: an award naming the ending waits for the ending turn instead of
    // paying mid-story — unless this reply IS the ending turn, in which case
    // it pays at once. Only the deferral itself is decided here; story-ending.ts
    // pays it when the ending applies. A multi-session campaign or an already
    // applied ending falls through to the normal path below.
    const deferral = reasonNamesEnding(reason) && !input.endingDeclared
      ? await deferEndingXp({
            sessionId,
            characterId: character.id,
            amount: award.amount,
            reason,
          })
        : null;
    if (deferral === 'deferred' || deferral === 'already_pending') {
      outcome = 'deferred';
      logger.info({
        msg: 'DM_STORY_XP_AWARD',
        sessionId,
        characterId: character?.id ?? null,
        amount: award.amount,
        outcome,
      });
      return outcome;
    }
    // #1139: an ending-named award that reaches here IS the ending turn's own
    // award (endingDeclared) — it is the ending XP, not an ordinary deed, so
    // it does not reserve against the pending award: it pays first, and the
    // pending payment then drops to the once-per-message dedupe. Ordinary
    // awards reserve, so they cannot eat the deferred award's share.
    const grant = await awardStoryXpOnce({
      characterId: character.id,
      sessionId,
      since: message.createdAt,
      amount: award.amount,
      reason,
      isEndingAward: reasonNamesEnding(reason),
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
