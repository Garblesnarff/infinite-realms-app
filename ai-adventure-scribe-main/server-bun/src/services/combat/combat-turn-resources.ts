import { and, eq, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { combatEncounters, combatParticipants } from '../../../../db/schema/index';
import { BusinessLogicError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

export async function consumeAction(participantId: string, encounterId: string): Promise<void> {
  const [claimed] = await db
    .update(combatParticipants)
    .set({ actionUsed: true, updatedAt: new Date() })
    .where(
      and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
        eq(combatParticipants.isActive, true),
        eq(combatParticipants.actionUsed, false),
      ),
    )
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
    const [encounter] = await tx
      .update(combatEncounters)
      .set({ version: sql`${combatEncounters.version} + 1`, updatedAt: new Date() })
      .where(
        and(eq(combatEncounters.id, encounterId), eq(combatEncounters.version, expectedVersion)),
      )
      .returning({ version: combatEncounters.version });
    if (!encounter)
      throw new BusinessLogicError('Combat state changed; refresh and retry', { expectedVersion });
    const [participant] = await tx
      .update(combatParticipants)
      .set({ actionUsed: true, updatedAt: new Date() })
      .where(
        and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId),
          eq(combatParticipants.isActive, true),
          eq(combatParticipants.actionUsed, false),
        ),
      )
      .returning({ id: combatParticipants.id });
    if (!participant)
      throw new BusinessLogicError('Action already used this turn', { participantId });
    return encounter.version;
  });
}

/**
 * Claims the optimistic encounter version for an actor who must still be in the fight, and spends
 * nothing (#2580). Flee is movement and Yield is a declaration, so neither costs the Action: a
 * player who already Disengaged this turn, or whose Action is gone, can still leave.
 *
 * The `isActive` predicate is what makes a second click refuse: once the exit is recorded the
 * participant is out of the turn order, so a repeat finds no row to claim.
 */
export async function claimTurnVersion(
  participantId: string,
  encounterId: string,
  expectedVersion: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [encounter] = await tx
      .update(combatEncounters)
      .set({ version: sql`${combatEncounters.version} + 1`, updatedAt: new Date() })
      .where(
        and(eq(combatEncounters.id, encounterId), eq(combatEncounters.version, expectedVersion)),
      )
      .returning({ version: combatEncounters.version });
    if (!encounter)
      throw new BusinessLogicError('Combat state changed; refresh and retry', { expectedVersion });
    const [participant] = await tx
      .update(combatParticipants)
      .set({ updatedAt: new Date() })
      .where(
        and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId),
          eq(combatParticipants.isActive, true),
        ),
      )
      .returning({ id: combatParticipants.id });
    if (!participant)
      throw new BusinessLogicError('Participant is not in the fight', { participantId });
    return encounter.version;
  });
}

export async function claimTurnBonusAction(
  participantId: string,
  encounterId: string,
  expectedVersion: number,
): Promise<number> {
  return db.transaction(async (tx) => {
    const [encounter] = await tx
      .update(combatEncounters)
      .set({ version: sql`${combatEncounters.version} + 1`, updatedAt: new Date() })
      .where(
        and(eq(combatEncounters.id, encounterId), eq(combatEncounters.version, expectedVersion)),
      )
      .returning({ version: combatEncounters.version });
    if (!encounter)
      throw new BusinessLogicError('Combat state changed; refresh and retry', { expectedVersion });
    const [participant] = await tx
      .update(combatParticipants)
      .set({ bonusActionUsed: true, updatedAt: new Date() })
      .where(
        and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId),
          eq(combatParticipants.isActive, true),
          eq(combatParticipants.bonusActionUsed, false),
        ),
      )
      .returning({ id: combatParticipants.id });
    if (!participant)
      throw new BusinessLogicError('Bonus action already used this turn', { participantId });
    return encounter.version;
  });
}

/**
 * Compensating action for a claim whose resolution then failed.
 *
 * Why this exists: `combat_participants.action_used` is cleared in exactly one
 * place -- `resetTurnResources`, reached only from
 * `CombatInitiativeService.advanceTurn`, reached only from an `end_turn` intent.
 * So an actor whose action was claimed and whose resolution then threw is stuck
 * for good: the action is spent, the turn was never advanced, `end_turn` is
 * never reached, and every retry returns "Action already used this turn".
 * Observed in production as `The Seeker action_used=t turn_order=1
 * current_turn_order=1 round=2`, in both a resumed and a fresh session.
 *
 * The encounter version is deliberately NOT rolled back. It is a monotonic
 * optimistic-concurrency token; decrementing it would let a stale
 * `expectedVersion` from a concurrent caller start matching again (an ABA
 * problem) to save the client one refetch. A client that just received an error
 * has to refresh its combat state regardless, and once it does, the retry
 * succeeds because the action is free again.
 *
 * Best-effort by construction: it must never replace the error that caused it.
 */
