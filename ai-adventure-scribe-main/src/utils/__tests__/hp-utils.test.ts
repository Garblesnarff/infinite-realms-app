import { describe, it, expect } from 'vitest';

import { getEnemyHealthTier, getHPColor, getHPStatusDescription } from '../hp-utils';

describe('getHPColor', () => {
  it('returns bg-red-500 for HP <= 25%', () => {
    expect(getHPColor(0)).toBe('bg-red-500');
    expect(getHPColor(10)).toBe('bg-red-500');
    expect(getHPColor(25)).toBe('bg-red-500');
  });

  it('returns bg-yellow-500 for HP > 25% and <= 50%', () => {
    expect(getHPColor(26)).toBe('bg-yellow-500');
    expect(getHPColor(40)).toBe('bg-yellow-500');
    expect(getHPColor(50)).toBe('bg-yellow-500');
  });

  it('returns bg-green-500 for HP > 50%', () => {
    expect(getHPColor(51)).toBe('bg-green-500');
    expect(getHPColor(75)).toBe('bg-green-500');
    expect(getHPColor(100)).toBe('bg-green-500');
  });
});

describe('getHPStatusDescription', () => {
  it('returns near death for HP <= 0%', () => {
    expect(getHPStatusDescription(0)).toBe('near death');
    expect(getHPStatusDescription(-5)).toBe('near death');
  });

  it('returns near death for HP > 0% and <= 25%', () => {
    expect(getHPStatusDescription(1)).toBe('near death');
    expect(getHPStatusDescription(25)).toBe('near death');
  });

  it('returns bloodied for HP > 25% and <= 50%', () => {
    expect(getHPStatusDescription(26)).toBe('bloodied');
    expect(getHPStatusDescription(50)).toBe('bloodied');
  });

  it('returns wounded above half and unharmed at full', () => {
    expect(getHPStatusDescription(51)).toBe('wounded');
    expect(getHPStatusDescription(70)).toBe('wounded');
    expect(getHPStatusDescription(100)).toBe('unharmed');
  });

  it('uses the engine tier for an enemy at 70% HP (#863)', () => {
    expect(getEnemyHealthTier(7, 10)).toBe('wounded');
    expect(getEnemyHealthTier(3, 10)).toBe('bloodied');
    expect(getEnemyHealthTier(10, 10)).toBe('unharmed');
    expect(getEnemyHealthTier(0, 10)).toBe('near death');
    expect(getEnemyHealthTier(7, 10)).not.toBe('near death');
  });
});
