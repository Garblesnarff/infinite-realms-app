/**
 * #913: a combat entry the player has not confirmed yet.
 *
 * The generate gate used to attach `combat_entry_pending` and forget it. The
 * next turn proposed the same fight again, and a generate response that never
 * reached the open tab left nothing for `GET /active` or the session socket
 * to deliver. This module is the memory of that handoff: one pending entry
 * per session, replaced when the actors change, dropped when the same actors
 * are proposed again, seated on confirm or on an initiative result, and
 * expired with one visible engine line.
 *
 * The value lives in `game_sessions.session_state` under `combatEntryPending`
 * so two server processes (SO_REUSEPORT) share it. A process-local map covers
 * tests whose `DATABASE_URL` is not a real database. Client whole-blob
 * session writes must not delete it; `enginePreservingSessionState` restores
 * the stored value the way the Action Surge mark is restored.
 */
import { eq, sql, type SQL } from 'drizzle-orm';

import { gameSessions } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

import type {
  CombatEntryPending,
  CombatEntryPlayer,
  SeatedCombatEntryOutcome,
} from './combat-entry-gate.js';

export const COMBAT_ENTRY_PENDING_KEY = 'combatEntryPending';

/** How long a proposal waits for Strike or an initiative result. */
export const PENDING_ENTRY_TTL_MS = 90_000;

export const PENDING_ENTRY_EXPIRED_LINE =
  'The moment to start the fight passed. Say it again if you still mean to strike.';

export interface StoredCombatEntry {
  pending: CombatEntryPending;
  actorKey: string;
  proposedAt: number;
}

const memory = new Map<string, StoredCombatEntry>();
const touchedSessions = new Set<string>();

let nowMs = (): number => Date.now();

/** Tests advance expiry without waiting. */
export function setPendingEntryClockForTests(clock: () => number): void {
  nowMs = clock;
}

function databaseReachable(): boolean {
  const url = process.env.DATABASE_URL ?? '';
  return url.startsWith('postgres') && !url.includes('test.invalid');
}

/** Sorted creature names, including the declared target. Empty when nothing was named. */
export function actorKeyOf(pending: CombatEntryPending): string {
  const names = new Set<string>();
  for (const combatant of pending.combatants) {
    const name = combatant.name.trim().toLocaleLowerCase();
    if (name) names.add(name);
  }
  const declared = pending.declaredAttack?.actorName?.trim().toLocaleLowerCase();
  if (declared) names.add(declared);
  return [...names].sort().join('|');
}

function parseStored(state: unknown): StoredCombatEntry | null {
  if (!state || typeof state !== 'object') return null;
  const raw = (state as Record<string, unknown>)[COMBAT_ENTRY_PENDING_KEY];
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<StoredCombatEntry>;
  if (typeof record.actorKey !== 'string' || typeof record.proposedAt !== 'number') return null;
  if (!record.pending || typeof record.pending !== 'object') return null;
  if (!Array.isArray(record.pending.combatants)) return null;
  return record as StoredCombatEntry;
}

async function liveDb() {
  const { db } = await import('../../../../db/client');
  return db;
}

async function readStored(sessionId: string): Promise<StoredCombatEntry | null> {
  if (!databaseReachable()) return memory.get(sessionId) ?? null;
  try {
    const db = await liveDb();
    const [row] = await db
      .select({ state: gameSessions.sessionState })
      .from(gameSessions)
      .where(eq(gameSessions.id, sessionId))
      .limit(1);
    // A reachable database that has no key wins over process memory, so a
    // cleared row cannot be resurrected by a stale map entry.
    return parseStored(row?.state) ?? null;
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENTRY_PENDING_READ_FAILED', sessionId, error });
    return memory.get(sessionId) ?? null;
  }
}

async function writeStored(sessionId: string, stored: StoredCombatEntry): Promise<void> {
  memory.set(sessionId, stored);
  touchedSessions.add(sessionId);
  if (!databaseReachable()) return;
  try {
    const db = await liveDb();
    await db
      .update(gameSessions)
      .set({
        sessionState: sql`jsonb_set(COALESCE(${gameSessions.sessionState}, '{}'::jsonb), '{combatEntryPending}', ${JSON.stringify(stored)}::jsonb, true)`,
        updatedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId));
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENTRY_PENDING_WRITE_FAILED', sessionId, error });
  }
}

