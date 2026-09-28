/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';

import type { Campaign as CampaignType } from '@/types/campaign';

import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import logger from '@/lib/logger';
import { characterLoaderService } from '@/services/character-loader';
import { userDataApi } from '@/services/user-data-api';
import { handleAsyncError } from '@/utils/error-handler';

export type LoadingPhase = 'initial' | 'data' | 'session' | 'greeting';

interface UseGameDataResult {
  isLoading: boolean;
  loadingPhase: LoadingPhase;
  error: string | null;
  isDM: boolean;
}

/**
 * Hook that loads character and campaign data for a game session.
 * Dispatches loaded data into CharacterContext and CampaignContext.
 */
export function useGameData(
  characterId: string | null,
  campaignId: string | undefined,
): UseGameDataResult {
  const { dispatch: characterDispatch } = useCharacter();
  const { dispatch: campaignDispatch } = useCampaign();
  const { user } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>('initial');
  const [error, setError] = useState<string | null>(null);
  const [isDM, setIsDM] = useState(false);

  useEffect(() => {
    const loadGameData = async (): Promise<void> => {
      if (!characterId || !campaignId) {
        setError('Character ID or Campaign ID is missing from URL parameters.');
        setIsLoading(false);
        setLoadingPhase('initial');
        return;
      }

      setIsLoading(true);
      setLoadingPhase('data');
      setError(null);

      try {
        logger.info(`[GameContent] Loading character ${characterId} and campaign ${campaignId}`);

        // ⚡ Bolt: Parallelize character and campaign data fetching to reduce total loading latency.
        // This ensures the application starts faster by not waiting for each fetch sequentially.
        const [loadedCharacter, campaignData] = await Promise.all([
          characterLoaderService.loadCharacterWithSpells(characterId, user?.id),
          userDataApi.getCampaign(campaignId),
        ]);

        if (!loadedCharacter) {
          throw new Error('Character not found or failed to load.');
        }

        if (!campaignData) {
          throw new Error('Campaign not found.');
        }

        logger.info(`[GameContent] Successfully loaded character and campaign:`, {
          characterName: loadedCharacter.name,
          campaignName: campaignData.name,
          cantrips: loadedCharacter.cantrips?.length || 0,
          knownSpells: loadedCharacter.knownSpells?.length || 0,
        });

        characterDispatch({ type: 'SET_CHARACTER', payload: loadedCharacter });
        campaignDispatch({
          type: 'UPDATE_CAMPAIGN',
          payload: campaignData as unknown as Partial<CampaignType>,
        });

        setLoadingPhase('session');

        // Derive DM role: env override or campaign owner
        try {
          const envVal = String(import.meta.env.VITE_FORCE_DM || '');
          const forceDM = ['true', '1', 'yes', 'on'].includes(envVal.toLowerCase());
          // Campaign type doesn't declare user_id even though CAMPAIGN_SELECT_COLUMNS
          // selects it (the query result genuinely has it) - cast to the real queried shape.
          const ownerId = (campaignData as { user_id?: string | null } | null)?.user_id;
          setIsDM(Boolean(forceDM || (user?.id && ownerId && user.id === ownerId)));
        } catch {
          setIsDM(false);
        }
      } catch (err: any) {
        const errorMessage = err.message || 'Failed to load game data';
        setError(errorMessage);
        handleAsyncError(err, {
          userMessage: 'Failed to load game data',
          context: {
            location: 'GameContent.loadGameData',
            campaignId,
            characterId,
          },
        });
      } finally {
        setIsLoading(false);
        setLoadingPhase('greeting');
      }
    };

    loadGameData();
  }, [characterId, campaignId, characterDispatch, campaignDispatch, user?.id]);

  // The combat tracker is reconciled from the engine's broadcast, but the character sheet reads
  // CharacterContext. Refresh that snapshot on each engine state event so persisted HP and spell
  // slots stay aligned with the tracker.
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
            user?.id,
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
    return () => {
      cancelled = true;
      window.removeEventListener('combat-state-updated', refreshCharacter);
    };
  }, [characterId, characterDispatch, user?.id]);

  return { isLoading, loadingPhase, error, isDM };
}
