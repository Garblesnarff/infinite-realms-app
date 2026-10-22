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
 * session is still active. A declaration on a roll-request turn waits for the
 * result turn, as the other story appliers do.
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
    return stored !== null ? done('already_applied', stored) : done('already_completed');
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
