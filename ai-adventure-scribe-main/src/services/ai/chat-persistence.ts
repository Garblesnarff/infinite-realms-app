import type { ChatMessage } from './shared/types';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

export class ChatPersistence {
  /**
   * Save a chat message to the database
   */
  static async saveChatMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    speakerId?: string;
    id?: string;
  }): Promise<void> {
    try {
      const messageId = params.id || crypto.randomUUID();
      await userDataApi.saveSessionMessages(params.sessionId, {
        id: messageId,
        speaker_type: params.role,
        speaker_id: params.speakerId,
        message: params.content,
      });
    } catch (error) {
      logger.error('Error saving chat message:', error);
      throw error;
    }
  }

  /**
   * Get conversation history for a session
   */
  static async getConversationHistory(sessionId: string): Promise<ChatMessage[]> {
    try {
      // ⚡ Bolt: Use explicit columns to avoid over-fetching large JSONB columns (context, images)
      // that are not needed for initial history mapping. This reduces data transfer.
      const { messages: data } = await userDataApi.listSessionMessages(sessionId, 0, 200);

      return data.map((msg) => ({
        id: msg.id,
        role: msg.speaker_type as 'user' | 'assistant',
        content: msg.message,
        timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
      }));
    } catch (error) {
      logger.error('Error getting conversation history:', error);
      throw error;
    }
  }
}
