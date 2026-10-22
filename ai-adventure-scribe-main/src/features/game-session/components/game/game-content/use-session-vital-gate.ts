import { useEffect, useState } from 'react';

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
 * reload flashed a live composer over a dead character. A failed read fails
 * open to the game: the live triggers (advance `endedReason`,
 * PartyDefeatedError, the 409 refusal) still catch a death the gate missed.
 *
 * #1020: the same gate restores the completion end state. The single truth
 * for "complete" is the session's `status` in the same load payload, gated
 * to one-shot campaigns — a completed multi-session campaign continues in a
 * new session and never reaches this screen. Death is checked first: a
 * character who fell is shown the fallen end state, never the completion.
 */
export type SessionVitalGate =
  | { status: 'unknown' }
  | { status: 'alive' }
  | { status: 'dead'; fallen: SessionFallenState }
  | { status: 'completed'; completion: SessionCompletionState };

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
        setGate({ status: 'alive' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return gate;
}
