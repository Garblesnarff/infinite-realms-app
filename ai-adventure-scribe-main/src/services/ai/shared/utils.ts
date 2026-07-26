/**
 * Shared utility functions for AI service modules
 * Extracted from ai-service.ts for reusability
 */

import logger from '@/lib/logger';

// In-flight request deduplication with 2s TTL
const inFlight = new Map<string, { ts: number; promise: Promise<unknown> }>();
const DEDUPE_MS = 2000;

/**
 * Generate cache key for deduplication
 */
export function keyFor(sessionId: string | undefined, message: string, historyLen: number): string {
  return `${sessionId || 'nosession'}|${message.slice(0, 256)}|${historyLen}`;
}

/**
 * Get or create deduplicated promise
 */
export function getOrCreateDeduped<T>(key: string, factory: () => Promise<T>): Promise<T> {
  const now = Date.now();

  // Clean up expired entries
  for (const [k, v] of inFlight) {
    if (now - v.ts > DEDUPE_MS) {
      inFlight.delete(k);
    }
  }

  // Return existing if found
  if (inFlight.has(key)) {
    logger.debug('[AIService] Deduping in-flight call:', key);
    return inFlight.get(key)!.promise as Promise<T>;
  }

  // Create new promise
  const promise = factory();
  inFlight.set(key, { ts: now, promise });

  return promise;
}
