/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useDiceRollRequest, isNumericFormula } from '../use-dice-roll-request';

import { useCharacter } from '@/contexts/CharacterContext';
import { calculateRollWithBreakdown } from '@/utils/characterModifiers';

// Mock dependencies
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/utils/characterModifiers', () => ({
  calculateRollWithBreakdown: vi.fn(),
  SKILL_ABILITIES: {
    athletics: 'strength',
    stealth: 'dexterity',
    perception: 'wisdom',
    arcana: 'intelligence',
    deception: 'charisma',
    insight: 'wisdom',
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

describe('useDiceRollRequest', () => {
  const mockOnManualResult = vi.fn();
  const mockCharacter = {
    name: 'Test Hero',
    level: 1,
    abilityScores: {
      strength: { score: 14, modifier: 2 },
      dexterity: { score: 10, modifier: 0 },
      constitution: { score: 10, modifier: 0 },
      intelligence: { score: 10, modifier: 0 },
      wisdom: { score: 10, modifier: 0 },
      charisma: { score: 10, modifier: 0 },
    },
  };

  const defaultRequest = {
    type: 'check' as const,
    formula: '1d20',
    purpose: 'Test purpose',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useCharacter as any).mockReturnValue({
      state: { character: mockCharacter },
    });

    (calculateRollWithBreakdown as any).mockReturnValue({
      formula: '1d20+2',
      breakdown: ['1d20', 'STR +2'],
      totalModifier: 2,
      isProficient: false,
    });
  });

  it('initializes state correctly', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    expect(result.current.manualMode).toBe(false);
    expect(result.current.hasAdvantage).toBe(false);
    expect(result.current.hasDisadvantage).toBe(false);
    expect(result.current.isRolling).toBe(false);
    expect(result.current.character).toEqual(mockCharacter);
  });

  it('respects initial advantage/disadvantage from request', () => {
    const request = { ...defaultRequest, advantage: true };
    const { result } = renderHook(() =>
      useDiceRollRequest({ request, onResult: mockOnManualResult }),
    );
    expect(result.current.hasAdvantage).toBe(true);
  });

  it('toggles advantage correctly', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.toggleAdvantage();
    });
    expect(result.current.hasAdvantage).toBe(true);
    expect(result.current.hasDisadvantage).toBe(false);

    act(() => {
      result.current.toggleAdvantage();
    });
    expect(result.current.hasAdvantage).toBe(false);
  });

  it('toggles disadvantage correctly and clears advantage', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.toggleAdvantage();
    });
    expect(result.current.hasAdvantage).toBe(true);

    act(() => {
      result.current.toggleDisadvantage();
    });
    expect(result.current.hasDisadvantage).toBe(true);
    expect(result.current.hasAdvantage).toBe(false);

    act(() => {
      result.current.toggleDisadvantage();
    });
    expect(result.current.hasDisadvantage).toBe(false);
  });

  it('handles manual result submission', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.setManualResult('15');
    });

    act(() => {
      result.current.handleManualSubmit();
    });

    expect(mockOnManualResult).toHaveBeenCalledWith(15);
  });

  it('ignores invalid manual result submission', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.setManualResult('abc');
    });
    act(() => {
      result.current.handleManualSubmit();
    });
    expect(mockOnManualResult).not.toHaveBeenCalled();

    act(() => {
      result.current.setManualResult('-5');
    });
    act(() => {
      result.current.handleManualSubmit();
    });
    expect(mockOnManualResult).not.toHaveBeenCalled();
  });

  it('starts auto-roll', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.handleAutoRoll();
    });

    expect(result.current.showDiceAnimation).toBe(true);
    expect(result.current.isRolling).toBe(true);
  });

  it('completes auto-roll with numeric result', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.handleDiceRollComplete(18);
    });

    expect(result.current.isRolling).toBe(false);
    expect(mockOnManualResult).toHaveBeenCalledWith(18);
  });

  it('completes auto-roll with object result', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.handleDiceRollComplete({ total: 22 });
    });

    expect(mockOnManualResult).toHaveBeenCalledWith(22);
  });

  // #2210: the engine settlers need the bare die; the total already carries the formula's bonus.
  it('passes the natural face alongside the total when the animated roll reports one', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.handleDiceRollComplete({ total: 18, naturalRoll: 13 });
    });

    expect(mockOnManualResult).toHaveBeenCalledWith(18, { naturalRoll: 13 });
  });

  it('passes every animated advantage/disadvantage face to the message producer', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.handleDiceRollComplete({
        total: 7,
        naturalRoll: 5,
        rolls: [
          { value: 18, useInTotal: false },
          { value: 5, useInTotal: true },
        ],
      });
    });

    expect(mockOnManualResult).toHaveBeenCalledWith(7, {
      naturalRoll: 5,
      results: [18, 5],
      keptResults: [5],
    });
  });

  it('completes auto-roll with invalid result', () => {
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    act(() => {
      result.current.handleDiceRollComplete(null);
    });

    expect(mockOnManualResult).toHaveBeenCalledWith(0);
  });

  it('handles damage rolls without calculating modifiers', () => {
    const request = { type: 'damage' as const, formula: '2d6+5', purpose: 'Fireball' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).not.toHaveBeenCalled();
  });

  it('handles formula with numbers as-is', () => {
    const request = { ...defaultRequest, formula: '1d20+5' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).not.toHaveBeenCalled();
  });

  it('identifies skill check from purpose', () => {
    const request = { ...defaultRequest, type: 'skill_check' as const, purpose: 'Athletics check' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'skill',
      'strength',
      'athletics',
    );
  });

  it('skill_check type without detected skill name falls back to ability check', () => {
    const request = {
      type: 'skill_check' as const,
      formula: '1d20+cha',
      purpose: 'A general charisma test',
    };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    // Must be called with 'check' rollType (not 'skill' which would throw with no skillName)
    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'charisma',
      undefined,
    );
  });

  it('identifies ability from formula string (+dex)', () => {
    const request = { ...defaultRequest, formula: '+dex' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'dexterity',
      undefined,
    );
  });

  it('sets ability from purpose using short names like dex', () => {
    const request = { ...defaultRequest, purpose: 'Dex check' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'dexterity',
      undefined,
    );
  });

  it('identifies ability from formula with full names', () => {
    const request = { ...defaultRequest, formula: 'strength' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'strength',
      undefined,
    );
  });

  it('identifies ability from formula with +str', () => {
    const request = { ...defaultRequest, formula: '+str' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'strength',
      undefined,
    );
  });

  it('identifies ability from formula with intelligence', () => {
    const request = { ...defaultRequest, formula: 'intelligence' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'intelligence',
      undefined,
    );
  });

  it('identifies ability from formula with +wis', () => {
    const request = { ...defaultRequest, formula: '+wis' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'wisdom',
      undefined,
    );
  });

  it('identifies ability from formula with +cha', () => {
    const request = { ...defaultRequest, formula: '+cha' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'charisma',
      undefined,
    );
  });

  it('identifies ability from formula with constitution', () => {
    const request = { ...defaultRequest, formula: 'constitution' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'constitution',
      undefined,
    );
  });

  it('identifies initiative correctly', () => {
    const request = { ...defaultRequest, type: 'initiative' as const };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'initiative',
      'dexterity',
      undefined,
    );
  });

  it('identifies attack correctly (defaults to strength)', () => {
    const request = { ...defaultRequest, type: 'attack' as const };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'attack',
      'strength',
      undefined,
    );
  });

  it('identifies save correctly from purpose', () => {
    const request = { ...defaultRequest, type: 'save' as const, purpose: 'Wisdom save' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'save',
      'wisdom',
      undefined,
    );
  });

  it('identifies skill from purpose even if type is not skill_check', () => {
    const request = { ...defaultRequest, type: 'check' as const, purpose: 'Stealth check' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'skill',
      'dexterity',
      'stealth',
    );
  });

  it('identifies ability from purpose', () => {
    const request = { ...defaultRequest, type: 'check' as const, purpose: 'Intelligence check' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'intelligence',
      undefined,
    );
  });

  it('handles missing character gracefully', () => {
    (useCharacter as any).mockReturnValue({ state: { character: null } });
    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    expect(result.current.character).toBeNull();
    expect(result.current.rollCalculation.formula).toBe('1d20');
  });

  it('handles error in calculation gracefully', () => {
    (calculateRollWithBreakdown as any).mockImplementation(() => {
      throw new Error('Calc error');
    });

    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    expect(result.current.rollCalculation.formula).toBe('1d20');
  });

  it('isNumericFormula identifies symbolic and numeric formulas correctly', () => {
    expect(isNumericFormula('1d20+5')).toBe(true);
    expect(isNumericFormula('1d20+str')).toBe(false);
    expect(isNumericFormula('1d20+dex')).toBe(false);
    expect(isNumericFormula('1d20+con')).toBe(false);
    expect(isNumericFormula('1d20+int')).toBe(false);
    expect(isNumericFormula('1d20+wis')).toBe(false);
    expect(isNumericFormula('1d20+cha')).toBe(false);
    expect(isNumericFormula('1d20+mod')).toBe(false);
    expect(isNumericFormula('1d20+modifier')).toBe(false);
  });

  it('switches to manual mode if formula remains symbolic', () => {
    (calculateRollWithBreakdown as any).mockReturnValue({
      formula: '1d20+str',
      breakdown: ['1d20+str'],
      totalModifier: 0,
    });

    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    expect(result.current.resolvedFormula).toBeNull();
    expect(result.current.effectiveManualMode).toBe(true);
  });

  it('sets ability from purpose when not explicitly in formula and skill not found', () => {
    const request = { ...defaultRequest, purpose: 'Just a strength test' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'strength',
      undefined,
    );
  });

  describe('Callback and Reference Stability', () => {
    it('maintains referential identity across re-renders with the same props and state', () => {
      const { result, rerender } = renderHook(
        ({ request }) => useDiceRollRequest({ request, onResult: mockOnManualResult }),
        { initialProps: { request: defaultRequest } },
      );

      const firstRenderResult = result.current;

      rerender({ request: defaultRequest });

      // Verify that the exact same object reference is returned
      expect(result.current).toBe(firstRenderResult);

      // Verify reference stability of the individual action callbacks
      expect(result.current.handleEnterManually).toBe(firstRenderResult.handleEnterManually);
      expect(result.current.handleBackToRoll).toBe(firstRenderResult.handleBackToRoll);
      expect(result.current.handleAutoRoll).toBe(firstRenderResult.handleAutoRoll);
      expect(result.current.handleDiceRollComplete).toBe(firstRenderResult.handleDiceRollComplete);
      expect(result.current.handleManualSubmit).toBe(firstRenderResult.handleManualSubmit);
      expect(result.current.toggleAdvantage).toBe(firstRenderResult.toggleAdvantage);
      expect(result.current.toggleDisadvantage).toBe(firstRenderResult.toggleDisadvantage);
    });
  });
});
