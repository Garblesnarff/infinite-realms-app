import { useCallback, useEffect, useState } from 'react';

import logger from '@/lib/logger';
import {
  userDataApi,
  type SessionCompletionState,
  type SessionFallenState,
} from '@/services/user-data-api';

/**
 * #2517: the load gate for the game screen. The single truth for "dead" is
 * `character_stats.vital_state`, read in the session load payload. While it
 * is unknown the game (composer, sheet, tracker) must not render — run D2's
 * reload flashed a live composer over a dead character. A failed read does
 * not open the game: the player sees a retry state, because a dead hero must
 * never reach the live composer on a bad connection.
 *
 * #1020: the same gate restores the completion end state. The single truth
 * for "complete" is the session's `status` in the same load payload, gated
 * to one-shot campaigns — a completed multi-session campaign continues in a
 * new session and never reaches this screen. Death is checked first: a
 * character who fell is shown the fallen end state, never the completion.
 */
export type SessionVitalGate =
  | { status: 'unknown' }
  | { status: 'error'; retry: () => void }
  | { status: 'alive' }
  | { status: 'dead'; fallen: SessionFallenState }
  | { status: 'completed'; completion: SessionCompletionState };

export function useSessionVitalGate(sessionId: string | null | undefined): SessionVitalGate {
  const [gate, setGate] = useState<SessionVitalGate>({ status: 'unknown' });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

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
        if (fallen) {
          setGate({ status: 'dead', fallen });
          return;
        }
        const completion = await userDataApi.fetchSessionCompletionState(sessionId);
        if (cancelled) return;
        setGate(completion ? { status: 'completed', completion } : { status: 'alive' });
      } catch (error) {
        if (cancelled) return;
        logger.warn('SESSION_VITAL_GATE_FAILED', { sessionId, error: String(error) });
        setGate({ status: 'error', retry });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, attempt, retry]);

  return gate;
}
