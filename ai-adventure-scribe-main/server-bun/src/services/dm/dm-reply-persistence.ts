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

import { dedupeDmOptions, stripOptionsRepeatedInText } from './dm-response-schema.js';
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
  | 'client_in_combat'
  | 'client_cancellable';

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
  // #864: same dedupe parseDmResponse applies to the returned envelope, so a
  // provisional row that outlives its tab shows each offered choice once.
  const options = Array.isArray(envelope.options)
    ? dedupeDmOptions(
        envelope.options.filter((option): option is string => typeof option === 'string'),
      )
    : [];
  // #864 reopened: same text reconciliation as parseDmResponse — the choices
  // can also sit inside the narration text this function appends them to.
  const text = stripOptionsRepeatedInText(String(envelope.text ?? ''), options).trim();
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
  /** The client may cancel this sheet-cast turn after generation, so do not keep provisional prose. */
  holdProse?: boolean;
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
  const reason = params.holdProse
    ? 'client_cancellable'
    : params.clientInCombat
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
  /** #1390: test seam for whether the fight this reply opened is live. */
  hasActiveEncounter?: (sessionId: string, userId: string, generatedAt?: Date) => Promise<boolean>;
  /** #1390: test seam for the session's declined actor keys. */
  declinedActorKeys?: (sessionId: string) => Promise<string[]>;
  /**
   * #1416: the durable record for a held combat-entry reply. When given, the record decides
   * whether the reply is published, so the watchdog no longer depends on a live encounter.
   * Absent (non-combat turns, unit tests), the legacy fallback below runs unchanged.
   */
  replyRecords?: DmReplyRecordStore;
  /** #1416: test seam for the row write a `ready` record publishes through. */
  writeReplyRow?: (record: DmReplyRecord) => Promise<void>;
}

/**
 * #1390: whether the fight this reply opened is live — an active encounter
 * that began after this turn was generated. An already-live fight from
 * before the turn is not the fight this reply opened, and without a
 * generation time there is nothing to compare against, so both read as no
 * fight. A lookup failure also reads as no fight, so the fallback keeps
 * today's skip rather than resurrecting prose for a fight nobody confirmed.
 */
