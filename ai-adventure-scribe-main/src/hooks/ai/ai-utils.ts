/**
 * AI Utilities
 *
 * Helper functions for formatting DM tasks, fetching game context, and selecting memories.
 *
 * Dependencies:
 * - Supabase client (src/integrations/supabase/client.ts)
 * - ChatMessage and Memory types (src/types/game.ts, src/types/memory.ts)
 *
 * @author AI Dungeon Master Team
 */

import type { GameContext } from '@/services/ai/shared/types';
import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';
import type { ChatMessage } from '@/types/game';
import type { Memory } from '@/types/memory';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { isValidMemoryType } from '@/types/memory';
import { hasStarterPlaythroughSignal } from '@/utils/starter-playthrough';

/**
 * Formats chat messages into a task object for the DM Agent.
 *
 * @param {ChatMessage[]} messages - The full message history
 * @param {ChatMessage} latestMessage - The latest player message
 * @returns {object} The formatted task object
 */
export function formatDMTask(messages: ChatMessage[], latestMessage: ChatMessage) {
  return {
    id: `task_${Date.now()}`,
    description: `Respond to player message: ${latestMessage.text}`,
    expectedOutput: 'D&D appropriate response with game context',
    context: {
      messageHistory: messages,
      playerIntent: latestMessage.context?.intent || 'query',
      playerEmotion: latestMessage.context?.emotion || 'neutral',
    },
  };
}

/**
 * Fetches campaign and character details for the DM Agent context.
 *
 * @param {string} sessionId - The session ID
 * @returns {Promise<{campaign: Partial<Campaign>, character: Partial<Character>, starterCampaignId?: string} | null>} The game context or null if failed
 */
export async function fetchGameContext(sessionId: string): Promise<{
  campaign: Partial<Campaign>;
  character: Partial<Character>;
  starterCampaignId?: string;
  /** #2450: game_sessions.current_scene_description — the session's current scene. */
  currentSceneDescription?: string;
} | null> {
  try {
    const sessionData = await userDataApi.getSessionContext(sessionId);

    if (!sessionData?.campaign_id || !sessionData?.character_id) {
      logger.error('No campaign or character IDs found in session');
      return null;
    }

    return {
      campaign: (sessionData.campaign || {}) as Partial<Campaign>,
      character: (sessionData.character || {}) as Partial<Character>,
      starterCampaignId: sessionData.starter_campaign_id as string,
      currentSceneDescription:
        typeof sessionData.current_scene_description === 'string'
          ? sessionData.current_scene_description
          : undefined,
    };
  } catch (error) {
    logger.error('Error in fetchGameContext:', error);
    return null;
  }
}

/**
 * Builds the structured AI context object for AIService.chatWithDM.
 *
 * @param {object} params - Input parameters for context construction
 * @returns {object} The formatted AI context
 */
export function buildAIContext(params: {
  sessionId: string;
  userId?: string;
  starterCampaignId?: string;
  isStarterPlaythrough?: boolean;
  campaign: Record<string, unknown> | Partial<Campaign>;
  character: Record<string, unknown> | Partial<Character>;
  currentPhase: string;
  isInCombat: boolean;
  /** #2450: the session's current scene description, rendered as a <current_scene> block. */
  currentSceneDescription?: string;
  /** Identifies the encounter to the server, which teaches the combat dialect once per fight. */
  encounterId?: string | null;
  currentTurnParticipantId?: string | null;
  pendingRollsCount: number;
  currentRound?: number | null;
  participants?: Array<{
    id: string;
    name: string;
    participantType: string;
    currentHitPoints: number;
    maxHitPoints: number;
    armorClass: number;
    conditions?: Array<{ name: string }>;
  }>;
}) {
  const campaignRecord = params.campaign as Record<string, unknown>;
  const characterRecord = params.character as Record<string, unknown>;
  const isStarterPlaythrough =
    params.isStarterPlaythrough ??
    (Boolean(params.starterCampaignId) || hasStarterPlaythroughSignal(params.campaign));

  const context: GameContext = {
    campaignId: (campaignRecord.id as string) || '',
    characterId: (characterRecord.id as string) || '',
    sessionId: params.sessionId,
    userId: params.userId,
    starterCampaignId: params.starterCampaignId,
    currentSceneDescription: params.currentSceneDescription,
    campaignDetails: params.campaign,
    characterDetails: params.character,
    gameState: {
      currentPhase: params.currentPhase,
      isInCombat: params.isInCombat,
      encounterId: params.encounterId,
      currentTurnPlayerId: params.currentTurnParticipantId,
      pendingRolls: params.pendingRollsCount,
      round: params.currentRound,
      participants: (params.participants || []).map((participant) => ({
        id: participant.id,
        name: participant.name,
        type: participant.participantType,
        hp: participant.currentHitPoints,
        maxHp: participant.maxHitPoints,
        armorClass: participant.armorClass,
        conditions: (participant.conditions || []).map((condition) => condition.name),
      })),
    },
  };

  if (isStarterPlaythrough) context.isStarterPlaythrough = true;
  return context;
}

/**
 * Fetches and validates memories for a session.
 *
 * @param {string} sessionId - The session ID
 * @returns {Promise<Memory[]>} Array of validated memories
 */
export async function fetchMemories(sessionId: string): Promise<Memory[]> {
  // ⚡ Bolt: Using explicit column list to avoid fetching large vector embeddings (~3KB/row).
  const memoriesData = await userDataApi.listMemories(sessionId);

  return (memoriesData || []).map((memory): Memory => {
    if (!isValidMemoryType(memory.type)) {
      logger.warn(`[Memory] Invalid memory type detected: ${memory.type}, defaulting to 'general'`);
      memory.type = 'general';
    }
    return {
      ...memory,
      type: isValidMemoryType(memory.type) ? memory.type : 'general',
    };
  });
}
