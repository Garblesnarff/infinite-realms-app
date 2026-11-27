import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  headlessEntryEnterResponse,
  headlessEntryPending,
  HEADLESS_ENTRY_CHARACTER_ID,
} from '../../../../../../../shared/test-fixtures/combat-entry-headless';
import { useMessageDiceRolls } from '../use-message-dice-rolls';

import type { DiceRollQueue, DiceRollRequest } from '@/types/combat';

import { nextVisibleRollId } from '@/contexts/game/dice-queue-visibility';
import { usePlayerRollHost } from '@/hooks/combat/use-player-roll-host';
import {
  clearCombatEntryTurnConfirmed,
  startCombatEntryDelivery,
} from '@/services/combat/combat-entry-delivery';
import {
  requestPlayerAttackRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

const { game } = vi.hoisted(() => ({
  game: {
    state: {
      isInCombat: false,
      currentPhase: 'exploration',
      diceRollQueue: {
        currentRollId: null as string | null,
        pendingRolls: [] as DiceRollRequest[],
      },
    },
    getCurrentDiceRoll: vi.fn(),
    completeDiceRoll: vi.fn(),
    cancelDiceRoll: vi.fn(),
    clearBatch: vi.fn(),
    requestDiceRoll: vi.fn(),
  },
}));

vi.mock('@/contexts/GameContext', () => ({ useGame: () => game }));
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
}));
vi.mock('@/contexts/CampaignContext', () => ({ useOptionalCampaign: () => undefined }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getActiveCombat: vi.fn(),
    enterCombat: vi.fn(),
    declinePendingCombatEntry: vi.fn(),
    updateCampaign: vi.fn(),
  },
}));

function http(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('dismissed initiative line end to end (#115)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    game.state = {
      isInCombat: false,
      currentPhase: 'exploration',
      diceRollQueue: { currentRollId: null, pendingRolls: [] },
    };
    let counter = 0;
    (game as Record<string, unknown>).requestDiceRoll = (request: DiceRollRequest) => {
      const id = `roll-${++counter}`;
      const roll = { ...request, id, timestamp: new Date(), status: 'pending' };
      const queue = {
        pendingRolls: game.state.diceRollQueue.pendingRolls,
        currentRollId: game.state.diceRollQueue.currentRollId,
      };
      const nextCurrent = nextVisibleRollId(
        queue as unknown as DiceRollQueue,
        roll as DiceRollRequest,
      );
      game.state.diceRollQueue.pendingRolls = [
        ...game.state.diceRollQueue.pendingRolls,
        roll as DiceRollRequest,
      ];
      game.state.diceRollQueue.currentRollId = nextCurrent;
      return id;
    };
    (game as Record<string, unknown>).cancelDiceRoll = (id: string) => {
      const rolls = game.state.diceRollQueue.pendingRolls.map((r: DiceRollRequest) =>
        r.id === id ? ({ ...r, status: 'cancelled' } as DiceRollRequest) : r,
      );
      const remaining = rolls.filter((r: DiceRollRequest) => r.status === 'pending');
      game.state.diceRollQueue.pendingRolls = rolls;
      game.state.diceRollQueue.currentRollId = remaining.length ? remaining[0].id : null;
    };
    (game as Record<string, unknown>).getCurrentDiceRoll = () => {
      const q = game.state.diceRollQueue;
      if (!q.currentRollId) return null;
      return (
        q.pendingRolls.find(
          (r: DiceRollRequest) => r.id === q.currentRollId && r.status === 'pending',
        ) || null
      );
    };
    (game as Record<string, unknown>).completeDiceRoll = vi.fn((id: string, result: unknown) => {
      game.state.diceRollQueue.pendingRolls = game.state.diceRollQueue.pendingRolls.map(
        (r: DiceRollRequest) =>
          r.id === id ? ({ ...r, status: 'completed', result } as DiceRollRequest) : r,
      );
    });
    game.clearBatch = vi.fn();
    vi.mocked(userDataApi.getActiveCombat).mockResolvedValue(http(200, { combat: null }));
    vi.mocked(userDataApi.enterCombat).mockResolvedValue(http(201, headlessEntryEnterResponse));
    vi.mocked(userDataApi.declinePendingCombatEntry).mockResolvedValue(
      http(200, { cleared: true }),
    );
  });

  it('seats the encounter and writes the dismissed initiative line', async () => {
    const host = renderHook(() => usePlayerRollHost());
    await Promise.resolve();

    const sessionId = `session-dismissed-${Date.now()}`;
    const deliveryPromise = startCombatEntryDelivery({
      sessionId,
      pending: headlessEntryPending as never,
      player: { characterId: HEADLESS_ENTRY_CHARACTER_ID, name: 'Rook', initiativeModifier: 2 },
      entryConfirmed: true,
    });

    await waitFor(() => expect(game.state.diceRollQueue.pendingRolls.length).toBe(1));

    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const dice = renderHook(() => useMessageDiceRolls({ onSendMessage }));

    act(() => {
      dice.result.current.handleCancelRoll();
    });

    const result = await deliveryPromise;
    expect(result).toMatchObject({ kind: 'seated' });

    expect(userDataApi.enterCombat).toHaveBeenCalledTimes(1);
    const body = vi.mocked(userDataApi.enterCombat).mock.calls[0][1];
    expect(body).not.toHaveProperty('playerInitiativeRoll');

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: 'system',
        text: '⚙️ Engine: You dismissed the Initiative roll, so the engine rolled 16 for you.',
        context: { intent: 'engine_roll_dismissed' },
      }),
    );

    clearCombatEntryTurnConfirmed(sessionId);
    host.unmount();
    dice.unmount();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
  });

  it('a queued attack prompt resolves cancelled and writes no line', async () => {
    const host = renderHook(() => usePlayerRollHost());
    await Promise.resolve();

    const pending = requestPlayerAttackRoll({
      actorLabel: 'The Apprentice',
      targetLabel: 'Flavor-Elemental (Corrupted)',
      weaponName: 'Unarmed Strike',
      attackBonus: 1,
      targetAc: 14,
      advantage: false,
      disadvantage: false,
    });

    await waitFor(() => expect(game.state.diceRollQueue.pendingRolls.length).toBe(1));

    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const dice = renderHook(() => useMessageDiceRolls({ onSendMessage }));

    act(() => {
      dice.result.current.handleCancelRoll();
    });

    await expect(pending).resolves.toEqual({ d20: null, cancelled: true });
    await Promise.resolve();
    expect(onSendMessage).not.toHaveBeenCalled();

    host.unmount();
    dice.unmount();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
  });
});
