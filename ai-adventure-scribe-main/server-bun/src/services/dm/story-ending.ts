/**
 * #1020: the campaign's ending (`campaign_ending` in the reply) reaches the
 * session. Before this applier, nobody owned the ending in code: the campaign's
 * rules (campaign_rules rows, the bible's Clock and final beats) reached the DM
 * only as prompt prose, and `SessionService.completeSession` was called only by
 * the client's manual end-session flow. A one-shot whose Clock reached 6/6 just
 * kept improvising — no ending row, no completion state, completion XP never
 * awarded (Hark G22-008/016: XP frozen at 1,050, the listed landing choice
 * answered with the narration gate's neutral line because an ending turn had
 * no engine event to back its narration).
 *
 * Scope: the ending fires only for a one-shot campaign — `campaigns.campaign_length`
 * is 'one-shot', the value the creation wizard writes and a starter one-shot's
 * campaign inherits through `starterCampaignLength` (#829). Completing a
 * session is irreversible and there is no un-complete; on a multi-session
 * campaign a declaration is refused (`not_one_shot`) rather than bricking the
 * run at a session boundary.
 *
 * The ending is claimed before it lands, as story damage claims its line
 * (#610): the deterministic ending row (`campaign-ending:<session>`) is
 * inserted first, and winning that primary key is what applies the ending.
 * Only the claimer completes the session, through `SessionService.completeSession`
 * — the same completion write the manual flow uses (the manual route also
 * starts chronicle generation; the engine path deliberately does not). If the
 * completion write throws, the claim is released, so a retry can apply once.
 * A declaration that arrives after the ending — a retried turn regenerates
 * its summary, so it will differ — finds the stored row and reports
 * `already_applied` with the STORED summary: the session row, the engine row
 * and the client's completion screen all carry the one text that was stored.
 * A session completed any other way (manual end, death, expiry) has no ending
 * row, so a later declaration reports `already_completed` and changes
 * nothing; /generate's own completed-session guard nulls the field before any
 * story applier runs there anyway.
 *
 * The completion XP rides the same reply's `xp_award` through story-xp.ts;
 * this applier runs after it in /generate, so the award lands while the
 * session is still active. #1139: an award that named the ending on an
 * earlier turn was deferred by story-xp.ts instead of paying mid-story; it
 * is paid here, before the session completes, so its event lands on the
 * ending turn — and if the ending turn carries its own award, that one wins
 * the once-per-message dedupe and the deferred one is dropped, never paid
 * twice. A declaration on a roll-request turn waits for the result turn,
 * as the other story appliers do.
 *
 * Database imports stay inside the functions, as in story-damage.ts: the pure
 * validator tests run outside the real-DB suite, and /v1/llm/generate's route
 * contract tests load this module without an application database.
 */

import { logger } from '../../lib/logger.js';

export type StoryEndingOutcome =
  | 'applied'
  | 'already_applied'
  | 'invalid_ending'
  | 'no_character'
  | 'no_player_message'
  | 'roll_pending'
  | 'not_one_shot'
  | 'already_completed'
  | 'ending_failed';

export interface StoryEndingResult {
  outcome: StoryEndingOutcome;
  /** The stored ending summary, present when the ending applied (now or earlier). */
  summary?: string;
}

export interface CampaignEnding {
  summary: string;
}

/** The contract is one or two sentences; a longer claim is a prompt bug, not an ending. */
export const MAX_ENDING_SUMMARY_LENGTH = 600;

/** The ending engine line's text; the stored summary is parsed back out of it. */
export const ENDING_LINE_PREFIX = '⚙️ Engine: Adventure complete — ';

export function validCampaignEnding(ending: unknown): ending is CampaignEnding {
  if (!ending || typeof ending !== 'object') return false;
  const summary = (ending as { summary?: unknown }).summary;
  return (
    typeof summary === 'string' &&
    summary.trim().length > 0 &&
    summary.trim().length <= MAX_ENDING_SUMMARY_LENGTH
  );
}

export function endingLineText(summary: string): string {
  return `${ENDING_LINE_PREFIX}${summary}`;
}

/** The summary a stored ending line carries, or null when the text is not an ending line. */
export function summaryFromEndingLine(text: string): string | null {
  if (!text.startsWith(ENDING_LINE_PREFIX)) return null;
  const summary = text.slice(ENDING_LINE_PREFIX.length).trim();
  return summary.length > 0 ? summary : null;
}

function endingRowContext(summary: string): Record<string, unknown> {
  return {
    intent: 'campaign_ending',
    combatEngineBlocks: [{ sequence: 0, source: 'system', lines: [summary], cards: [] }],
  };
}

