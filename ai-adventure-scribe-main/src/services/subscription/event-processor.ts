import type { PostgresEvent, TableSubscription } from './types';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import logger from '@/lib/logger';


/**
 * Handles table update events by dispatching to registered callbacks
 */
export function processTableEvent(
  tableName: string,
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  subscription: TableSubscription,
): void {
  const newPayload = payload.new as Record<string, unknown> | null;
  const oldPayload = payload.old as Record<string, unknown> | null;
  const recordId = newPayload?.id ?? oldPayload?.id;

  if (typeof recordId === 'string' || typeof recordId === 'number') {
    subscription.recordCallbacks.forEach((callbackData) => {
      if (callbackData.recordId === String(recordId)) {
        const newImageUrl = (newPayload ?? {})[callbackData.imageField] as
          | string
          | null
          | undefined;
        const oldImageUrl = (oldPayload ?? {})[callbackData.imageField] as
          | string
          | null
          | undefined;

        if (newImageUrl !== oldImageUrl) {
          logger.info(`Image updated for ${tableName} ${recordId}: ${newImageUrl}`);
          callbackData.callback(newImageUrl || null);
        }
      }
    });
  }

  if (subscription.eventCallbacks.size > 0) {
    subscription.eventCallbacks.forEach((callbackData) => {
      const eventType = payload.eventType as PostgresEvent | undefined;
      if (!eventType || !callbackData.events.includes(eventType)) {
        return;
      }

      try {
        if (!callbackData.filter || callbackData.filter(payload)) {
          callbackData.callback(payload);
        }
      } catch (error) {
        logger.error(`Error running subscription callback for ${tableName}:`, error);
      }
    });
  }
}
