import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

export type PostgresEvent = 'INSERT' | 'UPDATE' | 'DELETE';

export interface RecordSubscriptionCallback {
  id: string;
  recordId: string;
  imageField: string;
  callback: (imageUrl: string | null) => void;
}

export interface EventSubscriptionCallback {
  id: string;
  events: PostgresEvent[];
  filter?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => boolean;
  callback: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
}

export interface TableSubscription {
  channel: RealtimeChannel | null;
  recordCallbacks: Map<string, RecordSubscriptionCallback>;
  eventCallbacks: Map<string, EventSubscriptionCallback>;
  retryCount: number;
  isConnected: boolean;
  isConnecting: boolean;
  lastRetry: number;
  connectionTimeoutId: ReturnType<typeof setTimeout> | null;
  cleanupTimeoutId: ReturnType<typeof setTimeout> | null;
  disabled: boolean;
}
