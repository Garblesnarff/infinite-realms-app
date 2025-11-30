import { LocationGenerator } from './location-generator';
import { NPCGenerator } from './npc-generator';
import { QuestGenerator } from './quest-generator';
import { MemoryManager } from '../memory-manager';

import type { LocationRequest, GeneratedLocation } from './location-generator';
import type { NPCRequest, GeneratedNPC } from './npc-generator';
import type { QuestRequest, GeneratedQuest } from './quest-generator';
import type { Memory } from '@/types/memory';

import { isWorldBuilderEnabled } from '@/config/featureFlags';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export interface WorldBuildingContext {
  campaignId: string;
  sessionId: string;
  characterId: string;
  playerAction: string;
  userId?: string; // SECURITY: Required for ownership validation
  currentLocation?: string;
  recentMemories?: Memory[];
  genre?: string;
  playerLevel?: number;
}

export interface WorldExpansionResult {
  locations: GeneratedLocation[];
  npcs: GeneratedNPC[];
  quests: GeneratedQuest[];
  narrativeElements: {
    hooks: string[];
    consequences: string[];
    opportunities: string[];
  };
}

export interface WorldBuildingTrigger {
  type: 'player_action' | 'story_progression' | 'random_event' | 'memory_based';
  confidence: number; // How certain we are that world building is needed
  suggestions: {
    locations?: string[];
    npcs?: string[];
    quests?: string[];
  };
}

