/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { usePointBuyLogic } from '../use-point-buy-logic';

describe('usePointBuyLogic', () => {
  const mockDispatch = vi.fn();
  const mockCharacter: any = {
    abilityScores: {
      strength: { score: 8, modifier: -1, savingThrow: false },
      dexterity: { score: 8, modifier: -1, savingThrow: false },
      constitution: { score: 8, modifier: -1, savingThrow: false },
      intelligence: { score: 8, modifier: -1, savingThrow: false },
      wisdom: { score: 8, modifier: -1, savingThrow: false },
      charisma: { score: 8, modifier: -1, savingThrow: false },
    },
    remainingAbilityPoints: 27,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with 27 points if not specified in character', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: { ...mockCharacter, remainingAbilityPoints: undefined },
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    expect(result.current.remainingPoints).toBe(27);
  });

  it('should initialize with points from character', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: { ...mockCharacter, remainingAbilityPoints: 20 },
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    expect(result.current.remainingPoints).toBe(20);
  });

  it('should increase score and decrease remaining points', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: mockCharacter,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    act(() => {
      result.current.handleIncreaseScore('strength');
    });

    // 8 -> 9 costs 1 point
    expect(result.current.remainingPoints).toBe(26);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: expect.objectContaining({
        abilityScores: expect.objectContaining({
          strength: expect.objectContaining({ score: 9 }),
        }),
      }),
    });
  });

  it('should not increase score above 15', () => {
    const charWithHighStrength = {
      ...mockCharacter,
      abilityScores: {
        ...mockCharacter.abilityScores,
        strength: { score: 15, modifier: 2, savingThrow: false },
      },
    };

    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: charWithHighStrength,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    act(() => {
      result.current.handleIncreaseScore('strength');
    });

    expect(result.current.remainingPoints).toBe(27);
    expect(mockDispatch).not.toHaveBeenCalledWith(expect.objectContaining({
        payload: expect.objectContaining({
            abilityScores: expect.objectContaining({
                strength: expect.objectContaining({ score: 16 })
            })
        })
    }));
  });

  it('should not increase score if not enough points', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: mockCharacter,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    // Manually set remaining points to 0
    act(() => {
      result.current.setRemainingPoints(0);
    });

    // Reset mocks because useEffect might have triggered UPDATE_CHARACTER
    mockDispatch.mockClear();

    act(() => {
      result.current.handleIncreaseScore('strength');
    });

    expect(result.current.remainingPoints).toBe(0);
    expect(mockDispatch).not.toBeCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ abilityScores: expect.anything() })
    }));
  });

  it('should decrease score and refund points', () => {
    const charWithIncreasedStrength = {
      ...mockCharacter,
      abilityScores: {
        ...mockCharacter.abilityScores,
        strength: { score: 9, modifier: -1, savingThrow: false },
      },
    };

    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: charWithIncreasedStrength,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    act(() => {
      result.current.handleDecreaseScore('strength');
    });

    // 9 -> 8 refunds 1 point
    expect(result.current.remainingPoints).toBe(28);
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: expect.objectContaining({
        abilityScores: expect.objectContaining({
          strength: expect.objectContaining({ score: 8 }),
        }),
      }),
    });
  });

  it('should not decrease score below 8', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: mockCharacter,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    // Clear initial dispatch from useEffect
    mockDispatch.mockClear();

    act(() => {
      result.current.handleDecreaseScore('strength');
    });

    expect(result.current.remainingPoints).toBe(27);
    expect(mockDispatch).not.toBeCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ abilityScores: expect.anything() })
    }));
  });

  it('should maintain referential stability of returned hook values when parameters do not change', () => {
    const { result, rerender } = renderHook(
      ({ character, method }) => usePointBuyLogic({ character, dispatch: mockDispatch, method }),
      { initialProps: { character: mockCharacter, method: 'pointBuy' } },
    );

    const firstReturn = result.current;

    // Rerender with the identical character reference and method
    rerender({ character: mockCharacter, method: 'pointBuy' });

    expect(result.current).toBe(firstReturn);
  });

  it('should calculate pointsUsed correctly', () => {
    const charWithModifiedScores = {
        ...mockCharacter,
        abilityScores: {
          ...mockCharacter.abilityScores,
          strength: { score: 10, modifier: 0, savingThrow: false }, // 2 points
          dexterity: { score: 12, modifier: 1, savingThrow: false }, // 4 points
          constitution: { score: 8 }, // 0 points, testing fallback
        },
      };

    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: charWithModifiedScores,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    expect(result.current.pointsUsed).toBe(6);
    expect(result.current.pointBuyValid).toBe(true);
  });

  it('should handle null character', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: null,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    expect(result.current.remainingPoints).toBe(27);
    expect(result.current.pointsUsed).toBe(0);

    act(() => {
        result.current.handleIncreaseScore('strength');
    });
    expect(result.current.remainingPoints).toBe(26);
  });

  it('should handle decreasing score when character has no abilityScores', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: { ...mockCharacter, abilityScores: undefined },
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    act(() => {
        result.current.handleDecreaseScore('strength');
    });
    // Should not decrease below 8 (default)
    expect(result.current.remainingPoints).toBe(27);
  });

  it('should mark as invalid if more than 27 points used', () => {
    const charWithWayTooManyPoints = {
        ...mockCharacter,
        abilityScores: {
          strength: { score: 15, modifier: 2, savingThrow: false }, // 9
          dexterity: { score: 15, modifier: 2, savingThrow: false }, // 9
          constitution: { score: 15, modifier: 2, savingThrow: false }, // 9
          intelligence: { score: 15, modifier: 2, savingThrow: false }, // 9
          wisdom: { score: 8, modifier: -1, savingThrow: false }, // 0
          charisma: { score: 8, modifier: -1, savingThrow: false }, // 0
        },
      };

    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: charWithWayTooManyPoints,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    expect(result.current.pointsUsed).toBe(36);
    expect(result.current.pointBuyValid).toBe(false);
  });

  it('should return 0 pointsUsed if method is not pointBuy', () => {
    const charWithModifiedScores = {
        ...mockCharacter,
        abilityScores: {
          ...mockCharacter.abilityScores,
          strength: { score: 10, modifier: 0, savingThrow: false }, // 2 points
        },
      };

    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: charWithModifiedScores,
        dispatch: mockDispatch,
        method: 'rolling',
      }),
    );

    expect(result.current.pointsUsed).toBe(0);
    expect(result.current.pointBuyValid).toBe(true);
  });

  it('should dispatch UPDATE_CHARACTER when remainingPoints changes via useEffect', () => {
    const { result } = renderHook(() =>
      usePointBuyLogic({
        character: mockCharacter,
        dispatch: mockDispatch,
        method: 'pointBuy',
      }),
    );

    // Initial dispatch during mount
    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { remainingAbilityPoints: 27 },
    });

    act(() => {
      result.current.setRemainingPoints(20);
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: { remainingAbilityPoints: 20 },
    });
  });
});
