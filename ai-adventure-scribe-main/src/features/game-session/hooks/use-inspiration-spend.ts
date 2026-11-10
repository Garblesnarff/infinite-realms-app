import { useCallback } from 'react';

import { useCharacter } from '@/contexts/CharacterContext';
import { useInspirationArmed } from '@/features/game-session/contexts/inspiration-armed-context';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * #1414: the one spend path for Inspiration. The coin and the legal-action chip arm the
 * advantage; the roll that consumes it calls `spendInspiration`, which clears the flag
 * server-side and mirrors the change into the local character state so the coin goes grey
 * at once. Returns false (never throws) when the flag was already spent or the spend
 * failed — the caller rolls without advantage instead of losing the roll. Disarming is
 * the caller's job: the roll request keeps the armed state through its animation and
 * disarms at completion. The combat action bar never spends — the popup is the single
 * spend site (round 2, B2), so a typed number never spends the flag either; the chip
 * disarms when tapped while armed, and the popup disarms at completion or on a failed spend.
 */
export function useInspirationSpend() {
  const { armed, arm, disarm } = useInspirationArmed();
  // #1414 round 4 (CI fix): the strict hook, not useOptionalCharacter — the optional
  // export is newer and many CharacterContext mocks do not provide it, which broke
  // renders of the combat menu (use-ai-response.combat-options.test.tsx: 17/17 in
  // CI). The strict hook is the long-standing export every mock provides, and the
  // only caller (useDiceRollRequest) already requires a CharacterProvider — it calls
  // useCharacter itself — so this adds no new provider requirement.
  const characterContext = useCharacter();

  const spendInspiration = useCallback(
    async (characterId: string): Promise<boolean> => {
      try {
        await userDataApi.spendInspiration(characterId);
      } catch (error) {
        logger.warn('Inspiration spend failed; rolling without advantage', error);
        return false;
      }
      const character = characterContext?.state.character;
      if (character && character.id === characterId) {
        characterContext.dispatch({
          type: 'UPDATE_CHARACTER',
          payload: { ...character, inspiration: false },
        });
      }
      return true;
    },
    [characterContext],
  );

  return { armed, arm, disarm, spendInspiration };
}
