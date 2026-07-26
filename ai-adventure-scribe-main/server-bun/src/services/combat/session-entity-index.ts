/**
 * The one place that turns whatever a caller typed into a participant id.
 *
 * Clients, the CLI, and the DM all address the board with the token the board handed them — a
 * slug out of the tactical digest (`shadow-roach-1`) — while every engine table keys on the
 * participant uuid. That translation used to live inside one route handler, and three separate
 * entry points have since been written that forgot to perform it: the intent route, the AoE
 * cast service, and the browser action bridge each sent a slug straight into a uuid lookup and
 * got "Actor is not the current-turn participant" back. Hoisting it here is only half the fix;
 * the other half is that `executeCombatIntent` — the single mutation gateway — now applies it,
 * so a future fourth entry point cannot forget.
 */
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { describeEntityRoster, entitySlug, resolveEntityRef } from '../../tactical/identity.js';

import type { EntityRef } from '../../tactical/identity.js';

export interface SessionEntityIndex {
  /** The canonical participant id for a token, or the token unchanged when no board can say. */
  resolve(token: string): string;
  /** The DM-facing slug for an id; `undefined` when the board does not carry that entity. */
  slugFor(id: string | null | undefined): string | undefined;
  /** The board roster, for the refusal message a caller is handed after a miss. */
  roster(): string;
}

/** An index over a session's live board. Sessions with no active map resolve to identity. */
export async function loadSessionEntityIndex(sessionId: string): Promise<SessionEntityIndex> {
  const map = await loadActiveTacticalMap(sessionId);
  return sessionEntityIndex(map?.entities ?? []);
}

/** The pure core, so callers that already hold the entities do not reload the map. */
export function sessionEntityIndex(entities: EntityRef[]): SessionEntityIndex {
  return {
    resolve: (token) => resolveEntityRef(entities, token)?.id || token,
    slugFor: (id) => {
      if (!id) return undefined;
      const entity = entities.find((candidate) => candidate.id === id);
      return entity ? entitySlug(entity) : undefined;
    },
    roster: () => describeEntityRoster(entities),
  };
}

/**
 * Convenience for the routes that resolve exactly one token and hold nothing else. The gateway
 * uses the index directly, because it resolves an actor and its targets against one board read.
 */
export async function resolveSessionEntityId(sessionId: string, token: string): Promise<string> {
  return (await loadSessionEntityIndex(sessionId)).resolve(token);
}
