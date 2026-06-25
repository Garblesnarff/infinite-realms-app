/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useAbilityRollingLogic } from '../use-ability-rolling-logic';

import { useToast } from '@/components/ui/use-toast';
import {
  generateAbilityScoresDetailed,
  rerollSingleScoreDetailed,
} from '@/utils/diceRolls';

// Mock dependencies
vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn(),
}));

vi.mock('@/utils/diceRolls', () => ({
  generateAbilityScoresDetailed: vi.fn(),
  rerollSingleScoreDetailed: vi.fn(),
}));

describe('useAbilityRollingLogic', () => {
  const mockToast = vi.fn();
  const mockDispatch = vi.fn();
  const mockCharacter: any = {
    abilityScores: {
      strength: { score: 10, modifier: 0, savingThrow: true },
      dexterity: { score: 10, modifier: 0, savingThrow: false },
      constitution: { score: 10, modifier: 0, savingThrow: false },
      intelligence: { score: 10, modifier: 0, savingThrow: false },
      wisdom: { score: 10, modifier: 0, savingThrow: false },
      charisma: { score: 10, modifier: 0, savingThrow: false },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useToast as any).mockReturnValue({ toast: mockToast });
  });

  it('should handle rolling new ability scores', () => {
    const mockRollResult = {
      scores: [15, 14, 13, 12, 11, 10],
      details: [{}, {}, {}, {}, {}, {}],
      timestamp: new Date(),
    };
    (generateAbilityScoresDetailed as any).mockReturnValue(mockRollResult);

    const { result } = renderHook(() =>
      useAbilityRollingLogic({ character: mockCharacter, dispatch: mockDispatch })
    );

    act(() => {
      result.current.handleRollScores();
    });

    expect(generateAbilityScoresDetailed).toHaveBeenCalled();
    expect(result.current.rollHistory).toEqual([[15, 14, 13, 12, 11, 10]]);
    expect(result.current.currentRollDetails).toEqual(mockRollResult);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: {
        abilityScores: expect.objectContaining({
          strength: expect.objectContaining({ score: 15, savingThrow: true }),
          dexterity: expect.objectContaining({ score: 14, savingThrow: false }),
        }),
      },
    });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Ability Scores Rolled!',
    }));
  });

  it('should handle rerolling a single score', () => {
    const initialRollResult = {
      scores: [15, 14, 13, 12, 11, 10],
      details: [{ total: 15 }, { total: 14 }, { total: 13 }, { total: 12 }, { total: 11 }, { total: 10 }],
      timestamp: new Date(),
    };
    (generateAbilityScoresDetailed as any).mockReturnValue(initialRollResult);

    const { result, rerender } = renderHook(
      ({ character }) => useAbilityRollingLogic({ character, dispatch: mockDispatch }),
      { initialProps: { character: mockCharacter } }
    );

    act(() => {
      result.current.handleRollScores();
    });

    // Simulate character update from dispatch
    const updatedCharacter = {
      ...mockCharacter,
      abilityScores: {
        strength: { score: 15, modifier: 2, savingThrow: true },
        dexterity: { score: 14, modifier: 2, savingThrow: false },
        constitution: { score: 13, modifier: 1, savingThrow: false },
        intelligence: { score: 12, modifier: 1, savingThrow: false },
        wisdom: { score: 11, modifier: 0, savingThrow: false },
        charisma: { score: 10, modifier: 0, savingThrow: false },
      }
    };

    rerender({ character: updatedCharacter });

    const rerollResult = {
      scores: [18, 14, 13, 12, 11, 10],
      details: [{ total: 18 }, { total: 14 }, { total: 13 }, { total: 12 }, { total: 11 }, { total: 10 }],
      timestamp: new Date(),
    };
    (rerollSingleScoreDetailed as any).mockReturnValue(rerollResult);

    act(() => {
      result.current.handleRerollSingleScore(0); // Reroll strength
    });

    expect(rerollSingleScoreDetailed).toHaveBeenCalledWith(
      [15, 14, 13, 12, 11, 10],
      initialRollResult.details,
      0
    );
    expect(result.current.currentRollDetails).toEqual(rerollResult);
    expect(result.current.rollHistory[0]).toEqual([18, 14, 13, 12, 11, 10]);

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: {
        abilityScores: expect.objectContaining({
          strength: expect.objectContaining({ score: 18 }),
        }),
      },
    });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Score Rerolled!',
    }));
  });

  it('should not reroll if no current roll details exist', () => {
    const { result } = renderHook(() =>
      useAbilityRollingLogic({ character: mockCharacter, dispatch: mockDispatch })
    );

    act(() => {
      result.current.handleRerollSingleScore(0);
    });

    expect(rerollSingleScoreDetailed).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('should handle null character during roll', () => {
    const mockRollResult = {
      scores: [10, 10, 10, 10, 10, 10],
      details: [{}, {}, {}, {}, {}, {}],
      timestamp: new Date(),
    };
    (generateAbilityScoresDetailed as any).mockReturnValue(mockRollResult);

    const { result } = renderHook(() =>
      useAbilityRollingLogic({ character: null, dispatch: mockDispatch })
    );

    act(() => {
      result.current.handleRollScores();
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: {
        abilityScores: expect.objectContaining({
          strength: expect.objectContaining({ score: 10, savingThrow: false }),
        }),
      },
    });
  });

  it('should preserve saving throw proficiencies if character has partial scores', () => {
     const partialCharacter: any = {
      abilityScores: {
        strength: { score: 10, modifier: 0, savingThrow: true },
        // other scores missing
      },
    };

    const mockRollResult = {
      scores: [15, 14, 13, 12, 11, 10],
      details: [{}, {}, {}, {}, {}, {}],
      timestamp: new Date(),
    };
    (generateAbilityScoresDetailed as any).mockReturnValue(mockRollResult);

    const { result } = renderHook(() =>
      useAbilityRollingLogic({ character: partialCharacter, dispatch: mockDispatch })
    );

    act(() => {
      result.current.handleRollScores();
    });

    expect(mockDispatch).toHaveBeenCalledWith({
      type: 'UPDATE_CHARACTER',
      payload: {
        abilityScores: expect.objectContaining({
          strength: expect.objectContaining({ score: 15, savingThrow: true }),
          dexterity: expect.objectContaining({ score: 14, savingThrow: false }),
        }),
      },
    });
  });
});
