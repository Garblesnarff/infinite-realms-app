import { and, eq, sql } from 'drizzle-orm';

import { CombatEncounterService } from './combat-encounter-service.js';
import { db } from '../../../../db/client';
import { combatEncounters, gameSessions } from '../../../../db/schema/index';
import { BusinessLogicError, NotFoundError, ValidationError } from '../../lib/errors.js';

import type { PendingCombatIntent } from '../../../../db/schema/index';

/** The client declaration stored until its actor reaches the current turn. */
export type PendingCombatIntentInput = Omit<PendingCombatIntent, 'queuedOnTurn' | 'queuedOnRound'>;

function validatePendingIntent(input: PendingCombatIntentInput): void {
  if (!input || typeof input !== 'object') {
    throw new ValidationError('A pending combat intent is required');
  }
  if (typeof input.actorId !== 'string' || !input.actorId.trim()) {
    throw new ValidationError('pending intent actorId is required');
  }
  if (typeof input.actionType !== 'string' || !input.actionType.trim()) {
    throw new ValidationError('pending intent actionType is required');
  }
  if (!Array.isArray(input.targetIds) || input.targetIds.some((id) => typeof id !== 'string')) {
    throw new ValidationError('pending intent targetIds must be an array of strings');
  }
  if (input.targetIds.some((id) => !id.trim())) {
    throw new ValidationError('pending intent targetIds cannot contain blank ids');
  }
  if (typeof input.sourceText !== 'string' || !input.sourceText.trim()) {
    throw new ValidationError('pending intent sourceText is required');
  }
}

/**
 * Persist the player's declared action while another participant owns the current turn.
 *
 * The state read supplies both the roster and the server-owned round/turn coordinates. The
 * actor check is intentionally narrower than encounter ownership: a session owner may only
 * queue the session's declared player character, never an NPC or the current-turn participant.
 */
export async function setPendingCombatIntent(
  encounterId: string,
  input: PendingCombatIntentInput,
  userId: string,
): Promise<PendingCombatIntent> {
  validatePendingIntent(input);

  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  if (state.encounter.status !== 'active') {
    throw new BusinessLogicError('Encounter is not active', { status: state.encounter.status });
  }

  const [session] = await db
    .select({ characterId: gameSessions.characterId })
    .from(gameSessions)
    .where(eq(gameSessions.id, state.encounter.sessionId))
    .limit(1);
  if (!session) throw new NotFoundError('Session', state.encounter.sessionId);

  const actor = state.participants.find((participant) => participant.id === input.actorId);
  if (!actor) throw new NotFoundError('Combat participant', input.actorId);
  if (
    !actor.isActive ||
    actor.participantType !== 'player' ||
    actor.characterId !== session.characterId
  ) {
    throw new BusinessLogicError('Only the session player can queue a combat intent', {
      actorId: input.actorId,
    });
  }
  if (state.currentParticipant?.id === actor.id) {
    throw new BusinessLogicError('The session player is the current-turn participant', {
      actorId: input.actorId,
    });
  }

  const pendingIntent: PendingCombatIntent = {
    actorId: actor.id,
    actionType: input.actionType.trim(),
    targetIds: input.targetIds.map((id) => id.trim()),
    sourceText: input.sourceText,
    queuedOnTurn: state.encounter.currentTurnOrder,
    queuedOnRound: state.encounter.currentRound,
  };

  const [updated] = await db
    .update(combatEncounters)
    .set({ pendingIntent, updatedAt: new Date() })
    .where(and(eq(combatEncounters.id, encounterId), eq(combatEncounters.status, 'active')))
    .returning({ pendingIntent: combatEncounters.pendingIntent });

  if (!updated?.pendingIntent) {
    throw new BusinessLogicError('Encounter is no longer active');
  }
  return updated.pendingIntent;
}

/** Clear a pending declaration after the player chooses a different action. */
export async function clearPendingCombatIntent(encounterId: string, userId: string): Promise<void> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  if (state.encounter.status !== 'active') {
    throw new BusinessLogicError('Encounter is not active', { status: state.encounter.status });
  }
  const pendingIntent = state.encounter.pendingIntent;
  if (!pendingIntent) throw new BusinessLogicError('No pending combat intent to clear');

  const [updated] = await db
    .update(combatEncounters)
    .set({
      pendingIntent: null,
      version: sql`${combatEncounters.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(combatEncounters.id, encounterId),
        eq(combatEncounters.status, 'active'),
        eq(combatEncounters.version, state.encounter.version),
        sql`${combatEncounters.pendingIntent} = ${JSON.stringify(pendingIntent)}::jsonb`,
      ),
    )
    .returning({ id: combatEncounters.id });

  if (!updated) throw new BusinessLogicError('Pending combat intent already consumed');
}

/**
 * Atomically promote the stored declaration when its actor owns the current turn.
 *
 * The client still sends the returned source text through the ordinary DM turn. Clearing here
 * first prevents the normal resolution step from treating the deliberate re-declaration as a
 * stale queued action, while the current-turn check prevents a stale confirmation from stealing
 * another participant's turn.
 */
export async function promotePendingCombatIntent(
  encounterId: string,
  userId: string,
): Promise<PendingCombatIntent> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  if (state.encounter.status !== 'active') {
    throw new BusinessLogicError('Encounter is not active', { status: state.encounter.status });
  }
  const pendingIntent = state.encounter.pendingIntent;
  if (!pendingIntent) throw new BusinessLogicError('No pending combat intent to promote');
  if (state.currentParticipant?.id !== pendingIntent.actorId) {
    throw new BusinessLogicError(
      'Pending combat intent actor is not the current-turn participant',
      {
        actorId: pendingIntent.actorId,
      },
    );
  }

  const [updated] = await db
    .update(combatEncounters)
    .set({
      pendingIntent: null,
      version: sql`${combatEncounters.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(combatEncounters.id, encounterId),
        eq(combatEncounters.status, 'active'),
        eq(combatEncounters.version, state.encounter.version),
        sql`${combatEncounters.pendingIntent} = ${JSON.stringify(pendingIntent)}::jsonb`,
      ),
    )
    .returning({ id: combatEncounters.id });
  if (!updated) throw new BusinessLogicError('Pending combat intent already consumed');
  return pendingIntent;
}

export class CombatPendingIntentService {
  static setPendingCombatIntent = setPendingCombatIntent;
  static clearPendingCombatIntent = clearPendingCombatIntent;
  static promotePendingCombatIntent = promotePendingCombatIntent;
}
