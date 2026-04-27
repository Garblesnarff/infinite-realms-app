/**
 * User Plan Cache
 *
 * In-memory TTL cache for user subscription plans to reduce redundant
 * database lookups on every authenticated request.
 *
 * ⚡ Bolt: This eliminates 1 query per request for both tRPC and REST.
 */

interface CacheEntry {
  plan: string;
  expiresAt: number;
}

export class UserPlanCache {
  private static cache = new Map<string, CacheEntry>();
  private static readonly TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly MAX_ENTRIES = 1000;

  /**
   * Get a cached plan for a user
   */
  static get(userId: string): string | null {
    const entry = this.cache.get(userId);
    if (!entry) return null;

    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(userId);
      return null;
    }

    return entry.plan;
  }

  /**
   * Set a cached plan for a user
   */
  static set(userId: string, plan: string): void {
    // Capacity management: if cache is full, clear it to prevent memory leaks
    if (this.cache.size >= this.MAX_ENTRIES) {
      this.cache.clear();
    }

    this.cache.set(userId, {
      plan,
      expiresAt: Date.now() + this.TTL_MS,
    });
  }

  /**
   * Invalidate cache for a user
   */
  static delete(userId: string): void {
    this.cache.delete(userId);
  }

  /**
   * Clear all entries (mostly for testing)
   */
  static clear(): void {
    this.cache.clear();
  }
}
