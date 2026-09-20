import { describe, expect, it } from 'vitest';

import { describeCaughtError } from '../describe-caught-error';

describe('describeCaughtError', () => {
  it('copies name and message from an Error so logs are not empty', () => {
    expect(describeCaughtError(new TypeError('Failed to fetch'))).toEqual({
      name: 'TypeError',
      message: 'Failed to fetch',
    });
  });

  it('stringifies non-Error values', () => {
    expect(describeCaughtError({ code: 'x' })).toEqual({
      name: 'object',
      message: '[object Object]',
    });
  });
});
