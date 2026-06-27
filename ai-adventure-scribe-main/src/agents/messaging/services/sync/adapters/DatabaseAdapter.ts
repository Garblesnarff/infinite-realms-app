import { TypeConverter } from './TypeConverter';
import { ErrorHandlingService } from '../../../../error/services/error-handling-service';
import { ErrorCategory, ErrorSeverity } from '../../../../error/types';

import type { MessageSequence, SyncState, VectorClock, SyncStatus } from '../types';

import { supabase } from '@/integrations/supabase/client';

// ⚡ Bolt: Define explicit column lists to avoid over-fetching and improve query performance.
const MESSAGE_SEQUENCE_COLUMNS = 'id, message_id, sequence_number, vector_clock, created_at, updated_at';
const SYNC_STATUS_COLUMNS = 'id, agent_id, last_sync_timestamp, sync_state, vector_clock, created_at, updated_at';
const AGENT_COMMUNICATION_COLUMNS = 'id, message_type, content, sender_id, receiver_id, created_at';

export class DatabaseAdapter {
  private static errorHandler = ErrorHandlingService.getInstance();

  static async saveMessageSequence(sequence: MessageSequence): Promise<void> {
    await this.errorHandler.handleDatabaseOperation(
      async () =>
        supabase.from('message_sequences').insert({
          message_id: sequence.messageId,
          sequence_number: sequence.sequenceNumber,
          vector_clock: TypeConverter.toJson(sequence.vectorClock),
        }),
      {
        category: ErrorCategory.DATABASE,
        context: 'DatabaseAdapter.saveMessageSequence',
        severity: ErrorSeverity.HIGH,
      },
    );
  }

  static async updateSyncStatus(
    agentId: string,
    syncState: SyncState,
    vectorClock: VectorClock,
  ): Promise<void> {
    await this.errorHandler.handleDatabaseOperation(
      async () =>
        supabase.from('sync_status').upsert({
          agent_id: agentId,
          last_sync_timestamp: new Date().toISOString(),
          sync_state: TypeConverter.toJson(syncState),
          vector_clock: TypeConverter.toJson(vectorClock),
        }),
      {
        category: ErrorCategory.DATABASE,
        context: 'DatabaseAdapter.updateSyncStatus',
        severity: ErrorSeverity.HIGH,
      },
    );
  }

  static async getMessageSequence(messageId: string): Promise<MessageSequence | null> {
    const { data, error } = await this.errorHandler.handleDatabaseOperation(
      async () =>
        supabase.from('message_sequences').select(MESSAGE_SEQUENCE_COLUMNS).eq('message_id', messageId).single(),
      {
        category: ErrorCategory.DATABASE,
        context: 'DatabaseAdapter.getMessageSequence',
        severity: ErrorSeverity.HIGH,
      },
    );

    if (error || !data) return null;
    return TypeConverter.messageSequenceFromDb(data);
  }

  static async getAllMessageSequences(): Promise<MessageSequence[]> {
    const { data, error } = await this.errorHandler.handleDatabaseOperation(
      async () => supabase.from('message_sequences').select(MESSAGE_SEQUENCE_COLUMNS),
      {
        category: ErrorCategory.DATABASE,
        context: 'DatabaseAdapter.getAllMessageSequences',
        severity: ErrorSeverity.HIGH,
      },
    );

    if (error || !data) return [];
    return data.map((record) => TypeConverter.messageSequenceFromDb(record));
  }

  static async getSyncStatus(agentId: string): Promise<SyncStatus | null> {
    const { data, error } = await this.errorHandler.handleDatabaseOperation(
      async () => supabase.from('sync_status').select(SYNC_STATUS_COLUMNS).eq('agent_id', agentId).single(),
      {
        category: ErrorCategory.DATABASE,
        context: 'DatabaseAdapter.getSyncStatus',
        severity: ErrorSeverity.HIGH,
      },
    );

    if (error || !data) return null;
    return TypeConverter.syncStatusFromDb(data);
  }

  static async getLatestSyncStatus(): Promise<SyncStatus | null> {
    const { data, error } = await this.errorHandler.handleDatabaseOperation(
      async () =>
        supabase
          .from('sync_status')
          .select(SYNC_STATUS_COLUMNS)
          .order('last_sync_timestamp', { ascending: false })
          .limit(1)
          .single(),
      {
        category: ErrorCategory.DATABASE,
        context: 'DatabaseAdapter.getLatestSyncStatus',
        severity: ErrorSeverity.HIGH,
      },
    );

    if (error || !data) return null;
    return TypeConverter.syncStatusFromDb(data);
  }

  static async getMessageById(messageId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.errorHandler.handleDatabaseOperation(
      async () =>
        supabase
          .from('agent_communications')
          .select(AGENT_COMMUNICATION_COLUMNS)
          .eq('id', messageId)
          .single(),
      {
        category: ErrorCategory.DATABASE,
        context: 'DatabaseAdapter.getMessageById',
        severity: ErrorSeverity.HIGH,
      },
    );

    if (error || !data) return null;
    return TypeConverter.queuedMessageFromDb(data);
  }
}
