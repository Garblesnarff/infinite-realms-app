import { describe, expect, test } from 'bun:test';

import { parseBoundedQueryInteger } from '../bounded-query-integer.js';

describe('parseBoundedQueryInteger', () => {
  const bounds = { min: 1, max: 100 };

  test('accepts complete decimal integers', () => {
    expect(parseBoundedQueryInteger('1', bounds)).toBe(1);
    expect(parseBoundedQueryInteger('50', bounds)).toBe(50);
    expect(parseBoundedQueryInteger('100', bounds)).toBe(100);
  });

  test('clamps complete integers to the requested range', () => {
    expect(parseBoundedQueryInteger('0', bounds)).toBe(1);
    expect(parseBoundedQueryInteger('101', bounds)).toBe(100);
  });

  test.each(['', '-1', '10rows', '1.5', '1e2', '9007199254740992'])('rejects %s', (value) => {
    expect(parseBoundedQueryInteger(value, bounds)).toBeUndefined();
  });

  test('rejects missing and non-string query values', () => {
    expect(parseBoundedQueryInteger(undefined, bounds)).toBeUndefined();
    expect(parseBoundedQueryInteger(50, bounds)).toBeUndefined();
  });
});
