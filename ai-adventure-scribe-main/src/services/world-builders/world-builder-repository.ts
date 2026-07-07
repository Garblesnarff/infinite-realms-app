import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * WorldBuilderRepository handles database persistence and data access
 * for world building elements (NPCs, Locations, Quests).
 */
export class WorldBuilderRepository {
  /**
   * Validate that user owns the campaign (security check)
   * @param campaignId - The campaign ID to validate
   * @param userId - The user ID to check ownership against (required for security)
   * @returns true if user owns campaign, false otherwise
   */
  static async validateUserCampaignAccess(campaignId: string, userId?: string): Promise<boolean> {
    try {
      // SECURITY: Require userId for proper validation
      if (!userId) {
        logger.warn(
          '[WorldBuilder] No userId provided for campaign access validation - denying access',
        );
        return false;
      }

      // Check if campaign exists and user owns it
      const campaign = await userDataApi.getCampaign(campaignId);

      if (!campaign) {
        logger.warn(
          `[WorldBuilder] Campaign ${campaignId} not found or user ${userId} does not have access`,
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[WorldBuilder] Error validating campaign access:', error);
      return false;
    }
  }

  /**
   * Get world building statistics
   */
  static async getWorldStats(campaignId: string): Promise<{
    locations: number;
    npcs: number;
    quests: number;
    totalElements: number;
  }> {
    try {
      const [locations, npcs, quests] = await Promise.all([
        supabase.from('locations').select('id').eq('campaign_id', campaignId),
        supabase.from('npcs').select('id').eq('campaign_id', campaignId),
        supabase.from('quests').select('id').eq('campaign_id', campaignId),
      ]);

      return {
        locations: locations.data?.length || 0,
        npcs: npcs.data?.length || 0,
        quests: quests.data?.length || 0,
        totalElements:
          (locations.data?.length || 0) + (npcs.data?.length || 0) + (quests.data?.length || 0),
      };
    } catch (error) {
      logger.error('Failed to get world stats:', error);
      return { locations: 0, npcs: 0, quests: 0, totalElements: 0 };
    }
  }

  // ========================================================================
  // XML TAG HELPERS - Save world elements extracted from DM response XML tags
  // These methods allow single-call extraction without additional API calls
  // ========================================================================

  /**
   * Save an NPC from XML-extracted data (no AI call needed)
   */
  static async saveNPCFromXML(
    campaignId: string,
    _sessionId: string, // Kept for API compatibility but not used (column doesn't exist)
    npc: { name: string; description: string; location: string },
  ): Promise<boolean> {
    try {
      // Check if NPC already exists (by name in this campaign)
      const { data: existing } = await supabase
        .from('npcs')
        .select('id')
        .eq('campaign_id', campaignId)
        .ilike('name', npc.name)
        .limit(1);

      if (existing && existing.length > 0) {
        logger.debug(`[WorldBuilder] NPC "${npc.name}" already exists, skipping`);
        return true;
      }

      // Only use columns that exist in the npcs table schema:
      // id, campaign_id, name, race, occupation, personality, description, backstory,
      // relationship, location, image_url, voice_id, stats, created_at, updated_at
      const { error } = await supabase.from('npcs').insert({
        campaign_id: campaignId,
        name: npc.name,
        description: npc.description,
        location: npc.location, // Use 'location' not 'current_location'
      });

      if (error) {
        logger.warn(`[WorldBuilder] Failed to save NPC "${npc.name}":`, error);
        return false;
      } else {
        logger.debug(`[WorldBuilder] Saved NPC "${npc.name}" from XML`);
        return true;
      }
    } catch (error) {
      logger.warn(`[WorldBuilder] Error saving NPC "${npc.name}":`, error);
      return false;
    }
  }

  /**
   * Save a location from XML-extracted data (no AI call needed)
   */
  static async saveLocationFromXML(
    campaignId: string,
    _sessionId: string, // Kept for API compatibility but not used (column doesn't exist)
    location: { name: string; description: string; status?: string }, // status is optional, not saved
  ): Promise<boolean> {
    try {
      // Check if location already exists (by name in this campaign)
      const { data: existing } = await supabase
        .from('locations')
        .select('id')
        .eq('campaign_id', campaignId)
        .ilike('name', location.name)
        .limit(1);

      if (existing && existing.length > 0) {
        logger.debug(`[WorldBuilder] Location "${location.name}" already exists, skipping`);
        return true;
      }

      // Only use columns that exist in the locations table schema:
      // id, campaign_id, name, location_type, description, population, climate, terrain,
      // notable_features[], connected_locations[], image_url, map_url, metadata, created_at, updated_at, generated_by
      const { error } = await supabase.from('locations').insert({
        campaign_id: campaignId,
        name: location.name,
        description: location.description,
        location_type: 'point_of_interest', // Default type for XML-extracted locations
        generated_by: 'xml_extraction',
      });

      if (error) {
        logger.warn(`[WorldBuilder] Failed to save location "${location.name}":`, error);
        return false;
      } else {
        logger.debug(`[WorldBuilder] Saved location "${location.name}" from XML`);
        return true;
      }
    } catch (error) {
      logger.warn(`[WorldBuilder] Error saving location "${location.name}":`, error);
      return false;
    }
  }

  /**
   * Save a quest from XML-extracted data (no AI call needed)
   */
  static async saveQuestFromXML(
    campaignId: string,
    sessionId: string,
    quest: { name: string; update: string },
  ): Promise<boolean> {
    try {
      // Check if quest already exists (by name in this campaign)
      const { data: existing } = await supabase
        .from('quests')
        .select('id, status')
        .eq('campaign_id', campaignId)
        .ilike('title', quest.name)
        .limit(1);

      if (existing && existing.length > 0) {
        // Quest exists - update its status/description
        const { error } = await supabase
          .from('quests')
          .update({
            description: quest.update,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing[0].id);

        if (error) {
          logger.warn(`[WorldBuilder] Failed to update quest "${quest.name}":`, error);
          return false;
        } else {
          logger.debug(`[WorldBuilder] Updated quest "${quest.name}" from XML`);
          return true;
        }
      }

      // Create new quest
      const { error } = await supabase.from('quests').insert({
        campaign_id: campaignId,
        session_id: sessionId,
        title: quest.name,
        description: quest.update,
        status: 'active',
        quest_type: 'side', // Default type for XML-extracted quests
      });

      if (error) {
        logger.warn(`[WorldBuilder] Failed to save quest "${quest.name}":`, error);
        return false;
      } else {
        logger.debug(`[WorldBuilder] Saved quest "${quest.name}" from XML`);
        return true;
      }
    } catch (error) {
      logger.warn(`[WorldBuilder] Error saving quest "${quest.name}":`, error);
      return false;
    }
  }
}
