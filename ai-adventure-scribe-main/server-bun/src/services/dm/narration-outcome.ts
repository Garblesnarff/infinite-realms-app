/**
 * #266: a failed skill check narrated as a success (Hark GP-041: Stealth 7 vs DC 14 narrated as
 * "practiced stillness"), and the reverse (an engine hit narrated as a miss).
 *
 * The engine's verdict for the turn is authoritative. `contradictsEngineOutcome`
 * (shared/narration-harm.ts) detects explicit verdict language with the player as the subject;
 * this module feeds it the latest roll outcome from the session state and repairs a
 * contradiction by replacing only the contradicting sentences with the engine's truth, plainly
 * stated. A failed check may still have a consequence — noise, a cost, damage — so only
 * explicit success/failure claims contradict; everything else passes through untouched.
 *
 * Fails open: a check that cannot run logs and lets the reply through rather than costing the
 * player their turn.
 */

import { and, desc, eq } from 'drizzle-orm';

import { dialogueHistory, gameSessions } from '../../../../db/schema/index';
import { contradictsEngineOutcome, spliceContradictingSentences } from '../../../../shared/narration-harm.js';
import { logger } from '../../lib/logger.js';

export interface RollOutcome {
  success: boolean;
  total?: number;
  dc?: number;
  ac?: number;
  requestType?: string;
  description?: string;
  timestamp?: string;
}

/** A roll outcome older than this cannot be the current turn's; the gate stays silent. */
const OUTCOME_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * The newest persisted roll result with an authoritative outcome, mirroring the client's
 * `SessionStateService.getLatestRollOutcome` (same combatLog `roll_result` shape the DM prompt
 * carries as `lastRollOutcome`). Null when there is none, it is malformed, its timestamp is
 * missing or too old, or it predates the latest DM message (a previous turn's roll must not
 * repair this turn's narration).
 */
export async function latestRollOutcome(sessionId: string): Promise<RollOutcome | null> {
  // Lazy db import: the module must stay importable without DATABASE_URL so the pure
  // repairNarration unit tests run under vitest (db/client.ts throws at load without it).
  const { db } = await import('../../../../db/client');
  const [row] = await db
    .select({ state: gameSessions.sessionState })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  const log = (row?.state as { combatLog?: unknown } | null)?.combatLog;
  if (!Array.isArray(log)) return null;
  // The latest DM message marks the start of the current exchange; a roll older than it
  // belongs to a previous turn.
  const [latestDm] = await db
    .select({ timestamp: dialogueHistory.timestamp })
    .from(dialogueHistory)
    .where(
      and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'dm')),
    )
    .orderBy(desc(dialogueHistory.timestamp))
    .limit(1);
  const exchangeStart = latestDm?.timestamp?.getTime() ?? 0;
  for (let index = log.length - 1; index >= 0; index -= 1) {
    const entry = (log[index] as { entry?: unknown } | null)?.entry;
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as { kind?: unknown; payload?: unknown };
    if (candidate.kind !== 'roll_result' || !candidate.payload) continue;
    if (typeof candidate.payload !== 'object') return null;
    const payload = candidate.payload as Record<string, unknown>;
    if (typeof payload.success !== 'boolean' || typeof payload.total !== 'number') return null;
    const timestamp = (log[index] as { timestamp?: unknown })?.timestamp;
    // A missing or malformed timestamp cannot be placed in this turn: fail closed.
    if (typeof timestamp !== 'string') return null;
    const rollTime = new Date(timestamp).getTime();
    if (Number.isNaN(rollTime)) return null;
    if (Date.now() - rollTime > OUTCOME_MAX_AGE_MS) return null;
    if (rollTime <= exchangeStart) return null;
    return {
      success: payload.success,
      total: payload.total,
      dc: typeof payload.dc === 'number' ? payload.dc : undefined,
      ac: typeof payload.ac === 'number' ? payload.ac : undefined,
      requestType: typeof payload.requestType === 'string' ? payload.requestType : undefined,
      description: typeof payload.description === 'string' ? payload.description : undefined,
      timestamp,
    };
  }
  return null;
}

/**
 * The engine's truth, plainly stated, for a narration that claimed the opposite. The repair
 * replaces the false claim — it does not embroider it, and it never invents a consequence.
 */
export function repairNarration(outcome: RollOutcome): string {
  const what = outcome.description ? `The ${outcome.description}` : 'The attempt';
  const target =
    typeof outcome.dc === 'number'
      ? ` vs DC ${outcome.dc}`
      : typeof outcome.ac === 'number'
        ? ` vs AC ${outcome.ac}`
        : '';
  const score = ` (${outcome.total}${target})`;
  return outcome.success ? `${what} succeeded${score}.` : `${what} failed${score}.`;
}

/**
 * Checks a DM reply's narration against the engine's latest roll outcome. Returns the reply
 * with only the contradicting sentences replaced by the engine's truth, else null. The rest
 * of the narration is the DM's legitimate prose and stays. Never throws.
 */
export async function repairNarrationContradiction(input: {
  sessionId: string;
  text: string;
  characterName?: string;
}): Promise<string | null> {
  const { sessionId, text, characterName } = input;
  try {
    const outcome = await latestRollOutcome(sessionId);
    if (!outcome) return null;
    const claims = contradictsEngineOutcome(text, {
      success: outcome.success,
      characterName,
      description: outcome.description,
      requestType: outcome.requestType,
    });
    if (!claims.length) return null;
    logger.warn({
      msg: 'DM_NARRATION_OUTCOME_REPAIRED',
      sessionId,
      claims,
      engineSuccess: outcome.success,
    });
    return spliceContradictingSentences(text, claims, repairNarration(outcome));
  } catch (error) {
    logger.warn({
      msg: 'DM_NARRATION_OUTCOME_CHECK_FAILED',
      sessionId,
      error: error instanceof Error ? error.message : error,
    });
    return null;
  }
}
