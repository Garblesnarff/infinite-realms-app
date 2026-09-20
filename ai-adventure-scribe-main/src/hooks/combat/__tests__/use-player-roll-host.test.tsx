import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { usePlayerRollHost } from '../use-player-roll-host';

import { useCharacter } from '@/contexts/CharacterContext';
import { useGame } from '@/contexts/GameContext';
import { useDiceRollRequest } from '@/hooks/game/use-dice-roll-request';
import {
  hasPendingPlayerRoll,
  markPlayerRollCommitted,
  requestPlayerInitiativeRoll,
  requestPlayerAttackRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';

vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/contexts/CharacterContext', () => ({ useCharacter: vi.fn() }));

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
    vi.mocked(useCharacter).mockReturnValue({ state: { character: null } } as never);
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

  it('uses the same attack modifier in the popup description and roll config', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      actorLabel: 'The Seeker',
      targetLabel: 'Sentient Glaze',
      weaponName: 'Longsword',
      attackBonus: 1,
      targetAc: 15,
      advantage: false,
      disadvantage: false,
    });

    expect(requestDiceRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Longsword attack vs Sentient Glaze — 1d20+1 vs AC 15',
        rollConfig: expect.objectContaining({ modifier: 1 }),
      }),
    );

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });

  it('describes a spell-attack popup without claiming an AC line', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerAttackRoll({
      kind: 'spell-attack',
      actorLabel: 'Rook',
      targetLabel: 'Professor Umeboshi',
      weaponName: 'Fire Bolt',
      attackBonus: 0,
      targetAc: 0,
      advantage: false,
      disadvantage: false,
    });

    expect(requestDiceRoll).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Fire Bolt spell attack vs Professor Umeboshi',
        combatAttackRoll: true,
      }),
    );
    expect(requestDiceRoll.mock.calls[0][0].ac).toBeUndefined();

    settlePendingPlayerRoll({ d20: 12 });
    await expect(pending).resolves.toEqual({ d20: 12 });
    unmount();
  });

  it('calls the initiative commit signal before the roll animation starts', async () => {
    const { unmount } = renderHook(() => usePlayerRollHost());
    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });
    const animationStarted = { current: false };
    const onRollCommit = vi.fn(() => {
      expect(animationStarted.current).toBe(false);
      expect(markPlayerRollCommitted('initiative-roll-1')).toBe(true);
    });
    const { result: diceResult } = renderHook(() =>
      useDiceRollRequest({
        request: {
          type: 'initiative',
          formula: '1d20+2',
          purpose: 'Initiative for The Seeker',
        },
        onManualResult: vi.fn(),
        onRollCommit,
      }),
    );

    act(() => {
      diceResult.current.handleAutoRoll();
      animationStarted.current = diceResult.current.showDiceAnimation;
    });

    expect(onRollCommit).toHaveBeenCalledTimes(1);
    expect(diceResult.current.showDiceAnimation).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    unmount();
    await expect(pending).resolves.toEqual({ d20: null });
  });
});
