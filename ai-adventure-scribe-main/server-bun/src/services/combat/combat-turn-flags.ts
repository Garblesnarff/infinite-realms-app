/**
 * Engine-owned, per-participant flags kept in `game_sessions.session_state` (#1637).
 *
 * Two flags live here. Each write is one guarded statement against the live row, the same rule as
 * the Action Surge mark in combat-turn-resources.ts, so a client whole-blob write can never delete
 * them mid-fight:
 *
 * - `hiddenParticipants`: a participant who won a Hide check. Their next attack has advantage
 *   (source "hidden"); the attack, damage taken, or the end of the fight clears it.
 * - `sneakAttackSpent`: the turn in which a Rogue already took Sneak Attack, recorded as
 *   "round:turn order". A reaction on another creature's turn is a different turn, so it can claim
 *   its own Sneak Attack. The claim is one UPDATE made before damage is applied.
 *
 * - `raging`: a Barbarian's Rage (#1638), recorded as the encounter, the round it expires at, and
 *   an `active` mark for the turn (#1654). The claim is one guarded UPDATE, the same shape as the
 *   Sneak Attack claim. Rage ends when its round passes, when the fight ends, when the Barbarian
 *   drops to 0 HP or falls unconscious, or at a turn start with no attack on a hostile and no
 *   damage since the last turn.
 *
 * - `lightAttack` (#1639): the weapon a participant swung with its Attack action this turn, when that
 *   weapon is a light melee weapon. It is recorded as the encounter, the turn, and the weapon id, and an
 *   off-hand attack reads it. It is written after the Attack action is claimed, so a refused attack
 *   writes nothing.
 *
 * Every entry records its encounter, so a flag from an earlier fight never grants anything.
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
const RAGE_KEY = 'raging';
const LIGHT_ATTACK_KEY = 'lightAttack';
/** Rage lasts 10 rounds (2014 SRD 5.1; the reduced first scope of #1638). */
export const RAGE_DURATION_ROUNDS = 10;
/** Conditions that make a creature unable to act for the Sneak Attack flanking clause (2014). */
const INCAPACITATING_CONDITIONS = [
  'incapacitated',
  'unconscious',
  'paralyzed',
  'petrified',
  'stunned',
];

type FlagRecord = Record<string, unknown>;

/**
 * The database client, loaded on first use. A static import would load the client whenever this
 * module loads, which breaks suites that import the attack path without a database.
 */
async function database(): Promise<typeof DatabaseClient> {
  return (await import('../../../../db/client')).db;
}

/** The session row that owns an encounter. Writes go through this so no caller needs a session id. */
const sessionOfEncounter = (encounterId: string): SQL =>
  sql`(SELECT ${combatEncounters.sessionId} FROM ${combatEncounters} WHERE ${combatEncounters.id} = ${encounterId})`;

/** The current turn of an encounter, as "round:turn order". */
const turnOfEncounter = (encounterId: string): SQL =>
  sql`(SELECT ${combatEncounters.currentRound}::text || ':' || ${combatEncounters.currentTurnOrder}::text FROM ${combatEncounters} WHERE ${combatEncounters.id} = ${encounterId})`;

/** The current round of an encounter. */
const roundOfEncounter = (encounterId: string): SQL =>
  sql`(SELECT ${combatEncounters.currentRound} FROM ${combatEncounters} WHERE ${combatEncounters.id} = ${encounterId})`;

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
 * Claim this Rogue's Sneak Attack for the current turn, in one guarded UPDATE made before damage is
 * applied. The statement writes only when the stored claim is absent or belongs to another turn or
 * encounter, and reports whether it wrote. A second claim in the same turn writes nothing.
 */
export async function claimSneakAttack(
  encounterId: string,
  participantId: string,
): Promise<boolean> {
  const db = await database();
  const turn = turnOfEncounter(encounterId);
  const storedEntry = sql`(${gameSessions.sessionState} -> ${SNEAK_KEY} -> ${participantId})`;
  const claimed = await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(
        COALESCE(${gameSessions.sessionState}, '{}'::jsonb), ${`{${SNEAK_KEY}}`}::text[],
        COALESCE(${gameSessions.sessionState} -> ${SNEAK_KEY}, '{}'::jsonb) || jsonb_build_object(
          ${participantId}::text,
          jsonb_build_object('encounterId', ${encounterId}::text, 'turn', ${turn})),
        true)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, sessionOfEncounter(encounterId)),
        sql`(${storedEntry} ->> 'encounterId') IS DISTINCT FROM ${encounterId}::text
          OR (${storedEntry} ->> 'turn') IS DISTINCT FROM ${turn}`,
      ),
    )
    .returning({ id: gameSessions.id });
  return claimed.length > 0;
}

