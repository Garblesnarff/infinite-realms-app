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

import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';
import type { ChatMessage } from '@/types/game';
import type { Memory } from '@/types/memory';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';
import { isValidMemoryType } from '@/types/memory';

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
 * @returns {Promise<{campaign: Partial<Campaign>, character: Partial<Character>} | null>} The game context or null if failed
 */
export async function fetchGameContext(
  sessionId: string,
): Promise<{ campaign: Partial<Campaign>; character: Partial<Character> } | null> {
  try {
    const sessionData = await userDataApi.getSessionContext(sessionId);

    if (!sessionData?.campaign_id || !sessionData?.character_id) {
      logger.error('No campaign or character IDs found in session');
      return null;
    }

    return {
      campaign: (sessionData.campaign || {}) as Partial<Campaign>,
      character: (sessionData.character || {}) as Partial<Character>,
    };
  } catch (error) {
    logger.error('Error in fetchGameContext:', error);
    return null;
  }
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
