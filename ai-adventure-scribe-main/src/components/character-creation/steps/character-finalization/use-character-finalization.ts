import { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useToast } from '@/components/ui/use-toast';
import { useCampaign } from '@/contexts/CampaignContext';
import { useCharacter } from '@/contexts/CharacterContext';
import { llmApiClient, type ImageQuotaStatus } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { analytics } from '@/services/analytics';
import { characterDescriptionGenerator } from '@/services/character-description-generator';
import { characterImageGenerator } from '@/services/character-image-generator';
import { openRouterService } from '@/services/openrouter-service';
import { toCharacterPromptData } from '@/services/prompts/characterPrompts';
import { type Character } from '@/types/character';

export type GenerationStep = 'idle' | 'avatar' | 'sheet' | 'background';

/**
 * Custom hook for CharacterFinalization component logic
 * Extracted to improve maintainability and follow coding standards
 */
export const useCharacterFinalization = (): {
  state: {
    character: Character | null;
    isDirty: boolean;
    currentStep: number;
    isLoading: boolean;
    error: string | null;
  };
  isGeneratingDescription: boolean;
  isGeneratingAvatar: boolean;
  isGeneratingImage: boolean;
  selectedTheme: string;
  setSelectedTheme: (theme: string) => void;
  generationStep: GenerationStep;
  imageQuota: ImageQuotaStatus | null;
  handleDescriptionChange: (description: string) => void;
  handleGenerateDescription: () => Promise<void>;
  handleGenerateAvatar: () => Promise<void>;
  handleGenerateImage: () => Promise<void>;
} => {
  const { state, dispatch } = useCharacter();
  const { state: campaignState } = useCampaign();
  const { toast } = useToast();
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState('fantasy');
  const [generationStep, setGenerationStep] = useState<GenerationStep>('idle');
  const [searchParams] = useSearchParams();
  const [imageQuota, setImageQuota] = useState<ImageQuotaStatus | null>(null);

  const fetchImageQuota = useCallback(async () => {
    try {
      const quota = await llmApiClient.getImageQuotaStatus();
      setImageQuota(quota);
    } catch (error) {
      logger.error('Failed to fetch image quota:', error);
    }
  }, []);

  useEffect(() => {
    fetchImageQuota();
  }, [fetchImageQuota]);

  useEffect(() => {
    if (campaignState.campaign?.defaultArtStyle && !state.character?.theme) {
      setSelectedTheme(campaignState.campaign.defaultArtStyle);
    }
  }, [campaignState.campaign?.defaultArtStyle, state.character?.theme]);

  const isQuotaExceededError = useCallback((error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('402') || message.toLowerCase().includes('quota exceeded');
  }, []);

  const handleDescriptionChange = useCallback(
    (description: string): void => {
      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: { description },
      });
    },
    [dispatch],
  );

  const handleGenerateDescription = useCallback(async (): Promise<void> => {
    if (!state.character?.name?.trim()) {
      toast({
        title: 'Character Incomplete',
        description: 'Character name is required for description generation.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const campaignId = searchParams.get('campaign') || undefined;
      const artStyle = analytics.detectArtStyle({ characterTheme: state.character?.theme });
      analytics.aiRegenerateClicked('description', { campaignId, artStyle });
    } catch (_e) {
      // ignore analytics errors
    }

    setIsGeneratingDescription(true);
    try {
      const characterData = toCharacterPromptData(state.character);

      const enhancedDescription = await characterDescriptionGenerator.generateDescription(
        characterData,
        {
          enhanceExisting: Boolean(state.character.description?.trim()),
          includeBackstory: true,
          includePersonality: true,
          includeAppearance: true,
          tone: 'heroic',
        },
      );

      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: {
          description: enhancedDescription.description,
          appearance: enhancedDescription.appearance,
          personality_traits: enhancedDescription.personality_traits,
          backstory_elements: enhancedDescription.backstory_elements,
        },
      });

      toast({
        title: 'Description Generated',
        description:
          "Your character's description has been enhanced with AI using all your character choices!",
      });
    } catch (error) {
      logger.error('Failed to generate description:', error);
      toast({
        title: 'Generation Failed',
        description: 'Failed to generate character description. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsGeneratingDescription(false);
    }
  }, [state.character, searchParams, toast, dispatch]);

  const handleGenerateAvatar = useCallback(async (): Promise<void> => {
    if (!state.character?.name?.trim()) {
      toast({
        title: 'Character Incomplete',
        description: 'Character name is required for avatar generation.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const campaignId = searchParams.get('campaign') || undefined;
      const artStyle = analytics.detectArtStyle({ characterTheme: state.character?.theme });
      analytics.aiRegenerateClicked('avatar', { campaignId, artStyle });
    } catch (_e) {
      // ignore analytics errors
    }

    setIsGeneratingAvatar(true);
    setGenerationStep('avatar');
    try {
      const characterData = {
        ...toCharacterPromptData(state.character),
        theme: selectedTheme,
      };

      logger.info('Generating avatar with theme:', selectedTheme);

      const avatarBase64 = await characterImageGenerator.generateAvatarImage(characterData, {
        artStyle: 'fantasy-art',
        theme: selectedTheme,
      });

      const avatarUrl = await openRouterService.uploadImage(avatarBase64, { label: 'avatar' });

      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: {
          avatar_url: avatarUrl,
          theme: selectedTheme,
        },
      });

      toast({
        title: 'Avatar Generated',
        description: 'Your character avatar portrait has been created!',
      });

      fetchImageQuota();
      setGenerationStep('idle');
    } catch (error) {
      logger.error('Failed to generate avatar:', error);

      if (isQuotaExceededError(error)) {
        toast({
          title: 'Daily Image Limit Reached',
          description:
            "You've used all your image generations for today. Your limit resets at midnight UTC.",
          variant: 'destructive',
        });
        fetchImageQuota();
      } else {
        toast({
          title: 'Avatar Generation Failed',
          description: 'Failed to generate character avatar. Please try again.',
          variant: 'destructive',
        });
      }
      setGenerationStep('idle');
    } finally {
      setIsGeneratingAvatar(false);
    }
  }, [
    state.character,
    searchParams,
    selectedTheme,
    toast,
    dispatch,
    fetchImageQuota,
    isQuotaExceededError,
  ]);

  const handleGenerateImage = useCallback(async (): Promise<void> => {
    if (!state.character?.name?.trim()) {
      toast({
        title: 'Character Incomplete',
        description: 'Character name is required for image generation.',
        variant: 'destructive',
      });
      return;
    }

    try {
      const campaignId = searchParams.get('campaign') || undefined;
      const artStyle = analytics.detectArtStyle({ characterTheme: state.character?.theme });
      analytics.aiRegenerateClicked('design_sheet', { campaignId, artStyle });
    } catch (_e) {
      // ignore analytics errors
    }

    setIsGeneratingImage(true);
    setGenerationStep('sheet');
    try {
      const characterData = {
        ...toCharacterPromptData(state.character),
        theme: selectedTheme,
      };

      logger.info('Generating design sheet with theme:', selectedTheme);

      let avatarReference: string | undefined;
      if (state.character.avatar_url) {
        try {
          const response = await fetch(state.character.avatar_url);
          const blob = await response.blob();
          const reader = new FileReader();
          avatarReference = await new Promise<string>((resolve) => {
            reader.onloadend = () => {
              const base64 = reader.result as string;
              resolve(base64.split(',')[1]);
            };
            reader.readAsDataURL(blob);
          });
        } catch (error) {
          logger.warn('Could not fetch avatar for reference:', error);
        }
      }

      const imageUrl = await characterImageGenerator.generateCharacterImage(
        characterData,
        {
          style: 'character-sheet',
          artStyle: 'fantasy-art',
          theme: selectedTheme,
          storage: { label: 'design-sheet' },
        },
        avatarReference,
      );

      dispatch({
        type: 'UPDATE_CHARACTER',
        payload: {
          image_url: imageUrl,
          theme: selectedTheme,
        },
      });

      toast({
        title: 'Character Design Sheet Generated',
        description: `Your detailed character design sheet in ${selectedTheme} theme has been created${avatarReference ? ' using your avatar as reference' : ''}!`,
      });

      fetchImageQuota();
      setGenerationStep('idle');
    } catch (error) {
      logger.error('Failed to generate character design sheet:', error);

      if (isQuotaExceededError(error)) {
        toast({
          title: 'Daily Image Limit Reached',
          description:
            "You've used all your image generations for today. Your limit resets at midnight UTC.",
          variant: 'destructive',
        });
        fetchImageQuota();
      } else {
        toast({
          title: 'Design Sheet Generation Failed',
          description: 'Failed to generate character design sheet. Please try again.',
          variant: 'destructive',
        });
      }
      setGenerationStep('idle');
    } finally {
      setIsGeneratingImage(false);
    }
  }, [
    state.character,
    searchParams,
    selectedTheme,
    toast,
    dispatch,
    fetchImageQuota,
    isQuotaExceededError,
  ]);

  return useMemo(
    () => ({
      state,
      isGeneratingDescription,
      isGeneratingAvatar,
      isGeneratingImage,
      selectedTheme,
      setSelectedTheme,
      generationStep,
      imageQuota,
      handleDescriptionChange,
      handleGenerateDescription,
      handleGenerateAvatar,
      handleGenerateImage,
    }),
    [
      state,
      isGeneratingDescription,
      isGeneratingAvatar,
      isGeneratingImage,
      selectedTheme,
      generationStep,
      imageQuota,
      handleDescriptionChange,
      handleGenerateDescription,
      handleGenerateAvatar,
      handleGenerateImage,
    ],
  );
};