async function deleteStored(sessionId: string): Promise<void> {
  memory.delete(sessionId);
  touchedSessions.add(sessionId);
  if (!databaseReachable()) return;
  try {
    const db = await liveDb();
    await db
      .update(gameSessions)
      .set({
        sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) - ${COMBAT_ENTRY_PENDING_KEY}`,
        updatedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId));
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENTRY_PENDING_CLEAR_FAILED', sessionId, error });
  }
}

function expired(stored: StoredCombatEntry): boolean {
  return nowMs() - stored.proposedAt > PENDING_ENTRY_TTL_MS;
}

async function broadcastPending(sessionId: string, pending: CombatEntryPending): Promise<void> {
  try {
    const { broadcastToRoom } = await import('../collaboration/room-manager.js');
    broadcastToRoom(sessionId, null as never, {
      type: 'combat_state_updated',
      reason: 'combat_entry_pending',
      sessionId,
      combat: null,
      combatEntryPending: pending,
      initiativeOrder: [],
      tacticalMap: null,
    });
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENTRY_PENDING_BROADCAST_FAILED', sessionId, error });
  }
}

async function postExpiredLine(
  sessionId: string,
  userId: string,
  proposedAt: number,
): Promise<void> {
  try {
    const { postEngineChatLine } = await import('../engine-chat-line.js');
    await postEngineChatLine({
      sessionId,
      userId,
      idSeed: `combat-entry-expired:${sessionId}:${proposedAt}`,
      text: PENDING_ENTRY_EXPIRED_LINE,
      context: { kind: 'combat_entry_expired' },
    });
  } catch (error) {
    logger.warn({ msg: 'COMBAT_ENTRY_PENDING_EXPIRE_LINE_FAILED', sessionId, error });
  }
}

/**
 * The unexpired proposal for this session, or null. An expired proposal is
 * cleared and, when the caller knows the owner, announced in chat.
 */
export async function readPendingCombatEntry(
  sessionId: string,
  userId?: string,
): Promise<StoredCombatEntry | null> {
  const stored = await readStored(sessionId);
  if (!stored) return null;
  if (!expired(stored)) return stored;
  await deleteStored(sessionId);
  if (userId) await postExpiredLine(sessionId, userId, stored.proposedAt);
  return null;
}

export async function clearPendingCombatEntry(sessionId: string): Promise<void> {
  await deleteStored(sessionId);
}

/**
 * Remember `pending`, or report that the same actors are already waiting.
 * An empty actor key is never a duplicate: there is nothing to match.
 */
export async function holdOrDropPending(
  sessionId: string,
  userId: string,
  pending: CombatEntryPending,
): Promise<'keep' | 'drop'> {
  const actorKey = actorKeyOf(pending);
  const existing = await readPendingCombatEntry(sessionId, userId);
  if (actorKey && existing && existing.actorKey === actorKey) return 'drop';
  const stored: StoredCombatEntry = { pending, actorKey, proposedAt: nowMs() };
  await writeStored(sessionId, stored);
  await broadcastPending(sessionId, pending);
  return 'keep';
}

/**
 * The d20 in an initiative result the player sent as their turn.
 * "Initiative: 16 (nat 14+2)" yields 14. A sentence that merely contains the
 * word does not seat a fight.
 */
export function initiativeRollFromPlayerInput(input: string | null | undefined): number | null {
  if (!input || !/initiative\s*:/i.test(input)) return null;
  const natural = input.match(/\bnat(?:ural)?\s+(\d{1,2})\b/i);
  const direct = input.match(/initiative\s*:\s*(\d{1,2})\b/i);
  const digits = natural?.[1] ?? direct?.[1];
  if (!digits) return null;
  const roll = Number(digits);
  return roll >= 1 && roll <= 20 ? roll : null;
}

/** Remove the handoff from a generate body after this turn seated it. */
export function withoutCombatEntryPending(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return text;
    delete parsed.combat_entry_pending;
    parsed.combat_transition = 'none';
    return JSON.stringify(parsed);
  } catch {
    return text;
  }
}

/**
 * Seat the stored proposal with the player's initiative die. Returns null when
 * nothing is waiting or an encounter is already active.
 */
export async function seatStoredPendingEntry(params: {
  sessionId: string;
  userId: string;
  player: CombatEntryPlayer;
  playerInitiativeRoll: number;
}): Promise<SeatedCombatEntryOutcome | null> {
  const stored = await readPendingCombatEntry(params.sessionId, params.userId);
  if (!stored) return null;
  const { seatCombatEntry } = await import('./combat-entry-gate.js');
  const { combatEntryGateDeps } = await import('./combat-entry-gate-deps.js');
  const outcome = await seatCombatEntry(
    {
      sessionId: params.sessionId,
      userId: params.userId,
      player: params.player,
      combatants: stored.pending.combatants,
      sceneSpec: stored.pending.sceneSpec,
      sceneSpecSynthesized: stored.pending.sceneSpecSynthesized,
      trigger: stored.pending.trigger,
      detail: stored.pending.detail,
      playerInitiativeRoll: params.playerInitiativeRoll,
      declaredAttack: stored.pending.declaredAttack,
      seatingHint: stored.pending.seatingHint,
    },
    combatEntryGateDeps,
  );
  if (outcome) await clearPendingCombatEntry(params.sessionId);
  return outcome;
}

/** Drop every in-process proposal and the rows this process wrote. Route tests share a session id. */
export async function resetPendingCombatEntries(): Promise<void> {
  const sessions = [...touchedSessions];
  memory.clear();
  touchedSessions.clear();
  if (!databaseReachable()) return;
  const db = await liveDb();
  for (const sessionId of sessions) {
    try {
      await db
        .update(gameSessions)
        .set({
          sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) - ${COMBAT_ENTRY_PENDING_KEY}`,
          updatedAt: new Date(),
        })
        .where(eq(gameSessions.id, sessionId));
    } catch {
      // The suite is tearing down; a vanished row is already clear.
    }
  }
}

/**
 * Client `session_state` writes replace the blob. The pending combat entry is
 * engine-owned, so the live row's value wins. `merged` is the Action Surge
 * preservation expression; this wraps it and does not rewrite that SQL.
 */
export function enginePreservingSessionState(merged: SQL): SQL {
  const stored = sql`${gameSessions.sessionState} -> ${COMBAT_ENTRY_PENDING_KEY}`;
  const validStored = sql`jsonb_typeof(${stored}) = 'object'
    AND jsonb_typeof(${stored} -> 'actorKey') = 'string'
    AND jsonb_typeof(${stored} -> 'proposedAt') = 'number'`;
  return sql`CASE WHEN ${validStored}
    THEN (${merged} - ${COMBAT_ENTRY_PENDING_KEY}) || jsonb_build_object(${COMBAT_ENTRY_PENDING_KEY}::text, ${stored})
    ELSE ${merged} - ${COMBAT_ENTRY_PENDING_KEY} END`;
}
