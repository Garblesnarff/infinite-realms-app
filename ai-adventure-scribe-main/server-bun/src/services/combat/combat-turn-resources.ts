import { and, eq, sql, type SQL } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { combatEncounters, combatParticipants, gameSessions } from '../../../../db/schema/index';
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
    if (!participant) {
      // #975: an Action Surge declared before the action was spent arms one
      // extra action for this turn (see armActionSurge). The plain claim
      // failing is the only moment that arm can be spent: the participant's
      // one regular action is gone, so a matching mark pays for this claim
      // instead. The mark is consumed inside this transaction, so the claim
      // and the spend commit or roll back together.
      if (await consumeArmedActionSurge(tx, encounterId, participantId)) {
        return encounter.version;
      }
      throw new BusinessLogicError('Action already used this turn', { participantId });
    }
    return encounter.version;
  });
}

/**
 * #975: an Action Surge that was declared while the fighter's action was still
 * unspent. `combat_participants` carries one boolean per resource, so "two
 * actions this turn" has no column to live in; the mark lives in the session's
 * existing `session_state` jsonb instead, keyed by the encounter, participant
 * and round it was armed in — a mark from another fight, another fighter or
 * another round can never pay for a claim here. It is spent by
 * `claimTurnAction` (above) or cleared when the fighter's next turn resets
 * their resources, whichever comes first. The mark is a single slot: Action
 * Surge grants exactly one extra action, and the resolver refuses to arm a
 * second one over a live mark rather than spend a use on nothing.
 */
export interface ActionSurgeMark {
  encounterId: string;
  participantId: string;
  round: number;
}

const ACTION_SURGE_KEY = 'actionSurgeArmed';

type SessionStateRecord = Record<string, unknown>;

function surgeMarkOf(state: unknown): ActionSurgeMark | null {
  if (!state || typeof state !== 'object') return null;
  const mark = (state as SessionStateRecord)[ACTION_SURGE_KEY];
  if (!mark || typeof mark !== 'object') return null;
  const candidate = mark as Partial<ActionSurgeMark>;
  if (
    typeof candidate.encounterId !== 'string' ||
    typeof candidate.participantId !== 'string' ||
    typeof candidate.round !== 'number'
  ) {
    return null;
  }
  return candidate as ActionSurgeMark;
}

/**
 * The mark is engine-owned state inside a column the client also writes
 * wholesale (`PATCH /v1/sessions/:id` replaces `session_state`, and the
 * client's SessionStateService is read-merge-write of the whole blob). So no
 * writer here may work from a JS-side snapshot: a snapshot write landing
 * between the arm and the claim would silently delete the mark (use spent, no
 * extra action), and one landing after the consume would resurrect it (a
 * third action). Every operation below is therefore a single guarded UPDATE
 * against the live row — `jsonb_set` to arm, the `-` operator to delete —
 * and `SessionService.updateSession` preserves this key across client
 * whole-blob writes by folding the same merge into its single UPDATE
 * (`actionSurgePreservingState`) — a read-then-write there would reopen
 * exactly the window this comment forbids.
 */
