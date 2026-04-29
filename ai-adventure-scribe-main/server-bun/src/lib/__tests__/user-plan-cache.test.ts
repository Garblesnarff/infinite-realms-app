import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { UserPlanCache } from '../user-plan-cache.js';

describe('UserPlanCache', () => {
  beforeEach(() => {
    UserPlanCache.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should store and retrieve a plan', () => {
    const userId = 'user_123';
    const plan = 'pro';

    UserPlanCache.set(userId, plan);
    expect(UserPlanCache.get(userId)).toBe(plan);
  });

  it('should return null for missing user', () => {
    expect(UserPlanCache.get('non_existent')).toBe(null);
  });

  it('should expire entries after TTL', () => {
    const userId = 'user_123';
    const plan = 'pro';

    UserPlanCache.set(userId, plan);
    expect(UserPlanCache.get(userId)).toBe(plan);

    // Advance time by 5 minutes + 1 second
    vi.advanceTimersByTime(5 * 60 * 1000 + 1000);

    expect(UserPlanCache.get(userId)).toBe(null);
  });

  it('should invalidate specific user cache', () => {
    const userId = 'user_123';
    UserPlanCache.set(userId, 'pro');
    UserPlanCache.delete(userId);
    expect(UserPlanCache.get(userId)).toBe(null);
  });

  it('should handle capacity limit by clearing', () => {
    // Fill up to max entries (1000)
    for (let i = 0; i < 1000; i++) {
      UserPlanCache.set(`user_${i}`, 'free');
    }

    expect(UserPlanCache.get('user_0')).toBe('free');

    // Add one more to trigger clear
    UserPlanCache.set('user_1000', 'pro');

    // Should have cleared old entries
    expect(UserPlanCache.get('user_0')).toBe(null);
    expect(UserPlanCache.get('user_1000')).toBe('pro');
  });
});