export class WorldBuilderService {
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
        logger.warn('[WorldBuilder] No userId provided for campaign access validation - denying access');
        return false;
      }

      // Check if campaign exists and user owns it
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('user_id')
        .eq('id', campaignId)
        .eq('user_id', userId) // SECURITY: Validate ownership
        .single();

      if (campaignError) {
        logger.warn('[WorldBuilder] Campaign query error:', campaignError);
        return false;
      }

      if (!campaign) {
        logger.warn(`[WorldBuilder] Campaign ${campaignId} not found or user ${userId} does not have access`);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[WorldBuilder] Error validating campaign access:', error);
      return false;
    }
  }

  /**
   * Analyze if the current context needs world building
   */
  static async analyzeBuildingNeeds(context: WorldBuildingContext): Promise<WorldBuildingTrigger> {
    const { playerAction, recentMemories = [] } = context;
    const actionLower = playerAction.toLowerCase();

    let confidence = 0;
    const suggestions: WorldBuildingTrigger['suggestions'] = {};

    // Check for location building triggers
    const locationTriggers = [
      'go to',
      'enter',
      'travel to',
      'visit',
      'explore',
      'find',
      'search for',
    ];
    if (locationTriggers.some((trigger) => actionLower.includes(trigger))) {
      confidence += 0.3;
      suggestions.locations = ['contextual location based on player action'];
    }

    // Check for NPC building triggers
    const npcTriggers = [
      'talk to',
      'speak with',
      'meet',
      'find someone',
      'ask',
      'hire',
      'buy from',
    ];
    if (npcTriggers.some((trigger) => actionLower.includes(trigger))) {
      confidence += 0.3;
      suggestions.npcs = ['contextual NPC based on player need'];
    }

    // Check for quest building triggers
    const questTriggers = ['help', 'quest', 'mission', 'task', 'job', 'problem', 'trouble'];
    if (questTriggers.some((trigger) => actionLower.includes(trigger))) {
      confidence += 0.3;
      suggestions.quests = ['quest based on current situation'];
    }

    // Check memories for world building opportunities
    const memoryBasedOpportunities = recentMemories.filter(
      (memory) =>
        memory.type === 'quest' ||
        memory.type === 'npc' ||
        memory.type === 'location' ||
        memory.content.includes('mysterious') ||
        memory.content.includes('unresolved'),
    );

    if (memoryBasedOpportunities.length > 0) {
      confidence += 0.2;
    }

    // Determine trigger type
    let type: WorldBuildingTrigger['type'] = 'player_action';
    if (memoryBasedOpportunities.length > 2) type = 'memory_based';
    if (confidence < 0.2) type = 'random_event';

    return {
      type,
      confidence: Math.min(confidence, 1.0),
      suggestions,
    };
  }

  /**
   * Expand the world based on current context
   */
  static async expandWorld(context: WorldBuildingContext): Promise<WorldExpansionResult> {
    const result: WorldExpansionResult = {
      locations: [],
      npcs: [],
      quests: [],
      narrativeElements: {
        hooks: [],
        consequences: [],
        opportunities: [],
      },
    };

    if (!isWorldBuilderEnabled()) {
      logger.debug('World building disabled via feature flag');
      return result;
    }

    logger.info(`🌍 Expanding world for: "${context.playerAction}"`);

    // Security check: Validate user owns this campaign
    const hasAccess = await this.validateUserCampaignAccess(context.campaignId, context.userId);
    if (!hasAccess) {
      logger.warn('🚨 Unauthorized world building attempt blocked');
      return result;
    }

    try {
      // Analyze what kind of expansion is needed
      const buildingNeeds = await this.analyzeBuildingNeeds(context);

      if (buildingNeeds.confidence < 0.3) {
        logger.info('🤏 Low confidence for world building, skipping');
        return result;
      }

      // Get campaign details for context
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', context.campaignId)
        .single();

      const genre = campaign?.genre || context.genre || 'fantasy';

      // Generate locations if needed
      if (buildingNeeds.suggestions.locations) {
        try {
          const location = await LocationGenerator.generateContextualLocation(
            context.campaignId,
            context.sessionId,
            context.playerAction,
            context.currentLocation,
          );
          result.locations.push(location);
          result.narrativeElements.hooks.push(
            `The ${location.name} holds secrets waiting to be discovered.`,
          );
        } catch (error) {
          logger.warn('Failed to generate location:', error);
        }
      }

      // Generate NPCs if needed
      if (buildingNeeds.suggestions.npcs) {
        try {
          const npc = await NPCGenerator.generateContextualNPC(
            context.campaignId,
            context.sessionId,
            context.playerAction,
            result.locations[0]?.name || context.currentLocation,
          );
          result.npcs.push(npc);
          result.narrativeElements.hooks.push(...npc.questHooks.slice(0, 2));
        } catch (error) {
          logger.warn('Failed to generate NPC:', error);
        }
      }

      // Generate quests if needed or if we have new NPCs/locations
      if (
        buildingNeeds.suggestions.quests ||
        result.npcs.length > 0 ||
        result.locations.length > 0
      ) {
        try {
          const quest = await QuestGenerator.generateMemoryBasedQuest(
            context.campaignId,
            context.sessionId,
            context.characterId,
            this.inferQuestTypeFromAction(context.playerAction),
          );
          result.quests.push(quest);
          result.narrativeElements.opportunities.push(...quest.hooks.initial);
        } catch (error) {
          logger.warn('Failed to generate quest:', error);
        }
      }

      // Generate narrative consequences
      result.narrativeElements.consequences.push(
        'Your actions have set new events in motion...',
        'The world responds to your presence...',
      );

      logger.info(
        `✅ World expansion complete: ${result.locations.length} locations, ${result.npcs.length} NPCs, ${result.quests.length} quests`,
      );
    } catch (error) {
      logger.error('World expansion failed:', error);
    }

    return result;
  }

  /**
   * Smart world building that responds to player actions
   * @param userId - User ID for ownership validation (SECURITY: strongly recommended)
   */
  static async respondToPlayerAction(
    campaignId: string,
    sessionId: string,
    characterId: string,
    playerMessage: string,
    aiResponse: string,
    userId?: string,
  ): Promise<WorldExpansionResult | null> {
    if (!isWorldBuilderEnabled()) {
      logger.debug('World building disabled via feature flag');
      return null;
    }

    try {
      // Security check: Validate user owns this campaign
      const hasAccess = await this.validateUserCampaignAccess(campaignId, userId);
      if (!hasAccess) {
        logger.warn('🚨 Unauthorized world building attempt blocked');
        return null;
      }
      // Get recent memories for context
      const recentMemories = await MemoryManager.getRelevantMemories(sessionId, playerMessage, 5);

      const context: WorldBuildingContext = {
        campaignId,
        sessionId,
        characterId,
        playerAction: playerMessage,
        userId,
        recentMemories,
      };

      // Only expand world if there's a good reason
      const needs = await this.analyzeBuildingNeeds(context);

      if (needs.confidence > 0.6) {
        logger.info(`🎯 High confidence (${needs.confidence}) world building triggered`);
        return await this.expandWorld(context);
      } else if (needs.confidence > 0.3) {
        logger.info(
          `🎲 Medium confidence (${needs.confidence}) world building - rolling for random expansion`,
        );
        // 50% chance of expansion for medium confidence
        if (Math.random() > 0.5) {
          return await this.expandWorld(context);
        }
      }

      logger.info(`📝 No world building needed (confidence: ${needs.confidence})`);
      return null;
    } catch (error) {
      logger.error('Failed to respond to player action:', error);
      return null;
    }
  }

  /**
   * Generate world elements on demand
   */
  static async generateOnDemand(request: {
    type: 'location' | 'npc' | 'quest';
    campaignId: string;
    sessionId: string;
    characterId: string;
    specifications?: Partial<{
      locationType: string;
      size: string;
      atmosphere: string;
      genre: string;
      role: NPCRequest['role'];
      importance: NPCRequest['importance'];
      questType: QuestRequest['type'];
      difficulty: QuestRequest['difficulty'];
      urgency: QuestRequest['urgency'];
      scope: QuestRequest['scope'];
    }>;
  }): Promise<GeneratedLocation | GeneratedNPC | GeneratedQuest | null> {
    if (!isWorldBuilderEnabled()) {
      logger.debug('World building disabled via feature flag');
      return null;
    }

    const { type, campaignId, sessionId, characterId, specifications = {} } = request;

    try {
      switch (type) {
        case 'location': {
          const locationRequest: LocationRequest = {
            type: specifications.locationType || 'room',
            size: specifications.size || 'medium',
            atmosphere: specifications.atmosphere || 'mysterious',
            context: {
              campaignId,
              sessionId,
              genre: specifications.genre || 'fantasy',
            },
          };
          return await LocationGenerator.createLocation(locationRequest);
        }

        case 'npc': {
          const npcRequest: NPCRequest = {
            role: specifications.role || 'commoner',
            importance: specifications.importance || 'minor',
            context: {
              campaignId,
              sessionId,
              genre: specifications.genre || 'fantasy',
            },
          };
          return await NPCGenerator.createNPC(npcRequest);
        }

        case 'quest': {
          const questRequest: QuestRequest = {
            type: specifications.questType || 'side',
            difficulty: specifications.difficulty || 'medium',
            urgency: specifications.urgency || 'soon',
            scope: specifications.scope || 'single-session',
            context: {
              campaignId,
              sessionId,
              characterId,
              genre: specifications.genre || 'fantasy',
            },
          };
          return await QuestGenerator.createQuest(questRequest);
        }

        default:
          throw new Error(`Unknown generation type: ${type}`);
      }
    } catch (error) {
      logger.error(`Failed to generate ${type}:`, error);
      throw error;
    }
  }

  /**
   * Infer quest type from player action
   */
  private static inferQuestTypeFromAction(action: string): QuestRequest['type'] {
    const actionLower = action.toLowerCase();

    if (actionLower.includes('investigate') || actionLower.includes('mystery')) {
      return 'investigation';
    }
    if (
      actionLower.includes('talk') ||
      actionLower.includes('negotiate') ||
      actionLower.includes('convince')
    ) {
      return 'social';
    }
    if (
      actionLower.includes('find') ||
      actionLower.includes('get') ||
      actionLower.includes('bring')
    ) {
      return 'fetch';
    }
    if (
      actionLower.includes('kill') ||
      actionLower.includes('defeat') ||
      actionLower.includes('fight')
    ) {
      return 'kill';
    }
    if (
      actionLower.includes('escort') ||
      actionLower.includes('protect') ||
      actionLower.includes('guard')
    ) {
      return 'escort';
    }
    if (
      actionLower.includes('explore') ||
      actionLower.includes('discover') ||
      actionLower.includes('map')
    ) {
      return 'exploration';
    }

    return 'side'; // Default
  }

  /**
   * Get world building statistics
   */
  static async getWorldStats(campaignId: string) {
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
    sessionId: string,
    npc: { name: string; description: string; location: string },
  ): Promise<void> {
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
        return;
      }

      const { error } = await supabase.from('npcs').insert({
        campaign_id: campaignId,
        session_id: sessionId,
        name: npc.name,
        description: npc.description,
        current_location: npc.location,
        role: 'supporting', // Default role for XML-extracted NPCs
        disposition: 'neutral', // Default disposition
        generated_by: 'xml_extraction',
      });

      if (error) {
        logger.warn(`[WorldBuilder] Failed to save NPC "${npc.name}":`, error);
      } else {
        logger.debug(`[WorldBuilder] Saved NPC "${npc.name}" from XML`);
      }
    } catch (error) {
      logger.warn(`[WorldBuilder] Error saving NPC "${npc.name}":`, error);
    }
  }

  /**
   * Save a location from XML-extracted data (no AI call needed)
   */
  static async saveLocationFromXML(
    campaignId: string,
    sessionId: string,
    location: { name: string; description: string; status: string },
  ): Promise<void> {
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
        return;
      }

      const { error } = await supabase.from('locations').insert({
        campaign_id: campaignId,
        session_id: sessionId,
        name: location.name,
        description: location.description,
        status: location.status || 'revealed',
        location_type: 'point_of_interest', // Default type for XML-extracted locations
        generated_by: 'xml_extraction',
      });

      if (error) {
        logger.warn(`[WorldBuilder] Failed to save location "${location.name}":`, error);
      } else {
        logger.debug(`[WorldBuilder] Saved location "${location.name}" from XML`);
      }
    } catch (error) {
      logger.warn(`[WorldBuilder] Error saving location "${location.name}":`, error);
    }
  }

  /**
   * Save a quest from XML-extracted data (no AI call needed)
   */
  static async saveQuestFromXML(
    campaignId: string,
    sessionId: string,
    quest: { name: string; update: string },
  ): Promise<void> {
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
        } else {
          logger.debug(`[WorldBuilder] Updated quest "${quest.name}" from XML`);
        }
        return;
      }

      // Create new quest
      const { error } = await supabase.from('quests').insert({
        campaign_id: campaignId,
        session_id: sessionId,
        title: quest.name,
        description: quest.update,
        status: 'active',
        type: 'side', // Default type for XML-extracted quests
        generated_by: 'xml_extraction',
      });

      if (error) {
        logger.warn(`[WorldBuilder] Failed to save quest "${quest.name}":`, error);
      } else {
        logger.debug(`[WorldBuilder] Saved quest "${quest.name}" from XML`);
      }
    } catch (error) {
      logger.warn(`[WorldBuilder] Error saving quest "${quest.name}":`, error);
    }
  }
}
