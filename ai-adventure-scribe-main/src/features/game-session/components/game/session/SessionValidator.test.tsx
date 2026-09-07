import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
});
