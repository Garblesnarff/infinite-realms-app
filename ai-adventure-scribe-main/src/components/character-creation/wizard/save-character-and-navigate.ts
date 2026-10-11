/**
 * Final-step character save + post-save navigation, split out of
 * WizardContent.tsx's handleNext.
 */

import type { NavigateFunction } from 'react-router-dom';

import { type useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { analytics } from '@/services/analytics';
import { type Character } from '@/types/character';

interface SaveCharacterAndNavigateParams {
  character: Character;
  saveCharacter: (character: Character) => Promise<Character | null>;
  navigate: NavigateFunction;
  searchParams: URLSearchParams;
  toast: ReturnType<typeof useToast>['toast'];
  /** Called once the character is saved with an id (e.g. to clear a local draft). */
  onSaved?: () => void;
}

export async function saveCharacterAndNavigate({
  character,
  saveCharacter,
  navigate,
  searchParams,
  toast,
  onSaved,
}: SaveCharacterAndNavigateParams): Promise<void> {
  try {
    logger.info('Calling saveCharacter...');
    const savedCharacter = await saveCharacter(character);
    logger.debug('Save result:', savedCharacter);

    if (!savedCharacter) {
      logger.warn('Character save returned null; staying on wizard step for user correction');
      return;
    }

    if (savedCharacter.id) {
      logger.info('Character saved successfully, navigating to /characters');
      onSaved?.();
      try {
        const campaignId = searchParams.get('campaign') || undefined;
        const artStyle = analytics.detectArtStyle({
          characterTheme: character.theme,
          campaignGenre: undefined,
        });
        analytics.characterCreationCompleted({ campaignId, artStyle });
      } catch (_e) {
        // ignore analytics errors
      }
      toast({
        title: 'Success!',
        description:
          'Character created successfully! Background image generation may continue in the background.',
      });
      const targetCampaignId = savedCharacter.campaign_id || character.campaign_id;
      const starterCampaignId = searchParams.get('starterCampaign');

      // If this is a starter campaign, navigate directly to the game
      if (starterCampaignId && targetCampaignId && savedCharacter.id) {
        navigate(
          `/app/game/${targetCampaignId}?character=${savedCharacter.id}&starterCampaign=${starterCampaignId}`,
        );
      } else if (targetCampaignId) {
        navigate(`/app/campaigns/${targetCampaignId}/characters`);
      } else {
        navigate('/app/characters');
      }
    } else {
      logger.error('Save succeeded but no ID returned');
      toast({
        title: 'Save Warning',
        description:
          'Character data may be incomplete. Please review your characters list and edit if needed.',
        variant: 'destructive',
      });
    }
  } catch (error) {
    logger.error('Error saving character:', error);

    // Enhanced error message with recovery suggestions
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const isNetworkError =
      errorMessage.toLowerCase().includes('network') ||
      errorMessage.toLowerCase().includes('fetch') ||
      errorMessage.toLowerCase().includes('connection');

    toast({
      title: 'Save Error',
      description: isNetworkError
        ? `Network connection issue: ${errorMessage}. Please check your internet connection and try again.`
        : `Failed to save character: ${errorMessage}. Please try again or contact support if the issue persists.`,
      variant: 'destructive',
    });
  }
}
