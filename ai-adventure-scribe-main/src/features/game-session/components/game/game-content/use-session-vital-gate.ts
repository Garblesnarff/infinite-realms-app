import { useEffect, useState } from 'react';

import logger from '@/lib/logger';
import { userDataApi, type SessionFallenState } from '@/services/user-data-api';

/**
 * #2517: the load gate for the game screen. The single truth for "dead" is
 * `character_stats.vital_state`, read in the session load payload. While it
 * is unknown the game (composer, sheet, tracker) must not render — run D2's
 * reload flashed a live composer over a dead character. A failed read fails
 * open to the game: the live triggers (advance `endedReason`,
 * PartyDefeatedError, the 409 refusal) still catch a death the gate missed.
 */
export type SessionVitalGate =
  | { status: 'unknown' }
  | { status: 'alive' }
  | { status: 'dead'; fallen: SessionFallenState };

export function useSessionVitalGate(sessionId: string | null | undefined): SessionVitalGate {
  const [gate, setGate] = useState<SessionVitalGate>({ status: 'unknown' });

  useEffect(() => {
    if (!sessionId) {
      setGate({ status: 'unknown' });
      return;
    }
    let cancelled = false;
    setGate({ status: 'unknown' });
    void (async () => {
      try {
        const fallen = await userDataApi.fetchSessionFallenState(sessionId);
        if (cancelled) return;
        setGate(fallen ? { status: 'dead', fallen } : { status: 'alive' });
      } catch (error) {
        if (cancelled) return;
        logger.warn('SESSION_VITAL_GATE_FAILED', { sessionId, error: String(error) });
        setGate({ status: 'alive' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return gate;
}
