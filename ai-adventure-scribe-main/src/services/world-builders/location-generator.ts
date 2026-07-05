import { buildLocationPrompt, calculateNarrativeWeight } from './location-prompts';
import { WorldBuildingAnalyzer } from './world-building-analyzer';

import type { LocationRequest, GeneratedLocation } from './location-types';

import { llmApiClient } from '@/infrastructure/api';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

export class LocationGenerator {
  /**
   * Generate a detailed location using AI
   */
  static async generateLocation(request: LocationRequest): Promise<GeneratedLocation> {
    try {
      const prompt = buildLocationPrompt(request);

      const text = await llmApiClient.generateText({
        prompt,
        temperature: 0.9,
        maxTokens: 4096,
      });

      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in location generation response');
      }

      try {
        const locationData = JSON.parse(jsonMatch[0]);

        // Add metadata
        const location: GeneratedLocation = {
          ...locationData,
          id: undefined, // Will be set when saved
          metadata: {
            createdAt: new Date(),
            campaignId: request.context.campaignId,
            sessionId: request.context.sessionId,
            narrativeWeight: calculateNarrativeWeight(locationData, request),
            storyArc: request.context.currentStory,
          },
        };

        logger.info(`🏰 Generated location: ${location.name}`);
        return location;
      } catch (parseError) {
        logger.error('Failed to parse location JSON:', parseError);
        throw new Error('Invalid response format');
      }
    } catch (error) {
      logger.error('Location generation failed:', error);
      throw new Error(
        `Failed to generate location: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Save location to database
   */
  static async saveLocation(location: GeneratedLocation): Promise<string> {
    try {
      const locationData = {
        name: location.name,
        description: location.description,
        location_type: location.type,
        campaign_id: location.metadata.campaignId,
        metadata: {
          ...location,
          generatedAt: location.metadata.createdAt.toISOString(),
          generator: 'LocationGenerator',
          version: '1.0',
        },
      };

      const { data, error } = await supabase
        .from('locations')
        .insert(locationData)
        .select('id')
        .single();

      if (error) {
        logger.error('Error saving location:', error);
        throw new Error('Failed to save location to database');
      }

      logger.info(`💾 Saved location "${location.name}" with ID: ${data.id}`);
      return data.id;
    } catch (error) {
      logger.error('Error saving location:', error);
      throw error;
    }
  }

  /**
   * Generate and save a location in one call
   */
  static async createLocation(request: LocationRequest): Promise<GeneratedLocation> {
    const location = await this.generateLocation(request);

    try {
      const locationId = await this.saveLocation(location);
      location.id = locationId;

      logger.info(`✅ Created location "${location.name}" successfully`);
      return location;
    } catch (saveError) {
      logger.warn('Location generated but failed to save:', saveError);
      // Return the generated location even if save failed
      return location;
    }
  }

  /**
   * Generate a location based on current game context
   * @param userId - User ID for ownership validation (SECURITY: strongly recommended)
   */
  static async generateContextualLocation(
    campaignId: string,
    sessionId: string,
    playerAction: string,
    currentLocationId?: string,
    userId?: string,
  ): Promise<GeneratedLocation> {
    try {
      // Security check: Verify user ownership of campaign
      if (!userId) {
        logger.warn('[LocationGenerator] No userId provided - this is insecure');
      }

      // Build query with ownership validation
      // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
      let query = supabase.from('campaigns').select('genre').eq('id', campaignId);

      if (userId) {
        query = query.eq('user_id', userId); // SECURITY: Ensure user owns this campaign
      }

      const { data: campaign } = await query.single();

      if (!campaign) {
        throw new Error('Campaign not found or access denied');
      }

      // Determine location type based on player action
      const locationType = WorldBuildingAnalyzer.inferLocationTypeFromAction(playerAction);

      const request: LocationRequest = {
        type: locationType,
        size: 'medium',
        atmosphere: 'mysterious',
        context: {
          campaignId,
          sessionId,
          genre: campaign.genre || 'fantasy',
          currentStory: playerAction,
          playerLevel: await getAveragePartyLevel(campaignId, sessionId),
        },
      };

      return await this.createLocation(request);
    } catch (error) {
      logger.error('Failed to generate contextual location:', error);
      throw error;
    }
  }
}