/** The stored ending row's summary for this session, or null when no ending row exists. */
async function storedEndingSummary(sessionId: string): Promise<string | null> {
  const { engineLineUuid } = await import('../engine-chat-line.js');
  const { db } = await import('../../../../db/client');
  const { eq } = await import('drizzle-orm');
  const { dialogueHistory } = await import('../../../../db/schema/index');
  const [row] = await db
    .select({ message: dialogueHistory.message })
    .from(dialogueHistory)
    .where(eq(dialogueHistory.id, engineLineUuid(`campaign-ending:${sessionId}`)))
    .limit(1);
  return row ? summaryFromEndingLine(row.message) : null;
}

/**
 * #1139: the ending turn's player message timestamp, or null when it cannot
 * be recovered. The ending row is moved last by `placeEndingLineAfterReply`,
 * so the ending turn's message is the latest player message sequenced before
 * it. A recovered message that is EARLIER than the ending turn (an
 * unsequenced ending-turn message falls out of the comparison) only widens
 * the dedupe window toward under-paying, never toward paying twice — the
 * unsafe direction would be a message later than the ending turn, which this
 * query cannot return.
 */
async function endingTurnPlayerMessage(sessionId: string): Promise<Date | null> {
  const { engineLineUuid } = await import('../engine-chat-line.js');
  const { db } = await import('../../../../db/client');
  const { and, desc, eq, lt } = await import('drizzle-orm');
  const { dialogueHistory } = await import('../../../../db/schema/index');
  const [endingRow] = await db
    .select({ sequenceNumber: dialogueHistory.sequenceNumber })
    .from(dialogueHistory)
    .where(eq(dialogueHistory.id, engineLineUuid(`campaign-ending:${sessionId}`)))
    .limit(1);
  if (!endingRow || endingRow.sequenceNumber === null) return null;
  const [message] = await db
    .select({ createdAt: dialogueHistory.createdAt })
    .from(dialogueHistory)
    .where(
      and(
        eq(dialogueHistory.sessionId, sessionId),
        eq(dialogueHistory.speakerType, 'player'),
        lt(dialogueHistory.sequenceNumber, endingRow.sequenceNumber),
      ),
    )
    .orderBy(desc(dialogueHistory.sequenceNumber))
    .limit(1);
  return message?.createdAt ?? null;
}

