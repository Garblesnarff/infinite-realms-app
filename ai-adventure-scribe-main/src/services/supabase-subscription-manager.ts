
import type {
  PostgresEvent,
  TableSubscription,
} from '@/services/subscription/types';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';
import { processTableEvent } from '@/services/subscription/event-processor';
import { handleStatusChange, handleFailure } from '@/services/subscription/status-manager';
import { addNetworkListener, isOffline } from '@/utils/network';



/**
 * Centralized Supabase subscription manager
 * Pools connections by table to prevent over-subscription
 */
class SupabaseSubscriptionManager {
  private subscriptions = new Map<string, TableSubscription>();
  private readonly maxRetries = 2;
  private readonly retryDelay = 5000; // 5 seconds
  private readonly connectionTimeout = 15000; // 15 seconds
  private readonly cleanupDelay = 3000; // 3 seconds grace period before tearing down

  constructor() {
    if (typeof window !== 'undefined') {
      addNetworkListener('online', () => {
        logger.info('Network restored, reinitializing Supabase subscriptions');
        this.reconnectAll();
      });
      addNetworkListener('offline', () => {
        logger.info('Network lost, suspending Supabase subscriptions');
        this.suspendAll();
      });
    }
  }

  /**
   * Subscribe to image updates for a specific record
   */
  subscribe(
    tableName: string,
    recordId: string,
    imageField: string,
    callback: (imageUrl: string | null) => void,
  ): string {
    const callbackId = `${recordId}_${imageField}_${Date.now()}`;

    // Get or create table subscription
    if (!this.subscriptions.has(tableName)) {
      this.subscriptions.set(tableName, {
        channel: null,
        recordCallbacks: new Map(),
        eventCallbacks: new Map(),
        retryCount: 0,
        isConnected: false,
        isConnecting: false,
        lastRetry: 0,
        connectionTimeoutId: null,
        cleanupTimeoutId: null,
        disabled: false,
      });
    }

    const subscription = this.subscriptions.get(tableName)!;

    if (subscription.cleanupTimeoutId) {
      clearTimeout(subscription.cleanupTimeoutId);
      subscription.cleanupTimeoutId = null;
    }

    // Add callback
    subscription.recordCallbacks.set(callbackId, {
      id: callbackId,
      recordId,
      imageField,
      callback,
    });

    // Setup or reuse channel
    this.ensureChannelConnected(tableName);

    return callbackId;
  }

  /**
   * Unsubscribe a specific callback
   */
  unsubscribe(tableName: string, callbackId: string): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    subscription.recordCallbacks.delete(callbackId);

