import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { combatEncounters, combatParticipants } from '../../../../db/schema/index';
import { BusinessLogicError } from '../../lib/errors.js';

export async function consumeAction(participantId: string, encounterId: string): Promise<void> {
  const [claimed] = await db.update(combatParticipants)
    .set({ actionUsed: true, updatedAt: new Date() })
    .where(and(
      eq(combatParticipants.id, participantId),
      eq(combatParticipants.encounterId, encounterId),
      eq(combatParticipants.isActive, true),
      eq(combatParticipants.actionUsed, false),
    ))
    .returning({ id: combatParticipants.id });
  if (!claimed) throw new BusinessLogicError('Action already used this turn', { participantId });
}

/** Atomically claims both optimistic encounter version and the actor's one action. */
export async function claimTurnAction(
  participantId: string,
  encounterId: string,
  expectedVersion: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [encounter] = await tx.update(combatEncounters)
      .set({ version: sql`${combatEncounters.version} + 1`, updatedAt: new Date() })
      .where(and(eq(combatEncounters.id, encounterId), eq(combatEncounters.version, expectedVersion)))
      .returning({ version: combatEncounters.version });
    if (!encounter) throw new BusinessLogicError('Combat state changed; refresh and retry', { expectedVersion });
    const [participant] = await tx.update(combatParticipants)
      .set({ actionUsed: true, updatedAt: new Date() })
      .where(and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
        eq(combatParticipants.isActive, true),
        eq(combatParticipants.actionUsed, false),
      ))
      .returning({ id: combatParticipants.id });
    if (!participant) throw new BusinessLogicError('Action already used this turn', { participantId });
    return encounter.version;
  });
}

export async function claimTurnBonusAction(
  participantId: string,
  encounterId: string,
  expectedVersion: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [encounter] = await tx.update(combatEncounters)
      .set({ version: sql`${combatEncounters.version} + 1`, updatedAt: new Date() })
      .where(and(eq(combatEncounters.id, encounterId), eq(combatEncounters.version, expectedVersion)))
      .returning({ version: combatEncounters.version });
    if (!encounter) throw new BusinessLogicError('Combat state changed; refresh and retry', { expectedVersion });
    const [participant] = await tx.update(combatParticipants)
      .set({ bonusActionUsed: true, updatedAt: new Date() })
      .where(and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
        eq(combatParticipants.isActive, true),
        eq(combatParticipants.bonusActionUsed, false),
      ))
      .returning({ id: combatParticipants.id });
    if (!participant) throw new BusinessLogicError('Bonus action already used this turn', { participantId });
    return encounter.version;
  });
}

export async function resetTurnResources(participantId: string, round: number): Promise<void> {
  await db.update(combatParticipants).set({
    resourcesRound: round,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    isDodging: false,
    isDisengaged: false,
    updatedAt: new Date(),
  }).where(eq(combatParticipants.id, participantId));
}

export async function setDefensiveAction(
  participantId: string,
  action: 'dodge' | 'disengage',
): Promise<void> {
  await db.update(combatParticipants).set({
    isDodging: action === 'dodge',
    isDisengaged: action === 'disengage',
    updatedAt: new Date(),
  }).where(eq(combatParticipants.id, participantId));
}
