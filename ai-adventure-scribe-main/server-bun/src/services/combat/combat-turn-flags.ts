/**
 * Engine-owned, per-participant flags kept in `game_sessions.session_state` (#1637).
 *
 * Two flags live here, both written as a single guarded UPDATE against the live row (the same
 * rule as the Action Surge mark in combat-turn-resources.ts), so a client whole-blob write can
 * never delete them mid-fight:
 *
 * - `hiddenParticipants`: a participant who won a Hide check. The next attack by that participant
 *   has advantage (source "hidden"); the attack, damage taken, or the end of the fight clears it.
 * - `sneakAttackSpent`: a Rogue who already took Sneak Attack this round. Cleared at turn reset.
 *
 * Every write is keyed by encounter so a flag from an earlier fight can never grant anything.
 */
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { getActiveConditionNames } from './data-access.js';
import {
  characters,
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
} from '../../../../db/schema/index';

import type { db as DatabaseClient } from '../../../../db/client';
import type { VitalsTx } from '../character-vitals-service.js';

const HIDDEN_KEY = 'hiddenParticipants';
const SNEAK_KEY = 'sneakAttackSpent';
/** Conditions that make a creature unable to act for the Sneak Attack flanking clause (2014). */
const INCAPACITATING_CONDITIONS = [
  'incapacitated',
  'unconscious',
  'paralyzed',
  'petrified',
  'stunned',
];

type FlagRecord = Record<string, unknown>;

/** The session row that owns an encounter. Writes go through this so no caller needs a session id. */
const sessionOfEncounter = (encounterId: string): SQL =>
  sql`(SELECT ${combatEncounters.sessionId} FROM ${combatEncounters} WHERE ${combatEncounters.id} = ${encounterId})`;

/**
 * The database client, loaded on first use. A static import would load the client whenever this
 * module loads, which breaks suites that import the attack path without a database.
 */
async function database(): Promise<typeof DatabaseClient> {
  return (await import('../../../../db/client')).db;
}

function flagEntry(state: unknown, key: string, participantId: string): FlagRecord | null {
  if (!state || typeof state !== 'object') return null;
  const bucket = (state as FlagRecord)[key];
  if (!bucket || typeof bucket !== 'object') return null;
  const entry = (bucket as FlagRecord)[participantId];
  return entry && typeof entry === 'object' ? (entry as FlagRecord) : null;
}

async function readSessionState(encounterId: string): Promise<unknown> {
  const db = await database();
  const [row] = await db
    .select({ state: gameSessions.sessionState })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)))
    .limit(1);
  return row?.state ?? null;
}

/** Store the hidden mark for one participant (a successful Hide check). */
export async function markHiddenAttacker(
  encounterId: string,
  participantId: string,
): Promise<void> {
  const db = await database();
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(
        jsonb_set(COALESCE(${gameSessions.sessionState}, '{}'::jsonb), ${`{${HIDDEN_KEY}}`}::text[],
          COALESCE(${gameSessions.sessionState} -> ${HIDDEN_KEY}, '{}'::jsonb), true),
        ARRAY[${HIDDEN_KEY}, ${participantId}]::text[],
        jsonb_build_object('encounterId', ${encounterId}::text), true)`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)));
}

/** Whether this participant's next attack in this encounter has the hidden advantage. */
export async function isHiddenAttacker(
  encounterId: string,
  participantId: string,
): Promise<boolean> {
  const state = await readSessionState(encounterId);
  return flagEntry(state, HIDDEN_KEY, participantId)?.encounterId === encounterId;
}

/** Drop one participant's hidden mark: the attack, or damage taken, ends it. */
export async function clearHiddenAttacker(
  encounterId: string,
  participantId: string,
): Promise<void> {
  const db = await database();
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) #- ARRAY[${HIDDEN_KEY}, ${participantId}]::text[]`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)));
}

/**
 * Drop every hidden mark that belongs to an encounter, inside the caller's transaction when it
 * has one. Called when the fight ends.
 */