    this.scheduleCleanupIfIdle(tableName, subscription);
  }

  subscribeToEvents(
    tableName: string,
    options: {
      events?: PostgresEvent[];
      filter?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => boolean;
      callback: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
    },
  ): string {
    const callbackId = `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    if (!this.subscriptions.has(tableName)) {
      this.subscriptions.set(tableName, {
        channel: null,
        recordCallbacks: new Map(),
        eventCallbacks: new Map(),
        retryCount: 0,
        isConnected: false,
        isConnecting: false,
        lastRetry: 0,
        connectionTimeoutId: null,
        cleanupTimeoutId: null,
        disabled: false,
      });
    }

    const subscription = this.subscriptions.get(tableName)!;

    if (subscription.cleanupTimeoutId) {
      clearTimeout(subscription.cleanupTimeoutId);
      subscription.cleanupTimeoutId = null;
    }

    subscription.eventCallbacks.set(callbackId, {
      id: callbackId,
      events: options.events ?? ['INSERT', 'UPDATE', 'DELETE'],
      filter: options.filter,
      callback: options.callback,
    });

    this.ensureChannelConnected(tableName);

    return callbackId;
  }

  unsubscribeFromEvents(tableName: string, callbackId: string): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    subscription.eventCallbacks.delete(callbackId);

    this.scheduleCleanupIfIdle(tableName, subscription);
  }

  /**
   * Ensure a table has an active realtime channel
   */
  private ensureChannelConnected(tableName: string): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    const hasCallbacks =
      subscription.recordCallbacks.size > 0 || subscription.eventCallbacks.size > 0;

    if (!hasCallbacks) {
      return;
    }

    if (isOffline()) {
      logger.info(`Skipping ${tableName} subscription setup while offline`);
      subscription.isConnected = false;
      return;
    }

    // Skip if already connected or recently retried
    if (
      subscription.isConnected ||
      subscription.isConnecting ||
      Date.now() - subscription.lastRetry < this.retryDelay
    ) {
      return;
    }

    // Skip if max retries exceeded
    if (subscription.retryCount >= this.maxRetries) {
      logger.warn(`Max retries reached for ${tableName} subscription, skipping`);
      subscription.disabled = true;
      return;
    }

    if (subscription.disabled) {
      logger.warn(`Realtime disabled for ${tableName} subscription, skipping`);
      return;
    }

    this.setupChannel(tableName);
  }

  /**
   * Setup realtime channel for a table
   */
  private setupChannel(tableName: string): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    if (isOffline()) {
      logger.info(`Deferring ${tableName} channel setup until back online`);
      subscription.isConnected = false;
      subscription.isConnecting = false;
      return;
    }

    // Clean up existing channel
    if (subscription.channel) {
      supabase.removeChannel(subscription.channel);
    }

    logger.info(`Setting up shared channel for ${tableName}`);
    subscription.lastRetry = Date.now();
    subscription.isConnecting = true;

    const channel = supabase
      .channel(`shared_${tableName}_updates`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: tableName,
        },
        (payload) => {
          this.handleTableEvent(
            tableName,
            payload as RealtimePostgresChangesPayload<Record<string, unknown>>,
          );
        },
      )
      .subscribe((status) => {
        this.handleSubscriptionStatus(tableName, status);
      });

    subscription.channel = channel;

    // Set connection timeout
    if (subscription.connectionTimeoutId) {
      clearTimeout(subscription.connectionTimeoutId);
    }

    const expectedChannel = channel;
    subscription.connectionTimeoutId = setTimeout(() => {
      if (
        !subscription.isConnected &&
        subscription.channel === expectedChannel &&
        !subscription.disabled
      ) {
        logger.warn(`Connection timeout for ${tableName} subscription`);
        this.handleConnectionFailure(tableName);
      }
    }, this.connectionTimeout);
  }

  /**
   * Handle table update events
   */
  private handleTableEvent(
    tableName: string,
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  ): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    processTableEvent(tableName, payload, subscription);
  }

  /**
   * Handle subscription status changes
   */
  private handleSubscriptionStatus(tableName: string, status: string): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    handleStatusChange(tableName, status, subscription, () => this.handleConnectionFailure(tableName));
  }

  /**
   * Handle connection failures with exponential backoff
   */
  private handleConnectionFailure(tableName: string): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    handleFailure(tableName, subscription, {
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay,
      retryAction: (t) => this.setupChannel(t),
    });
  }

  private reconnectAll(): void {
    this.subscriptions.forEach((_subscription, tableName) => {
      const subscription = this.subscriptions.get(tableName);
      if (!subscription) return;

      if (subscription.channel) {
        supabase.removeChannel(subscription.channel);
        subscription.channel = null;
      }

      subscription.isConnected = false;
      subscription.retryCount = 0;
      subscription.isConnecting = false;
      subscription.disabled = false;
      if (subscription.connectionTimeoutId) {
        clearTimeout(subscription.connectionTimeoutId);
        subscription.connectionTimeoutId = null;
      }
      if (subscription.cleanupTimeoutId) {
        clearTimeout(subscription.cleanupTimeoutId);
        subscription.cleanupTimeoutId = null;
      }
      this.ensureChannelConnected(tableName);
    });
  }

  private suspendAll(): void {
    this.subscriptions.forEach((subscription, tableName) => {
      if (subscription.channel) {
        supabase.removeChannel(subscription.channel);
        subscription.channel = null;
      }
      subscription.isConnected = false;
      subscription.isConnecting = false;
      subscription.lastRetry = Date.now();
      if (subscription.connectionTimeoutId) {
        clearTimeout(subscription.connectionTimeoutId);
        subscription.connectionTimeoutId = null;
      }
      if (subscription.cleanupTimeoutId) {
        clearTimeout(subscription.cleanupTimeoutId);
        subscription.cleanupTimeoutId = null;
      }
      logger.info(`Suspended ${tableName} subscription due to offline status`);
    });
  }

  /**
   * Clean up a table subscription
   */
  private cleanupTableSubscription(tableName: string): void {
    const subscription = this.subscriptions.get(tableName);
    if (!subscription) return;

    logger.info(`Cleaning up ${tableName} subscription`);

    if (subscription.channel) {
      supabase.removeChannel(subscription.channel);
    }

    if (subscription.connectionTimeoutId) {
      clearTimeout(subscription.connectionTimeoutId);
    }

    if (subscription.cleanupTimeoutId) {
      clearTimeout(subscription.cleanupTimeoutId);
    }

    this.subscriptions.delete(tableName);
  }

  private scheduleCleanupIfIdle(tableName: string, subscription: TableSubscription): void {
    if (subscription.recordCallbacks.size > 0 || subscription.eventCallbacks.size > 0) {
      return;
    }

    if (subscription.cleanupTimeoutId) {
      clearTimeout(subscription.cleanupTimeoutId);
    }

    subscription.cleanupTimeoutId = setTimeout(() => {
      this.cleanupTableSubscription(tableName);
    }, this.cleanupDelay);
  }

  /**
   * Clean up all subscriptions (for app shutdown)
   */
  cleanup(): void {
    logger.info('Cleaning up all Supabase subscriptions');

    this.subscriptions.forEach((subscription, _tableName) => {
      if (subscription.channel) {
        supabase.removeChannel(subscription.channel);
      }
      if (subscription.connectionTimeoutId) {
        clearTimeout(subscription.connectionTimeoutId);
      }
      if (subscription.cleanupTimeoutId) {
        clearTimeout(subscription.cleanupTimeoutId);
      }
    });

    this.subscriptions.clear();
  }
}

// Export singleton instance
export const subscriptionManager = new SupabaseSubscriptionManager();

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    subscriptionManager.cleanup();
  });
}
