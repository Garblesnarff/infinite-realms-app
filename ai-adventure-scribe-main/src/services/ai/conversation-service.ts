/**
 * Conversation Service
 *
 * Handles saving and retrieving chat messages from the database.
 * Manages conversation history for AI sessions.
 * Extracted from ai-service.ts for separation of concerns.
 *
 * @module conversation-service
 */

import type { ChatMessage } from './shared/types';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

/**
 * Save a chat message to the database
 *
 * Stores a message in the dialogue_history table for persistent storage.
 *
 * @param params - Message parameters (sessionId, role, content, speakerId)
 * @throws Error if database save fails
 *
 * @example
 * ```typescript
 * await saveChatMessage({
 *   sessionId: 'session_123',
 *   role: 'user',
 *   content: 'I attack the goblin!',
 *   speakerId: 'char_456'
 * });
 * ```
 */
export async function saveChatMessage(params: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  speakerId?: string;
  id?: string;
}): Promise<void> {
  const messageId = params.id || crypto.randomUUID();
  try {
    await userDataApi.saveSessionMessages(params.sessionId, {
      id: messageId,
      speaker_type: params.role,
      speaker_id: params.speakerId,
      message: params.content,
    });
  } catch (error) {
    logger.error('Error saving chat message:', error);
    throw new Error('Failed to save chat message');
  }
}

/**
 * Get conversation history for a session
 *
 * Retrieves all messages for a given session in chronological order.
 *
 * @param sessionId - The session ID to fetch history for
 * @returns Array of chat messages
 * @throws Error if database query fails
 *
 * @example
 * ```typescript
 * const history = await getConversationHistory('session_123');
 * console.log(`Found ${history.length} messages`);
 * ```
 */
export async function getConversationHistory(sessionId: string): Promise<ChatMessage[]> {
  try {
    // ⚡ Bolt: Use explicit column selection to avoid over-fetching large JSONB columns (context, images)
    // that are not needed for the ChatMessage mapping.
    // Added sequence_number to select to match chat-persistence.ts and ensure consistency.
    const { messages: data } = await userDataApi.listSessionMessages(sessionId, 0, 200);

    return data.map((msg) => ({
      id: msg.id,
      role: msg.speaker_type as 'user' | 'assistant',
      content: msg.message,
      timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
    }));
  } catch (error) {
    logger.error('Error getting conversation history:', error);
    throw new Error('Failed to get conversation history');
  }
}
