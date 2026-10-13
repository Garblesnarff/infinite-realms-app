import { describe, expect, it } from 'bun:test';

import { parseBoundedIntegerCore } from '../bounded-integer.js';

describe('parseBoundedIntegerCore', () => {
  const baseOptions = {
    min: 0,
    max: 100,
    invalidFallback: -1,
  };

  it('parses valid in-range integer strings', () => {
    expect(parseBoundedIntegerCore('42', baseOptions)).toBe(42);
    expect(parseBoundedIntegerCore('0', baseOptions)).toBe(0);
    expect(parseBoundedIntegerCore('100', baseOptions)).toBe(100);
  });

  it('handles whitespace with trim option', () => {
    expect(parseBoundedIntegerCore('  42  ', { ...baseOptions, trim: true })).toBe(42);
    expect(parseBoundedIntegerCore('  42  ', { ...baseOptions, trim: false })).toBe(-1);
  });

  it('handles signed integers with allowSigned option', () => {
    const optionsWithSigned = { ...baseOptions, min: -50, max: 50, allowSigned: true };
    const optionsWithoutSigned = { ...baseOptions, min: -50, max: 50, allowSigned: false };

    expect(parseBoundedIntegerCore('-25', optionsWithSigned)).toBe(-25);
    expect(parseBoundedIntegerCore('-25', optionsWithoutSigned)).toBe(-1);
    expect(parseBoundedIntegerCore('+25', optionsWithSigned)).toBe(-1);
  });

  it('handles numeric input with allowNumbers option', () => {
    expect(parseBoundedIntegerCore(42, { ...baseOptions, allowNumbers: true })).toBe(42);
    expect(parseBoundedIntegerCore(42, { ...baseOptions, allowNumbers: false })).toBe(-1);
  });

  it('clamps out-of-range values by default', () => {
    expect(parseBoundedIntegerCore('-10', { ...baseOptions, allowSigned: true })).toBe(0);
    expect(parseBoundedIntegerCore('150', baseOptions)).toBe(100);
  });

  it('rejects out-of-range values when outOfRange is reject', () => {
    expect(
      parseBoundedIntegerCore('150', {
        ...baseOptions,
        outOfRange: 'reject',
        outOfRangeFallback: 'REJECTED',
      }),
    ).toBe('REJECTED');
  });

  it('rejects invalid or unsafe string representations', () => {
    for (const val of ['1.5', '42px', '1e2', '0x10', '', 'Infinity', 'NaN', '9007199254740992']) {
      expect(parseBoundedIntegerCore(val, baseOptions)).toBe(-1);
    }
  });

  it('rejects non-string/non-number inputs', () => {
    for (const val of [null, undefined, {}, [], true, false]) {
      expect(parseBoundedIntegerCore(val, baseOptions)).toBe(-1);
    }
  });
});
