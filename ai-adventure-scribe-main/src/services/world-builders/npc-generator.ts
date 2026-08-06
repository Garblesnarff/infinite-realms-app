import { buildNPCPrompt } from './npc-prompt-builder';

import type { NPCRequest, GeneratedNPC } from './npc-types';

import { llmApiClient } from '@/infrastructure/api';
import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

export class NPCGenerator {
  /**
   * Generate a detailed NPC using AI
   */
  static async generateNPC(request: NPCRequest): Promise<GeneratedNPC> {
    try {
      const prompt = buildNPCPrompt(request);

      const text = await llmApiClient.generateText({
        prompt,
        temperature: 0.9,
        maxTokens: 4096,
      });

      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in NPC generation response');
      }

      let npcData;
      try {
        npcData = JSON.parse(jsonMatch[0]);
      } catch (_parseError) {
        throw new Error('Invalid JSON format in NPC response');
      }

      // Add metadata
      const npc: GeneratedNPC = {
        ...npcData,
        id: undefined, // Will be set when saved
        metadata: {
          createdAt: new Date(),
          campaignId: request.context.campaignId,
          sessionId: request.context.sessionId,
          importance: request.importance,
          narrativeWeight: this.calculateNarrativeWeight(npcData, request),
          storyArc: request.context.currentStory,
          locationId: request.location,
        },
      };

      logger.info(`👤 Generated NPC: ${npc.name} (${npc.role})`);
      return npc;
    } catch (error) {
      logger.error('NPC generation failed:', error);
      throw new Error(
        `Failed to generate NPC: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Calculate narrative importance of NPC
   */
  private static calculateNarrativeWeight(
    npc: { secrets?: string[]; questHooks?: string[]; goals?: { secret?: string[] } },
    request: NPCRequest,
  ): number {
    let weight = 5; // Base weight

    // Adjust based on importance
    if (request.importance === 'critical') weight += 3;
    else if (request.importance === 'major') weight += 2;
    else if (request.importance === 'minor') weight += 0;

    // Increase weight for story-rich NPCs
    if ((npc.secrets?.length || 0) > 1) weight += 1;
    if ((npc.questHooks?.length || 0) > 2) weight += 1;
    if ((npc.goals?.secret?.length || 0) > 0) weight += 1;
    if (['villain', 'mentor', 'ally'].includes(request.role)) weight += 1;

    return Math.min(weight, 10);
  }

  /**
   * Save NPC to database
   */
  static async saveNPC(npc: GeneratedNPC): Promise<string> {
    try {
      const generatedAt = npc.metadata.createdAt.toISOString();
      const npcData = {
        name: npc.name,
        description: npc.description,
        race: npc.race,
        campaign_id: npc.metadata.campaignId,
        occupation: npc.occupation,
        personality: JSON.stringify(npc.personality),
        backstory: npc.background,
        relationship: JSON.stringify(npc.relationships),
        location: npc.metadata.locationId,
        stats: {
          ...npc,
          metadata: {
            ...npc.metadata,
            createdAt: generatedAt,
          },
          generatedAt,
          generator: 'NPCGenerator',
          version: '1.0',
        },
      };

      const data = await userDataApi.createWorldBuilderNpc(npcData);

      logger.info(`💾 Saved NPC "${npc.name}" with ID: ${data.id}`);
      return data.id;
    } catch (error) {
      logger.error('Error saving NPC:', error);
      throw new Error('Failed to save NPC to database');
    }
  }

  /**
   * Generate and save an NPC in one call
   */
  static async createNPC(request: NPCRequest): Promise<GeneratedNPC> {
    const npc = await this.generateNPC(request);

    try {
      const npcId = await this.saveNPC(npc);
      npc.id = npcId;

      logger.info(`✅ Created NPC "${npc.name}" successfully`);
      return npc;
    } catch (saveError) {
      logger.warn('NPC generated but failed to save:', saveError);
      // Return the generated NPC even if save failed
      return npc;
    }
  }

  /**
   * Generate an NPC based on current game context and player action
   */
  /**
   * @param userId - User ID for ownership validation
   */
  static async generateContextualNPC(
    campaignId: string,
    sessionId: string,
    playerAction: string,
    locationName?: string,
    userId: string,
  ): Promise<GeneratedNPC> {
    try {
      // RLS cannot scope this WorkOS-authenticated Supabase client. Fail closed
      // and scope the campaign lookup before generating or persisting an NPC.
      if (!userId) {
        throw new Error('User ID is required for NPC generation');
      }

      const campaign = await userDataApi.getCampaign(campaignId);

      if (!campaign) {
        throw new Error('Campaign not found or access denied');
      }

      // Implement double-ownership checks
      const campaignUserId = campaign.user_id || campaign.userId;
      if (campaignUserId !== userId) {
        throw new Error('Campaign not found or access denied');
      }

      // Infer NPC type from player action and location
      const npcRole = this.inferNPCRoleFromContext(playerAction, locationName);
      const importance = this.inferImportanceFromAction(playerAction);

      const request: NPCRequest = {
        role: npcRole,
        importance,
        context: {
          campaignId,
          sessionId,
          genre: campaign.genre || 'fantasy',
          currentStory: playerAction,
          locationName,
          playerLevel: await getAveragePartyLevel(campaignId, sessionId),
        },
      };

      return await this.createNPC(request);
    } catch (error) {
      logger.error('Failed to generate contextual NPC:', error);
      throw error;
    }
  }

  /**
   * Infer NPC role from context
   */
  private static inferNPCRoleFromContext(action: string, location?: string): NPCRequest['role'] {
    const actionLower = action.toLowerCase();
    const locationLower = location?.toLowerCase() || '';

    if (
      locationLower.includes('shop') ||
      actionLower.includes('buy') ||
      actionLower.includes('trade')
    ) {
      return 'shopkeeper';
    }
    if (
      locationLower.includes('guard') ||
      actionLower.includes('guard') ||
      locationLower.includes('gate')
    ) {
      return 'guard';
    }
    if (
      actionLower.includes('noble') ||
      locationLower.includes('palace') ||
      locationLower.includes('manor')
    ) {
      return 'noble';
    }
    if (
      actionLower.includes('help') ||
      actionLower.includes('mentor') ||
      actionLower.includes('learn')
    ) {
      return 'mentor';
    }
    if (
      actionLower.includes('enemy') ||
      actionLower.includes('villain') ||
      actionLower.includes('boss')
    ) {
      return 'villain';
    }
    if (
      actionLower.includes('mysterious') ||
      actionLower.includes('strange') ||
      actionLower.includes('hooded')
    ) {
      return 'mysterious';
    }

    // Default to commoner
    return 'commoner';
  }

  /**
   * Infer NPC importance from action
   */
  private static inferImportanceFromAction(action: string): NPCRequest['importance'] {
    const actionLower = action.toLowerCase();

    if (
      actionLower.includes('boss') ||
      actionLower.includes('main') ||
      actionLower.includes('important')
    ) {
      return 'critical';
    }
    if (
      actionLower.includes('quest') ||
      actionLower.includes('help') ||
      actionLower.includes('leader')
    ) {
      return 'major';
    }

    return 'minor';
  }
}