async function defaultHasActiveEncounter(
  sessionId: string,
  userId: string,
  generatedAt?: Date,
): Promise<boolean> {
  if (!generatedAt) return false;
  // #1416: three outcomes read as "no fight" but mean different things, so each logs its own line.
  let encounter: { startedAt: Date } | null | undefined;
  try {
    const { CombatEncounterService } = await import('../combat/combat-encounter-service.js');
    encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
  } catch (error) {
    logger.warn({
      msg: 'DM_REPLY_ENCOUNTER_LOOKUP_FAILED',
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
  if (!encounter) {
    logger.info({ msg: 'DM_REPLY_ENCOUNTER_ENDED', sessionId, reason: 'no_active_encounter' });
    return false;
  }
  if (encounter.startedAt.getTime() <= generatedAt.getTime()) {
    logger.info({ msg: 'DM_REPLY_ENCOUNTER_ENDED', sessionId, reason: 'predates_turn' });
    return false;
  }
  return true;
}

/**
 * #1390: the session's declined actor keys, for the bypass's decline guard.
 * No catch here by design: a failed read propagates to the bypass branch,
 * which keeps the skip — uncertainty must not resurrect a refused fight.
 */
async function defaultDeclinedActorKeys(sessionId: string): Promise<string[]> {
  const { readDeclinedCombatEntryActorKeys } = await import('../combat/pending-combat-entry.js');
  return await readDeclinedCombatEntryActorKeys(sessionId);
}

/**
 * #1390: normalized combatant names from a held envelope, for the decline
 * guard. The pending entry's combatants win; a combat_start envelope has
 * only its own combatants. Broader than the actor key on purpose: a name
 * shared with a declined fight blocks the bypass (safe direction — the
 * narration stays missing, as today, rather than contradicting a refusal).
 */
function combatantNames(envelope: Record<string, unknown>): string[] {
  const pending = envelope.combat_entry_pending;
  const fromPending =
    pending && typeof pending === 'object'
      ? (pending as Record<string, unknown>).combatants
      : undefined;
  const raw = Array.isArray(fromPending)
    ? fromPending
    : Array.isArray(envelope.combatants)
      ? envelope.combatants
      : [];
  const names = new Set<string>();
  for (const combatant of raw) {
    if (combatant && typeof combatant === 'object') {
      const name = (combatant as Record<string, unknown>).name;
      if (typeof name === 'string') {
        const normalized = name.trim().toLocaleLowerCase();
        if (normalized) names.add(normalized);
      }
    }
  }
  return [...names];
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
  // A cancellable sheet cast the player gave up: resurrecting its prose would narrate a cast
  // that never happened, and its roll popup with it (#1021).
  'client_cancellable',
]);

/**
 * The skip reason for a fallback, derived from the envelope itself. The
 * watchdog's reason comes from `dmReplySkipReason`, which returns
 * 'roll_requests' before the combat and gate checks — so a combat envelope
 * carrying roll requests arrives with reason 'roll_requests' and the
 * combat/gate skips would never run. Check the envelope conditions directly.
 */
function fallbackSkipReason(envelope: Record<string, unknown>, reason: string): string | null {
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
 * row. After the write succeeds, the row is also pushed over the session
 * socket so a live tab sees it without a reload (#800 item 3). Scoped to the
 * roll-request case: combat turns and gate-rejected prose are log-only, with
 * one exception (#1390): a held `roll_requests` reply whose fight is live
 * is written — and otherwise the fight-opening narration is lost. The
 * bypass is tied to this fight, not any fight: the encounter must have
 * begun after this turn was generated, the prose must not assert an
 * undecided outcome (#2139 — confirming a fight does not validate the dice
 * outcomes inside its prose), and the fight must not be one the player
 * declined. That write omits the roll requests (combat initiative
 * superseded them) and forces `combat_transition: 'none'`, so no reload
 * re-opens the fight. When generatedAt is given, a player row newer than it means
 * the player already moved past this turn, so the row is not written (#800):
 * persisting it would surface a roll popup for a passed turn, and answering
 * it hits the superseded-roll 409. Never throws: a failed write must not
 * break the watchdog.
 */
export async function persistFallbackDmReply(params: {
  userId: string;
  sessionId: string;
  messageId: string;
  reason: string;
  envelope: Record<string, unknown> | null;
  /**
   * Server clock at generation (#800). When given, a player row with a later
   * server-clock createdAt means the player moved past this turn. Absent, the
   * check is skipped (the watchdog always passes it).
   */
  generatedAt?: Date;
  /**
   * #1390: whether the fight this reply opened is live. Defaults to the
   * encounter service; a lookup failure reads as no fight.
   */
  hasActiveEncounter?: (sessionId: string, userId: string, generatedAt?: Date) => Promise<boolean>;
  /**
   * #1390: the session's declined actor keys, for the bypass's decline
   * guard. Defaults to the pending-entry record; a failed read keeps the
   * skip (uncertainty must not resurrect a refused fight).
   */
  declinedActorKeys?: (sessionId: string) => Promise<string[]>;
}): Promise<{ persisted: boolean; skipped?: string }> {
  try {
    if (!params.envelope) return { persisted: false };
    const rollRequests = Array.isArray(params.envelope.roll_requests)
      ? params.envelope.roll_requests
      : [];
    const skipped = fallbackSkipReason(params.envelope, params.reason);
    // #1390: a held `roll_requests` reply that opened a fight is not dropped
    // when that fight is live. Three guards, all required: the encounter
    // began after this turn (not an older live fight), the prose asserts no
    // undecided outcome, and the fight was not declined. A declined,
    // never-entered, or fabricated fight still skips.
    let bypassedCombatSkip = false;
    if (
      (skipped === 'combat_entry_pending' || skipped === 'combat_start') &&
      rollRequests.length > 0
    ) {
      const checkEncounter = params.hasActiveEncounter ?? defaultHasActiveEncounter;
      const checkDeclined = params.declinedActorKeys ?? defaultDeclinedActorKeys;
      try {
        const live = await checkEncounter(params.sessionId, params.userId, params.generatedAt);
        const fabricated = suspectsFabricatedOutcome(String(params.envelope.text ?? ''), {
          playerMayHaveActed: true,
        });
        let declined = false;
        if (live && !fabricated) {
          const names = combatantNames(params.envelope);
          if (names.length > 0) {
            const keys = await checkDeclined(params.sessionId);
            declined = keys.some((key) => names.some((name) => key.split('|').includes(name)));
          }
        }
        bypassedCombatSkip = live && !fabricated && !declined;
      } catch {
        bypassedCombatSkip = false;
      }
    }
    if (skipped && !bypassedCombatSkip) return { persisted: false, skipped };
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
    // #1390: a bypass with no narration to save writes nothing — the
    // purposes line would narrate a roll ask with no popup attached.
    if (bypassedCombatSkip && !prose && skipped) return { persisted: false, skipped };
    // #800: the turn is stale when the player has written since generation.
    // createdAt is the server clock (the guard's own ordering in withRollTurn
    // loads the latest player row by createdAt), and generatedAt is the
    // server clock at generation completion (captured after the provider call
    // returns), so the comparison is clock-consistent. A
    // player row written during generation (an overlapping submit) still
    // reads as current here; the guard's 409 remains the backstop for it.
    // When the check itself cannot run (no database: the unit tests mock the
    // service layer and never import one), the fallback keeps today's
    // behavior and persists: dropping the reply would be worse than risking
    // a stale popup, and in production the watchdog's own row check has just
    // proved the database reachable. Debug-logged, not warned: a DB-less
    // caller is a normal case here, and the watchdog's DM_REPLY_UNPERSISTED
    // line already records the outcome.
    if (params.generatedAt) {
      try {
        const [{ db }, { dialogueHistory }, { and, eq, gt }] = await Promise.all([
          import('../../../../db/client.js'),
          import('../../../../db/schema/index.js'),
          import('drizzle-orm'),
        ]);
        const [newer] = await db
          .select({ id: dialogueHistory.id })
          .from(dialogueHistory)
          .where(
            and(
              eq(dialogueHistory.sessionId, params.sessionId),
              eq(dialogueHistory.speakerType, 'player'),
              gt(dialogueHistory.createdAt, params.generatedAt),
            ),
          )
          .limit(1);
        if (newer) return { persisted: false, skipped: 'superseded_turn' };
      } catch (error) {
        logger.debug({
          msg: 'DM_REPLY_FALLBACK_SUPERSEDE_CHECK_FAILED',
          sessionId: params.sessionId,
          messageId: params.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
          // #1390: a bypassed write is narration, not a transition trigger.
          combat_transition: bypassedCombatSkip
            ? 'none'
            : typeof params.envelope.combat_transition === 'string'
              ? params.envelope.combat_transition
              : 'none',
          [PROVISIONAL_DM_CONTEXT_KEY]: true,
          // #1390: combat initiative superseded the roll; no popup restores.
          ...(bypassedCombatSkip ? {} : { rollRequests }),
        },
      },
      params.userId,
    );
    // #800 item 3: the row is written; tell live tabs over the session socket
    // so a tab that is already open sees it without a reload. A failed push
    // must not flip the outcome — the row is persisted — so it is logged, not
    // thrown. The frame carries ids + requests only, never the row prose.
    // #1390: no push on a bypassed write — a live tab mid-fight must not
    // gain the opening narration out of order; the row is there on reload.
    if (!bypassedCombatSkip) {
      try {
        const { publishDmFallbackRow } = await import('./dm-fallback-broadcast.js');
        publishDmFallbackRow({
          sessionId: params.sessionId,
          messageId: params.messageId,
          rollRequests,
        });
      } catch (error) {
        logger.warn({
          msg: 'DM_REPLY_FALLBACK_PUSH_FAILED',
          sessionId: params.sessionId,
          messageId: params.messageId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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

/* ------------------------------------------------------------------------------------------------
 * #1416: the durable record of a held combat-entry reply.
 *
 * One row per reserved reply id in `dm_reply_records`, apart from `dialogue_history` until the
 * reply is safe to publish. This module is the only writer of its `state`. Every other path
 * (seating, the watchdog, a client save) calls the guarded transitions below.
 *
 *   held → ready → persisted        (ready → ready is a publish retry that did not finish)
 *   held → cancelled | superseded   (a refused or abandoned fight, a fabricated outcome)
 * ---------------------------------------------------------------------------------------------- */

export type DmReplyRecordState = 'held' | 'ready' | 'persisted' | 'cancelled' | 'superseded';

/** Legal moves. Anything else is refused and the refusal names the state it found. */
const DM_REPLY_TRANSITIONS: Readonly<Record<DmReplyRecordState, readonly DmReplyRecordState[]>> = {
  held: ['ready', 'cancelled', 'superseded'],
  ready: ['ready', 'persisted'],
  persisted: [],
  cancelled: [],
  superseded: [],
};

export function canTransitionDmReply(from: DmReplyRecordState, to: DmReplyRecordState): boolean {
  return DM_REPLY_TRANSITIONS[from].includes(to);
}

export interface DmReplyRecord {
  id: string;
  sessionId: string;
  userId: string;
  state: DmReplyRecordState;
  text: string;
  envelope: Record<string, unknown> | null;
}

export type DmReplyTransitionResult =
  | { ok: true; state: DmReplyRecordState }
  | { ok: false; reason: 'no_record' | 'illegal_from'; state?: DmReplyRecordState };

/** Storage for the record. The Postgres store is the default; tests inject an in-memory one. */
export interface DmReplyRecordStore {
  read(id: string): Promise<DmReplyRecord | null>;
  /** Inserts a `held` record, or does nothing when one already exists for this id. */
  insertHeld(record: Omit<DmReplyRecord, 'state'>): Promise<void>;
  /** Moves the record only from a state the table allows, in one guarded write. */
  transition(id: string, to: DmReplyRecordState): Promise<DmReplyTransitionResult>;
}

export const postgresDmReplyRecordStore: DmReplyRecordStore = {
  async read(id) {
    const [{ db }, { dmReplyRecords }, { eq }] = await Promise.all([
      import('../../../../db/client.js'),
      import('../../../../db/schema/index.js'),
      import('drizzle-orm'),
    ]);
    const [row] = await db.select().from(dmReplyRecords).where(eq(dmReplyRecords.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      sessionId: row.sessionId,
      userId: row.userId,
      state: row.state as DmReplyRecordState,
      text: row.text,
      envelope: (row.envelope as Record<string, unknown> | null) ?? null,
    };
  },
  async insertHeld(record) {
    const [{ db }, { dmReplyRecords }] = await Promise.all([
      import('../../../../db/client.js'),
      import('../../../../db/schema/index.js'),
    ]);
    await db
      .insert(dmReplyRecords)
      .values({ ...record, state: 'held' })
      .onConflictDoNothing({ target: dmReplyRecords.id });
  },
  async transition(id, to) {
    const froms = (Object.keys(DM_REPLY_TRANSITIONS) as DmReplyRecordState[]).filter((from) =>
      canTransitionDmReply(from, to),
    );
    const [{ db }, { dmReplyRecords }, { and, eq, inArray }] = await Promise.all([
      import('../../../../db/client.js'),
      import('../../../../db/schema/index.js'),
      import('drizzle-orm'),
    ]);
    const [moved] = await db
      .update(dmReplyRecords)
      .set({ state: to, updatedAt: new Date() })
      .where(and(eq(dmReplyRecords.id, id), inArray(dmReplyRecords.state, froms)))
      .returning({ state: dmReplyRecords.state });
    if (moved) return { ok: true, state: to };
    const current = await postgresDmReplyRecordStore.read(id);
    return current
      ? { ok: false, reason: 'illegal_from', state: current.state }
      : { ok: false, reason: 'no_record' };
  },
};

/** Writes the provisional row for a published reply; the same id replaces in place. */
async function writeReplyRow(record: DmReplyRecord): Promise<void> {
  const { SessionMessageService } = await import('../session/session-message-service.js');
  await SessionMessageService.addMessage(
    {
      id: record.id,
      sessionId: record.sessionId,
      speakerType: 'dm',
      message: record.text,
      context: {
        emotion: 'neutral',
        intent: 'response',
        combat_transition: 'none',
        [PROVISIONAL_DM_CONTEXT_KEY]: true,
      },
    },
    record.userId,
  );
}

/**
 * Publish a `ready` record to `dialogue_history`, then mark it persisted. Restart-safe: the row is
 * keyed by the reserved id, so a retry replaces the same row rather than adding one. A failed write
 * leaves the record `ready` (the `ready → ready` retry) and reports `retry`.
 */
export async function publishReadyDmReply(
  record: DmReplyRecord,
  store: DmReplyRecordStore = postgresDmReplyRecordStore,
  writeRow: (record: DmReplyRecord) => Promise<void> = writeReplyRow,
): Promise<'persisted' | 'retry'> {
  try {
    await writeRow(record);
  } catch (error) {
    logger.error({
      msg: 'DM_REPLY_RECORD_PUBLISH_FAILED',
      sessionId: record.sessionId,
      messageId: record.id,
      error: error instanceof Error ? error.message : String(error),
    });
    await store.transition(record.id, 'ready');
    return 'retry';
  }
  const moved = await store.transition(record.id, 'persisted');
  if (!moved.ok) {
    logger.warn({
      msg: 'DM_REPLY_RECORD_TRANSITION_REFUSED',
      sessionId: record.sessionId,
      messageId: record.id,
      to: 'persisted',
      state: moved.ok ? undefined : moved.state,
      reason: moved.ok ? undefined : moved.reason,
    });
  }
  return 'persisted';
}

/**
 * Seating confirmed the fight, so the held reply becomes publishable. Applies the harm gate here
 * (a fabricated outcome cancels the record instead of publishing), then publishes. Seating calls
 * this instead of writing `dialogue_history` itself.
 */
export async function publishHeldReplyAtSeating(
  params: { sessionId: string; userId: string; messageId: string; text: string },
  store: DmReplyRecordStore = postgresDmReplyRecordStore,
  writeRow: (record: DmReplyRecord) => Promise<void> = writeReplyRow,
): Promise<'persisted' | 'cancelled' | 'retry' | 'refused'> {
  let record = await store.read(params.messageId);
  if (!record) {
    await store.insertHeld({
      id: params.messageId,
      sessionId: params.sessionId,
      userId: params.userId,
      text: params.text,
      envelope: null,
    });
    record = await store.read(params.messageId);
  }
  if (!record) return 'refused';
  if (record.state === 'persisted') return 'persisted';
  if (record.state === 'cancelled' || record.state === 'superseded') return 'cancelled';
  if (record.state === 'held') {
    if (suspectsFabricatedOutcome(record.text, { playerMayHaveActed: true })) {
      await store.transition(record.id, 'cancelled');
      logger.warn({
        msg: 'DM_REPLY_RECORD_CANCELLED',
        sessionId: params.sessionId,
        messageId: params.messageId,
        reason: 'unverified_harm_claim',
      });
      return 'cancelled';
    }
    const moved = await store.transition(record.id, 'ready');
    if (!moved.ok) return 'refused';
  }
  const outcome = await publishReadyDmReply({ ...record, state: 'ready' }, store, writeRow);
  return outcome;
}

/**
 * The client saved this reply under its reserved id (or the row exists for another reason). A
 * `ready` record is then settled as persisted, so the watchdog stops considering it.
 */
export async function settleRecordWhenRowExists(
  messageId: string,
  store: DmReplyRecordStore = postgresDmReplyRecordStore,
): Promise<void> {
  const record = await store.read(messageId);
  if (record?.state === 'ready') await store.transition(messageId, 'persisted');
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
          const store = params.replyRecords;
          if (found) {
            if (store) await settleRecordWhenRowExists(params.messageId, store);
            return;
          }
          // #1416: a held combat-entry reply has a durable record. A `ready` record is
          // published whether or not a fight is still live: seating already confirmed it.
          if (store) {
            let record: DmReplyRecord | null = null;
            try {
              record = await store.read(params.messageId);
            } catch (error) {
              // A failed lookup fails open to the legacy fallback below, not to a dropped reply.
              logger.warn({
                msg: 'DM_REPLY_RECORD_LOOKUP_FAILED',
                sessionId: params.sessionId,
                messageId: params.messageId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
            if (record?.state === 'ready') {
              const outcome = await publishReadyDmReply(record, store, params.writeReplyRow);
              logger.warn({
                msg: 'DM_REPLY_UNPERSISTED',
                sessionId: params.sessionId,
                messageId: params.messageId,
                reason: params.reason,
                waitedMs: delayMs,
                fallbackPersisted: outcome === 'persisted',
                fallbackSkipped: outcome === 'persisted' ? undefined : 'publish_retry',
                recordState: 'ready',
              });
              return;
            }
            if (record) {
              // held: the player has not confirmed the fight yet, so there is nothing to publish.
              // cancelled / superseded / persisted: already settled.
              logger.warn({
                msg: 'DM_REPLY_UNPERSISTED',
                sessionId: params.sessionId,
                messageId: params.messageId,
                reason: params.reason,
                waitedMs: delayMs,
                fallbackPersisted: false,
                fallbackSkipped: `record_${record.state}`,
                recordState: record.state,
              });
              return;
            }
          }
          // #783: the client never saved this reply. The server generated it,
          // so persist the fallback row before reporting — the player gets
          // the reply (and its roll popup) after a reload instead of nothing.
          let fallbackPersisted = false;
          let fallbackSkipped: string | undefined;
          if (params.envelope && params.userId) {
            const fallback = await persistFallbackDmReply({
              userId: params.userId,
              sessionId: params.sessionId,
              messageId: params.messageId,
              reason: params.reason,
              envelope: params.envelope,
              generatedAt: params.generatedAt,
              hasActiveEncounter: params.hasActiveEncounter,
              declinedActorKeys: params.declinedActorKeys,
            });
            fallbackPersisted = fallback.persisted;
            fallbackSkipped = fallback.skipped;
          }
          logger.warn({
            msg: 'DM_REPLY_UNPERSISTED',
            sessionId: params.sessionId,
            messageId: params.messageId,
            reason: params.reason,
            waitedMs: delayMs,
            fallbackPersisted,
            // #1390: the combat_entry_pending vs superseded distinction stays
            // diagnosable on the line Hetzner reads for a lost reply.
            ...(fallbackSkipped ? { fallbackSkipped } : {}),
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
