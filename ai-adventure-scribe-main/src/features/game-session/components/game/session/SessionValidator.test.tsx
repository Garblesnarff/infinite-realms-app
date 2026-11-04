import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionValidator } from './SessionValidator';

import type * as UserDataApiModule from '@/services/user-data-api';

import { SessionExpiredError } from '@/infrastructure/api/rest-client';
import logger from '@/lib/logger';
import {
  TokenRefreshTransientError,
  TokenRefreshTransportError,
} from '@/services/auth/TokenService';
import { UserDataApiRequestError, userDataApi } from '@/services/user-data-api';

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

vi.mock('@/services/user-data-api', async (importOriginal) => {
  const actual = await importOriginal<UserDataApiModule>();
  return {
    ...actual,
    userDataApi: {
      getSession: vi.fn(),
    },
  };
});

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
    vi.mocked(userDataApi.getSession).mockRejectedValueOnce(new SessionExpiredError());

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
      new UserDataApiRequestError('Not found', 404, {}),
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

  it('shows a connection message when the refresh endpoint fails transiently (#1113)', async () => {
    vi.mocked(userDataApi.getSession).mockRejectedValueOnce(
      new TokenRefreshTransientError('Token refresh failed with status 503', 503),
    );

    const { result } = renderHook(() =>
      useSessionValidator({
        sessionId: 'session-1',
        campaignId: 'campaign-1',
        characterId: 'character-1',
      }),
    );

    let isValid = true;
    await act(async () => {
      isValid = await result.current();
    });

    expect(isValid).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Connection problem — try again' }),
    );
  });

  it('shows a connection message when the refresh endpoint is unreachable (#1113)', async () => {
    vi.mocked(userDataApi.getSession).mockRejectedValueOnce(new TokenRefreshTransportError());

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
      expect.objectContaining({ description: 'Connection problem — try again' }),
    );
  });

  it('keeps the retry message when the session belongs to another campaign or character (#1113)', async () => {
    vi.mocked(userDataApi.getSession).mockResolvedValueOnce({
      campaign_id: 'campaign-2',
      character_id: 'character-1',
    });

    const { result } = renderHook(() =>
      useSessionValidator({
        sessionId: 'session-1',
        campaignId: 'campaign-1',
        characterId: 'character-1',
      }),
    );

    let isValid = true;
    await act(async () => {
      isValid = await result.current();
    });

    expect(isValid).toBe(false);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Unable to verify this game session. Please try again.',
      }),
    );
    expect(toast).not.toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Invalid game session. Please try starting a new game.',
      }),
    );
  });
});
