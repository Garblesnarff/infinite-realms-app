import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useMessageDiceRolls, ROLL_RESULT_FLASH_MS } from '../use-message-dice-rolls';

import { useGame } from '@/contexts/GameContext';

vi.mock('@/contexts/GameContext', () => ({ useGame: vi.fn() }));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({
  settleCombatAttackRoll: vi.fn(() => false),
  settleCombatCheckRoll: vi.fn(() => false),
  settleCombatDeathSaveRoll: vi.fn(() => false),
  settleCombatInitiativeRoll: vi.fn(() => false),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({
  hasPendingPlayerRoll: vi.fn(() => false),
  markDeathSavePromptDismissed: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

describe('roll result flash (#84)', () => {
  const baseRoll = {
    id: 'roll-1',
    status: 'pending',
    requestType: 'attack',
    description: 'Longsword attack vs Sentient Glaze',
    rollConfig: {
      dieType: 20,
      count: 1,
      modifier: 5,
      advantage: false,
      disadvantage: false,
    },
  };

  function mockQueue(currentRollId: string | undefined, pendingRolls: unknown[]): void {
    vi.mocked(useGame).mockReturnValue({
      state: {
        isInCombat: false,
        currentPhase: 'exploration',
        diceRollQueue: { currentRollId, pendingRolls },
      },
      // Mirror the real currentRoll memo: pending + matching id, never a settled roll.
      getCurrentDiceRoll: vi.fn(
        () =>
          (pendingRolls as Array<{ id: string; status: string }>).find(
            (roll) => roll.id === currentRollId && roll.status === 'pending',
          ) ?? null,
      ),
      completeDiceRoll: vi.fn(),
      cancelDiceRoll: vi.fn(),
      clearBatch: vi.fn(),
    } as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('flashes the settled die for 1.5 s after the prompt closes, then clears', () => {
    mockQueue('roll-1', [baseRoll]);
    const { result, rerender } = renderHook(() => useMessageDiceRolls({ onSendMessage: vi.fn() }));
    expect(result.current.completedRoll).toBeNull();

    const completed = {
      ...baseRoll,
      status: 'completed',
      result: { total: 18, naturalRoll: 13 },
    };
    mockQueue(undefined, [completed]);
    rerender();

    expect(result.current.completedRoll).toEqual({ die: 13, modifier: 5, total: 18 });
    // The ticket pins 1.5 s exactly: still flashing at 1499 ms, gone at 1500 ms.
    act(() => {
      vi.advanceTimersByTime(ROLL_RESULT_FLASH_MS - 1);
    });
    expect(result.current.completedRoll).toEqual({ die: 13, modifier: 5, total: 18 });
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.completedRoll).toBeNull();
  });

  it('derives the die from the total when the roll has no natural face', () => {
    mockQueue('roll-1', [baseRoll]);
    const { result, rerender } = renderHook(() => useMessageDiceRolls({ onSendMessage: vi.fn() }));

    const completed = { ...baseRoll, status: 'completed', result: { total: 18 } };
    mockQueue(undefined, [completed]);
    rerender();

    expect(result.current.completedRoll).toEqual({ die: 13, modifier: 5, total: 18 });
  });

  it('flashes nothing for a cancelled roll', () => {
    mockQueue('roll-1', [baseRoll]);
    const { result, rerender } = renderHook(() => useMessageDiceRolls({ onSendMessage: vi.fn() }));

    mockQueue(undefined, [{ ...baseRoll, status: 'cancelled' }]);
    rerender();

    expect(result.current.completedRoll).toBeNull();
  });

  it('flashes nothing when a batch advances to its next roll', () => {
    mockQueue('roll-1', [baseRoll]);
    const { result, rerender } = renderHook(() => useMessageDiceRolls({ onSendMessage: vi.fn() }));

    const nextRoll = { ...baseRoll, id: 'roll-2', status: 'pending' };
    mockQueue('roll-2', [
      { ...baseRoll, status: 'completed', result: { total: 18, naturalRoll: 13 } },
      nextRoll,
    ]);
    rerender();

    expect(result.current.completedRoll).toBeNull();
  });

  it('clears a showing flash when a new roll arrives mid-flash', () => {
    mockQueue('roll-1', [baseRoll]);
    const { result, rerender } = renderHook(() => useMessageDiceRolls({ onSendMessage: vi.fn() }));

    mockQueue(undefined, [
      { ...baseRoll, status: 'completed', result: { total: 18, naturalRoll: 13 } },
    ]);
    rerender();
    expect(result.current.completedRoll).toEqual({ die: 13, modifier: 5, total: 18 });

    const nextRoll = { ...baseRoll, id: 'roll-2', status: 'pending' };
    mockQueue('roll-2', [
      { ...baseRoll, status: 'completed', result: { total: 18, naturalRoll: 13 } },
      nextRoll,
    ]);
    rerender();

    expect(result.current.completedRoll).toBeNull();
  });
});
