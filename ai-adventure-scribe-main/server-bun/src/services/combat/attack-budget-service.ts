import { and, eq, sql, type SQL } from 'drizzle-orm';

import { attackActionSwings, planAttackSwing, type AttackActionBudget } from './extra-attack.js';
import { db } from '../../../../db/client';
import {
  characters,
  combatEncounters,
  combatParticipants,
  gameSessions,
} from '../../../../db/schema/index';
import { BusinessLogicError } from '../../lib/errors.js';

const KEY = 'attackActionBudget';

type Stored = {
  attackActionBudget?: AttackActionBudget;
  actionSurgeArmed?: { encounterId: string; participantId: string; round: number };
};

/** Read the current Action's remaining attack swings without claiming any resource. */
export async function attackBudgetPlan(encounterId: string, participantId: string) {
  const [row] = await db
    .select({
      round: combatEncounters.currentRound,
      sessionId: combatEncounters.sessionId,
      state: gameSessions.sessionState,
      actionUsed: combatParticipants.actionUsed,
      characterClass: characters.class,
      level: characters.level,
      classLevels: characters.classLevels,
    })
    .from(combatParticipants)
    .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(characters, eq(combatParticipants.characterId, characters.id))
    .where(
      and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
        eq(combatParticipants.isActive, true),
      ),
    )
    .limit(1);
  if (!row) throw new BusinessLogicError('Action already used this turn', { participantId });
  const state = (row.state ?? {}) as Stored;
  const surge = state.actionSurgeArmed;
  const plan = planAttackSwing({
    encounterId,
    participantId,
    round: row.round,
    actionUsed: row.actionUsed,
    surgeArmed:
      surge?.encounterId === encounterId &&
      surge.participantId === participantId &&
      surge.round === row.round,
    capacity: attackActionSwings({
      class: row.characterClass,
      level: row.level,
      classLevels: row.classLevels,
    }),
    budget: state.attackActionBudget ?? null,
  });
  return { ...row, plan };
}

/** Claim a swing inside the surrounding encounter transaction. */
export async function claimAttackSwing(
  encounterId: string,
  participantId: string,
  expectedVersion: number,
): Promise<void> {
  const [version] = await db
    .update(combatEncounters)
    .set({ version: sql`${combatEncounters.version} + 1`, updatedAt: new Date() })
    .where(and(eq(combatEncounters.id, encounterId), eq(combatEncounters.version, expectedVersion)))
    .returning({ id: combatEncounters.id });
  if (!version)
    throw new BusinessLogicError('Combat state changed; refresh and retry', { expectedVersion });
  const current = await attackBudgetPlan(encounterId, participantId);
  if (!current.plan)
    throw new BusinessLogicError('Action already used this turn', { participantId });
  if (current.plan.payment === 'action') {
    await db
      .update(combatParticipants)
      .set({ actionUsed: true, updatedAt: new Date() })
      .where(
        and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId),
        ),
      );
  }
  const state =
    current.plan.payment === 'surge'
      ? sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) - 'actionSurgeArmed'`
      : sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb)`;
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(${state}, '{attackActionBudget}', ${JSON.stringify(current.plan.budget)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, current.sessionId));
}

/** Preserve the engine-owned budget across a client whole-session-state write. */
export function attackBudgetPreservingState(incoming: SQL): SQL {
  const stored = sql`${gameSessions.sessionState} -> ${KEY}`;
  return sql`CASE WHEN jsonb_typeof(${stored}) = 'object'
    THEN (${incoming} - ${KEY}) || jsonb_build_object(${KEY}::text, ${stored})
    ELSE ${incoming} - ${KEY} END`;
}

export async function clearAttackBudget(sessionId: string, participantId: string): Promise<void> {
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) - ${KEY}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, sessionId),
        sql`${gameSessions.sessionState} -> ${KEY} ->> 'participantId' = ${participantId}`,
      ),
    );
}
