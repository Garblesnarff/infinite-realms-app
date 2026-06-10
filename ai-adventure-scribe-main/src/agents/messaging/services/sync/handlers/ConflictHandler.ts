import { MessageSequence, QueuedMessage, ConflictResolutionStrategy } from '../types';
import { DatabaseAdapter } from '../adapters/DatabaseAdapter';
import { supabase } from '@/integrations/supabase/client';
import { logger } from '../../../../../lib/logger';

export class ConflictHandler {
  private defaultStrategy: ConflictResolutionStrategy = {
    type: 'timestamp',
    // ⚡ Bolt: Use direct string comparison for ISO timestamps to avoid expensive Date object creation.
    resolve: (messages) => messages.sort((a, b) => b.timestamp.localeCompare(a.timestamp))[0],
  };

  public async handleConflict(sequence: MessageSequence): Promise<void> {
    try {
      const message = await DatabaseAdapter.getMessageById(sequence.messageId);

      if (!message) {
        throw new Error('Message not found');
      }

      const resolvedMessage = this.defaultStrategy.resolve([message]);

      await supabase
        .from('agent_communications')
        .update(resolvedMessage)
        .eq('id', sequence.messageId);

      logger.info('[ConflictHandler] Conflict resolved:', sequence.messageId);
    } catch (error) {
      logger.error('[ConflictHandler] Conflict resolution error:', error);
    }
  }
}
