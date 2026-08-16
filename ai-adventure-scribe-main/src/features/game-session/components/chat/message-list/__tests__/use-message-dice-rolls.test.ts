/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useMessageDiceRolls } from '../use-message-dice-rolls';

import { useGame } from '@/contexts/GameContext';
import { rollDice } from '@/utils/diceUtils';
import { handleAsyncError } from '@/utils/error-handler';

// Mock dependencies
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(),
}));

vi.mock('@/utils/diceUtils', () => ({
  rollDice: vi.fn(),
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

  describe('handleDiceRoll', () => {
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

    it('should process a successful dice roll', async () => {
      const mockResult = {
        total: 15,
        naturalRoll: 13,
        results: [13],
        keptResults: [13],
        critical: false,
      };
      (rollDice as any).mockReturnValue(mockResult);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(rollDice).toHaveBeenCalledWith(20, 1, 2, { advantage: false, disadvantage: false });
      expect(mockUseGame.completeDiceRoll).toHaveBeenCalledWith('roll-1', mockResult);
      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Stealth Check: 15 (nat 13+2)'),
        expect.objectContaining({ intent: 'dice_roll' }),
      );
    });

    it('should format DC success correctly', async () => {
      const rollWithDC = { ...activeRoll, dc: 14 };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithDC);
      (rollDice as any).mockReturnValue({
        total: 15,
        naturalRoll: 13,
        results: [13],
        keptResults: [13],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('✓'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({
            success: true,
            dc: 14,
            requestType: 'skill_check',
            description: 'Stealth Check',
          }),
        }),
      );
    });

    it('should format critical miss on attacks', async () => {
      const attackRoll = { ...activeRoll, requestType: 'attack' };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(attackRoll);
      (rollDice as any).mockReturnValue({
        total: 3,
        naturalRoll: 1,
        results: [1],
        keptResults: [1],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('Critical Miss'),
        expect.anything(),
      );
    });

    it('should format AC success correctly', async () => {
      const rollWithAC = { ...activeRoll, requestType: 'attack', ac: 15 };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithAC);
      (rollDice as any).mockReturnValue({
        total: 16,
        naturalRoll: 14,
        results: [14],
        keptResults: [14],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('✓'),
        expect.anything(),
      );
    });

    it('should format advantage and negative modifier', async () => {
      const rollWithAdv = {
        ...activeRoll,
        rollConfig: { ...activeRoll.rollConfig, advantage: true, modifier: -1 },
      };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithAdv);
      (rollDice as any).mockReturnValue({
        total: 9,
        naturalRoll: 10,
        results: [10, 5],
        keptResults: [10],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20-1', true, false);
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

    it('should format disadvantage', async () => {
      const rollWithDis = {
        ...activeRoll,
        rollConfig: { ...activeRoll.rollConfig, disadvantage: true },
      };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithDis);
      (rollDice as any).mockReturnValue({
        total: 7,
        naturalRoll: 5,
        results: [10, 5],
        keptResults: [5],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2', false, true);
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('[DIS]'),
        expect.anything(),
      );
    });

    it('should format DC failure correctly', async () => {
      const rollWithDC = { ...activeRoll, dc: 18 };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(rollWithDC);
      (rollDice as any).mockReturnValue({
        total: 15,
        naturalRoll: 13,
        results: [13],
        keptResults: [13],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('✗'),
        expect.objectContaining({
          diceRoll: expect.objectContaining({ success: false, dc: 18 }),
        }),
      );
    });

    it('should format critical hits on attacks', async () => {
      const attackRoll = { ...activeRoll, requestType: 'attack' };
      mockUseGame.getCurrentDiceRoll.mockReturnValue(attackRoll);
      (rollDice as any).mockReturnValue({
        total: 22,
        naturalRoll: 20,
        results: [20],
        keptResults: [20],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(mockOnSendFullMessage).toHaveBeenCalledWith(
        expect.stringContaining('CRITICAL HIT!'),
        expect.anything(),
      );
    });

    it('should handle batch rolls and wait for completion', async () => {
      const batchId = 'batch-1';
      const roll1 = { ...activeRoll, id: 'roll-1', batchId };
      const roll2 = { ...activeRoll, id: 'roll-2', batchId };

      mockUseGame.state.diceRollQueue.pendingRolls = [roll1, roll2] as any;
      mockUseGame.getCurrentDiceRoll.mockReturnValue(roll1);
      (rollDice as any).mockReturnValue({
        total: 10,
        naturalRoll: 8,
        results: [8],
        keptResults: [8],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      // Should call onSendMessage for intermediate batch roll, NOT onSendFullMessage
      expect(mockOnSendMessage).toHaveBeenCalled();
      expect(mockOnSendFullMessage).not.toHaveBeenCalled();
      expect(mockUseGame.clearBatch).not.toHaveBeenCalled();
    });

    it('should clear batch when final roll completes', async () => {
      const batchId = 'batch-1';
      const roll1 = { ...activeRoll, id: 'roll-1', batchId, status: 'completed' };
      const roll2 = { ...activeRoll, id: 'roll-2', batchId, status: 'pending' };

      mockUseGame.state.diceRollQueue.pendingRolls = [roll1, roll2] as any;
      mockUseGame.getCurrentDiceRoll.mockReturnValue(roll2);
      (rollDice as any).mockReturnValue({
        total: 10,
        naturalRoll: 8,
        results: [8],
        keptResults: [8],
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(mockOnSendFullMessage).toHaveBeenCalled();
      expect(mockUseGame.clearBatch).toHaveBeenCalled();
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
    it('should handle errors in handleDiceRoll', async () => {
      (rollDice as any).mockImplementation(() => {
        throw new Error('Test Error');
      });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20+2');
      });

      expect(handleAsyncError).toHaveBeenCalled();
    });

    it('should handle missing current roll in handleDiceRoll', async () => {
      mockUseGame.getCurrentDiceRoll.mockReturnValue(null);

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('1d20');
      });

      expect(rollDice).not.toHaveBeenCalled();
    });

    it('should handle invalid formula in handleDiceRoll', async () => {
      mockUseGame.getCurrentDiceRoll.mockReturnValue({ id: 'roll-1' });

      const { result } = renderHook(() =>
        useMessageDiceRolls({
          onSendMessage: mockOnSendMessage,
          onSendFullMessage: mockOnSendFullMessage,
        }),
      );

      await act(async () => {
        await result.current.handleDiceRoll('invalid');
      });

      expect(rollDice).not.toHaveBeenCalled();
    });

    it('should handle missing current roll in handleManualResult', async () => {
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
});
