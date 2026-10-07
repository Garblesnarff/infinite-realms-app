/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';

import { useCharacterRefreshOnCombatUpdate } from './use-character-refresh';

import type { Campaign as CampaignType } from '@/types/campaign';

import { useAuth } from '@/contexts/AuthContext';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import logger from '@/lib/logger';
import { characterLoaderService } from '@/services/character-loader';
import { userDataApi } from '@/services/user-data-api';
import { handleAsyncError } from '@/utils/error-handler';

export type LoadingPhase = 'initial' | 'data' | 'session' | 'greeting';

/** Why the game cannot open from this URL: no hero on the account, or no such adventure. */
export type MissingGameTarget = 'no-hero' | 'no-adventure';

interface UseGameDataResult {
  isLoading: boolean;
  loadingPhase: LoadingPhase;
  error: string | null;
  isDM: boolean;
  /** Set when the URL had no ?character and the campaign's hero was found. */
  resolvedCharacterId: string | null;
  missingTarget: MissingGameTarget | null;
}

function isNotFoundError(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status;
  return status === 404 || status === 403;
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
  const [resolvedCharacterId, setResolvedCharacterId] = useState<string | null>(null);
  const [missingTarget, setMissingTarget] = useState<MissingGameTarget | null>(null);

  // A link without ?character (bookmark, shared, trimmed): find the player's hero for the
  // campaign. One hero is used as is; with several, the hero of the newest session wins.
  useEffect(() => {
    setResolvedCharacterId(null);
    if (characterId) {
      setMissingTarget(null);
      return;
    }
    if (!campaignId) {
      setMissingTarget('no-adventure');
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setMissingTarget(null);
    setError(null);

    const findCharacter = async (): Promise<void> => {
      try {
        await userDataApi.getCampaign(campaignId);
      } catch (err) {
        if (cancelled) return;
        if (isNotFoundError(err)) {
          setMissingTarget('no-adventure');
        } else {
          setError('We could not load this adventure. Please try again.');
        }
        setIsLoading(false);
        return;
      }

      try {
        const characters = await userDataApi.listCharacters(campaignId);
        if (cancelled) return;
        if (characters.length === 0) {
          setMissingTarget('no-hero');
          setIsLoading(false);
          return;
        }
        let chosen = characters[0];
        if (characters.length > 1) {
          const sessions = await userDataApi
            .listSessions({ campaignId, limit: 20 })
            .catch(() => []);
          const lastPlayed = sessions.find((session) =>
            characters.some((character) => character.id === session.character_id),
          );
          if (lastPlayed) chosen = characters.find((c) => c.id === lastPlayed.character_id);
        }
        if (cancelled) return;
        setResolvedCharacterId(chosen.id);
      } catch (err) {
        if (cancelled) return;
        logger.error('[GameContent] Could not look up the hero for this adventure', {
          campaignId,
          err,
        });
        setError('We could not load your hero. Please try again.');
        setIsLoading(false);
      }
    };

    findCharacter();
    return () => {
      cancelled = true;
    };
  }, [characterId, campaignId]);

  useEffect(() => {
    const loadGameData = async (): Promise<void> => {
      // Without a character the lookup effect above decides what the player sees.
      if (!characterId || !campaignId) {
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

  useCharacterRefreshOnCombatUpdate(characterId, user?.id, characterDispatch);

  return { isLoading, loadingPhase, error, isDM, resolvedCharacterId, missingTarget };
}
