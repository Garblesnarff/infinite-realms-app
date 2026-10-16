import { describe, expect, it } from 'vitest';

import { failVerdict } from './fail-rules';

describe('failVerdict', () => {
  it('passes a clean run with no errors and a summary showing no failed turns', () => {
    expect(failVerdict({ errors: [], summary: { turnsFailed: 0 } })).toBeNull();
  });

  it('fails on a server 500 by status', () => {
    expect(failVerdict({ errors: [{ status: 500, message: 'boom' }] })).toBe('server error: boom');
  });

  it('fails on a 5xx status without a message', () => {
    expect(failVerdict({ errors: [{ status: 503 }] })).toBe('server error 503');
  });

  it('fails when a message carries a 5xx code', () => {
    expect(failVerdict({ errors: [{ message: 'HTTP 502 from upstream' }] })).toBe(
      'server error: HTTP 502 from upstream',
    );
  });

  it('ignores 4xx errors', () => {
    expect(failVerdict({ errors: [{ status: 404, message: 'not found' }] })).toBeNull();
  });

  it('fails on a summary verdict', () => {
    expect(failVerdict({ errors: [], summary: { verdict: 'Dead end: no options' } })).toBe(
      'Dead end: no options',
    );
  });

  it('fails on a failed auto turn', () => {
    expect(failVerdict({ errors: [], summary: { turnsFailed: 1 } })).toBe('lost turn');
  });
});
