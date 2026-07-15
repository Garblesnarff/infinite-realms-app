import { LocationGenerator } from './location-generator';
import { NPCGenerator } from './npc-generator';
import { QuestGenerator } from './quest-generator';
import { WorldBuilderRepository } from './world-builder-repository';
import { WorldBuildingAnalyzer } from './world-building-analyzer';
import { MemoryManager } from '../memory-manager';

import type { LocationRequest, GeneratedLocation } from './location-types';
import type { NPCRequest, GeneratedNPC } from './npc-types';
import type { QuestRequest, GeneratedQuest } from './quest-generator';
import type { WorldBuildingContext, WorldExpansionResult } from './types';

import { isWorldBuilderEnabled } from '@/config/featureFlags';
import logger from '@/lib/logger';

export class WorldBuilderService {
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
    const hasAccess = await WorldBuilderRepository.validateUserCampaignAccess(
      context.campaignId,
      context.userId,
    );
    if (!hasAccess) {
      logger.warn('🚨 Unauthorized world building attempt blocked');
      return result;
    }

    try {
      // Analyze what kind of expansion is needed
      const buildingNeeds = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);

      if (buildingNeeds.confidence < 0.3) {
        logger.info('🤏 Low confidence for world building, skipping');
        return result;
      }

      // Generate locations if needed
      if (buildingNeeds.suggestions.locations) {
        try {
          const location = await LocationGenerator.generateContextualLocation(
            context.campaignId,
            context.sessionId,
            context.playerAction,
            context.currentLocation,
            context.userId,
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
            context.userId,
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
            WorldBuildingAnalyzer.inferQuestTypeFromAction(context.playerAction),
            context.userId,
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
   * @param userId - User ID for ownership validation
   */
  static async respondToPlayerAction(
    campaignId: string,
    sessionId: string,
    characterId: string,
    playerMessage: string,
    aiResponse: string,
    userId: string,
  ): Promise<WorldExpansionResult | null> {
    if (!isWorldBuilderEnabled()) {
      logger.debug('World building disabled via feature flag');
      return null;
    }

    try {
      // Security check: Validate user owns this campaign
      const hasAccess = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, userId);
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
      const needs = await WorldBuildingAnalyzer.analyzeBuildingNeeds(context);

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
    userId: string;
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

    const { type, campaignId, sessionId, characterId, userId, specifications = {} } = request;

    try {
      const hasAccess = await WorldBuilderRepository.validateUserCampaignAccess(campaignId, userId);
      if (!hasAccess) {
        throw new Error('Campaign not found or access denied');
      }

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

}
