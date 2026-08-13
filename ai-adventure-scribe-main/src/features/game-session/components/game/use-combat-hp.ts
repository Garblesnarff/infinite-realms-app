import { useEffect, useState } from 'react';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

export interface CombatHP {
  current_hp: number;
  max_hp: number;
  temp_hp: number;
  is_conscious: boolean;
}

const COMBAT_STATUS_POLL_MS = 5_000;

/**
 * Fetches a character's active-combat HP status through the authenticated server route.
 *
 * This used to query combat tables and subscribe to Postgres changes with the browser anon
 * key. Combat status is now polled from server-bun so the table revoke can happen after the
 * code deploy without leaving a client-side realtime dependency behind.
 */
export function useCombatHP(characterId: string | undefined): CombatHP | null {
  const [combatHP, setCombatHP] = useState<CombatHP | null>(null);

  useEffect(() => {
    if (!characterId) {
      setCombatHP(null);
      return;
    }

    let cancelled = false;

    const fetchCombatStatus = async (): Promise<void> => {
      try {
        const status = await userDataApi.getCharacterCombatStatus(characterId);
        if (cancelled) return;
        setCombatHP(
          status
            ? {
                current_hp: status.current_hp,
                max_hp: status.max_hp,
                temp_hp: status.temp_hp,
                is_conscious: status.is_conscious,
              }
            : null,
        );
      } catch (error) {
        if (!cancelled) {
          setCombatHP(null);
          logger.error('[useCombatHP] Failed to fetch combat status:', error);
        }
      }
    };

    void fetchCombatStatus();
    const interval = setInterval(() => void fetchCombatStatus(), COMBAT_STATUS_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [characterId]);

  return combatHP;
}
