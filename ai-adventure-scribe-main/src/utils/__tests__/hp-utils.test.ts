import { describe, it, expect } from 'vitest';
import { getHPColor } from '../hp-utils';

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
