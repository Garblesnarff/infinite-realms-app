/**
 * Browser combat state follows the server, not the client's dispatch history.
 *
 * The headless playtest client sets its combat flag by re-reading the board every turn
 * (`this.combatActive = Boolean(await this.getMap())`). Nineteen adversarial runs went green on
 * that pattern while the browser accumulated transitions instead — and a browser that only
 * listens to its own actions desyncs the moment the server ends a fight on its own, which
 * `endCombatIfResolved` does on any killing blow.
 *
 * So this module offers one read (`GET /v1/combat/sessions/:id/active`) and one reconciliation,
 * used three ways: once on mount, on every `combat_state_updated` broadcast, and on demand at
 * the top of a DM turn via the `refreshCombatState` callback this hook returns.
 */
import { useCallback, useEffect } from 'react';

import {
  mapAuthoritativeCombat,
  type AuthoritativeCombatPayload,
} from './authoritative-combat-state';

import type { ReducerAction } from './combat-reducer';
import type { CombatEncounter } from '@/types/combat';
import type { Dispatch } from 'react';

import { logServerRequestId } from '@/infrastructure/api/request-id-log';
import { getAuthHeaders } from '@/services/auth/TokenService';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';

/**
 * A read of server combat truth. `unknown` is deliberately distinct from `none`: a request that
 * never reached the server says nothing about whether a fight is running, and treating it as
 * "no combat" would end fights on a flaky connection.
 */
export type AuthoritativeCombatRead =
  | { state: 'combat'; combat: AuthoritativeCombatPayload }
  | { state: 'none' }
  | { state: 'unknown' };

export async function readAuthoritativeCombat(
  sessionId: string,
  signal?: AbortSignal,
): Promise<AuthoritativeCombatRead> {
  try {
    const response = await fetch(
      `${apiBase}/v1/combat/sessions/${encodeURIComponent(sessionId)}/active`,
      { headers: getAuthHeaders(), ...(signal ? { signal } : {}) },
    );
    logServerRequestId('/v1/combat', response);
    if (response.status === 404) return { state: 'none' };
    if (!response.ok) return { state: 'unknown' };
    const payload = (await response.json()) as { combat?: AuthoritativeCombatPayload };
    return payload.combat ? { state: 'combat', combat: payload.combat } : { state: 'none' };
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { name?: unknown }).name === 'AbortError'
    ) {
      throw error;
    }
    return { state: 'unknown' };
  }
}

/**
 * Folds a read into combat state and returns the encounter that is live afterwards.
 *
 * `current` is the encounter the reducer holds right now. It matters for exactly one case: the
 * manual combat button mints a client-side encounter the server has never been told about, and
 * server silence must not delete it.
 */
export function applyAuthoritativeCombat(
  read: AuthoritativeCombatRead,
  dispatch: Dispatch<ReducerAction>,
  current: CombatEncounter | null,
): CombatEncounter | null {
  if (read.state === 'unknown') return current;
  if (read.state === 'none') {
    if (current?.origin !== 'server') return current;
    dispatch({ type: 'END_COMBAT' });
    return null;
  }
  const encounter = mapAuthoritativeCombat(read.combat);
  // A concluded encounter is cleared rather than kept at `phase: 'conclusion'`, so the finished
  // fight's id, round and roster stop being handed to the DM on the turns that follow it.
  if (encounter.phase !== 'active') {
    if (current) dispatch({ type: 'END_COMBAT' });
    return null;
  }
  dispatch({ type: 'SET_ENCOUNTER', encounter });
  return encounter;
}

/**
 * Whether a pull moved any character's hit points, or ended the fight that held them. A fight that
 * ends in the same read as its last hit never shows that hit in a participant, so the end itself
 * counts.
 */
function hitPointsMoved(before: CombatEncounter | null, after: CombatEncounter | null): boolean {
  if (before && !after) return true;
  if (!after) return false;
  return after.participants.some((participant) => {
    if (!participant.characterId) return false;
    const previous = before?.participants.find((candidate) => candidate.id === participant.id);
    return previous?.currentHitPoints !== participant.currentHitPoints;
  });
}

export function useAuthoritativeCombatSync(
  sessionId: string | undefined,
  dispatch: Dispatch<ReducerAction>,
  getEncounter: () => CombatEncounter | null,
): (signal?: AbortSignal) => Promise<CombatEncounter | null> {
  const refreshCombatState = useCallback(
    async (signal?: AbortSignal): Promise<CombatEncounter | null> => {
      if (!sessionId) return getEncounter();
      const before = getEncounter();
      const read = await readAuthoritativeCombat(sessionId, signal);
      const encounter = applyAuthoritativeCombat(read, dispatch, before);
      // A pull changed a character's hit points, or ended the fight, without the socket's event.
      // The header reads the character, not the participant, so it is told the way the socket
      // tells it (#2641). The event carries no `combat`, so the listener below ignores it.
      if (read.state !== 'unknown' && hitPointsMoved(before, encounter)) {
        window.dispatchEvent(new CustomEvent('combat-state-updated'));
      }
      return encounter;
    },
    [dispatch, getEncounter, sessionId],
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const apply = (read: AuthoritativeCombatRead): void => {
      if (!cancelled) applyAuthoritativeCombat(read, dispatch, getEncounter());
    };
    void readAuthoritativeCombat(sessionId).then(apply);
    const listener = (event: Event): void => {
      const detail = (event as CustomEvent<{ combat?: AuthoritativeCombatPayload }>).detail;
      if (detail?.combat) apply({ state: 'combat', combat: detail.combat });
    };
    window.addEventListener('combat-state-updated', listener);
    return () => {
      cancelled = true;
      window.removeEventListener('combat-state-updated', listener);
    };
  }, [dispatch, getEncounter, sessionId]);

  return refreshCombatState;
}
