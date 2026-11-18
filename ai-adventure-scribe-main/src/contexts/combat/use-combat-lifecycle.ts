/**
 * Combat lifecycle callbacks: ending the local encounter and advancing the turn.
 * Server-backed combat state is reconciled through use-authoritative-combat-sync.
 */

import { useCallback } from 'react';

import type { ReducerAction } from './combat-reducer';

type Dispatch = (action: ReducerAction) => void;

interface UseCombatLifecycleArgs {
  dispatch: Dispatch;
}

interface UseCombatLifecycleReturn {
  endCombat: () => Promise<void>;
  nextTurn: () => Promise<void>;
}

export function useCombatLifecycle({ dispatch }: UseCombatLifecycleArgs): UseCombatLifecycleReturn {
  const endCombat = useCallback(async () => {
    dispatch({ type: 'END_COMBAT' });
  }, [dispatch]);

  const nextTurn = useCallback(async () => {
    dispatch({ type: 'NEXT_TURN' });
  }, [dispatch]);

  return { endCombat, nextTurn };
}
