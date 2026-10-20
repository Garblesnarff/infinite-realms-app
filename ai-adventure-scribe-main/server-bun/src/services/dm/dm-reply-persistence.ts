/* eslint-disable max-lines -- the boundary, the written text, the fallback and the watchdog. */
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

import { dedupeDmOptions } from './dm-response-schema.js';
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
  { narrationGated = true }: { narrationGated?: boolean } = {},
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
  // the provisional copy is not written either; the client saves the reply it keeps. The gate
  // does not run on a roll-result turn (the engine's lines are the account of it), so the
  // client says when it will not, and the detector is skipped here too.
  if (narrationGated && suspectsFabricatedOutcome(envelope.text, { playerMayHaveActed: true })) {
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
  // #864: same dedupe parseDmResponse applies to the returned envelope, so a
  // provisional row that outlives its tab shows each offered choice once.
  const options = Array.isArray(envelope.options)
    ? dedupeDmOptions(
        envelope.options.filter((option): option is string => typeof option === 'string'),
      )
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
  /** The client will run its narration gate on this turn. Absent means it will. */
  narrationGated?: boolean;
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
  const reason = params.clientInCombat
    ? 'client_in_combat'
    : dmReplySkipReason(params.envelope, { narrationGated: params.narrationGated });
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
  /** The envelope the turn generated, for the server-side fallback write (#783). */
  envelope?: Record<string, unknown> | null;
  /** Owner of the session, for the fallback write's ownership check (#783). */
  userId?: string;
  delayMs?: number;
  /** Test seam: whether this turn's DM row was written (by id). */
  hasDmRow?: (messageId: string) => Promise<boolean>;
}

/** Reasons the server may not fallback-persist a reply the client never saved. */
const FALLBACK_SKIP_REASONS: ReadonlySet<string> = new Set([
  // The narration gate rejected this prose; resurrecting it would persist the
  // exact fabrication the guard exists to prevent (#2373).
  'unverified_harm_claim',
  // Combat turns: declaration prose may describe outcomes the dice have not
  // decided (#2139), and there is no reload-time withholding for it — the
  // player would read undecided outcomes as fact. Roll requests on these
  // turns belong to the engine, not the popup (#2190).
  'combat_start',
  'combat_entry_pending',
  'combat_actions',
  'client_in_combat',
]);

/**
 * The skip reason for a fallback, derived from the envelope itself. The
 * watchdog's reason comes from `dmReplySkipReason`, which returns
 * 'roll_requests' before the combat and gate checks — so a combat envelope
 * carrying roll requests arrives with reason 'roll_requests' and the
 * combat/gate skips would never run. Check the envelope conditions directly.
 */
function fallbackSkipReason(
  envelope: Record<string, unknown>,
  reason: string,
): string | null {
  if (envelope.combat_transition === 'start') return 'combat_start';
  if (envelope.combat_entry_pending) return 'combat_entry_pending';
  if (nonEmptyArray(envelope.combat_actions) || nonEmptyArray(envelope.combatants)) {
    return 'combat_actions';
  }
  if (suspectsFabricatedOutcome(String(envelope.text ?? ''), { playerMayHaveActed: true })) {
    return 'unverified_harm_claim';
  }
  return FALLBACK_SKIP_REASONS.has(reason) ? reason : null;
}

/**
 * The server-side fallback for a DM reply the client never saved (#783). The
 * server already holds the envelope; write it as a provisional row under the
 * turn's reserved id so the player gets the reply after a reload. Carries the
 * roll requests in context so a reload can restore the popup from the same
 * row. Scoped to the roll-request case: combat turns and gate-rejected prose
 * are log-only. Never throws: a failed write must not break the watchdog.
 */
export async function persistFallbackDmReply(params: {
  userId: string;
  sessionId: string;
  messageId: string;
  reason: string;
  envelope: Record<string, unknown> | null;
}): Promise<{ persisted: boolean; skipped?: string }> {
  try {
    if (!params.envelope) return { persisted: false };
    const skipped = fallbackSkipReason(params.envelope, params.reason);
    if (skipped) return { persisted: false, skipped };
    const rollRequests = Array.isArray(params.envelope.roll_requests)
      ? params.envelope.roll_requests
      : [];
    // Roll-request turns are the only ones that reach the fallback.
    if (rollRequests.length === 0) return { persisted: false };
    const purposes = rollRequests
      .map((request) =>
        request && typeof request === 'object'
          ? String((request as Record<string, unknown>).purpose ?? '').trim()
          : '',
      )
      .filter(Boolean);
    const prose = String(params.envelope.text ?? '').trim();
    const text = prose
      ? provisionalDmText(params.envelope).trim()
      : purposes.length > 0
        ? `The DM asks for a roll: ${purposes.join('; ')}.`
        : '';
    if (!text) return { persisted: false };
    const { SessionMessageService } = await import('../session/session-message-service.js');
    await SessionMessageService.addMessage(
      {
        id: params.messageId,
        sessionId: params.sessionId,
        speakerType: 'dm',
        message: text,
        context: {
          emotion: 'neutral',
          intent: 'response',
          combat_transition:
            typeof params.envelope.combat_transition === 'string'
              ? params.envelope.combat_transition
              : 'none',
          [PROVISIONAL_DM_CONTEXT_KEY]: true,
          rollRequests,
        },
      },
      params.userId,
    );
    return { persisted: true };
  } catch (error) {
    logger.error({
      msg: 'DM_REPLY_FALLBACK_PERSIST_FAILED',
      sessionId: params.sessionId,
      messageId: params.messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { persisted: false };
  }
}

/** Whether this turn's DM row was written, by its reserved id. */
export async function dmReplyRowExists(messageId: string): Promise<boolean> {
  const [{ db }, { dialogueHistory }, { eq }] = await Promise.all([
    import('../../../../db/client.js'),
    import('../../../../db/schema/index.js'),
    import('drizzle-orm'),
  ]);
  const rows = await db
    .select({ id: dialogueHistory.id })
    .from(dialogueHistory)
    .where(eq(dialogueHistory.id, messageId))
    .limit(1);
  return rows.length > 0;
}

/**
 * Check once, after `delayMs`, that this turn's DM row was saved after a
 * generation the server did not persist. When it was not, write the envelope
 * as a server-side fallback row (#783) and log `DM_REPLY_UNPERSISTED` — the
 * line Hetzner needed on #2184 to answer "did the DM reply?" without matching
 * `ai_usage` rows to sessions by timestamp.
 */
export function scheduleDmReplyWatchdog(params: DmReplyWatchdogParams): Promise<void> {
  const hasDmRow = params.hasDmRow ?? dmReplyRowExists;
  const delayMs = params.delayMs ?? DM_REPLY_WATCHDOG_MS;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      void Promise.resolve()
        .then(() => hasDmRow(params.messageId))
        .then(async (found) => {
          if (found) return;
          // #783: the client never saved this reply. The server generated it,
          // so persist the fallback row before reporting — the player gets
          // the reply (and its roll popup) after a reload instead of nothing.
          let fallbackPersisted = false;
          if (params.envelope && params.userId) {
            fallbackPersisted = (
              await persistFallbackDmReply({
                userId: params.userId,
                sessionId: params.sessionId,
                messageId: params.messageId,
                reason: params.reason,
                envelope: params.envelope,
              })
            ).persisted;
          }
          logger.warn({
            msg: 'DM_REPLY_UNPERSISTED',
            sessionId: params.sessionId,
            messageId: params.messageId,
            reason: params.reason,
            waitedMs: delayMs,
            fallbackPersisted,
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
