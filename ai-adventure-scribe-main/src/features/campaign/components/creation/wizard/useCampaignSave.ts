import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { useToast } from '@/hooks/use-toast';
import logger from '@/lib/logger';
import { campaignImageGenerator } from '@/services/campaign-image-generator';
import { userDataApi } from '@/services/user-data-api';

interface CampaignSaveData {
  name?: string;
  background_image?: string | null;
  enhancementSelections?: unknown[];
  enhancementEffects?: Record<string, unknown>;
  setting_details?: unknown;
  [key: string]: unknown;
}

/**
 * Custom hook for handling campaign saving functionality
 * @returns Object containing save function and loading state
 */
export const useCampaignSave = () => {
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  /**
   * Saves campaign data to Supabase and generates background image
   * @param campaignData - The campaign data to save
   * @returns The saved campaign's ID if successful
   */
  const saveCampaign = async (campaignData: CampaignSaveData) => {
    setIsSaving(true);
    try {
      logger.info('Creating campaign and generating background image...');

      // First, save the campaign without the background image
      // Extract background_image and map camelCase to snake_case fields
      const {
        background_image: _background_image,
        enhancementSelections,
        enhancementEffects,
        ...campaignDataWithoutImage
      } = campaignData;

      const data = await userDataApi.createCampaign({
        ...campaignDataWithoutImage,
        status: 'active',
        setting_details: campaignData.setting_details || {},
        enhancement_selections: enhancementSelections || [],
        enhancement_effects: enhancementEffects || {},
      });

      if (!data) {
        throw new Error('No data returned from insert');
      }

      const campaignId = data.id;

      // Generate background image asynchronously
      // Don't block campaign creation on image generation
      generateBackgroundImage(campaignId, campaignData);

      return campaignId;
    } catch (error) {
      logger.error('Error in saveCampaign:', error);
      throw error;
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * Generate background image for the campaign
   * This runs asynchronously after campaign creation
   */
  const generateBackgroundImage = async (campaignId: string, campaignData: CampaignSaveData) => {
    try {
      logger.info(`Generating background image for campaign ${campaignId}`);

      // Generate the image
      const imageUrl = await campaignImageGenerator.generateCampaignImage(
        { ...campaignData, name: campaignData.name || 'Untitled Campaign' },
        {
          storage: {
            entityType: 'campaign',
            entityId: campaignId,
            label: 'background',
          },
        },
      );

      // Update the campaign with the generated image URL
      try {
        await userDataApi.updateCampaign(campaignId, { background_image: imageUrl });
        logger.info(`Successfully generated and saved background image for campaign ${campaignId}`);

        // Invalidate all campaign-related queries to refresh with the new image
        queryClient.invalidateQueries({ queryKey: ['campaigns'] });
        queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
        queryClient.invalidateQueries({ queryKey: ['gallery', 'campaign', campaignId] });

        // Show success notification
        toast({
          title: 'Campaign Image Generated',
          description: 'Your campaign background image has been created successfully.',
        });
      } catch (error) {
        logger.error('Error updating campaign with background image:', error);
      }
    } catch (error) {
      logger.error(`Failed to generate background image for campaign ${campaignId}:`, error);

      // Show user-friendly error notification
      toast({
        title: 'Image Generation Failed',
        description:
          "We couldn't generate a background image for your campaign, but your campaign was created successfully. You can add an image later.",
        variant: 'destructive',
      });

      // Don't throw error - campaign creation should still succeed even if image generation fails
    }
  };

  return { saveCampaign, isSaving };
};
