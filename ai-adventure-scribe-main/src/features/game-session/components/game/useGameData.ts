/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';

import type { Campaign as CampaignType } from '@/types/campaign';

import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { characterLoaderService } from '@/services/character-loader';
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
        const [loadedCharacter, campaignResult] = await Promise.all([
          characterLoaderService.loadCharacterWithSpells(characterId, user?.id),
          supabase
            .from('campaigns')
            .select(
              'id, name, description, genre, difficulty_level, campaign_length, tone, status, art_style, user_id, setting_details, thematic_elements, style_config, rules_config',
            )
            .eq('id', campaignId)
            .single(),
        ]);

        if (!loadedCharacter) {
          throw new Error('Character not found or failed to load.');
        }

        const { data: campaignData, error: campaignError } = campaignResult;

        if (campaignError) {
          throw new Error(`Failed to load campaign: ${campaignError.message}`);
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
          const envVal = String(import.meta?.env?.VITE_FORCE_DM || '');
          const forceDM = ['true', '1', 'yes', 'on'].includes(envVal.toLowerCase());
          const ownerId = (campaignData as any)?.user_id;
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

  return { isLoading, loadingPhase, error, isDM };
}
