import { useEffect } from 'react';

import type { CharacterAction } from '@/contexts/character/types';
import type { Dispatch } from 'react';

import logger from '@/lib/logger';
import { characterLoaderService } from '@/services/character-loader';

/**
 * The one way the engine's state reaches the character in CharacterContext.
 *
 * The combat tracker is reconciled from the engine's state, but the header and sheet read
 * CharacterContext. Every `combat-state-updated` event refetches that snapshot so persisted HP and
 * spell slots stay aligned with the tracker. The event comes from the session socket and from
 * `refreshCombatState` (the pull after an End turn, and the read that ends a fight), so a hit
 * that arrives by either route lands in the header too (#2641).
 *
 * #130: story appliers (damage, items, XP) write character state out of combat, where no
 * combat_state_updated follows — the sheet showed the stale value until a hard reload.
 * The server publishes `character_state_updated` for those writes, which the session
 * socket forwards as `character-state-updated`; this hook refetches on that too.
 */
export function useCharacterRefreshOnCombatUpdate(
  characterId: string | null,
  userId: string | undefined,
  characterDispatch: Dispatch<CharacterAction>,
): void {
  useEffect(() => {
    if (!characterId) return;
    let cancelled = false;
    let refreshing = false;
    let refreshAgain = false;

    const refreshCharacter = async (): Promise<void> => {
      if (refreshing) {
        refreshAgain = true;
        return;
      }
      refreshing = true;
      do {
        refreshAgain = false;
        try {
          const refreshedCharacter = await characterLoaderService.loadCharacterWithSpells(
            characterId,
            userId,
          );
          if (!cancelled && refreshedCharacter) {
            characterDispatch({ type: 'SET_CHARACTER', payload: refreshedCharacter });
          }
        } catch (refreshError) {
          logger.warn('[GameContent] Could not refresh character after engine event', {
            characterId,
            error: refreshError,
          });
        }
      } while (refreshAgain && !cancelled);
      refreshing = false;
    };

    window.addEventListener('combat-state-updated', refreshCharacter);
    // #130: story appliers write character state out of combat; the server
    // publishes character_state_updated for those writes and the session
    // socket forwards it as this event.
    window.addEventListener('character-state-updated', refreshCharacter);
    return () => {
      cancelled = true;
      window.removeEventListener('combat-state-updated', refreshCharacter);
      window.removeEventListener('character-state-updated', refreshCharacter);
    };
  }, [characterId, characterDispatch, userId]);
}