/** Reads the reply's `campaign_ending` and completes the one-shot session it ends. */
export async function applyStoryEnding(input: {
  userId: string;
  sessionId: string;
  ending: unknown;
  /** The reply asks for a roll: the ending belongs to the result turn, not this one. */
  rollRequested?: boolean;
}): Promise<StoryEndingResult> {
  const { userId, sessionId } = input;
  let characterId: string | null = null;
  const done = (outcome: StoryEndingOutcome, summary?: string): StoryEndingResult => {
    logger.info({ msg: 'DM_STORY_ENDING', sessionId, characterId, outcome });
    return summary !== undefined ? { outcome, summary } : { outcome };
  };

  if (!validCampaignEnding(input.ending)) return done('invalid_ending');
  const summary = input.ending.summary.trim();

  const { ownedSessionCharacter } = await import('./dm-feature-gate.js');
  const character = await ownedSessionCharacter(sessionId, userId);
  if (!character) return done('no_character');
  characterId = character.id;
  // The ending belongs to the roll's result, which arrives as its own player message.
  if (input.rollRequested) return done('roll_pending');
  const { playerMessage } = await import('./story-spell-slots.js');
  const message = await playerMessage(sessionId);
  // No saved player message, no turn to hang the ending on.
  if (!message?.createdAt) return done('no_player_message');

  const { db } = await import('../../../../db/client');
  const { eq } = await import('drizzle-orm');
  const { campaigns, gameSessions } = await import('../../../../db/schema/index');
  const [session] = await db
    .select({ status: gameSessions.status, campaignLength: campaigns.campaignLength })
    .from(gameSessions)
    .innerJoin(campaigns, eq(campaigns.id, gameSessions.campaignId))
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  if (!session) return done('no_character');
  if (session.campaignLength !== 'one-shot') return done('not_one_shot');

  const idSeed = `campaign-ending:${sessionId}`;
  if (session.status === 'completed') {
    // Completed by this applier (the ending row is there) or by something
    // else (it is not). Only the first is this ending applied.
    const stored = await storedEndingSummary(sessionId);
    if (stored !== null) {
      // #1139: a retry lands here. The applied path below normally paid or
      // dropped any deferred award already — but if its payment threw, the
      // award was deliberately left in place, so this path pays it rather
      // than clearing it unpaid. The dedupe window must be the ENDING turn's
      // player message, not the latest one: a retry message is later, and
      // paying against it would not see the ending turn's own award and
      // could pay twice. The ending turn's message is the latest player
      // message sequenced before the ending row (the row is moved last by
      // `placeEndingLineAfterReply`, so later messages sequence after it).
      // If it cannot be recovered, the award stays in place — a stale key on
      // a completed session, never a silent drop — and the outcome still
      // reports already-applied.
      const endingSince = await endingTurnPlayerMessage(sessionId);
      if (endingSince) {
        const { payPendingEndingXp } = await import('./story-xp.js');
        await payPendingEndingXp({ sessionId, userId, since: endingSince });
      } else {
        const { readPendingEndingXp } = await import('./story-xp.js');
        if (await readPendingEndingXp(sessionId)) {
          logger.warn({
            msg: 'DM_STORY_ENDING_XP_UNRECOVERED',
            sessionId,
            characterId,
          });
        }
      }
      return done('already_applied', stored);
    }
    return done('already_completed');
  }

  // Claim first, as story damage does: winning the deterministic row's
  // primary key is what applies the ending. A concurrent or retried ending
  // turn loses the claim and reports the stored summary instead of its own.
  const { claimEngineChatLine, releaseEngineChatLine, rewriteEngineChatLine } =
    await import('../engine-chat-line.js');
  const lineInput = {
    sessionId,
    userId,
    idSeed,
    text: endingLineText(summary),
    context: endingRowContext(summary),
  };
  let claimed: boolean;
  try {
    claimed = await claimEngineChatLine(lineInput);
  } catch (error) {
    logger.warn({ msg: 'DM_STORY_ENDING_CLAIM_FAILED', sessionId, characterId, error });
    return done('ending_failed');
  }
  if (!claimed) {
    const stored = await storedEndingSummary(sessionId);
    return done('already_applied', stored ?? summary);
  }

  // #1139: pay a deferred ending award now, while the session is still
  // active — its event lands on the ending turn. The ending turn's own award
  // (applied by story-xp.ts just before this applier in /generate) wins the
  // once-per-message dedupe, so a deferred award alongside it pays nothing.
  // The helper never throws, so a payment failure cannot block the ending:
  // the pending award is left in place and the ending still applies.
  const { payPendingEndingXp } = await import('./story-xp.js');
  await payPendingEndingXp({ sessionId, userId, since: message.createdAt });

  try {
    const { SessionService } = await import('../session-service.js');
    await SessionService.completeSession(sessionId, userId, summary);
  } catch (error) {
    // The claim never became an effect: release it, so a retry applies once.
    try {
      await releaseEngineChatLine(idSeed);
    } catch (releaseError) {
      logger.warn({
        msg: 'DM_STORY_ENDING_RELEASE_FAILED',
        sessionId,
        characterId,
        error: releaseError,
      });
    }
    logger.warn({ msg: 'DM_STORY_ENDING_FAILED', sessionId, characterId, error });
    return done('ending_failed');
  }
  try {
    // The claim does not broadcast; this posts the final text to live clients.
    // A failure here loses only the live push — the row is already stored.
    await rewriteEngineChatLine(lineInput);
  } catch (error) {
    logger.warn({ msg: 'DM_STORY_ENDING_BROADCAST_FAILED', sessionId, characterId, error });
  }
  return done('applied', summary);
}

/**
 * #1084 (Hark V-001): the ending row is claimed inside the appliers, before
 * the turn's DM reply is persisted, so `dialogue_history` ordered it ahead of
 * the ending narration ("Adventure complete" above the DM's ending reply).
 * Once the reply row is stored, move the ending row behind it: the next
 * sequence number for the session, then broadcast with that number so a
 * live client re-sorts. A no-op when no ending row exists or it is already
 * the session's last row.
 */
export async function placeEndingLineAfterReply(input: {
  sessionId: string;
  userId: string;
}): Promise<boolean> {
  const { sessionId } = input;
  const { engineLineUuid } = await import('../engine-chat-line.js');
  const { db } = await import('../../../../db/client');
  const { and, eq, sql } = await import('drizzle-orm');
  const { dialogueHistory } = await import('../../../../db/schema/index');
  const id = engineLineUuid(`campaign-ending:${sessionId}`);
  const lastSequence = sql`(SELECT MAX(d.sequence_number) FROM dialogue_history d WHERE d.session_id = ${sessionId})`;
  const [row] = await db
    .update(dialogueHistory)
    .set({ sequenceNumber: sql`${lastSequence} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(dialogueHistory.id, id),
        eq(dialogueHistory.sessionId, sessionId),
        sql`${dialogueHistory.sequenceNumber} < ${lastSequence}`,
      ),
    )
    .returning();
  if (!row) return false;
  const { broadcastToRoom } = await import('../collaboration/room-manager.js');
  broadcastToRoom(sessionId, null as never, {
    type: 'chat',
    sessionId,
    engineRows: [
      {
        id: row.id,
        sequence: row.sequenceNumber,
        text: row.message,
        kind: 'system',
        sessionId,
        timestamp: (row.timestamp ?? new Date()).toISOString(),
        context: row.context,
      },
    ],
  });
  return true;
}
