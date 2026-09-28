import { normalizeMonsterKey } from './monster-key.js';
import { NotFoundError } from '../../lib/errors.js';
import { resolveEntityRef } from '../../tactical/identity.js';

export interface CombatIntentRefParticipant {
  id: string;
  name?: string;
  participantType?: string;
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

/** `srd:vitruvian-spider`, `campaign:the-doorkeeper` — a namespaced stat-block key. */
const CATALOG_REF = /^[a-z][a-z0-9_-]*:\S/i;
/** The participant types seated from a stat block (see `participant-type.ts`). */
const CATALOG_SEATED_TYPES = new Set(['npc', 'monster']);

function uniqueCatalogMatch<P extends CombatIntentRefParticipant>(
  participants: P[],
  token: string,
): P | null {
  const key = normalizeMonsterKey(token.replace(/^[^:]*:/, ''));
  if (!key) return null;
  // A catalog key names a stat block, and only creatures are seated from one: a player whose
  // name happens to normalize to the key (a PC called "Vitruvian Spider") is never its target.
  const matches = participants.filter(
    (participant) =>
      CATALOG_SEATED_TYPES.has(participant.participantType ?? '') &&
      !!participant.name &&
      normalizeMonsterKey(participant.name) === key,
  );
  return matches.length === 1 ? matches[0] : null;
}

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

    // A catalog ref is the creature's stat-block key, not its seat: the DM copies
    // `srd:vitruvian-spider` out of the scene spec while the board seated `the-vitruvian-spider`
    // (#2303, run 13). Translate through the one monster-key rule, and only when exactly one
    // participant answers to it — two spiders stay unresolved rather than becoming the first.
    const catalogParticipant = CATALOG_REF.test(token)
      ? uniqueCatalogMatch(state.participants, token)
      : null;
    if (catalogParticipant) {
      warn({
        msg: 'COMBAT_INTENT_REF_RECONCILED_FROM_CATALOG_REF',
        encounterId: state.encounter.id,
        sessionId: state.encounter.sessionId,
        intentType: submitted.type,
        role,
        submittedRef: token,
        resolvedTo: catalogParticipant.id,
      });
      return catalogParticipant.id;
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
