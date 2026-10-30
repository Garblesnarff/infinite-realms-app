import { useEffect, useState } from 'react';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * Map of session id to session number for one campaign, so a memory can say
 * "Session 2 · 3 days ago". Empty until loaded, or when there is no campaign id.
 */
export const useCampaignSessionNumbers = (
  campaignId: string | null | undefined,
): Map<string, number> => {
  const [numbers, setNumbers] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    if (!campaignId) {
      setNumbers(new Map());
      return;
    }
    let cancelled = false;
    userDataApi
      .listSessions({ campaignId })
      .then((rows) => {
        if (cancelled) return;
        setNumbers(
          new Map(
            rows
              .filter((row) => typeof row.session_number === 'number')
              .map((row) => [row.id, row.session_number as number]),
          ),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) logger.warn('[memory] Failed to load session numbers', { error });
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId]);

  return numbers;
};
