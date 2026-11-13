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

  it('does not call 70% HP near death (#863)', () => {
    expect(healthConditionForCombat(7, 10)).toBe('wounded');
    expect(healthConditionForCombat(70, 100)).toBe('wounded');
    expect(healthConditionForCombat(3, 10)).toBe('bloodied');
    expect(healthConditionForCombat(5, 20)).toBe('near death');
    expect(healthConditionForCombat(6, 20)).toBe('bloodied');
    expect(healthConditionForCombat(14, 20)).toBe('wounded');
  });
});