export async function armActionSurge(sessionId: string, mark: ActionSurgeMark): Promise<void> {
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`jsonb_set(COALESCE(${gameSessions.sessionState}, '{}'::jsonb), '{actionSurgeArmed}', ${JSON.stringify(mark)}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(eq(gameSessions.id, sessionId));
}

/** The mark currently armed for a session, if any. */
export async function readActionSurgeMark(sessionId: string): Promise<ActionSurgeMark | null> {
  const [session] = await db
    .select({ state: gameSessions.sessionState })
    .from(gameSessions)
    .where(eq(gameSessions.id, sessionId))
    .limit(1);
  return surgeMarkOf(session?.state);
}

/**
 * Merge a client whole-blob `session_state` write with the engine-owned mark:
 * the stored value of the key (present or absent) always wins over whatever
 * the client's snapshot carries, so a stale snapshot can neither delete a
 * live mark nor resurrect a spent one.
 */
export function withPreservedActionSurgeMark(
  incoming: unknown,
  current: unknown,
): SessionStateRecord {
  const next: SessionStateRecord =
    incoming && typeof incoming === 'object' ? { ...(incoming as SessionStateRecord) } : {};
  const mark = surgeMarkOf(current);
  if (mark) {
    next[ACTION_SURGE_KEY] = mark;
  } else {
    delete next[ACTION_SURGE_KEY];
  }
  return next;
}

/**
 * The same preservation as `withPreservedActionSurgeMark`, expressed as a
 * single SQL expression over the live row, for writers that must not read
 * first: the UPDATE computes the merged blob from the row it is writing, so
 * an arm or a consume that commits at any point relative to the write is
 * never undone by it — a stored valid mark replaces the incoming key, and
 * with no valid mark stored the incoming key is stripped. The validity test
 * mirrors `surgeMarkOf` field for field (object with string encounterId and
 * participantId and a numeric round). `SessionService.updateSession` folds
 * this into its UPDATE; the JS twin above remains as the semantic reference
 * and is what the merge-level tests pin.
 */
export function actionSurgePreservingState(incoming: unknown): SQL {
  const incomingJson = sql`${JSON.stringify(incoming ?? null)}::jsonb`;
  const base = sql`CASE WHEN jsonb_typeof(${incomingJson}) = 'object' THEN ${incomingJson} ELSE '{}'::jsonb END`;
  const storedMark = sql`${gameSessions.sessionState} -> ${ACTION_SURGE_KEY}`;
  const validStoredMark = sql`jsonb_typeof(${storedMark}) = 'object'
    AND jsonb_typeof(${storedMark} -> 'encounterId') = 'string'
    AND jsonb_typeof(${storedMark} -> 'participantId') = 'string'
    AND jsonb_typeof(${storedMark} -> 'round') = 'number'`;
  return sql`CASE WHEN ${validStoredMark}
    THEN (${base} - ${ACTION_SURGE_KEY}) || jsonb_build_object(${ACTION_SURGE_KEY}::text, ${storedMark})
    ELSE ${base} - ${ACTION_SURGE_KEY} END`;
}

/** Remove the mark, but only the one belonging to `participantId`. */
export async function clearActionSurgeMark(
  sessionId: string,
  participantId: string,
): Promise<void> {
  await db
    .update(gameSessions)
    .set({
      sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) - ${ACTION_SURGE_KEY}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, sessionId),
        sql`${gameSessions.sessionState} -> ${ACTION_SURGE_KEY} ->> 'participantId' = ${participantId}`,
      ),
    );
}

/**
 * Spend the armed surge inside the claim transaction: one test-and-delete
 * UPDATE whose predicate is the mark itself (this encounter, this participant,
 * the encounter's current round). True when the statement deleted a mark —
 * i.e. a mark armed for exactly this claim paid for it.
 */
async function consumeArmedActionSurge(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  encounterId: string,
  participantId: string,
): Promise<boolean> {
  const [encounter] = await tx
    .select({ sessionId: combatEncounters.sessionId, currentRound: combatEncounters.currentRound })
    .from(combatEncounters)
    .where(eq(combatEncounters.id, encounterId))
    .limit(1);
  if (!encounter) return false;
  const [consumed] = await tx
    .update(gameSessions)
    .set({
      sessionState: sql`COALESCE(${gameSessions.sessionState}, '{}'::jsonb) - ${ACTION_SURGE_KEY}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(gameSessions.id, encounter.sessionId),
        sql`${gameSessions.sessionState} -> ${ACTION_SURGE_KEY} ->> 'encounterId' = ${encounterId}`,
        sql`${gameSessions.sessionState} -> ${ACTION_SURGE_KEY} ->> 'participantId' = ${participantId}`,
        sql`(${gameSessions.sessionState} -> ${ACTION_SURGE_KEY} ->> 'round')::int = ${encounter.currentRound}`,
      ),
    )
    .returning({ id: gameSessions.id });
  return Boolean(consumed);
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
  // #975: an Action Surge armed last turn dies with it. Best-effort: the mark
  // is round-keyed, so a survivor could never pay for a claim anyway — this
  // just keeps the state honest. A failure here must not strand the turn
  // boundary the reset belongs to, so it is logged, never thrown. Only a
  // participant with a character can ever have armed a surge (the resolver is
  // reached through a sheet), so monsters skip the lookup entirely.
  try {
    const [row] = await db
      .select({
        sessionId: combatEncounters.sessionId,
        characterId: combatParticipants.characterId,
      })
      .from(combatParticipants)
      .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
      .where(eq(combatParticipants.id, participantId))
      .limit(1);
    if (row?.characterId) await clearActionSurgeMark(row.sessionId, participantId);
  } catch (error) {
    logger.error({ msg: 'ACTION_SURGE_MARK_CLEAR_FAILED', participantId, error });
  }
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
