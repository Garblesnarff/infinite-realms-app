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
 * #130: Story damage and item grants are applied server-side during the DM turn
 * (applyStoryDamageOnce, applyStoryItemsOnce) with no combat event. The
 * `character-state-updated` event covers those non-combat state changes: the
 * server sends `character_updated` on the session socket, `use-session-story-socket`
 * dispatches this window event, and the same refetch runs.
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
    // #130: non-combat state changes (story damage, item grants) use the same refetch.
    window.addEventListener('character-state-updated', refreshCharacter);
    return () => {
      cancelled = true;
      window.removeEventListener('combat-state-updated', refreshCharacter);
      window.removeEventListener('character-state-updated', refreshCharacter);
    };
  }, [characterId, characterDispatch, userId]);
}
