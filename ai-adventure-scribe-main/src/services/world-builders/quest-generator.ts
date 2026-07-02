import { MemoryManager } from '../memory-manager';

import type { QuestRequest, GeneratedQuest } from '@/services/world-builders/quest-types';

import { llmApiClient } from '@/infrastructure/api';
import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import {
  buildQuestPromptTemplate,
  buildQuestHookPromptTemplate,
} from '@/services/world-builders/quest-prompts';
import { getAveragePartyLevel } from '@/utils/character-level-utils';

export type {
  QuestRequest,
  GeneratedQuest,
  QuestStage,
} from '@/services/world-builders/quest-types';

export class QuestGenerator {
  /**
   * Generate a detailed quest using AI
   */
  static async generateQuest(request: QuestRequest): Promise<GeneratedQuest> {
    try {
      const prompt = await this.buildQuestPrompt(request);

      const text = await llmApiClient.generateText({
        prompt,
        temperature: 0.9,
        maxTokens: 4096,
      });

      // Extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in quest generation response');
      }

      try {
        const questData = JSON.parse(jsonMatch[0]);

        // Add metadata
        const quest: GeneratedQuest = {
          ...questData,
          id: undefined, // Will be set when saved
          metadata: {
            createdAt: new Date(),
            campaignId: request.context.campaignId,
            sessionId: request.context.sessionId,
            characterId: request.context.characterId,
            giver: request.giver,
            urgency: request.urgency,
            scope: request.scope,
            narrativeWeight: this.calculateNarrativeWeight(questData, request),
            storyArc: request.context.currentStory,
          },
        };

        logger.info(`⚔️ Generated quest: ${quest.title} (${quest.type})`);
        return quest;
      } catch (parseError) {
        logger.error('Failed to parse quest JSON:', parseError);
        throw new Error('Failed to generate quest: Invalid response format');
      }
    } catch (error) {
      logger.error('Quest generation failed:', error);
      throw new Error(
        `Failed to generate quest: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Build the prompt for quest generation
   */
  private static async buildQuestPrompt(request: QuestRequest): Promise<string> {
    return buildQuestPromptTemplate(request);
  }

  /**
   * Calculate narrative importance of quest
   */
  private static calculateNarrativeWeight(
    quest: {
      stages?: unknown[];
      connections?: { npcs?: unknown[] };
      hooks?: { twists?: unknown[] };
    },
    request: QuestRequest,
  ): number {
    let weight = 5; // Base weight

    // Adjust based on quest type and scope
    if (request.type === 'main') weight += 3;
    else if (request.type === 'personal') weight += 2;
    else if (request.type === 'side') weight += 1;

    if (request.scope === 'campaign-arc') weight += 2;
    else if (request.scope === 'multi-session') weight += 1;

    // Increase weight for complex quests
    if ((quest.stages?.length || 0) > 3) weight += 1;
    if ((quest.connections?.npcs?.length || 0) > 2) weight += 1;
    if ((quest.hooks?.twists?.length || 0) > 1) weight += 1;

    return Math.min(weight, 10);
  }

  /**
   * Save quest to database
   */
  static async saveQuest(quest: GeneratedQuest): Promise<string> {
    try {
      const questData = {
        title: quest.title,
        description: quest.description,
        quest_type: quest.type,
        difficulty: quest.difficulty,
        status: 'available',
        campaign_id: quest.metadata.campaignId,
        metadata: {
          ...quest,
          generatedAt: quest.metadata.createdAt.toISOString(),
          generator: 'QuestGenerator',
          version: '1.0',
        },
      };

      const { data, error } = await supabase.from('quests').insert(questData).select('id').single();

      if (error) {
        logger.error('Error saving quest:', error);
        throw new Error('Failed to save quest to database');
      }

      logger.info(`💾 Saved quest "${quest.title}" with ID: ${data.id}`);
      return data.id;
    } catch (error) {
      logger.error('Error saving quest:', error);
      throw error;
    }
  }

  /**
   * Generate and save a quest in one call
   */
  static async createQuest(request: QuestRequest): Promise<GeneratedQuest> {
    const quest = await this.generateQuest(request);

    try {
      const questId = await this.saveQuest(quest);
      quest.id = questId;

      logger.info(`✅ Created quest "${quest.title}" successfully`);
      return quest;
    } catch (saveError) {
      logger.warn('Quest generated but failed to save:', saveError);
      // Return the generated quest even if save failed
      return quest;
    }
  }

  /**
   * Generate a quest based on current memories and context
   */
  /**
   * @param userId - User ID for ownership validation (SECURITY: strongly recommended)
   */
  static async generateMemoryBasedQuest(
    campaignId: string,
    sessionId: string,
    characterId: string,
    questType: QuestRequest['type'] = 'side',
    userId?: string,
  ): Promise<GeneratedQuest> {
    try {
      // Security check: Verify user ownership of campaign
      if (!userId) {
        logger.warn('[QuestGenerator] No userId provided - this is insecure');
      }

      // Build query with ownership validation
      // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
      let campaignQuery = supabase.from('campaigns').select('genre').eq('id', campaignId);

      if (userId) {
        campaignQuery = campaignQuery.eq('user_id', userId); // SECURITY: Ensure user owns this campaign
      }

      // Get campaign and memories in parallel
      const [campaignResult, memories] = await Promise.all([
        campaignQuery.single(),
        MemoryManager.getRelevantMemories(sessionId, 'quest opportunities', 5),
      ]);

      if (!campaignResult.data) {
        throw new Error('Campaign not found or access denied');
      }

      const campaign = campaignResult;

      const request: QuestRequest = {
        type: questType,
        difficulty: 'medium',
        urgency: 'soon',
        scope: 'single-session',
        context: {
          campaignId,
          sessionId,
          characterId,
          genre: campaign.data.genre || 'fantasy',
          playerLevel: await getAveragePartyLevel(campaignId, sessionId),
          recentMemories: memories,
        },
      };

      return await this.createQuest(request);
    } catch (error) {
      logger.error('Failed to generate memory-based quest:', error);
      throw error;
    }
  }

  /**
   * Generate a quest hook from current game state
   */
  static async generateQuestHook(
    campaignId: string,
    sessionId: string,
    contextMessage: string,
  ): Promise<{ title: string; hook: string; questType: string }> {
    try {
      const prompt = buildQuestHookPromptTemplate(contextMessage);

      const text = await llmApiClient.generateText({
        prompt,
        temperature: 0.8,
        maxTokens: 512,
      });

      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Fallback if JSON parsing fails
      return {
        title: 'Mysterious Opportunity',
        hook: 'Something interesting has caught your attention...',
        questType: 'side',
      };
    } catch (error) {
      logger.error('Failed to generate quest hook:', error);
      return {
        title: 'Adventure Awaits',
        hook: 'A new opportunity presents itself...',
        questType: 'side',
      };
    }
  }
}
