/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2517: the game screen's load gate. While the vital state is unknown the
 * game must not render (run D2's reload flashed a live composer over a
 * dead character); the single truth is `character_stats.vital_state` in
 * the session load payload.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionVitalGate } from '../use-session-vital-gate';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { fetchSessionFallenState: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const fallenState = {
  characterId: 'char-1',
  characterName: 'The Scholar',
  campaignId: 'camp-1',
  campaignName: 'Abyssal Descent',
  starterCampaignId: null,
  diedAt: '2026-10-02T14:51:00.000Z',
};

describe('useSessionVitalGate (#2517)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stays unknown while the load payload is in flight', async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    vi.mocked(userDataApi.fetchSessionFallenState).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }) as any,
    );

    const { result } = renderHook(() => useSessionVitalGate('session-1'));
    expect(result.current.status).toBe('unknown');

    resolveFetch(null);
    await waitFor(() => {
      expect(result.current.status).toBe('alive');
    });
  });

  it('reports dead with the fallen payload when the character has fallen', async () => {
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(fallenState as any);

    const { result } = renderHook(() => useSessionVitalGate('session-1'));

    await waitFor(() => {
      expect(result.current).toEqual({ status: 'dead', fallen: fallenState });
    });
  });

  it('fails open to the game when the read errors', async () => {
    vi.mocked(userDataApi.fetchSessionFallenState).mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() => useSessionVitalGate('session-1'));

    await waitFor(() => {
      expect(result.current.status).toBe('alive');
    });
  });

  it('stays unknown without a session id', () => {
    const { result } = renderHook(() => useSessionVitalGate(null));
    expect(result.current.status).toBe('unknown');
    expect(userDataApi.fetchSessionFallenState).not.toHaveBeenCalled();
  });
});
