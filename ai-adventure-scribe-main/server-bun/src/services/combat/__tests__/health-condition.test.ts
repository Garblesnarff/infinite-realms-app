import { describe, expect, it } from 'bun:test';

import { healthConditionForCombat } from '../health-condition.js';

describe('authoritative combat health condition', () => {
  it('uses the four player-facing tiers without exposing numeric HP', () => {
    expect(healthConditionForCombat(30, 30)).toBe('unharmed');
    expect(healthConditionForCombat(29, 30)).toBe('wounded');
    expect(healthConditionForCombat(15, 30)).toBe('bloodied');
    expect(healthConditionForCombat(7, 30)).toBe('near death');
  });

  it('reports downed and dead targets as near death', () => {
    expect(healthConditionForCombat(0, 30, false)).toBe('near death');
    expect(healthConditionForCombat(0, 30, false, true)).toBe('near death');
  });
});
