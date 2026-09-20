import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer access-token' })),
  loadCachedSession: vi.fn(),
  persistSession: vi.fn(),
  refreshAccessTokenOnce: vi.fn(),
}));

import { waitForAuth } from '@/lib/auth-gate';
import { logger } from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';

describe('issue1784Api.getVoiceMappings', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
  });

  it('returns a parsed array when the body is JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify([{ id: 'mapping-1', character_name: 'Rook' }]),
    });

    await expect(issue1784Api.getVoiceMappings('session-1')).resolves.toEqual([
      { id: 'mapping-1', character_name: 'Rook' },
    ]);
  });

  it('does not JSON.parse an already-coerced "[object Object]" body a second time', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[object Object]',
    });

    await expect(issue1784Api.getVoiceMappings('session-1')).resolves.toBe('[object Object]');
  });

  it('logs ISSUE1784_BODY_UNPARSEABLE before returning raw unparseable body', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[object Object]',
    });

    await expect(issue1784Api.getVoiceMappings('session-1')).resolves.toBe('[object Object]');
    expect(warnSpy).toHaveBeenCalledWith('ISSUE1784_BODY_UNPARSEABLE', {
      path: '/v1/sessions/session-1/voice-mappings',
      status: 200,
      bodyHead: '[object Object]',
    });
  });
});
