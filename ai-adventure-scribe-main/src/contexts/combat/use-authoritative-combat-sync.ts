import { useEffect } from 'react';


import { mapAuthoritativeCombat, type AuthoritativeCombatPayload } from './authoritative-combat-state';

import type { ReducerAction } from './combat-reducer';
import type { Dispatch } from 'react';

import { getAuthHeaders } from '@/services/auth/TokenService';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';

export function useAuthoritativeCombatSync(
  sessionId: string | undefined,
  dispatch: Dispatch<ReducerAction>,
): void {
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const apply = (combat: AuthoritativeCombatPayload) => {
      if (!cancelled) dispatch({ type: 'SET_ENCOUNTER', encounter: mapAuthoritativeCombat(combat) });
    };
    void fetch(`${apiBase}/v1/combat/sessions/${encodeURIComponent(sessionId)}/active`, {
      headers: getAuthHeaders(),
    }).then(async (response) => response.ok ? response.json() as Promise<{ combat: AuthoritativeCombatPayload }> : null)
      .then((payload) => { if (payload) apply(payload.combat); })
      .catch(() => undefined);
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ combat?: AuthoritativeCombatPayload }>).detail;
      if (detail.combat) apply(detail.combat);
    };
    window.addEventListener('combat-state-updated', listener);
    return () => { cancelled = true; window.removeEventListener('combat-state-updated', listener); };
  }, [dispatch, sessionId]);
}
