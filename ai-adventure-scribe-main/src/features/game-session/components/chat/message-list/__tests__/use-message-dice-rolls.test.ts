/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMessageDiceRolls } from '../use-message-dice-rolls';

import { useGame } from '@/contexts/GameContext';
import {
  settleCombatAttackRoll,
  settleCombatCheckRoll,
  settleCombatInitiativeRoll,
} from '@/hooks/combat/use-player-roll-host';
import logger from '@/lib/logger';
import { hasPendingPlayerRoll } from '@/services/combat/player-roll-bridge';
import { handleAsyncError } from '@/utils/error-handler';

// Mock dependencies
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(),
}));

vi.mock('@/hooks/combat/use-player-roll-host', () => ({
  settleCombatAttackRoll: vi.fn(),
  settleCombatInitiativeRoll: vi.fn(),
  settleCombatCheckRoll: vi.fn(),
}));

vi.mock('@/services/combat/player-roll-bridge', () => ({
  hasPendingPlayerRoll: vi.fn(() => false),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/utils/error-handler', () => ({
  handleAsyncError: vi.fn(),
}));

describe('useMessageDiceRolls', () => {
  const mockOnSendMessage = vi.fn();
  const mockOnSendFullMessage = vi.fn();

  const mockGameState = {
    diceRollQueue: {
      currentRollId: null,
      pendingRolls: [],
    },
  };

  const mockUseGame = {
    state: mockGameState,
    getCurrentDiceRoll: vi.fn(),
    completeDiceRoll: vi.fn(),
    cancelDiceRoll: vi.fn(),
    clearBatch: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useGame as any).mockReturnValue(mockUseGame);
    mockUseGame.state = {
      diceRollQueue: {
        currentRollId: null,
        pendingRolls: [],
      },
    };
    vi.mocked(settleCombatAttackRoll).mockReturnValue(false);
    vi.mocked(settleCombatInitiativeRoll).mockReturnValue(false);
    vi.mocked(settleCombatCheckRoll).mockReturnValue(false);
    vi.mocked(hasPendingPlayerRoll).mockReturnValue(false);
  });

  it('should return initial state when no roll is active', () => {
    const { result } = renderHook(() =>
      useMessageDiceRolls({
        onSendMessage: mockOnSendMessage,
        onSendFullMessage: mockOnSendFullMessage,
      }),
    );

    expect(result.current.currentRoll).toBeNull();
    expect(result.current.batchProgress).toBeNull();
    expect(result.current.rollRequest).toBeNull();
  });

  it('should identify current roll from queue', () => {
    const activeRoll = {
      id: 'roll-1',
      status: 'pending',
      description: 'Test Roll',
      rollConfig: { dieType: 20, count: 1, modifier: 0 },
    };
    mockUseGame.state.diceRollQueue = {
      currentRollId: 'roll-1',
      pendingRolls: [activeRoll] as any,
    };

    const { result } = renderHook(() =>
      useMessageDiceRolls({
        onSendMessage: mockOnSendMessage,
        onSendFullMessage: mockOnSendFullMessage,
      }),
    );

    expect(result.current.currentRoll).toEqual(activeRoll);
  });

  it('should calculate batch progress', () => {
    const batchId = 'batch-1';
    const rolls = [
      {
        id: 'roll-1',
        batchId,
        status: 'completed',
        description: 'Roll 1',
        rollConfig: { dieType: 20, count: 1, modifier: 0 },
      },
      {
        id: 'roll-2',
        batchId,
        status: 'pending',
        description: 'Roll 2',
        rollConfig: { dieType: 20, count: 1, modifier: 0 },
      },
      {
        id: 'roll-3',
        batchId,
        status: 'pending',
        description: 'Roll 3',
        rollConfig: { dieType: 20, count: 1, modifier: 0 },
      },
    ];
    mockUseGame.state.diceRollQueue = {
      currentRollId: 'roll-2',
      pendingRolls: rolls as any,
    };

    const { result } = renderHook(() =>
      useMessageDiceRolls({
        onSendMessage: mockOnSendMessage,
        onSendFullMessage: mockOnSendFullMessage,
      }),
    );

    expect(result.current.batchProgress).toEqual({ current: 2, total: 3 });
  });

  it('should handle cancel roll', () => {
    const activeRoll = {
      id: 'roll-1',
      status: 'pending',
      rollConfig: { dieType: 20, count: 1, modifier: 0 },
    };
    mockUseGame.state.diceRollQueue = {
      currentRollId: 'roll-1',
      pendingRolls: [activeRoll] as any,
    };

    const { result } = renderHook(() =>
      useMessageDiceRolls({
        onSendMessage: mockOnSendMessage,
        onSendFullMessage: mockOnSendFullMessage,
      }),
    );

    act(() => {
      result.current.handleCancelRoll();
    });

    expect(mockUseGame.cancelDiceRoll).toHaveBeenCalledWith('roll-1');
  });

  /**
   * Ported from the retired `handleDiceRoll` (#2219). The animated popup no longer re-rolls a
   * fresh die: it reports the total with the natural face the player watched land, and
   * `handleManualResult` settles that. Each test below is the successor of the `handleDiceRoll`
   * test named in its comment, with assertions just as strong.
   */
  describe('handleManualResult with animated popup details', () => {
    const activeRoll = {
      id: 'roll-1',
      requestType: 'skill_check',
      description: 'Stealth Check',
      rollConfig: { dieType: 20, count: 1, modifier: 2 },
      status: 'pending',
    };

    beforeEach(() => {
      mockUseGame.state.diceRollQueue = {
        currentRollId: 'roll-1',
        pendingRolls: [activeRoll] as any,
      };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(activeRoll);
    });

    it('processes an animated skill check with its natural face', async () => {
      // Successor of `handleDiceRoll › should process a successful dice roll`. The die the
      // player watched land (total 15, natural 13) is the die that settles — no re-roll.
      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(15, { naturalRoll: 13 });
      });

      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', {
        total: 15,
        naturalRoll: 13,
      });
      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Stealth Check: 15 (nat 13+2)'),
        expect.objectContaining({
          intent: 'dice_roll',
          diceRoll: expect.objectContaining({ results: [13] }),
        }),
      );
    });

    it('formats DC success for an animated result', async () => {
      // Successor of `handleDiceRoll › should format DC success correctly`.
      mockUseGame.getCurrentDiceRoll.mockReturnValue({ ...activeRoll, dc: 14 });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(15, { naturalRoll: 13 });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('success'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({
            success: true,
            dc: 14,
            naturalRoll: 13,
            requestType: 'skill_check',
            description: 'Stealth Check',
          }),
        }),
      );
    });

    it('formats a critical miss for an animated attack', async () => {
      // Successor of `handleDiceRoll › should format critical miss on attacks`. No engine
      // settler owns this die (mocked), so it reaches the DM as a message, as before.
      const attackRoll = { ...activeRoll, requestType: 'attack' };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(attackRoll);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(3, { naturalRoll: 1 });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Critical Miss'),
        expect.anything(),
      );
    });

    it('formats AC success for an animated attack', async () => {
      // Successor of `handleDiceRoll › should format AC success correctly`.
      const rollWithAC = { ...activeRoll, requestType: 'attack', ac: 15 };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithAC);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(16, { naturalRoll: 14 });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('hit'),
        expect.anything(),
      );
    });

    it('formats advantage and a negative modifier for an animated result', async () => {
      // Successor of `handleDiceRoll › should format advantage and negative modifier`.
      const rollWithAdv = {
        ...activeRoll,
        rollConfig: { ...activeRoll.rollConfig, advantage: true, modifier: -1 },
      };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithAdv);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(9, { naturalRoll: 10 });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('[ADV]'),
        expect.anything(),
      );
      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('nat 10-1'),
        expect.anything(),
      );
    });

    it('formats disadvantage for an animated result', async () => {
      // Successor of `handleDiceRoll › should format disadvantage`.
      const rollWithDis = {
        ...activeRoll,
        rollConfig: { ...activeRoll.rollConfig, disadvantage: true },
      };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithDis);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(7, {
          naturalRoll: 5,
          results: [18, 5],
          keptResults: [5],
        });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('[DIS]'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({ results: [18, 5], keptResults: [5] }),
        }),
      );
    });

    it('formats DC failure for an animated result', async () => {
      // Successor of `handleDiceRoll › should format DC failure correctly`.
      const rollWithDC = { ...activeRoll, dc: 18 };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithDC);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(15, { naturalRoll: 13 });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('fail'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({ success: false, dc: 18, naturalRoll: 13 }),
        }),
      );
    });

    it('formats a critical hit for an animated attack', async () => {
      // Successor of `handleDiceRoll › should format critical hits on attacks`.
      const attackRoll = { ...activeRoll, requestType: 'attack' };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(attackRoll);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(22, { naturalRoll: 20 });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL HIT!'),
        expect.anything(),
      );
    });
  });

  describe('handleManualResult', () => {
    const activeRoll = {
      id: 'roll-1',
      requestType: 'skill_check',
      description: 'Stealth Check',
      rollConfig: { dieType: 20, count: 1, modifier: 2 },
      status: 'pending',
    };

    beforeEach(() => {
      mockUseGame.state.diceRollQueue = {
        currentRollId: 'roll-1',
        pendingRolls: [activeRoll] as any,
      };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(activeRoll);
    });

    it('should process a manual result', async () => {
      mockUseGame.getCurrentDiceRoll.mockReturnValue({ ...activeRoll, dc: 16 });
      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(18);
      });

      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', { total: 18 });
      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Stealth Check: 18'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({ success: true, dc: 16 }),
        }),
      );
    });

    it('settles the die before the server turn finishes and ignores duplicate results', async () => {
      let resolveSend!: () => void;
      mockOnSendFullMessage.mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
      );
      mockUseGame.completeDiceRoll.mockImplementation(() => {
        mockUseGame.state.diceRollQueue = {
          currentRollId: null,
          pendingRolls: [],
        };
      });

      const { result, rerender } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      let submission!: Promise<void>;
      act(() => {
        submission = result.current.handleManualResult(18);
        void result.current.handleManualResult(19);
      });

      expect(result.current.pendingRollId).toBeNull();
      expect(mockOnSendFullMessage).toHaveBeenCalledTimes(1);
      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', { total: 18 });

      resolveSend();
      await act(async () => {
        await submission;
      });

      expect(result.current.pendingRollId).toBeNull();
      rerender();
      expect(result.current.currentRoll).toBeNull();
      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', { total: 18 });
    });

    it('releases the resolved die and retains an explicit retry after a timeout error', async () => {
      mockOnSendFullMessage.mockRejectedValueOnce(new Error('request timed out'));

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(18);
      });

      expect(result.current.pendingRollId).toBeNull();
      expect(result.current.rollError).toBe('Roll timed out. Please try again.');
      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', { total: 18 });
      expect(result.current.currentRoll).toBeNull();
      await act(async () => {
        await result.current.handleRetryRoll();
      });
      expect(mockOnSendFullMessage).toHaveBeenCalledTimes(2);
    });

    it('should handle manual result in batch', async () => {
      const batchId = 'batch-1';
      const roll1 = { ...activeRoll, id: 'roll-1', batchId };
      const roll2 = { ...activeRoll, id: 'roll-2', batchId };

      mockUseGame.state.diceRollQueue.pendingRolls = [roll1, roll2] as any;
      mockUseGame.getCurrentDiceRoll.mockReturnValue(roll1);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(15);
      });

      expect(mockOnSendMessage).toHaveBeenCalled();
      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
      // The retired `handleDiceRoll` batch-wait test asserted the batch survives mid-batch.
      expect(mockUseGame.clearBatch).not.toHaveBeenCalled();
    });

    it('should handle manual batch completion', async () => {
      const batchId = 'batch-1';
      const roll1 = { ...activeRoll, id: 'roll-1', batchId, status: 'completed' };
      const roll2 = { ...activeRoll, id: 'roll-2', batchId, status: 'pending' };

      mockUseGame.state.diceRollQueue.pendingRolls = [roll1, roll2] as any;
      mockUseGame.getCurrentDiceRoll.mockReturnValue(roll2);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(10);
      });

      expect(mockOnSendFullMessage).toHaveBeenCalled();
      expect(mockUseGame.clearBatch).toHaveBeenCalled();
    });

    it('shows the natural face of an animated skill check in the DM message (nat 20)', async () => {
      // #2219 acceptance: a DM-requested skill check rolled through the popup animation keeps
      // its natural face — the DM message shows "nat 20" and the total is unchanged.
      mockUseGame.getCurrentDiceRoll.mockReturnValue({ ...activeRoll, dc: 16 });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(22, { naturalRoll: 20 });
      });

      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', {
        total: 22,
        naturalRoll: 20,
      });
      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Stealth Check: 22 (nat 20+2)'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({
            total: 22,
            naturalRoll: 20,
            success: true,
            dc: 16,
          }),
        }),
      );
    });

    it('keeps the typed-entry format and context shape without a natural face', async () => {
      // A hand-entered number has no animation details: completeDiceRoll still receives exactly
      // { total }, and the DM context carries no naturalRoll key (#2219).
      mockUseGame.getCurrentDiceRoll.mockReturnValue(activeRoll);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(18);
      });

      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', { total: 18 });
      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Stealth Check: 18'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({ total: 18 }),
        }),
      );
      const context = (mockOnSendFullMessage.mock.calls[0] as any[])[1];
      expect(context.diceRoll).not.toHaveProperty('naturalRoll');
    });

    it('should handle errors in manual result', async () => {
      mockUseGame.completeDiceRoll.mockImplementation(() => {
        throw new Error('Test Error');
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(10);
      });

      expect(handleAsyncError).toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('rejects an invalid result type in handleManualResult', async () => {
      // Successor of `handleDiceRoll › should handle invalid formula in handleDiceRoll`: invalid
      // input never reaches the roll machinery — no message is sent and nothing completes.
      mockUseGame.getCurrentDiceRoll.mockReturnValue({ id: 'roll-1' });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult('invalid' as any);
      });

      expect(logger.error).toHaveBeenCalledWith(
        '[useMessageDiceRolls] Invalid result type:',
        'invalid',
      );
      expect(mockUseGame.completeDiceRoll).not.toHaveBeenCalled();
      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
      expect(mockOnSendMessage).not.toHaveBeenCalled();
    });

    it('should handle missing current roll in handleManualResult', async () => {
      // Successor of the retired `handleDiceRoll › should handle missing current roll in
      // handleDiceRoll`: nothing is sent anywhere when there is no current roll.
      mockUseGame.getCurrentDiceRoll.mockReturnValue(null);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(10);
      });

      expect(mockUseGame.completeDiceRoll).not.toHaveBeenCalled();
      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
      expect(mockOnSendMessage).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[useMessageDiceRolls] No current dice roll in queue',
      );
    });

    it('does not reach the no-current-roll branch for a committed combat initiative roll', async () => {
      const committedRoll = {
        id: 'roll-1',
        requestType: 'initiative',
        description: 'Initiative for The Storyteller',
        rollConfig: { dieType: 20, count: 1, modifier: 2 },
        status: 'pending',
        combatInitiativeRoll: true,
      };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(committedRoll);
      mockUseGame.completeDiceRoll.mockImplementation(() => undefined);
      vi.mocked(settleCombatInitiativeRoll).mockReturnValue(true);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(14);
      });

      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', { total: 14 });
      expect(settleCombatInitiativeRoll).toHaveBeenCalledWith('roll-1', 14);
      expect(logger.warn).not.toHaveBeenCalledWith(
        '[useMessageDiceRolls] No current dice roll in queue',
      );
      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
    });

    it('should handle object result in handleManualResult', async () => {
      mockUseGame.getCurrentDiceRoll.mockReturnValue({
        id: 'roll-1',
        rollConfig: { dieType: 20, count: 1, modifier: 0 },
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult({ total: 25 } as any);
      });

      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', { total: 25 });
    });
  });
  /**
   * #2190: on a combat-start turn the DM's raw `attack`/`initiative` roll_requests used to reach
   * the popup. Nothing in the engine owns those dice, so the result was formatted and sent to the
   * DM as a player message — a turn for an attack the engine never resolved. While an encounter
   * exists or is being seated, such a die is dropped instead.
   */
  describe('unowned combat dice during an encounter', () => {
    const attackRoll = {
      id: 'roll-attack',
      requestType: 'attack',
      description: 'Longsword attack vs Chiropteran Hulk',
      rollConfig: { dieType: 20, count: 1, modifier: 5 },
      status: 'pending',
    };

    beforeEach(() => {
      mockUseGame.state = {
        isInCombat: true,
        currentPhase: 'combat',
        diceRollQueue: { currentRollId: 'roll-attack', pendingRolls: [attackRoll] as any },
      } as any;
      mockUseGame.getCurrentDiceRoll.mockReturnValue(attackRoll);
    });

    it('drops an animated attack die no engine settler owns instead of sending it to the DM', async () => {
      // Successor of the retired `handleDiceRoll › drops a rolled attack die no engine settler
      // owns instead of sending it to the DM`: the popup's observed total/natural face settles
      // through the unified path and the same guard drops it.
      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(9, { naturalRoll: 4 });
      });

      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
      expect(mockOnSendMessage).not.toHaveBeenCalled();
      // The queue entry still completes so the engine's own prompt can take the slot.
      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-attack', {
        total: 9,
        naturalRoll: 4,
      });
      expect(logger.warn).toHaveBeenCalledWith(
        '[useMessageDiceRolls] dropped an unowned manual combat die; not sent to the DM',
        expect.objectContaining({ requestType: 'attack' }),
      );
    });

    it('drops a hand-entered attack die no engine settler owns', async () => {
      // Typed-entry variant of the drop guard above: no animation details, so the settled
      // result stays exactly { total }.
      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleManualResult(4);
      });

      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
      expect(mockOnSendMessage).not.toHaveBeenCalled();
      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-attack', { total: 4 });
      expect(logger.warn).toHaveBeenCalledWith(
        '[useMessageDiceRolls] dropped an unowned manual combat die; not sent to the DM',
        expect.objectContaining({ requestType: 'attack' }),
      );
    });

    it('drops an unowned initiative die during the seating window', async () => {
      const initiativeRoll = {
        ...attackRoll,
        id: 'roll-initiative',
        requestType: 'initiative',
        description: 'Initiative roll for the party',
      };
      // Neither context reports combat yet; the engine's own prompt is already waiting.
      mockUseGame.state = {
        isInCombat: false,
        currentPhase: 'exploration',
        diceRollQueue: {
          currentRollId: 'roll-initiative',
          pendingRolls: [initiativeRoll] as any,
        },
      } as any;
      mockUseGame.getCurrentDiceRoll.mockReturnValue(initiativeRoll);
      vi.mocked(hasPendingPlayerRoll).mockReturnValue(true);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      // Successor of the retired `handleDiceRoll` seating-window test: the natural face rides
      // along but the die is still dropped — it never reaches the DM.
      await act(async () => {
        await result.current.handleManualResult(15, { naturalRoll: 13 });
      });

      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
      expect(mockOnSendMessage).not.toHaveBeenCalled();
      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-initiative', {
        total: 15,
        naturalRoll: 13,
      });
    });

    it('still sends an ordinary narrative check made during combat', async () => {
      const checkRoll = {
        ...attackRoll,
        id: 'roll-check',
        requestType: 'skill_check',
        description: 'Athletics to keep your footing',
      };
      mockUseGame.state = {
        isInCombat: true,
        currentPhase: 'combat',
        diceRollQueue: { currentRollId: 'roll-check', pendingRolls: [checkRoll] as any },
      } as any;
      mockUseGame.getCurrentDiceRoll.mockReturnValue(checkRoll);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      // Successor of the retired `handleDiceRoll` version: an ordinary check is not a combat
      // die, so it reaches the DM. The fixture copies the attack's +5, but the total is 15
      // and the face is 13, so the saved line uses +2.
      await act(async () => {
        await result.current.handleManualResult(15, { naturalRoll: 13 });
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Athletics to keep your footing: 15 (nat 13+2)'),
        expect.anything(),
      );
    });
  });
});
