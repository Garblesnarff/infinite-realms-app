import { describe, expect, it } from 'bun:test';

import { parseOptionalBoundedInteger } from '../query-integers.js';

describe('class feature integer query parsing', () => {
  it('preserves absence and accepts complete in-range integers', () => {
    expect(parseOptionalBoundedInteger(undefined, 1, 20)).toBeUndefined();
    expect(parseOptionalBoundedInteger('1', 1, 20)).toBe(1);
    expect(parseOptionalBoundedInteger('20', 1, 20)).toBe(20);
  });

  it('rejects partial, fractional, signed, and out-of-range values', () => {
    for (const value of ['2levels', '1.5', '+1', '-1', '0', '21', 'Infinity']) {
      expect(parseOptionalBoundedInteger(value, 1, 20)).toBeNull();
    }
  });

  it('applies the history limit ceiling', () => {
    expect(parseOptionalBoundedInteger('1', 1, 1_000)).toBe(1);
    expect(parseOptionalBoundedInteger('1000', 1, 1_000)).toBe(1_000);
    expect(parseOptionalBoundedInteger('1001', 1, 1_000)).toBeNull();
  });
});
