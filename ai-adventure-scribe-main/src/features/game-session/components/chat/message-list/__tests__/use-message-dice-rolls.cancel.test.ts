/**
 * #2291: Cancel on a narrative check records the choice as one system line. Engine-owned
 * attack and initiative prompts keep #2237's dismiss behavior and write nothing.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMessageDiceRolls } from '../use-message-dice-rolls';

import { settleCombatAttackRoll } from '@/hooks/combat/use-player-roll-host';

const { game } = vi.hoisted(() => ({
  game: {
    state: {
      isInCombat: false,
      currentPhase: 'exploration',
      diceRollQueue: { currentRollId: null as string | null, pendingRolls: [] as unknown[] },
    },
    getCurrentDiceRoll: vi.fn(),
    completeDiceRoll: vi.fn(),
    cancelDiceRoll: vi.fn(),
    clearBatch: vi.fn(),
  },
}));

vi.mock('@/contexts/GameContext', () => ({ useGame: () => game }));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({
  settleCombatAttackRoll: vi.fn(() => false),
  settleCombatInitiativeRoll: vi.fn(() => false),
}));
vi.mock('@/services/combat/player-roll-bridge', () => ({ hasPendingPlayerRoll: () => false }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/utils/error-handler', () => ({ handleAsyncError: vi.fn() }));

const INSIGHT = "Insight check to read Remy's motives and determine if he is hiding information";

function queue(roll: Record<string, unknown>): void {
  game.state.diceRollQueue = { currentRollId: roll.id as string, pendingRolls: [roll] };
}

function cancel(onSendMessage = vi.fn().mockResolvedValue(undefined)): typeof onSendMessage {
  const { result } = renderHook(() => useMessageDiceRolls({ onSendMessage }));
  act(() => result.current.handleCancelRoll());
  return onSendMessage;
}

describe('Cancel on a roll prompt (#2291)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settleCombatAttackRoll).mockReturnValue(false);
  });

  it('a narrative check saves exactly one system line naming the check', async () => {
    queue({
      id: 'insight-1',
      status: 'pending',
      requestType: 'skill_check',
      description: INSIGHT,
      rollConfig: { dieType: 20, count: 1, modifier: 6 },
    });

    const onSendMessage = cancel();

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(onSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: 'system',
        text: `You chose not to roll: ${INSIGHT}.`,
        context: { intent: 'roll_declined' },
      }),
    );
    expect(game.cancelDiceRoll).toHaveBeenCalledWith('insight-1');
  });

  it('an engine attack prompt keeps #2237: withdrawn, no line written', async () => {
    vi.mocked(settleCombatAttackRoll).mockReturnValue(true);
    queue({
      id: 'attack-1',
      status: 'pending',
      requestType: 'attack',
      description: 'Longsword attack vs Faceless Stalker',
      combatAttackRoll: true,
      rollConfig: { dieType: 20, count: 1, modifier: 5 },
    });

    const onSendMessage = cancel();

    expect(settleCombatAttackRoll).toHaveBeenCalledWith('attack-1', null, { cancelled: true });
    expect(game.cancelDiceRoll).toHaveBeenCalledWith('attack-1');
    await Promise.resolve();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it.each([
    ['an initiative prompt', { requestType: 'initiative', combatInitiativeRoll: true }],
    ['a raw attack request with no engine settler', { requestType: 'attack' }],
  ])('%s writes no line', async (_label, fields) => {
    queue({
      id: 'engine-1',
      status: 'pending',
      description: 'Initiative',
      rollConfig: { dieType: 20, count: 1, modifier: 1 },
      ...fields,
    });

    const onSendMessage = cancel();

    await Promise.resolve();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('a failed save of the line does not throw out of Cancel', async () => {
    queue({
      id: 'perception-1',
      status: 'pending',
      requestType: 'skill_check',
      description: 'Perception check',
      rollConfig: { dieType: 20, count: 1, modifier: 1 },
    });

    const onSendMessage = cancel(vi.fn().mockRejectedValue(new Error('Request failed (500)')));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect(game.cancelDiceRoll).toHaveBeenCalledWith('perception-1');
  });

  it('round 2: a double click on Cancel writes one line and cancels once', async () => {
    queue({
      id: 'insight-2',
      status: 'pending',
      requestType: 'skill_check',
      description: INSIGHT,
      rollConfig: { dieType: 20, count: 1, modifier: 6 },
    });
    const onSendMessage = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMessageDiceRolls({ onSendMessage }));
    // Both clicks land before the queue re-renders: the same stale callback runs twice.
    const cancelOnce = result.current.handleCancelRoll;

    act(() => {
      cancelOnce();
      cancelOnce();
    });

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(game.cancelDiceRoll).toHaveBeenCalledTimes(1);
  });
});
