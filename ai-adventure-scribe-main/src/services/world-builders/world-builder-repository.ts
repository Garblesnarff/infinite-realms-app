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
  static async validateUserCampaignAccess(campaignId: string, userId: string): Promise<boolean> {
    try {
      // SECURITY: Require userId for proper validation
      if (!userId) {
        logger.warn(
          '[WorldBuilder] No userId provided for campaign access validation - denying access',
        );
        return false;
      }

      // Query campaign data via the secure, server-routed API
      const campaign = await userDataApi.getCampaign(campaignId);

      if (!campaign) {
        logger.warn(
          `[WorldBuilder] Campaign ${campaignId} not found or user ${userId} does not have access`,
        );
        return false;
      }

      // Implement double-ownership defense-in-depth checks
      const campaignUserId = campaign.user_id || campaign.userId;
      if (campaignUserId !== userId) {
        logger.warn(
          `[WorldBuilder] Campaign ownership mismatch: Campaign owner ${campaignUserId} does not match caller user context ${userId}`,
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
  static async getWorldStats(
    campaignId: string,
    userId: string,
  ): Promise<{
    locations: number;
    npcs: number;
    quests: number;
    totalElements: number;
  }> {
    try {
      if (!(await this.validateUserCampaignAccess(campaignId, userId))) {
        return { locations: 0, npcs: 0, quests: 0, totalElements: 0 };
      }

      return await userDataApi.getWorldBuilderStats(campaignId);
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
    userId: string,
  ): Promise<boolean> {
    try {
      if (!(await this.validateUserCampaignAccess(campaignId, userId))) {
        return false;
      }

      const existing = await userDataApi.findWorldBuilderNpc(campaignId, npc.name);
      if (existing) {
        logger.debug(`[WorldBuilder] NPC "${npc.name}" already exists, skipping`);
        return true;
      }

      await userDataApi.createWorldBuilderNpc({
        campaign_id: campaignId,
        name: npc.name,
        description: npc.description,
        location: npc.location, // Use 'location' not 'current_location'
      });

      logger.debug(`[WorldBuilder] Saved NPC "${npc.name}" from XML`);
      return true;
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
    userId: string,
  ): Promise<boolean> {
    try {
      if (!(await this.validateUserCampaignAccess(campaignId, userId))) {
        return false;
      }

      const existing = await userDataApi.findWorldBuilderLocation(campaignId, location.name);
      if (existing) {
        logger.debug(`[WorldBuilder] Location "${location.name}" already exists, skipping`);
        return true;
      }

      await userDataApi.createWorldBuilderLocation({
        campaign_id: campaignId,
        name: location.name,
        description: location.description,
        location_type: 'point_of_interest', // Default type for XML-extracted locations
        generated_by: 'xml_extraction',
      });

      logger.debug(`[WorldBuilder] Saved location "${location.name}" from XML`);
      return true;
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
    userId: string,
  ): Promise<boolean> {
    try {
      if (!(await this.validateUserCampaignAccess(campaignId, userId))) {
        return false;
      }

      await userDataApi.upsertQuest({
        campaign_id: campaignId,
        title: quest.name,
        description: quest.update,
        status: 'active',
        quest_type: 'side', // Default type for XML-extracted quests
      });
      logger.debug(`[WorldBuilder] Saved quest "${quest.name}" from XML for session ${sessionId}`);
      return true;
    } catch (error) {
      logger.warn(`[WorldBuilder] Error saving quest "${quest.name}":`, error);
      return false;
    }
  }
}
