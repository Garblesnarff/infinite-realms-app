import { NotFoundError } from '../../lib/errors.js';
import { resolveEntityRef } from '../../tactical/identity.js';

export interface CombatIntentRefParticipant {
  id: string;
  name?: string;
}

export interface CombatIntentRefState {
  encounter: { id: string; sessionId: string; status?: string };
  participants: CombatIntentRefParticipant[];
}

export interface CombatIntentRefIndex {
  resolve(token: string): string;
  roster(): string;
}

export interface CombatIntentRefSubmission {
  type: string;
  actorId: string;
  targetId?: string;
  targetIds?: string[];
}

type RefLog = (data: Record<string, unknown>) => void;

/** Resolve board tokens to IDs that actually belong to this encounter. */
export function resolveCombatIntentRefs<T extends CombatIntentRefSubmission>(
  submitted: T,
  index: CombatIntentRefIndex,
  state: CombatIntentRefState,
  warn: RefLog = () => undefined,
): T {
  const participantIds = new Set(state.participants.map((participant) => participant.id));
  const requireParticipant = (token: string, role: 'actor' | 'target'): string => {
    const boardId = index.resolve(token);
    if (participantIds.has(boardId)) return boardId;

    // A recently rebuilt encounter can briefly be ahead of its tactical-map aliases. Resolve
    // the same token against the authoritative encounter roster before refusing the action.
    const encounterParticipant = resolveEntityRef(state.participants, token);
    if (encounterParticipant && participantIds.has(encounterParticipant.id)) {
      warn({
        msg: 'COMBAT_INTENT_REF_RECONCILED_TO_ENCOUNTER_ROSTER',
        encounterId: state.encounter.id,
        sessionId: state.encounter.sessionId,
        intentType: submitted.type,
        role,
        submittedRef: token,
        resolvedTo: encounterParticipant.id,
        boardResolvedTo: boardId === token ? null : boardId,
        roster: index.roster(),
      });
      return encounterParticipant.id;
    }

    warn({
      msg: 'COMBAT_INTENT_UNRESOLVED_REF',
      encounterId: state.encounter.id,
      sessionId: state.encounter.sessionId,
      intentType: submitted.type,
      role,
      submittedRef: token,
      // Named separately because the two differ exactly when the board resolved a token to an
      // id the encounter does not carry — a stale reference, not an unknown one.
      resolvedTo: boardId === token ? null : boardId,
      roster: index.roster(),
    });
    throw new NotFoundError('Combat participant', token, {
      role,
      intentType: submitted.type,
      roster: index.roster(),
    });
  };

  const actorId = requireParticipant(submitted.actorId, 'actor');
  if (submitted.type === 'attack') {
    return {
      ...submitted,
      actorId,
      targetId: requireParticipant(submitted.targetId ?? '', 'target'),
    };
  }
  if (submitted.type === 'spell') {
    return {
      ...submitted,
      actorId,
      targetIds: (submitted.targetIds ?? []).map((id) => requireParticipant(id, 'target')),
    };
  }
  return { ...submitted, actorId };
}

const isUnresolvedCombatParticipant = (error: unknown): boolean =>
  error instanceof NotFoundError &&
  !!error.details &&
  typeof error.details === 'object' &&
  (error.details as { resource?: unknown }).resource === 'Combat participant';

/** Re-read the encounter and map once for a participant reference that may have raced seating. */
export async function resolveCombatIntentRefsWithRetry<
  T extends CombatIntentRefSubmission,
  S extends CombatIntentRefState,
  I extends CombatIntentRefIndex,
>(
  submitted: T,
  initialState: S,
  deps: {
    loadState: () => Promise<S>;
    loadIndex: (sessionId: string) => Promise<I>;
    warn: RefLog;
    waitBeforeRetry?: () => Promise<void>;
  },
): Promise<{ state: S; index: I; resolved: T }> {
  let state = initialState;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const index = await deps.loadIndex(state.encounter.sessionId);
    try {
      return {
        state,
        index,
        resolved: resolveCombatIntentRefs(submitted, index, state, deps.warn),
      };
    } catch (error) {
      if (attempt > 0 || !isUnresolvedCombatParticipant(error)) throw error;
      deps.warn({
        msg: 'COMBAT_INTENT_REF_RETRY_AFTER_SEATING_READ',
        encounterId: state.encounter.id,
        sessionId: state.encounter.sessionId,
        intentType: submitted.type,
        submittedActorRef: submitted.actorId,
      });
      if (deps.waitBeforeRetry) {
        await deps.waitBeforeRetry();
      } else {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      try {
        state = await deps.loadState();
      } catch {
        throw error;
      }
    }
  }

  throw new Error('Combat intent participant resolution did not complete');
}
