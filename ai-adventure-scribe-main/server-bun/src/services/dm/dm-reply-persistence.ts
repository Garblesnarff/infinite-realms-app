/**
 * Server-owned persistence of the DM reply that /v1/llm/generate just produced (#2218).
 *
 * On 2026-08-26 a stranger's first DM reply was generated (731 output tokens in `ai_usage`) and
 * never reached `dialogue_history`: the browser was the only writer of DM narration, so anything
 * that stopped it between generation and `sendMessage` — a closed tab, a failed save rolled back
 * off the screen, a reply withheld behind a roll prompt — lost the reply with no trace.
 *
 * The engine now writes the reply it generated before the response leaves the server, as a
 * provisional row under an id the client reserved for this turn. The client renders and saves
 * under that same id, and `SessionMessageService.addMessages` replaces a provisional row in place,
 * so a live tab still ends with exactly one row carrying the client's final text, while a dead
 * tab leaves the server's copy instead of nothing.
 *
 * Only turns the client would render early are persisted here — the same boundary
 * `use-ai-response` draws for `suppressRender`. A roll-request, combat-entry or in-combat turn can
 * still be resolved by the engine after generation, and its declaration prose may describe an
 * outcome the dice have not decided (#2139), so those stay client-persisted. They are the turns
 * the watchdog below reports on when no DM row follows.
 */

import { suspectsFabricatedOutcome } from '../../../../shared/narration-harm.js';
import { logger } from '../../lib/logger.js';

// Database imports stay inside the functions, as in combat-intent-roster.ts: /v1/llm/generate
// imports this module, and its route contract tests load without an application database.

/** How long after a non-persisted generation a DM row must exist before it is reported. */
export const DM_REPLY_WATCHDOG_MS = 120_000;

/** Marks a server-written row the client may replace with its final text. */
export const PROVISIONAL_DM_CONTEXT_KEY = 'provisional';

export type DmReplySkipReason =
  | 'unparsed_envelope'
  | 'empty_text'
  | 'roll_requests'
  | 'combat_start'
  | 'combat_entry_pending'
  | 'combat_actions'
  | 'unverified_harm_claim'
  | 'client_in_combat';

const nonEmptyArray = (value: unknown): boolean => Array.isArray(value) && value.length > 0;

/**
 * Whether this envelope is a turn the client renders as soon as it is parsed. Returns the reason
 * it is not, so the log line can say which boundary held the reply back.
 */
export function dmReplySkipReason(
  envelope: Record<string, unknown> | null,
): DmReplySkipReason | null {
  if (!envelope) return 'unparsed_envelope';
  if (typeof envelope.text !== 'string' || !envelope.text.trim()) return 'empty_text';
  if (nonEmptyArray(envelope.roll_requests)) return 'roll_requests';
  if (envelope.combat_transition === 'start') return 'combat_start';
  if (envelope.combat_entry_pending) return 'combat_entry_pending';
  if (nonEmptyArray(envelope.combat_actions) || nonEmptyArray(envelope.combatants)) {
    return 'combat_actions';
  }
  // The client withholds a reply like this until its narration gate has ruled on it (#2373), so
  // the provisional copy is not written either; the client saves the reply it keeps.
  if (suspectsFabricatedOutcome(envelope.text, { playerMayHaveActed: true })) {
    return 'unverified_harm_claim';
  }
  return null;
}

/**
 * The text the client would show for this envelope before its own post-processing: narration
 * followed by the lettered options, exactly as `use-ai-response` builds the early message.
 */
export function provisionalDmText(envelope: Record<string, unknown>): string {
  const text = String(envelope.text ?? '').trim();
  const options = Array.isArray(envelope.options)
    ? envelope.options.filter((option): option is string => typeof option === 'string')
    : [];
  return options.length > 0 ? `${text}\n\n${options.join('\n')}` : text;
}

export interface PersistDmReplyParams {
  userId: string;
  sessionId: string;
  messageId: string;
  envelope: Record<string, unknown> | null;
  /** The client saw no active encounter when it sent the turn. */
  clientInCombat?: boolean;
}

export interface PersistDmReplyResult {
  persisted: boolean;
  reason?: DmReplySkipReason | 'write_failed';
}

/**
 * Write the provisional DM row for a turn, or say why not. Never throws: a failed write must not
 * cost the player the reply the route is about to return.
 */
export async function persistGeneratedDmReply(
  params: PersistDmReplyParams,
): Promise<PersistDmReplyResult> {
  const reason = params.clientInCombat ? 'client_in_combat' : dmReplySkipReason(params.envelope);
  if (reason || !params.envelope)
    return { persisted: false, reason: reason ?? 'unparsed_envelope' };

  try {
    const { SessionMessageService } = await import('../session/session-message-service.js');
    await SessionMessageService.addMessage(
      {
        id: params.messageId,
        sessionId: params.sessionId,
        speakerType: 'dm',
        message: provisionalDmText(params.envelope),
        context: {
          emotion: 'neutral',
          intent: 'response',
          combat_transition: 'none',
          [PROVISIONAL_DM_CONTEXT_KEY]: true,
        },
      },
      params.userId,
    );
    return { persisted: true };
  } catch (error) {
    logger.error({
      msg: 'DM_REPLY_SERVER_PERSIST_FAILED',
      sessionId: params.sessionId,
      messageId: params.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { persisted: false, reason: 'write_failed' };
  }
}

export interface DmReplyWatchdogParams {
  sessionId: string;
  messageId: string;
  reason: string;
  generatedAt: Date;
  delayMs?: number;
  /** Test seam: whether a DM row was written for the session at or after `since`. */
  hasDmRowSince?: (sessionId: string, since: Date) => Promise<boolean>;
}

/** Whether a DM row was written for the session at or after `since` (server clock). */
export async function dmRowExistsSince(sessionId: string, since: Date): Promise<boolean> {
  const [{ db }, { dialogueHistory }, { and, eq, gte }] = await Promise.all([
    import('../../../../db/client.js'),
    import('../../../../db/schema/index.js'),
    import('drizzle-orm'),
  ]);
  const rows = await db
    .select({ id: dialogueHistory.id })
    .from(dialogueHistory)
    .where(
      and(
        eq(dialogueHistory.sessionId, sessionId),
        eq(dialogueHistory.speakerType, 'dm'),
        gte(dialogueHistory.createdAt, since),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Check once, after `delayMs`, that a DM row followed a generation the server did not persist.
 * When none did, log `DM_REPLY_UNPERSISTED` — the line Hetzner needed on #2184 to answer "did the
 * DM reply?" without matching `ai_usage` rows to sessions by timestamp.
 */
export function scheduleDmReplyWatchdog(params: DmReplyWatchdogParams): Promise<void> {
  const hasDmRowSince = params.hasDmRowSince ?? dmRowExistsSince;
  const delayMs = params.delayMs ?? DM_REPLY_WATCHDOG_MS;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void hasDmRowSince(params.sessionId, params.generatedAt)
        .then((found) => {
          if (found) return;
          logger.warn({
            msg: 'DM_REPLY_UNPERSISTED',
            sessionId: params.sessionId,
            messageId: params.messageId,
            reason: params.reason,
            waitedMs: delayMs,
          });
        })
        .catch((error) => {
          logger.warn({
            msg: 'DM_REPLY_WATCHDOG_FAILED',
            sessionId: params.sessionId,
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(resolve);
    }, delayMs);
    if (typeof timer === 'object' && typeof timer.unref === 'function') timer.unref();
  });
}
