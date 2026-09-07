import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayerRollHost } from '../use-player-roll-host';

import { useGame } from '@/contexts/GameContext';
import {
  hasPendingPlayerRoll,
  requestPlayerInitiativeRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';

vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));

describe('usePlayerRollHost teardown', () => {
  const requestDiceRoll = vi.fn().mockReturnValue('initiative-roll-1');
  const cancelDiceRoll = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.clearAllMocks();
    requestDiceRoll.mockReturnValue('initiative-roll-1');
    vi.mocked(useGame).mockReturnValue({ requestDiceRoll, cancelDiceRoll } as never);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('settles the initiative prompt and clears its timer when the host unmounts', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });

    expect(vi.getTimerCount()).toBe(1);
    unmount();

    await expect(pending).resolves.toEqual({ d20: null });
    expect(cancelDiceRoll).toHaveBeenCalledWith('initiative-roll-1');
    expect(vi.getTimerCount()).toBe(0);
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('uses the initiative modifier in the popup roll config and description', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 1,
    });

    expect(requestDiceRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Initiative for The Seeker — 1d20+1',
        rollConfig: { dieType: 20, count: 1, modifier: 1 },
        combatInitiativeRoll: true,
      }),
    );

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });
});
