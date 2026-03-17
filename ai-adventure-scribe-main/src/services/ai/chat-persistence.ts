import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import type { ChatMessage } from './shared/types';

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
      const { error } = await supabase.from('dialogue_history').insert({
        id: messageId,
        session_id: params.sessionId,
        speaker_type: params.role,
        speaker_id: params.speakerId,
        message: params.content,
      });

      if (error) {
        logger.error('Error saving chat message:', error);
        throw new Error('Failed to save chat message');
      }
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
      // ⚡ Bolt: Use explicit columns to avoid over-fetching large JSONB columns (context, images) not used for history mapping.
      const { data, error } = await supabase
        .from('dialogue_history')
        .select('id, speaker_type, message, created_at')
        .eq('session_id', sessionId)
        .order('sequence_number', { ascending: true });

      if (error) {
        logger.error('Error getting conversation history:', error);
        throw new Error('Failed to get conversation history');
      }

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
