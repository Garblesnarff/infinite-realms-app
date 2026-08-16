import { describe, expect, it } from 'vitest';

import { parseBoundedInteger } from '../bounded-integer';

describe('parseBoundedInteger', () => {
  const options = { fallback: 3, min: 0, max: 100 };

  it('accepts complete safe integers', () => {
    expect(parseBoundedInteger('42', options)).toBe(42);
    expect(parseBoundedInteger(7, options)).toBe(7);
  });

  it('clamps complete integers to the configured range', () => {
    expect(parseBoundedInteger('-1', options)).toBe(0);
    expect(parseBoundedInteger('101', options)).toBe(100);
  });

  it('can use the safe fallback for out-of-range integers', () => {
    expect(parseBoundedInteger('-1', { ...options, outOfRange: 'fallback' })).toBe(3);
    expect(parseBoundedInteger('101', { ...options, outOfRange: 'fallback' })).toBe(3);
  });

  it.each(['12px', '1.5', '1e2', '0x10', '', 'Infinity', '9007199254740992'])(
    'rejects %j',
    (value) => {
      expect(parseBoundedInteger(value, options)).toBe(3);
    },
  );

  it('uses the fallback for missing values', () => {
    expect(parseBoundedInteger(null, options)).toBe(3);
    expect(parseBoundedInteger(undefined, options)).toBe(3);
  });
});