export async function releaseTurnAction(participantId: string, encounterId: string): Promise<void> {
  await db
    .update(combatParticipants)
    .set({ actionUsed: false, updatedAt: new Date() })
    .where(
      and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
      ),
    );
}

/** {@link releaseTurnAction} for the bonus-action claim. */
export async function releaseTurnBonusAction(
  participantId: string,
  encounterId: string,
): Promise<void> {
  await db
    .update(combatParticipants)
    .set({ bonusActionUsed: false, updatedAt: new Date() })
    .where(
      and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
      ),
    );
}

/**
 * Claims the actor's action, runs `resolve`, and releases the claim if `resolve`
 * throws -- so a failure anywhere in resolution cannot leave the actor with a
 * spent action and no way to advance the turn.
 *
 * Chosen over wrapping the claim and the whole of resolution in one transaction
 * because resolution spans several services (HP, tactical map, DM narration) and,
 * for spell attacks, a loop over every target. A transaction that wide would hold
 * write locks on the encounter and participant rows across dice rolls and
 * multi-target damage, changing the concurrency behaviour of every combat
 * operation to fix a failure path. The compensating release restores exactly the
 * field that strands the actor and touches nothing else.
 */
export async function claimTurnActionAndResolve<T>(
  participantId: string,
  encounterId: string,
  expectedVersion: number,
  resolve: (version: number) => Promise<T>,
): Promise<T> {
  const version = await claimTurnAction(participantId, encounterId, expectedVersion);
  return runOrReleaseClaim(participantId, encounterId, version, resolve, releaseTurnAction);
}

/** {@link claimTurnActionAndResolve} for actions that cost a bonus action instead. */
export async function claimTurnBonusActionAndResolve<T>(
  participantId: string,
  encounterId: string,
  expectedVersion: number,
  resolve: (version: number) => Promise<T>,
): Promise<T> {
  const version = await claimTurnBonusAction(participantId, encounterId, expectedVersion);
  return runOrReleaseClaim(participantId, encounterId, version, resolve, releaseTurnBonusAction);
}

async function runOrReleaseClaim<T>(
  participantId: string,
  encounterId: string,
  version: number,
  resolve: (version: number) => Promise<T>,
  release: (participantId: string, encounterId: string) => Promise<void>,
): Promise<T> {
  try {
    return await resolve(version);
  } catch (error) {
    try {
      await release(participantId, encounterId);
    } catch (releaseError) {
      // Nothing else clears the claim, so a failure here is the stranded-actor
      // state itself. Surface it loudly, but never in place of the real error.
      logger.error({
        msg: 'COMBAT_ACTION_CLAIM_RELEASE_FAILED',
        releaseError,
        participantId,
        encounterId,
      });
    }
    throw error;
  }
}

export async function resetTurnResources(participantId: string, round: number): Promise<void> {
  await db
    .update(combatParticipants)
    .set({
      resourcesRound: round,
      actionUsed: false,
      bonusActionUsed: false,
      reactionUsed: false,
      isDodging: false,
      isDisengaged: false,
      updatedAt: new Date(),
    })
    .where(eq(combatParticipants.id, participantId));
}

/**
 * Claim one reaction, and release it if `resolve` throws (#2580).
 *
 * An opportunity attack is a reaction, not an action: it happens on somebody ELSE's turn, so it
 * must not spend the attacker's Action and must not advance the order. The engine had no way to
 * express that — every attack went through `claimTurnActionAndResolve` — which is why fleeing
 * a fight had to be modelled as the fleeing player Dash-ing rather than as the rules describe it.
 */
export async function claimTurnReactionAndResolve<T>(
  participantId: string,
  encounterId: string,
  resolve: () => Promise<T>,
): Promise<T> {
  const [claimed] = await db
    .update(combatParticipants)
    .set({ reactionUsed: true, updatedAt: new Date() })
    .where(
      and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
        eq(combatParticipants.isActive, true),
        eq(combatParticipants.reactionUsed, false),
      ),
    )
    .returning({ id: combatParticipants.id });
  if (!claimed) throw new BusinessLogicError('Reaction already used this turn', { participantId });
  try {
    return await resolve();
  } catch (error) {
    await db
      .update(combatParticipants)
      .set({ reactionUsed: false, updatedAt: new Date() })
      .where(
        and(
          eq(combatParticipants.id, participantId),
          eq(combatParticipants.encounterId, encounterId),
        ),
      );
    throw error;
  }
}

export async function setDefensiveAction(
  participantId: string,
  action: 'dodge' | 'disengage',
): Promise<void> {
  await db
    .update(combatParticipants)
    .set({
      isDodging: action === 'dodge',
      isDisengaged: action === 'disengage',
      updatedAt: new Date(),
    })
    .where(eq(combatParticipants.id, participantId));
}
