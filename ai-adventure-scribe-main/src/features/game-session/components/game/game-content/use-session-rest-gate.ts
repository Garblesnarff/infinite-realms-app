import { useCallback, useEffect, useState } from 'react';

import type { CharacterAction } from '@/contexts/character/types';
import type { Character } from '@/types/character';
import type { Dispatch } from 'react';

import logger from '@/lib/logger';
import { characterLoaderService } from '@/services/character-loader';
import { restApi } from '@/services/rest-api';
import { getCharacterSheetHitPoints } from '@/utils/character/character-sheet-hit-points';


/**
 * #1239 item 1: the session-start "Rest first?" gate. Inside one adventure
 * HP carries between sessions (#1071 decision), so a continuation session
 * that starts with the hero below max HP asks before the game renders —
 * before the greeting fires — whether to take a long rest first or continue
 * as they are. The rest is the existing long-rest route; the hero is then
 * reloaded from the server, the same producer the game load uses, so the
 * sheet, header and greeting all see the rested state.
 *
 * The gate shows only for a fresh continuation: session_number above 1 (a
 * first session is a new adventure — item 2 rests it at join instead) and
 * turn_count 0 (the greeting's own fresh-session signal). A reload of a
 * session already in play never prompts: the choice is remembered per
 * session in sessionStorage, following the combat-end-facts precedent in
 * use-ai-response.ts. A failed read fails open to the game — the prompt
 * never blocks play on missing HP. A hero at 0 HP never prompts either:
 * the server refuses a long rest while dying or below 1 HP
 * (RestService.assertRestAllowed), so the prompt could only ever show them
 * the error state; dying heroes recover in fiction, not at session start.
 */
export interface SessionRestGateSession {
  session_number?: number | null;
  turn_count?: number | null;
}

const resolutionKey = (sessionId: string): string => `ir:rest-first-resolved:${sessionId}`;

function isResolved(sessionId: string): boolean {
  try {
    return window.sessionStorage.getItem(resolutionKey(sessionId)) === '1';
  } catch {
    return false;
  }
}

function markResolved(sessionId: string): void {
  try {
    window.sessionStorage.setItem(resolutionKey(sessionId), '1');
  } catch {
    // Storage unavailable: the prompt may show again on reload. Harmless.
  }
}

export interface SessionRestGate {
  showPrompt: boolean;
  resting: boolean;
  restError: string | null;
  currentHp: number | null;
  maxHp: number | null;
  restFirst: () => void;
  continueAsIs: () => void;
}

export function useSessionRestGate({
  sessionId,
  session,
  character,
  dispatch,
}: {
  sessionId: string | null | undefined;
  session: SessionRestGateSession | null | undefined;
  character: Character | null | undefined;
  dispatch: Dispatch<CharacterAction>;
}): SessionRestGate {
  const [dismissed, setDismissed] = useState(false);
  const [resting, setResting] = useState(false);
  const [restError, setRestError] = useState<string | null>(null);

  useEffect(() => {
    setDismissed(false);
    setRestError(null);
  }, [sessionId]);

  const { current, maximum } = character
    ? getCharacterSheetHitPoints(character)
    : { current: null, maximum: null };
  const isContinuation = (session?.session_number ?? 1) > 1;
  const isFresh = (session?.turn_count ?? 0) === 0;
  const belowMax =
    current !== null && maximum !== null && current >= 1 && current < maximum;
  const showPrompt = Boolean(
    sessionId && isContinuation && isFresh && belowMax && !dismissed && !isResolved(sessionId),
  );

  const restFirst = useCallback(() => {
    if (!character?.id || !sessionId || resting) return;
    const characterId = character.id;
    setResting(true);
    setRestError(null);
    void (async () => {
      try {
        await restApi.longRest(characterId);
        const refreshed =
          await characterLoaderService.loadCharacterWithSpells(characterId);
        if (!refreshed) {
          // The loader returns null on any load failure — that is its real
          // failure signal, not the catch below. The rest already applied
          // server-side, so keep the prompt open with the error instead of
          // dismissing into a session of stale pre-rest HP: retrying
          // re-rests (a no-op at full HP) and reloads, and continuing stays
          // available.
          logger.warn('[SessionRestGate] Character reload after rest returned nothing', {
            characterId,
          });
          setRestError(
            'your hero could not be reloaded after the rest (the rest itself was saved) — try again or continue as you are',
          );
          return;
        }
        dispatch({ type: 'SET_CHARACTER', payload: refreshed });
        markResolved(sessionId);
        setDismissed(true);
      } catch (error) {
        setRestError(error instanceof Error ? error.message : 'Rest failed');
      } finally {
        setResting(false);
      }
    })();
  }, [character?.id, sessionId, resting, dispatch]);

  const continueAsIs = useCallback(() => {
    if (!sessionId) return;
    markResolved(sessionId);
    setDismissed(true);
  }, [sessionId]);

  return {
    showPrompt,
    resting,
    restError,
    currentHp: current,
    maxHp: maximum,
    restFirst,
    continueAsIs,
  };
}
