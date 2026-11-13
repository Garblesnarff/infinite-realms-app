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

const inspirationHolder = vi.hoisted(() => {
  const holder = {
    armed: false,
    spendResult: true as boolean | Error,
    arm: vi.fn(),
    disarm: vi.fn(),
    spendInspiration: vi.fn(),
  };
  // Mirror the real useInspirationSpend: arm/disarm are stable callbacks, and
  // spendInspiration never throws — a failed spend resolves false.
  holder.arm.mockImplementation(() => {
    holder.armed = true;
  });
  holder.disarm.mockImplementation(() => {
    holder.armed = false;
  });
  holder.spendInspiration.mockImplementation(async (..._args: unknown[]) => {
    if (holder.spendResult instanceof Error) return false;
    return holder.spendResult;
  });
  return holder;
});
vi.mock('@/features/game-session/hooks/use-inspiration-spend', () => ({
  useInspirationSpend: () => ({
    armed: inspirationHolder.armed,
    arm: inspirationHolder.arm,
    disarm: inspirationHolder.disarm,
    spendInspiration: inspirationHolder.spendInspiration,
  }),
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
  // #1472: a recorded roll resolves true — the Inspiration spend waits on it.
  const mockOnManualResult = vi.fn().mockResolvedValue(true);
  const mockCharacter = {
    id: 'character-1',
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

    expect(mockOnManualResult).toHaveBeenCalledWith(18, {
      naturalRoll: 13,
      // #1414 round 2 (B4): the details always carry what the dice rolled with, so the
      // settle path can prefer them over the queued config — including an explicit false.
      advantage: false,
      disadvantage: false,
    });
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
      // #1414 round 2 (B4): see the test above — the details always carry advantage.
      advantage: false,
      disadvantage: false,
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

  it('does not keep a numeric formula when the character can supply the modifier', () => {
    const request = { ...defaultRequest, formula: '1d20+5' };
    renderHook(() => useDiceRollRequest({ request, onResult: mockOnManualResult }));

    expect(calculateRollWithBreakdown).toHaveBeenCalled();
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
    expect(result.current.rollCalculation.formula).toBe('modifier unknown');
    expect(result.current.rollCalculation.modifierUnknown).toBe(true);
    expect(result.current.resolvedFormula).toBeNull();
  });

  it('handles error in calculation gracefully', () => {
    (calculateRollWithBreakdown as any).mockImplementation(() => {
      throw new Error('Calc error');
    });

    const { result } = renderHook(() =>
      useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
    );

    expect(result.current.rollCalculation.formula).toBe('modifier unknown');
    expect(result.current.resolvedFormula).toBeNull();
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

  describe('inspiration spend (#1414)', () => {
    beforeEach(() => {
      inspirationHolder.armed = false;
      inspirationHolder.spendResult = true;
      inspirationHolder.arm.mockClear();
      inspirationHolder.disarm.mockClear();
      inspirationHolder.spendInspiration.mockClear();
    });

    it('an armed inspiration forces advantage and cancels disadvantage', () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({
          request: { ...defaultRequest, disadvantage: true },
          onResult: mockOnManualResult,
        }),
      );
      expect(result.current.hasAdvantage).toBe(true);
      expect(result.current.hasDisadvantage).toBe(false);
    });

    it('spends only after the advantaged roll is saved — the dice roll at once (#1472)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      // The dice roll with the armed advantage, but the flag is not consumed yet.
      expect(result.current.showDiceAnimation).toBe(true);
      expect(result.current.hasAdvantage).toBe(true);
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.handleDiceRollComplete(15);
      });
      expect(mockOnManualResult).toHaveBeenCalledWith(15);
      expect(inspirationHolder.spendInspiration).toHaveBeenCalledTimes(1);
      expect(inspirationHolder.spendInspiration).toHaveBeenCalledWith('character-1');
      // The save happens before the spend: the flag is consumed only for a recorded roll.
      expect(mockOnManualResult.mock.invocationCallOrder[0]).toBeLessThan(
        inspirationHolder.spendInspiration.mock.invocationCallOrder[0],
      );
      expect(inspirationHolder.disarm).toHaveBeenCalled();
    });

    it('a failed spend after the save: the saved roll stands and the arm stays (#1472)', async () => {
      inspirationHolder.armed = true;
      inspirationHolder.spendResult = new Error('No inspiration to spend');
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      await act(async () => {
        await result.current.handleDiceRollComplete({
          total: 15,
          naturalRoll: 15,
          rolls: [{ value: 15, useInTotal: true }],
        });
      });
      // The roll was recorded with the advantage it rolled with; the refused spend does not undo it.
      expect(mockOnManualResult).toHaveBeenCalledWith(
        15,
        expect.objectContaining({ advantage: true, disadvantage: false }),
      );
      expect(inspirationHolder.spendInspiration).toHaveBeenCalledWith('character-1');
      // A failed spend keeps the arm: the server flag is still true, so the next roll pays.
      expect(inspirationHolder.disarm).not.toHaveBeenCalled();
    });

    it('a manual entry disarms without spending', () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      act(() => {
        result.current.setManualResult('12');
      });
      act(() => {
        result.current.handleManualSubmit();
      });
      expect(mockOnManualResult).toHaveBeenCalledWith(12);
      expect(inspirationHolder.disarm).toHaveBeenCalled();
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
    });

    it('an armed roll reports advantage in the result details (round 2, B4)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      await act(async () => {
        await result.current.handleDiceRollComplete({
          total: 17,
          naturalRoll: 15,
          rolls: [
            { value: 15, useInTotal: true },
            { value: 8, useInTotal: false },
          ],
        });
      });
      expect(mockOnManualResult).toHaveBeenCalledWith(
        17,
        expect.objectContaining({ advantage: true, disadvantage: false, naturalRoll: 15 }),
      );
    });

    it('an armed roll with no character disarms instead of rolling a free advantage', async () => {
      inspirationHolder.armed = true;
      (useCharacter as any).mockReturnValue({ state: { character: null } });
      const { result, rerender } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
      expect(inspirationHolder.disarm).toHaveBeenCalled();
      rerender();
      expect(result.current.hasAdvantage).toBe(false);
    });

    it('toggling advantage off while armed disarms instead of doing nothing', () => {
      inspirationHolder.armed = true;
      const { result, rerender } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );
      expect(result.current.hasAdvantage).toBe(true);

      act(() => {
        result.current.toggleAdvantage();
      });
      expect(inspirationHolder.disarm).toHaveBeenCalled();
      // The mock's disarm flips a plain boolean, not React state — the real provider's
      // disarm is a setState and re-renders; force the re-read here, as the failed-spend
      // test does.
      rerender();
      expect(result.current.hasAdvantage).toBe(false);
    });

    it('toggling disadvantage on while armed disarms and goes disadvantaged', () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      act(() => {
        result.current.toggleDisadvantage();
      });
      expect(inspirationHolder.disarm).toHaveBeenCalled();
      expect(result.current.hasAdvantage).toBe(false);
      expect(result.current.hasDisadvantage).toBe(true);
    });

    it('entering manually is a no-op while a roll is in flight (round 2, B3)', async () => {
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      act(() => {
        result.current.handleEnterManually();
      });
      expect(result.current.manualMode).toBe(false);
    });

    it('a cancelled roll never spends — the flag stays true (#1472)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      // The player cancels or closes the page before the dice land: no completion runs.
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
      expect(inspirationHolder.disarm).not.toHaveBeenCalled();
      expect(inspirationHolder.armed).toBe(true);
      expect(mockOnManualResult).not.toHaveBeenCalled();
    });

    it('a roll whose save fails keeps the flag and the arm for the retry (#1472)', async () => {
      inspirationHolder.armed = true;
      mockOnManualResult.mockResolvedValueOnce(false);
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      await act(async () => {
        await result.current.handleDiceRollComplete(15);
      });
      expect(mockOnManualResult).toHaveBeenCalledWith(15);
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
      expect(inspirationHolder.disarm).not.toHaveBeenCalled();
    });

    it('double submit spends once — one roll, one flag (#1472)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
        // A second click while the roll is in flight is refused by the synchronous guard.
        await result.current.handleAutoRoll();
      });
      await act(async () => {
        await result.current.handleDiceRollComplete(15);
      });
      // A duplicate completion for the same roll must not spend the flag again.
      await act(async () => {
        await result.current.handleDiceRollComplete(15);
      });
      expect(inspirationHolder.spendInspiration).toHaveBeenCalledTimes(1);
    });

    it('does not mount the dice before the roll — the arm is spent after the save (#1472)', async () => {
      inspirationHolder.armed = true;
      const { result, rerender } = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      expect(result.current.isRolling).toBe(true);
      expect(result.current.showDiceAnimation).toBe(true);
      rerender();
      expect(result.current.hasAdvantage).toBe(true);
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
    });

    it('does not spend on a damage roll — the arm survives for the next d20 roll (round 3, B-2)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({
          request: { type: 'damage' as const, formula: '2d6+5', purpose: 'Fireball' },
          onResult: mockOnManualResult,
        }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      // Advantage is a d20 mechanic — a damage roll has nothing to advantage, so the flag
      // is neither spent nor disarmed here.
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
      expect(inspirationHolder.disarm).not.toHaveBeenCalled();
      expect(result.current.showDiceAnimation).toBe(true);
    });

    it('an armed damage request reports no advantage anywhere — display and record agree (round 5, FIX at 7df1690a item 1)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({
          request: { type: 'damage' as const, formula: '2d6+5', purpose: 'Fireball' },
          onResult: mockOnManualResult,
        }),
      );

      // The popup reads the returned values — a damage roll must not show advantage
      // while armed, or the display would claim a benefit the record does not carry.
      expect(result.current.hasAdvantage).toBe(false);
      expect(result.current.hasDisadvantage).toBe(false);

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      await act(async () => {
        await result.current.handleDiceRollComplete({
          total: 9,
          naturalRoll: 4,
          rolls: [{ value: 4, useInTotal: true }],
        });
      });
      // The record carries the same values the popup reported — no advantage, and the
      // flag was not spent.
      expect(mockOnManualResult).toHaveBeenCalledWith(
        9,
        expect.objectContaining({ advantage: false, disadvantage: false, naturalRoll: 4 }),
      );
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
    });

    it('toggling advantage off while armed restores the underlying disadvantage (round 3, nit 1)', () => {
      inspirationHolder.armed = true;
      const { result, rerender } = renderHook(() =>
        useDiceRollRequest({
          request: { ...defaultRequest, disadvantage: true },
          onResult: mockOnManualResult,
        }),
      );
      expect(result.current.hasAdvantage).toBe(true);
      expect(result.current.hasDisadvantage).toBe(false);

      act(() => {
        result.current.toggleAdvantage();
      });
      expect(inspirationHolder.disarm).toHaveBeenCalled();
      rerender();
      // Withdrawing Inspiration restores the disadvantage the request always carried —
      // the arm masked it, it did not remove it.
      expect(result.current.hasAdvantage).toBe(false);
      expect(result.current.hasDisadvantage).toBe(true);
    });

    it('does not spend when the request already has advantage — the arm survives for the next roll (#1471)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({
          request: { ...defaultRequest, advantage: true },
          onResult: mockOnManualResult,
        }),
      );

      // The request already rolls with advantage, so Inspiration would buy nothing.
      expect(result.current.hasAdvantage).toBe(true);

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
      expect(inspirationHolder.disarm).not.toHaveBeenCalled();
      expect(inspirationHolder.armed).toBe(true);
      expect(result.current.showDiceAnimation).toBe(true);

      await act(async () => {
        await result.current.handleDiceRollComplete({
          total: 19,
          naturalRoll: 17,
          rolls: [
            { value: 17, useInTotal: true },
            { value: 9, useInTotal: false },
          ],
        });
      });
      // The record carries the request's advantage — and the flag is still there.
      expect(mockOnManualResult).toHaveBeenCalledWith(
        19,
        expect.objectContaining({ advantage: true, disadvantage: false, naturalRoll: 17 }),
      );
      expect(inspirationHolder.disarm).not.toHaveBeenCalled();

      // The arm survived this roll — a second request spends it.
      const second = renderHook(() =>
        useDiceRollRequest({ request: defaultRequest, onResult: mockOnManualResult }),
      );
      await act(async () => {
        await second.result.current.handleAutoRoll();
      });
      await act(async () => {
        await second.result.current.handleDiceRollComplete(11);
      });
      expect(inspirationHolder.spendInspiration).toHaveBeenCalledWith('character-1');
    });

    it('does not spend when the request has advantage and disadvantage — the engine nets it to a straight roll (#1471)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({
          request: { ...defaultRequest, advantage: true, disadvantage: true },
          onResult: mockOnManualResult,
        }),
      );

      // The arm is not paying here, so the popup shows the request's own flags —
      // DiceRollRequest nets both-true to a plain d20, the 5e cancellation.
      expect(result.current.hasAdvantage).toBe(true);
      expect(result.current.hasDisadvantage).toBe(true);

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();
      expect(inspirationHolder.disarm).not.toHaveBeenCalled();
      expect(inspirationHolder.armed).toBe(true);
      expect(result.current.showDiceAnimation).toBe(true);

      await act(async () => {
        await result.current.handleDiceRollComplete({
          total: 12,
          naturalRoll: 12,
          rolls: [{ value: 12, useInTotal: true }],
        });
      });
      // The record carries the request's own flags — the same as the not-armed case.
      expect(mockOnManualResult).toHaveBeenCalledWith(
        12,
        expect.objectContaining({ advantage: true, disadvantage: true, naturalRoll: 12 }),
      );
    });

    it('still spends on a disadvantaged request — the arm buys out the disadvantage (#1471)', async () => {
      inspirationHolder.armed = true;
      const { result } = renderHook(() =>
        useDiceRollRequest({
          request: { ...defaultRequest, disadvantage: true },
          onResult: mockOnManualResult,
        }),
      );

      await act(async () => {
        await result.current.handleAutoRoll();
      });
      expect(inspirationHolder.spendInspiration).not.toHaveBeenCalled();

      await act(async () => {
        await result.current.handleDiceRollComplete({
          total: 16,
          naturalRoll: 14,
          rolls: [
            { value: 14, useInTotal: true },
            { value: 6, useInTotal: false },
          ],
        });
      });
      expect(mockOnManualResult).toHaveBeenCalledWith(
        16,
        expect.objectContaining({ advantage: true, disadvantage: false, naturalRoll: 14 }),
      );
      expect(inspirationHolder.spendInspiration).toHaveBeenCalledWith('character-1');
      expect(inspirationHolder.disarm).toHaveBeenCalled();
    });
  });
});