export async function clearHiddenForEncounter(
  executor: Pick<VitalsTx, 'update'>,
  encounterId: string,
): Promise<void> {
  await executor
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(
        COALESCE(${gameSessions.sessionState}, '{}'::jsonb), ${`{${HIDDEN_KEY}}`}::text[],
        COALESCE((
          SELECT jsonb_object_agg(e.key, e.value)
          FROM jsonb_each(COALESCE(${gameSessions.sessionState} -> ${HIDDEN_KEY}, '{}'::jsonb)) AS e(key, value)
          WHERE e.value ->> 'encounterId' <> ${encounterId}::text
        ), '{}'::jsonb), true)`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)));
}

/** Whether this Rogue already took Sneak Attack in this round. */
export async function isSneakAttackSpent(
  encounterId: string,
  participantId: string,
  round: number,
): Promise<boolean> {
  const state = await readSessionState(encounterId);
  const entry = flagEntry(state, SNEAK_KEY, participantId);
  return entry?.encounterId === encounterId && entry?.round === round;
}

/** Record that this Rogue took Sneak Attack this round. */
export async function markSneakAttackSpent(
  encounterId: string,
  participantId: string,
  round: number,
): Promise<void> {
  const db = await database();
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(
        jsonb_set(COALESCE(${gameSessions.sessionState}, '{}'::jsonb), ${`{${SNEAK_KEY}}`}::text[],
          COALESCE(${gameSessions.sessionState} -> ${SNEAK_KEY}, '{}'::jsonb), true),
        ARRAY[${SNEAK_KEY}, ${participantId}]::text[],
        jsonb_build_object('encounterId', ${encounterId}::text, 'round', ${round}::int), true)`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)));
}

/** Clear the once-per-turn mark at turn reset. */
export async function clearSneakAttackSpent(
  encounterId: string,
  participantId: string,
): Promise<void> {
  const db = await database();
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) #- ARRAY[${SNEAK_KEY}, ${participantId}]::text[]`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)));
}

/**
 * Keeps both flags across a client whole-blob write (`SessionService.updateSession`), the same
 * way `actionSurgePreservingState` keeps the Action Surge mark: the live stored value wins over
 * the client's copy, and a stored value that is absent removes the client's copy.
 */
export function combatTurnFlagsPreservingState(incoming: SQL): SQL {
  let merged = incoming;
  for (const key of [HIDDEN_KEY, SNEAK_KEY]) {
    const stored = sql`${gameSessions.sessionState} -> ${key}`;
    merged = sql`CASE WHEN jsonb_typeof(${stored}) = 'object'
      THEN ((${merged}) - ${key}) || jsonb_build_object(${key}::text, ${stored})
      ELSE (${merged}) - ${key} END`;
  }
  return merged;
}

/** The Rogue class level of a character, read the way the rest of the engine reads it (multiclass aware). */
export async function rogueLevelOf(characterId: string): Promise<number> {
  const db = await database();
  const { classLevelOf } = await import('../progression/limited-feature-uses.js');
  const [row] = await db
    .select({
      class: characters.class,
      level: characters.level,
      classLevels: characters.classLevels,
    })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  return row ? classLevelOf(row, 'Rogue') : 0;
}

/**
 * The other active participants on the attacker's side who are not incapacitated, with their
 * positions' owners, for the Sneak Attack flanking clause. "Same side" is the player/non-player
 * split the engine already uses for companions.
 */
export async function activeAlliesOf(
  encounterId: string,
  attackerId: string,
  targetId: string,
): Promise<Array<{ id: string; conscious: boolean; currentHp: number; conditions: string[] }>> {
  const db = await database();
  const rows = await db
    .select({
      id: combatParticipants.id,
      participantType: combatParticipants.participantType,
      currentHp: combatParticipantStatus.currentHp,
      isConscious: combatParticipantStatus.isConscious,
    })
    .from(combatParticipants)
    .leftJoin(
      combatParticipantStatus,
      eq(combatParticipantStatus.participantId, combatParticipants.id),
    )
    .where(
      and(eq(combatParticipants.encounterId, encounterId), eq(combatParticipants.isActive, true)),
    );
  const attacker = rows.find((row) => row.id === attackerId);
  if (!attacker) return [];
  const attackerIsPlayer = attacker.participantType === 'player';
  const allies = rows.filter(
    (row) =>
      row.id !== attackerId &&
      row.id !== targetId &&
      (row.participantType === 'player') === attackerIsPlayer,
  );
  const withConditions = await Promise.all(
    allies.map(async (ally) => ({
      id: ally.id,
      conscious: ally.isConscious !== false,
      currentHp: ally.currentHp ?? 1,
      conditions: await getActiveConditionNames(ally.id),
    })),
  );
  return withConditions.filter(
    (ally) =>
      ally.conscious &&
      ally.currentHp > 0 &&
      !ally.conditions.some((condition) =>
        INCAPACITATING_CONDITIONS.includes(condition.toLowerCase()),
      ),
  );
}
