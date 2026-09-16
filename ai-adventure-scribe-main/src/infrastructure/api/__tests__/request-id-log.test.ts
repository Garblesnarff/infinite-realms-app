import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logServerRequestId } from '../request-id-log';

import logger from '@/lib/logger';

vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const res = (status: number, id: string | null = 'req-abc') =>
  ({
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => (k === 'x-request-id' ? id : null) },
  }) as unknown as Response;

describe('logServerRequestId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs /v1/llm at info on success — debug is compiled out in production (#2050 D)', () => {
    const returned = logServerRequestId('/v1/llm/generate', res(200), 8645.13);
    expect(returned).toBe('req-abc');
    expect(logger.info).toHaveBeenCalledWith('[api] llm request', {
      route: '/v1/llm/generate',
      status: 200,
      requestId: 'req-abc',
      durationMs: 8645,
    });
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('still logs /v1/llm at info on a failure', () => {
    logServerRequestId('/v1/llm/extract', res(502));
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps /v1/combat at debug on success and warn on failure', () => {
    logServerRequestId('/v1/combat/x/intent', res(200));
    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.info).not.toHaveBeenCalled();

    vi.clearAllMocks();
    logServerRequestId('/v1/combat/x/intent', res(409));
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('returns the id so a caller can attach it to its own failure log', () => {
    expect(logServerRequestId('/v1/llm/generate', res(200))).toBe('req-abc');
  });

  it('is a no-op when the header is absent or the response is header-less', () => {
    expect(logServerRequestId('/v1/llm/generate', res(200, null))).toBeNull();
    expect(logServerRequestId('/v1/llm/generate', {} as unknown as Response)).toBeNull();
    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
