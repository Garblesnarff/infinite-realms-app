import { useCallback, useSyncExternalStore } from 'react';

import { showTargetNumbersByDefault } from '../../../../shared/show-target-numbers';

import { useOptionalCampaign } from '@/contexts/CampaignContext';
import { userDataApi } from '@/services/user-data-api';

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
 * The player's "Show target numbers" setting. The player's own choice wins. Until they make one,
 * `rules_config.show_target_numbers` wins when the open campaign has it, and otherwise the
 * campaign's difficulty sets it via `showTargetNumbersByDefault`. The header button and the
 * settings sheet share this setter. A choice also patches the open campaign's rules.
 */
export function useShowTargetNumbers(): {
  showTargetNumbers: boolean;
  setShowTargetNumbers: (show: boolean) => void;
} {
  const choice = useSyncExternalStore(subscribe, readChoice, () => null);
  const campaignState = useOptionalCampaign();
  const campaign = campaignState?.state.campaign;
  const difficulty = campaign?.difficulty_level;
  const rulesFlag = campaign?.rules_config?.show_target_numbers;
  const fromRules = typeof rulesFlag === 'boolean' ? rulesFlag : null;

  const setShowTargetNumbers = useCallback(
    (show: boolean) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, show ? 'on' : 'off');
      } catch {
        // Storage is blocked: the setting stays as it was.
      }
      listeners.forEach((listener) => listener());
      const id = campaign?.id;
      if (!id) return;
      const rules = { ...(campaign.rules_config ?? {}), show_target_numbers: show };
      if (typeof campaignState?.dispatch === 'function') {
        campaignState.dispatch({ type: 'UPDATE_CAMPAIGN', payload: { rules_config: rules } });
      }
      void userDataApi.updateCampaign(id, { rules_config: rules }).catch(() => undefined);
    },
    [campaign, campaignState],
  );

  return {
    showTargetNumbers: choice ?? fromRules ?? showTargetNumbersByDefault(difficulty),
    setShowTargetNumbers,
  };
}
