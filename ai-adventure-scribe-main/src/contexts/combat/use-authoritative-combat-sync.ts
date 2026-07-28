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

export async function readAuthoritativeCombat(sessionId: string): Promise<AuthoritativeCombatRead> {
  try {
    const response = await fetch(
      `${apiBase}/v1/combat/sessions/${encodeURIComponent(sessionId)}/active`,
      { headers: getAuthHeaders() },
    );
    if (response.status === 404) return { state: 'none' };
    if (!response.ok) return { state: 'unknown' };
    const payload = (await response.json()) as { combat?: AuthoritativeCombatPayload };
    return payload.combat ? { state: 'combat', combat: payload.combat } : { state: 'none' };
  } catch {
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

export function useAuthoritativeCombatSync(
  sessionId: string | undefined,
  dispatch: Dispatch<ReducerAction>,
  getEncounter: () => CombatEncounter | null,
): () => Promise<CombatEncounter | null> {
  const refreshCombatState = useCallback(async (): Promise<CombatEncounter | null> => {
    if (!sessionId) return getEncounter();
    return applyAuthoritativeCombat(
      await readAuthoritativeCombat(sessionId),
      dispatch,
      getEncounter(),
    );
  }, [dispatch, getEncounter, sessionId]);

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
