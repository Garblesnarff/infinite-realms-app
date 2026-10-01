import { useCallback, useSyncExternalStore } from 'react';

import { useOptionalCampaign } from '@/contexts/CampaignContext';

/** `on` or `off`. Absent means the player never chose, so the campaign's difficulty decides. */
const STORAGE_KEY = 'ui:showTargetNumbers:v1';

const listeners = new Set<() => void>();

function readChoice(): boolean | null {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'on' ? true : stored === 'off' ? false : null;
  } catch {
    return null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * Easy and any difficulty with "medium" in its name show a target's AC and a save's DC; Hard and
 * Deadly do not (#2393, Rob 2026-10-01). A difficulty that is none of these shows them.
 */
export function showTargetNumbersByDefault(difficulty: string | null | undefined): boolean {
  const name = difficulty?.trim().toLowerCase() ?? '';
  if (name.includes('medium')) return true;
  return !name.includes('hard') && !name.includes('deadly');
}

/**
 * The player's "Show target numbers" setting. The player's own choice wins; until they make one,
 * the campaign's difficulty sets it. The choice is shared by every card and the toggle on screen.
 */
export function useShowTargetNumbers(): {
  showTargetNumbers: boolean;
  setShowTargetNumbers: (show: boolean) => void;
} {
  const choice = useSyncExternalStore(subscribe, readChoice, () => null);
  const difficulty = useOptionalCampaign()?.state.campaign?.difficulty_level;
  const setShowTargetNumbers = useCallback((show: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, show ? 'on' : 'off');
    } catch {
      // Storage is blocked: the setting stays as it was.
    }
    listeners.forEach((listener) => listener());
  }, []);
  return {
    showTargetNumbers: choice ?? showTargetNumbersByDefault(difficulty),
    setShowTargetNumbers,
  };
}
