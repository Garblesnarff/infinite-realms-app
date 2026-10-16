import { describe, expect, it } from 'vitest';

import { getLastRequestId, installRequestIdCapture } from './request-id';

describe('installRequestIdCapture', () => {
  it('records the x-request-id header from a wrapped fetch response', async () => {
    const target = {
      fetch: async () => new Response('{}', { headers: { 'x-request-id': 'req-abc' } }),
    };
    installRequestIdCapture(target);
    await target.fetch();
    expect(getLastRequestId()).toBe('req-abc');
  });

  it('leaves the last id alone when a response has no header', async () => {
    const withHeader = {
      fetch: async () => new Response('{}', { headers: { 'x-request-id': 'req-keep' } }),
    };
    installRequestIdCapture(withHeader);
    await withHeader.fetch();
    const withoutHeader = { fetch: async () => new Response('{}') };
    installRequestIdCapture(withoutHeader);
    await withoutHeader.fetch();
    expect(getLastRequestId()).toBe('req-keep');
  });

  it('wraps a target only once', async () => {
    let calls = 0;
    const target = {
      fetch: async () => {
        calls += 1;
        return new Response('{}');
      },
    };
    installRequestIdCapture(target);
    installRequestIdCapture(target);
    await target.fetch();
    expect(calls).toBe(1);
  });
});
