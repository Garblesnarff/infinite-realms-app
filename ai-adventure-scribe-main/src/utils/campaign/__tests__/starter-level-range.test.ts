import { describe, expect, it } from 'vitest';

import { formatStarterLevelRange } from '../starter-level-range';

describe('formatStarterLevelRange', () => {
  it('shows level 1 for the glued Abyssal Descent span', () => {
    expect(formatStarterLevelRange('7-10-11')).toBe('1');
  });

  it('keeps a range that already starts at level 1', () => {
    expect(formatStarterLevelRange('1-5')).toBe('1-5');
    expect(formatStarterLevelRange('1')).toBe('1');
  });

  it('returns null when the campaign has no level range', () => {
    expect(formatStarterLevelRange(null)).toBeNull();
    expect(formatStarterLevelRange('')).toBeNull();
  });
});
