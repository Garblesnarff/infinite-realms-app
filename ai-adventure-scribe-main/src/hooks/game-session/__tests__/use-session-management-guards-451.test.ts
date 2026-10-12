import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionManagement } from '../use-session-management';

import type { SessionState } from '../session-utils';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { createSession: vi.fn(), completeSession: vi.fn(), updateSession: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('updateGameSessionState loading/error guards (#451)', () => {
  const setSessionData = vi.fn();
  const setSessionState = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setSessionData.mockImplementation((u) =>
      typeof u === 'function' ? u({ id: 'sess-1', turn_count: 1 }) : u,
    );
    vi.mocked(userDataApi.updateSession).mockResolvedValue({
      id: 'sess-1',
      turn_count: 2,
    } as never);
  });

  const run = async (state: SessionState) => {
    const { result } = renderHook(() =>
      useSessionManagement({
        setSessionData,
        setSessionState,
        sessionStateRef: { current: state },
        mountedRef: { current: true },
        toastRef: { current: vi.fn() },
      }),
    );
    await act(async () => {
      await result.current.updateGameSessionState({ turn_count: 2 });
    });
  };

  it('does not save while the session is loading', async () => {
    await run('loading');
    expect(userDataApi.updateSession).not.toHaveBeenCalled();
  });

  it('does not save while the session is in the error state', async () => {
    await run('error');
    expect(userDataApi.updateSession).not.toHaveBeenCalled();
  });

  it('saves when the session is active', async () => {
    await run('active');
    expect(userDataApi.updateSession).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ turn_count: 2 }),
    );
  });
});
