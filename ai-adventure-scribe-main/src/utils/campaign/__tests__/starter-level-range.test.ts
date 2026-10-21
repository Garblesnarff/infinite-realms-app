import { describe, expect, it } from 'vitest';

import { formatStarterLevelRange } from '../starter-level-range';

describe('formatStarterLevelRange', () => {
  it('shows the first-to-last range for the glued Abyssal Descent span', () => {
    expect(formatStarterLevelRange('7-10-11')).toBe('7-11');
  });

  it('shows a single level when start and finish agree', () => {
    expect(formatStarterLevelRange('3-3')).toBe('3');
    expect(formatStarterLevelRange('3')).toBe('3');
  });

  it('shows the real range for a level-3 one-shot span', () => {
    expect(formatStarterLevelRange('3-4')).toBe('3-4');
  });

  it('keeps a range that already starts at level 1', () => {
    expect(formatStarterLevelRange('1-5')).toBe('1-5');
    expect(formatStarterLevelRange('1')).toBe('1');
    expect(formatStarterLevelRange('1-1')).toBe('1');
  });

  it('returns null when the campaign has no level range', () => {
    expect(formatStarterLevelRange(null)).toBeNull();
    expect(formatStarterLevelRange('')).toBeNull();
  });
});