/** Drop one participant's Sneak Attack claim: the turn reset, or an attack that did not land its damage. */
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
 * Claim Rage for this participant in this encounter, in one guarded UPDATE. The statement writes
 * only when there is no live Rage: the stored entry belongs to another encounter, or its round has
 * passed. It returns the round the new mark expires at, or null when nothing was written, so a
 * second activation while raging writes nothing.
 */
export async function claimRage(
  encounterId: string,
  participantId: string,
): Promise<number | null> {
  const db = await database();
  const round = roundOfEncounter(encounterId);
  const storedEntry = sql`(${gameSessions.sessionState} -> ${RAGE_KEY} -> ${participantId})`;
  const claimed = await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(
        COALESCE(${gameSessions.sessionState}, '{}'::jsonb), ${`{${RAGE_KEY}}`}::text[],
        COALESCE(${gameSessions.sessionState} -> ${RAGE_KEY}, '{}'::jsonb) || jsonb_build_object(
          ${participantId}::text,
          jsonb_build_object('encounterId', ${encounterId}::text,
            'expiresRound', ${round} + ${RAGE_DURATION_ROUNDS}::int)),
        true)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, sessionOfEncounter(encounterId)),
        sql`(${storedEntry} ->> 'encounterId') IS DISTINCT FROM ${encounterId}::text
          OR (${storedEntry} ->> 'expiresRound')::int <= ${round}`,
      ),
    )
    .returning({ state: gameSessions.sessionState });
  // The expiry round the stored mark carries, read back from the row this claim wrote.
  const entry = flagEntry(claimed[0]?.state ?? null, RAGE_KEY, participantId);
  return entry?.encounterId === encounterId && typeof entry.expiresRound === 'number'
    ? entry.expiresRound
    : null;
}

/** Record the light melee weapon this participant swung with its Attack action this turn (#1639). */
export async function markLightAttack(
  encounterId: string,
  participantId: string,
  weaponId: string,
): Promise<void> {
  const db = await database();
  const turn = turnOfEncounter(encounterId);
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(
        COALESCE(${gameSessions.sessionState}, '{}'::jsonb), ${`{${LIGHT_ATTACK_KEY}}`}::text[],
        COALESCE(${gameSessions.sessionState} -> ${LIGHT_ATTACK_KEY}, '{}'::jsonb) || jsonb_build_object(
          ${participantId}::text,
          jsonb_build_object('encounterId', ${encounterId}::text, 'turn', ${turn}, 'weaponId', ${weaponId}::text)),
        true)`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)));
}

/**
 * The light melee weapon this participant swung with its Attack action this turn, or null. A mark
 * from another turn or another fight reads as null, so it never pays for an off-hand attack here.
 */
export async function readLightAttackMark(
  encounterId: string,
  participantId: string,
): Promise<string | null> {
  const db = await database();
  const [row] = await db
    .select({
      state: gameSessions.sessionState,
      turn: sql<string>`${turnOfEncounter(encounterId)}`,
    })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)))
    .limit(1);
  const entry = flagEntry(row?.state ?? null, LIGHT_ATTACK_KEY, participantId);
  return entry?.encounterId === encounterId &&
    entry.turn === row?.turn &&
    typeof entry.weaponId === 'string'
    ? entry.weaponId
    : null;
}

/** Whether this participant is raging in this encounter at the current round. */
export async function isRaging(encounterId: string, participantId: string): Promise<boolean> {
  const db = await database();
  const [row] = await db
    .select({
      state: gameSessions.sessionState,
      round: sql<number>`${roundOfEncounter(encounterId)}`,
    })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)))
    .limit(1);
  const entry = flagEntry(row?.state ?? null, RAGE_KEY, participantId);
  return (
    entry?.encounterId === encounterId &&
    typeof entry.expiresRound === 'number' &&
    Number(row?.round) < entry.expiresRound
  );
}

/**
 * Drop one participant's Rage mark. Writes only when this encounter's entry exists, so a drop to 0 HP
 * by a creature that is not raging costs no write. Returns true when a live Rage was ended.
 */
export async function clearRage(encounterId: string, participantId: string): Promise<boolean> {
  const db = await database();
  const entry = sql`(${gameSessions.sessionState} -> ${RAGE_KEY} -> ${participantId})`;
  const cleared = await db
    .update(gameSessions)
    .set({
      sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) #- ARRAY[${RAGE_KEY}, ${participantId}]::text[]`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, sessionOfEncounter(encounterId)),
        sql`(${entry} ->> 'encounterId') = ${encounterId}::text`,
      ),
    )
    .returning({ id: gameSessions.id });
  return cleared.length > 0;
}

/**
 * Record that a raging participant attacked a hostile creature or took damage in this turn (#1654).
 * Writes only when a live Rage for this encounter exists, so a call for a participant who is not
 * raging does nothing.
 */
