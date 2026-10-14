import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { initialGameState, type GameState } from '../game-reducer';
import { useDamageAutoApplication } from '../use-damage-auto-application';

import type { DiceRollRequest } from '@/types/combat-encounter';

import { userDataApi } from '@/services/user-data-api';

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    applyCharacterDamage: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const applyCharacterDamage = userDataApi.applyCharacterDamage as ReturnType<typeof vi.fn>;

function completedDamageTakenRoll(overrides: Partial<DiceRollRequest> = {}): DiceRollRequest {
  return {
    id: 'roll-dmg-1',
    requestType: 'damage_taken',
    description: 'Goblin hits you',
    rollConfig: { dieType: 6, count: 1, modifier: 2 },
    timestamp: new Date(),
    status: 'completed',
    target: 'player',
    damageType: 'slashing',
    result: {
      dieType: 6,
      count: 1,
      modifier: 2,
      results: [6],
      keptResults: [6],
      total: 8,
    },
    ...overrides,
  };
}

function stateWithRoll(roll: DiceRollRequest, inCombat: boolean): GameState {
  return {
    ...initialGameState,
    isInCombat: inCombat,
    diceRollQueue: {
      ...initialGameState.diceRollQueue,
      pendingRolls: [roll],
    },
  };
}

describe('useDamageAutoApplication (#621 Part A)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    applyCharacterDamage.mockResolvedValue({
      currentHitPoints: 22,
      temporaryHitPoints: 0,
    });
  });

  it('a damage_taken roll in combat calls the server route exactly once (no local HP mutation path exists)', async () => {
    const state = stateWithRoll(completedDamageTakenRoll(), true);

    renderHook(() => {
      // The hook signature is (state, characterId): it accepts no dealDamage or
      // local-mutation callback, so the server route is the only HP writer it can
      // reach. This test pins that behavior: exactly one server call, nothing else.
      useDamageAutoApplication(state, 'char-123');
    });

    await waitFor(() => {
      expect(applyCharacterDamage).toHaveBeenCalledTimes(1);
    });
    expect(applyCharacterDamage).toHaveBeenCalledWith('char-123', 8);
  });

  it('a damage_taken roll out of combat still calls the server route exactly once', async () => {
    const state = stateWithRoll(completedDamageTakenRoll(), false);

    renderHook(() => useDamageAutoApplication(state, 'char-123'));

    await waitFor(() => {
      expect(applyCharacterDamage).toHaveBeenCalledTimes(1);
    });
    expect(applyCharacterDamage).toHaveBeenCalledWith('char-123', 8);
  });

  it('does not call the server twice for the same roll', async () => {
    const state = stateWithRoll(completedDamageTakenRoll(), true);

    const { rerender } = renderHook(() => useDamageAutoApplication(state, 'char-123'));

    await waitFor(() => {
      expect(applyCharacterDamage).toHaveBeenCalledTimes(1);
    });

    rerender();
    rerender();

    // Give any duplicate effect runs a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(applyCharacterDamage).toHaveBeenCalledTimes(1);
  });

  it('ignores non-damage and incomplete rolls', async () => {
    const state: GameState = {
      ...initialGameState,
      diceRollQueue: {
        ...initialGameState.diceRollQueue,
        pendingRolls: [
          completedDamageTakenRoll({ id: 'r1', status: 'pending' }),
          completedDamageTakenRoll({ id: 'r2', requestType: 'attack', target: undefined }),
          completedDamageTakenRoll({ id: 'r3', target: 'Goblin' }),
        ],
      },
    };

    renderHook(() => useDamageAutoApplication(state, 'char-123'));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(applyCharacterDamage).not.toHaveBeenCalled();
  });
});
