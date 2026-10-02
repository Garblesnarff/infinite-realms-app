import { describe, expect, it } from 'vitest';

import { planHasPaidFeatures } from '../../shared/plan-features';

describe('planHasPaidFeatures (#2474)', () => {
  it.each(['pro', 'enterprise', 'tester'])('is true for %s', (plan) => {
    expect(planHasPaidFeatures(plan)).toBe(true);
  });

  it('is false for free', () => {
    expect(planHasPaidFeatures('free')).toBe(false);
  });

  it('is false while the plan is unknown or not a plan name', () => {
    expect(planHasPaidFeatures(null)).toBe(false);
    expect(planHasPaidFeatures(undefined)).toBe(false);
    expect(planHasPaidFeatures('')).toBe(false);
    expect(planHasPaidFeatures('platinum')).toBe(false);
  });

  it('ignores case, as the server lowercases plans', () => {
    expect(planHasPaidFeatures('Tester')).toBe(true);
  });
});