export async function markRageActive(encounterId: string, participantId: string): Promise<void> {
  const db = await database();
  const entry = sql`(${gameSessions.sessionState} -> ${RAGE_KEY} -> ${participantId})`;
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(${gameSessions.sessionState}, ARRAY[${RAGE_KEY}, ${participantId}, 'active']::text[], 'true'::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, sessionOfEncounter(encounterId)),
        sql`(${entry} ->> 'encounterId') = ${encounterId}::text`,
      ),
    );
}

/**
 * At the END of a raging participant's turn, once the advance is written (#1654, 2014 SRD 5.1): Rage ends
 * when the Barbarian neither attacked a hostile creature nor took damage since their last turn. A turn
 * that kept Rage resets the activity mark for the next turn. Returns 'ended', 'kept', or 'none' (no live
 * Rage for this encounter).
 */
export async function endRageIfIdle(
  encounterId: string,
  participantId: string,
): Promise<'ended' | 'kept' | 'none'> {
  const db = await database();
  const before = flagEntry(await readSessionState(encounterId), RAGE_KEY, participantId);
  if (before?.encounterId !== encounterId) return 'none';
  const entry = sql`(${gameSessions.sessionState} -> ${RAGE_KEY} -> ${participantId})`;
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`CASE WHEN (${entry} ->> 'active') = 'true'
        THEN jsonb_set(${gameSessions.sessionState}, ARRAY[${RAGE_KEY}, ${participantId}, 'active']::text[], 'false'::jsonb, true)
        ELSE ${gameSessions.sessionState} #- ARRAY[${RAGE_KEY}, ${participantId}]::text[] END`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, sessionOfEncounter(encounterId)),
        sql`(${entry} ->> 'encounterId') = ${encounterId}::text`,
      ),
    );
  return before.active === true ? 'kept' : 'ended';
}

/**
 * Drop every flag of one fight (hidden marks and Sneak Attack claims), inside the caller's
 * transaction when it has one. Called when the fight ends.
 */
export async function clearFightFlags(
  executor: Pick<VitalsTx, 'update'>,
  encounterId: string,
): Promise<void> {
  const keep = (key: string): SQL =>
    sql`COALESCE((
      SELECT jsonb_object_agg(e.key, e.value)
      FROM jsonb_each(COALESCE(${gameSessions.sessionState} -> ${key}, '{}'::jsonb)) AS e(key, value)
      WHERE e.value ->> 'encounterId' <> ${encounterId}::text
    ), '{}'::jsonb)`;
  await executor
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(
        jsonb_set(
          jsonb_set(
            jsonb_set(COALESCE(${gameSessions.sessionState}, '{}'::jsonb), ${`{${HIDDEN_KEY}}`}::text[], ${keep(HIDDEN_KEY)}, true),
            ${`{${SNEAK_KEY}}`}::text[], ${keep(SNEAK_KEY)}, true),
          ${`{${RAGE_KEY}}`}::text[], ${keep(RAGE_KEY)}, true),
        ${`{${LIGHT_ATTACK_KEY}}`}::text[], ${keep(LIGHT_ATTACK_KEY)}, true)`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionOfEncounter(encounterId)));
}

/**
 * Keeps both flags across a client whole-blob write (`SessionService.updateSession`), the same way
 * `actionSurgePreservingState` keeps the Action Surge mark: the live stored value wins over the
 * client's copy, and a stored value that is absent removes the client's copy.
 */
export function combatTurnFlagsPreservingState(incoming: SQL): SQL {
  // The incoming blob is written once, with each turn-flag key removed from it, and the stored
  // object (when there is one) is put back beside it. A CASE per key that repeated the incoming
  // expression in both branches doubled the statement for every key (#1639 added the fourth).
  const keys = [HIDDEN_KEY, SNEAK_KEY, RAGE_KEY, LIGHT_ATTACK_KEY];
  const storedObject = (key: string): SQL =>
    sql`CASE WHEN jsonb_typeof(${gameSessions.sessionState} -> ${key}) = 'object'
      THEN ${gameSessions.sessionState} -> ${key} END`;
  const stored = sql.join(
    keys.flatMap((key) => [sql`${key}::text`, storedObject(key)]),
    sql`, `,
  );
  return sql`((${incoming}) - ARRAY[${sql.join(
    keys.map((key) => sql`${key}`),
    sql`, `,
  )}]::text[])
    || jsonb_strip_nulls(jsonb_build_object(${stored}))`;
}

/** The level a character has in one class, read the way the rest of the engine reads it (multiclass aware). */
export async function classLevelOfCharacter(
  characterId: string,
  className: string,
): Promise<number> {
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
  return row ? classLevelOf(row, className) : 0;
}

/** The Rogue class level of a character (Sneak Attack, #1637). */
export async function rogueLevelOf(characterId: string): Promise<number> {
  return classLevelOfCharacter(characterId, 'Rogue');
}

/**
 * The other active participants on the attacker's side who are not incapacitated, for the Sneak
 * Attack flanking clause. "Same side" is the player/non-player split the engine already uses for
 * companions.
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
