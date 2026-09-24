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
import { Issue1784ApiError, issue1784Api } from '@/services/issue-1784-api';

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

  it('rejects an already-coerced "[object Object]" body instead of returning it as T (#2150)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[object Object]',
    });

    const error = await issue1784Api.getVoiceMappings('session-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Issue1784ApiError);
    expect(error).toMatchObject({ status: 200, code: 'BODY_UNPARSEABLE' });
  });

  it('logs ISSUE1784_BODY_UNPARSEABLE before rejecting an unparseable body', async () => {
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[object Object]',
    });

    await expect(issue1784Api.getVoiceMappings('session-1')).rejects.toBeInstanceOf(
      Issue1784ApiError,
    );
    expect(warnSpy).toHaveBeenCalledWith('ISSUE1784_BODY_UNPARSEABLE', {
      path: '/v1/sessions/session-1/voice-mappings',
      status: 200,
      bodyHead: '[object Object]',
    });
  });

  it('rejects the "[object Object]…" equipment body seen on prod (#2150)', async () => {
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '[object Object][object Object][object Object]',
    });

    await expect(issue1784Api.getCharacterEquipment('character-1')).rejects.toMatchObject({
      name: 'Issue1784ApiError',
      status: 200,
      code: 'BODY_UNPARSEABLE',
    });
  });
});
