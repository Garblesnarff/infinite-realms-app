/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useCharacter } from '@/contexts/CharacterContext';
import { useAbilityScoreSelection } from '@/hooks/use-ability-score-selection';
import { generateAbilityScoresDetailed, rerollSingleScoreDetailed } from '@/utils/diceRolls';
import { calculateRacialBonuses, getTotalRacialBonus } from '@/utils/racialAbilityBonuses';

// Mock dependencies
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

vi.mock('@/utils/diceRolls', () => ({
  generateAbilityScoresDetailed: vi.fn(),
  rerollSingleScoreDetailed: vi.fn(),
}));

vi.mock('@/utils/racialAbilityBonuses', () => ({
  calculateRacialBonuses: vi.fn(),
  getTotalRacialBonus: vi.fn(),
}));

describe('useAbilityScoreSelection', () => {
  const mockDispatch = vi.fn();
  let mockState: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState = {
      character: {
        abilityScores: {
          strength: { score: 8, modifier: -1, savingThrow: false },
          dexterity: { score: 8, modifier: -1, savingThrow: false },
          constitution: { score: 8, modifier: -1, savingThrow: false },
          intelligence: { score: 8, modifier: -1, savingThrow: false },
          wisdom: { score: 8, modifier: -1, savingThrow: false },
          charisma: { score: 8, modifier: -1, savingThrow: false },
        },
        remainingAbilityPoints: 27,
        race: 'Human',
        subrace: null,
        racialAbilityChoices: {},
      },
    };

    (useCharacter as any).mockImplementation(() => ({
      state: mockState,
      dispatch: mockDispatch,
    }));
    (calculateRacialBonuses as any).mockReturnValue([]);
    (getTotalRacialBonus as any).mockReturnValue(0);
  });

  it('should initialize with default values', () => {
    const { result } = renderHook(() => useAbilityScoreSelection());

    expect(result.current.method).toBe('pointBuy');
    expect(result.current.remainingPoints).toBe(27);
    expect(result.current.pointBuyValid).toBe(true);
    expect(result.current.getAbilityDescription('strength')).toContain('Physical power');
  });

  it('should initialize with existing points from character state', () => {
    mockState.character.remainingAbilityPoints = 15;
    const { result } = renderHook(() => useAbilityScoreSelection());
    expect(result.current.remainingPoints).toBe(15);
  });

  it('should reset scores', () => {
    mockState.character.abilityScores.strength.score = 15;
    const { result } = renderHook(() => useAbilityScoreSelection());

    act(() => {
      result.current.handleReset();
    });

    expect(mockDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'UPDATE_CHARACTER',
        payload: expect.objectContaining({
          abilityScores: expect.objectContaining({
            strength: expect.objectContaining({ score: 8 }),
          }),
        }),
      }),
    );
    expect(result.current.remainingPoints).toBe(27);
  });

  describe('Point Buy Method', () => {
    it('should increase score and decrease remaining points', () => {
      const { result } = renderHook(() => useAbilityScoreSelection());

      act(() => {
        result.current.handleIncreaseScore('strength');
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            abilityScores: expect.objectContaining({
              strength: expect.objectContaining({ score: 9 }),
            }),
          }),
        }),
      );

      expect(result.current.remainingPoints).toBe(26);
    });

    it('should handle higher point costs (13 to 14 costs 2 points)', () => {
      mockState.character.abilityScores.strength.score = 13;
      const { result } = renderHook(() => useAbilityScoreSelection());

      act(() => {
        result.current.handleIncreaseScore('strength');
      });

      expect(result.current.remainingPoints).toBe(25); // 27 - 2 = 25
    });

    it('should not increase score beyond 15', () => {
      mockState.character.abilityScores.strength.score = 15;
      const { result } = renderHook(() => useAbilityScoreSelection());
      mockDispatch.mockClear();

      act(() => {
        result.current.handleIncreaseScore('strength');
      });

      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            abilityScores: expect.objectContaining({
              strength: expect.objectContaining({ score: 16 }),
            }),
          }),
        }),
      );
    });

    it('should not increase score if not enough points', () => {
      mockState.character.abilityScores.strength.score = 13;
      mockState.character.remainingAbilityPoints = 1; // 13->14 costs 2
      const { result } = renderHook(() => useAbilityScoreSelection());
      mockDispatch.mockClear();

      act(() => {
        result.current.handleIncreaseScore('strength');
      });

      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            abilityScores: expect.any(Object),
          }),
        }),
      );
    });

    it('should decrease score and refund points', () => {
      mockState.character.abilityScores.strength.score = 10;
      const { result } = renderHook(() => useAbilityScoreSelection());

      act(() => {
        result.current.handleDecreaseScore('strength');
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            abilityScores: expect.objectContaining({
              strength: expect.objectContaining({ score: 9 }),
            }),
          }),
        }),
      );
      expect(result.current.remainingPoints).toBe(28); // 27 + (cost(10) - cost(9)) = 27 + (2 - 1) = 28
    });

    it('should not decrease score below 8', () => {
      const { result } = renderHook(() => useAbilityScoreSelection());
      mockDispatch.mockClear();

      act(() => {
        result.current.handleDecreaseScore('strength');
      });

      expect(mockDispatch).not.toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            abilityScores: expect.any(Object),
          }),
        }),
      );
    });
  });

  describe('Standard Array Method', () => {
    it('should apply standard array scores', () => {
      const { result } = renderHook(() => useAbilityScoreSelection());

      act(() => {
        result.current.handleStandardArray();
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            abilityScores: expect.objectContaining({
              strength: expect.objectContaining({ score: 15 }),
              dexterity: expect.objectContaining({ score: 14 }),
              constitution: expect.objectContaining({ score: 13 }),
              intelligence: expect.objectContaining({ score: 12 }),
              wisdom: expect.objectContaining({ score: 10 }),
              charisma: expect.objectContaining({ score: 8 }),
            }),
          }),
        }),
      );
    });

    it('should validate standard array', () => {
      const { result, rerender } = renderHook(() => useAbilityScoreSelection());

      act(() => {
        result.current.setMethod('standardArray');
      });

      // Default [8,8,8,8,8,8] is invalid
      expect(result.current.standardArrayValid).toBe(false);

      // Simulate applying standard array by updating mockState (use new reference)
      mockState.character = {
        ...mockState.character,
        abilityScores: {
          strength: { score: 15 },
          dexterity: { score: 14 },
          constitution: { score: 13 },
          intelligence: { score: 12 },
          wisdom: { score: 10 },
          charisma: { score: 8 },
        },
      };

      rerender();
      expect(result.current.standardArrayValid).toBe(true);

      // Invalid array (use new reference)
      mockState.character = {
        ...mockState.character,
        abilityScores: {
          ...mockState.character.abilityScores,
          strength: { score: 16 },
        },
      };
      rerender();
      expect(result.current.standardArrayValid).toBe(false);
    });
  });

  describe('Roll Method', () => {
    it('should roll all scores', () => {
      const mockRollResult = {
        scores: [18, 16, 14, 12, 10, 8],
        details: [
          [6, 6, 6, 1],
          [6, 6, 4, 1],
          [6, 4, 4, 1],
          [4, 4, 4, 1],
          [4, 4, 2, 1],
          [4, 2, 2, 1],
        ],
      };
      (generateAbilityScoresDetailed as any).mockReturnValue(mockRollResult);

      const { result } = renderHook(() => useAbilityScoreSelection());

      act(() => {
        result.current.handleRollScores();
      });

      expect(mockDispatch).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            abilityScores: expect.objectContaining({
              strength: expect.objectContaining({ score: 18 }),
              charisma: expect.objectContaining({ score: 8 }),
            }),
          }),
        }),
      );
      expect(result.current.currentRollDetails).toEqual(mockRollResult);
    });

    it('should reroll a single score', () => {
      const initialRollResult = {
        scores: [10, 10, 10, 10, 10, 10],
        details: [
          [4, 3, 3, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
        ],
      };
      (generateAbilityScoresDetailed as any).mockReturnValue(initialRollResult);

      const { result } = renderHook(() => useAbilityScoreSelection());

      act(() => {
        result.current.handleRollScores();
      });

      const updatedRollResult = {
        scores: [18, 10, 10, 10, 10, 10],
        details: [
          [6, 6, 6, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
          [4, 3, 3, 1],
        ],
      };
      (rerollSingleScoreDetailed as any).mockReturnValue(updatedRollResult);

      act(() => {
        result.current.handleRerollSingleScore(0);
      });

      expect(mockDispatch).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'UPDATE_CHARACTER',
          payload: expect.objectContaining({
            abilityScores: expect.objectContaining({
              strength: expect.objectContaining({ score: 18 }),
            }),
          }),
        }),
      );
    });
  });

  describe('Validation and Racial Bonuses', () => {
    it('should calculate final scores with racial bonuses', () => {
      (getTotalRacialBonus as any).mockImplementation((ability: string) => {
        if (ability === 'strength') return 2;
        return 0;
      });

      const { result } = renderHook(() => useAbilityScoreSelection());

      expect(result.current.getFinalScore('strength')).toBe(10); // 8 base + 2 racial
    });

    it('should cap final scores at 20', () => {
      mockState.character.abilityScores.strength.score = 19;
      (getTotalRacialBonus as any).mockReturnValue(2);

      const { result } = renderHook(() => useAbilityScoreSelection());

      expect(result.current.getFinalScore('strength')).toBe(20);
    });

    it('should validate point buy', () => {
      const { result, rerender } = renderHook(() => useAbilityScoreSelection());

      expect(result.current.pointsUsed).toBe(0); // All 8s, 0 cost
      expect(result.current.pointBuyValid).toBe(true);

      // 15 costs 9 points. 4 * 9 = 36 points, which exceeds 27.
      mockState.character = {
        ...mockState.character,
        abilityScores: {
          strength: { score: 15 },
          dexterity: { score: 15 },
          constitution: { score: 15 },
          intelligence: { score: 15 },
          wisdom: { score: 8 },
          charisma: { score: 8 },
        },
      };

      rerender();

      expect(result.current.pointsUsed).toBe(36);
      expect(result.current.pointBuyValid).toBe(false);
    });

    it('should calculate ability modifier correctly even if spellcasting ability is missing', () => {
      mockState.character = {
        ...mockState.character,
        class: {
          id: 'fighter',
          name: 'Fighter',
        },
      };

      const { result } = renderHook(() => useAbilityScoreSelection());
      expect(result.current.totalModifier).toBe(-6); // all 8s -> -1 each -> -6 total
    });

    it('should calculate total modifier bonus', () => {
      mockState.character = {
        ...mockState.character,
        abilityScores: {
          strength: { score: 12, modifier: 1 },
          dexterity: { score: 14, modifier: 2 },
          constitution: { score: 10, modifier: 0 },
          intelligence: { score: 8, modifier: -1 },
          wisdom: { score: 8, modifier: -1 },
          charisma: { score: 8, modifier: -1 },
        },
      };

      const { result } = renderHook(() => useAbilityScoreSelection());

      expect(result.current.totalModifier).toBe(0); // 1 + 2 + 0 - 1 - 1 - 1 = 0
    });
  });
});
