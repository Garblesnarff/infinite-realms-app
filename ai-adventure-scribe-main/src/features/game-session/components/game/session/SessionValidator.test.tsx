import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionValidator } from './SessionValidator';

import logger from '@/lib/logger';
import { userDataApi } from '@/services/user-data-api';

const toast = vi.fn();

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast }),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSession: vi.fn(),
  },
}));

describe('useSessionValidator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the validation error object with the failure message', async () => {
    const error = new Error('session lookup failed');
    vi.mocked(userDataApi.getSession).mockRejectedValueOnce(error);

    const { result } = renderHook(() =>
      useSessionValidator({
        sessionId: 'session-1',
        campaignId: 'campaign-1',
        characterId: 'character-1',
      }),
    );

    await act(async () => {
      await result.current();
    });

    expect(logger.error).toHaveBeenCalledWith('Session validation failed:', { error });
  });

  it('does not mislabel an authentication failure as an invalid game session', async () => {
    vi.mocked(userDataApi.getSession).mockRejectedValueOnce(
      Object.assign(new Error('Session expired — sign in again'), { status: 401 }),
    );

    const { result } = renderHook(() =>
      useSessionValidator({
        sessionId: 'session-1',
        campaignId: 'campaign-1',
        characterId: 'character-1',
      }),
    );

    await act(async () => {
      await result.current();
    });

    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps the invalid-session message for a missing session', async () => {
    vi.mocked(userDataApi.getSession).mockRejectedValueOnce(
      Object.assign(new Error('Not found'), { status: 404 }),
    );

    const { result } = renderHook(() =>
      useSessionValidator({
        sessionId: 'session-1',
        campaignId: 'campaign-1',
        characterId: 'character-1',
      }),
    );

    await act(async () => {
      await result.current();
    });

    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Invalid game session. Please try starting a new game.',
      }),
    );
  });
});
