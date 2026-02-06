/**
 * LangGraph Checkpointer
 *
 * State persistence for LangGraph agent graphs.
 * Replaces the custom IndexedDB messaging system with LangGraph's
 * built-in checkpointing mechanism.
 *
 * @module agents/langgraph/checkpointer
 */

import { BaseCheckpointSaver, MemorySaver } from '@langchain/langgraph';
import { CHECKPOINT_CONFIG } from './config';
import { SupabaseCheckpointer } from './persistence/supabase-checkpointer';

/**
 * In-memory checkpointer for development and testing
 *
 * State is lost when the page reloads.
 * Use for development or when persistence is not needed.
 */
export const memoryCheckpointer = new MemorySaver();

type StoredCheckpoint = {
  checkpoint_id: string;
  parent_checkpoint_id?: string | null;
  state: any;
  metadata: any;
  created_at: string;
  updated_at: string;
};

type StoredCheckpointMap = Record<string, StoredCheckpoint[]>;

function canUseLocalStorage(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * LocalStorage-based checkpointer
 *
 * Persists state to browser localStorage.
 * State survives page reloads but not across devices.
 */
export class LocalStorageCheckpointer extends BaseCheckpointSaver {
  private readonly storageKey = 'langgraph_checkpoints';

  private readStore(): StoredCheckpointMap {
    if (!canUseLocalStorage()) return {};
    const raw = localStorage.getItem(this.storageKey);
    if (!raw) return {};
    try {
      return JSON.parse(raw) as StoredCheckpointMap;
    } catch {
      return {};
    }
  }

  private writeStore(store: StoredCheckpointMap): void {
    if (!canUseLocalStorage()) return;
    localStorage.setItem(this.storageKey, JSON.stringify(store));
  }

  private serializeCheckpoint(checkpoint: any): any {
    return {
      ...checkpoint,
      channel_values: JSON.parse(JSON.stringify(checkpoint.channel_values || {})),
    };
  }

  private deserializeCheckpoint(data: any): any {
    return {
      ...data,
      channel_values: data.channel_values || {},
    };
  }

  async put(
    config: { configurable?: { thread_id?: string } },
    checkpoint: any,
    metadata: any,
  ): Promise<void> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) {
      throw new Error('thread_id is required in config.configurable');
    }

    const store = this.readStore();
    const now = new Date().toISOString();
    const entry: StoredCheckpoint = {
      checkpoint_id: checkpoint.id,
      parent_checkpoint_id: metadata?.parent_checkpoint_id ?? null,
      state: this.serializeCheckpoint(checkpoint),
      metadata,
      created_at: now,
      updated_at: now,
    };

    const list = store[threadId] ?? [];
    const existingIndex = list.findIndex((item) => item.checkpoint_id === checkpoint.id);

    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...entry, created_at: list[existingIndex].created_at };
    } else {
      list.unshift(entry);
    }

    store[threadId] = list;
    this.writeStore(store);
    await this.cleanup();
  }

  async get(config: { configurable?: { thread_id?: string } }): Promise<any | undefined> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return undefined;

    const store = this.readStore();
    const list = store[threadId] ?? [];
    if (!list.length) return undefined;

    const latest = list.reduce((acc, item) => {
      if (!acc) return item;
      return new Date(item.created_at).getTime() > new Date(acc.created_at).getTime() ? item : acc;
    }, list[0] as StoredCheckpoint);

    return this.deserializeCheckpoint(latest.state);
  }

  async list(
    config: { configurable?: { thread_id?: string } },
    limit?: number,
  ): Promise<Array<{ checkpoint: any; metadata: any }>> {
    const threadId = config.configurable?.thread_id;
    if (!threadId) return [];

    const store = this.readStore();
    const list = store[threadId] ?? [];
    const sorted = [...list].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const sliced = typeof limit === 'number' ? sorted.slice(0, limit) : sorted;

    return sliced.map((entry) => ({
      checkpoint: this.deserializeCheckpoint(entry.state),
      metadata: entry.metadata,
    }));
  }

  async deleteCheckpoint(threadId: string, checkpointId: string): Promise<void> {
    const store = this.readStore();
    if (!store[threadId]) return;

    store[threadId] = store[threadId].filter((item) => item.checkpoint_id !== checkpointId);
    if (!store[threadId].length) {
      delete store[threadId];
    }
    this.writeStore(store);
  }

  async deleteThread(threadId: string): Promise<void> {
    const store = this.readStore();
    if (store[threadId]) {
      delete store[threadId];
      this.writeStore(store);
    }
  }

  /**
   * Clean up expired checkpoints
   */
  async cleanup(): Promise<void> {
    const now = Date.now();
    const store = this.readStore();
    let hasChanges = false;

    Object.entries(store).forEach(([threadId, checkpoints]) => {
      const filtered = checkpoints.filter((entry) => {
        const createdAt = new Date(entry.created_at).getTime();
        return now - createdAt < CHECKPOINT_CONFIG.ttl;
      });

      if (filtered.length !== checkpoints.length) {
        store[threadId] = filtered;
        hasChanges = true;
      }

      if (!store[threadId].length) {
        delete store[threadId];
        hasChanges = true;
      }
    });

    if (hasChanges) {
      this.writeStore(store);
    }
  }
}

const localStorageCheckpointer = new LocalStorageCheckpointer();
const supabaseCheckpointer = new SupabaseCheckpointer();

/**
 * Get the configured checkpointer based on environment settings
 *
 * @returns Checkpointer instance based on CHECKPOINT_CONFIG.storageType
 */
export function getCheckpointer() {
  switch (CHECKPOINT_CONFIG.storageType) {
    case 'memory':
      return memoryCheckpointer;

    case 'localstorage':
      if (!canUseLocalStorage()) {
        console.warn('[LangGraph] LocalStorage unavailable. Falling back to memory checkpointer.');
        return memoryCheckpointer;
      }
      return localStorageCheckpointer;

    case 'supabase':
      return supabaseCheckpointer;

    default:
      console.warn(
        `[LangGraph] Unknown checkpoint storage type: ${CHECKPOINT_CONFIG.storageType}. ` +
          'Falling back to memory checkpointer.',
      );
      return memoryCheckpointer;
  }
}

/**
 * Default checkpointer instance
 *
 * Use this for most graph compilations unless you need
 * a specific checkpointer implementation.
 */
export const checkpointer = getCheckpointer();
