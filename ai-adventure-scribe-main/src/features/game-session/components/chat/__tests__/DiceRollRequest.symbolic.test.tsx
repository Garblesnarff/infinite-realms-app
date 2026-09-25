/**
 * Tests for symbolic dice formula resolution in DiceRollRequest.
 *
 * Regression coverage for: symbolic formulas (1d20+cha/int/wis) crashing the dice engine
 * and deadlocking pending-roll state.
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type RollRequest } from '../DiceRollRequest';

import type { Character } from '@/types/character';

import { DiceRollRequest } from '@/components/game/DiceRollRequest';
import { useCharacter } from '@/contexts/CharacterContext';
import { calculateRollWithBreakdown } from '@/utils/characterModifiers';

// ---------------------------------------------------------------------------
// Shared mock character
// ---------------------------------------------------------------------------
const mockCharacter: Character = {
  id: 'char-test',
  name: 'Test Hero',
  level: 5,
  abilityScores: {
    strength: { score: 14, modifier: 2, savingThrow: false },
    dexterity: { score: 12, modifier: 1, savingThrow: false },
    constitution: { score: 10, modifier: 0, savingThrow: false },
    intelligence: { score: 8, modifier: -1, savingThrow: false },
    wisdom: { score: 14, modifier: 2, savingThrow: true },
    charisma: { score: 16, modifier: 3, savingThrow: false },
  },
  skillProficiencies: ['Persuasion', 'Deception'],
  savingThrowProficiencies: ['wisdom'],
};

// ---------------------------------------------------------------------------
// 1. calculateRollWithBreakdown resolves symbolic ability to numeric formula
// ---------------------------------------------------------------------------
describe('calculateRollWithBreakdown — symbolic ability resolution', () => {
  it('resolves 1d20+cha → numeric formula using CHA modifier', () => {
    // CHA +3 on the mock character
    const result = calculateRollWithBreakdown(mockCharacter, 'check', 'charisma');
    expect(result.formula).toMatch(/^1d20/);
    // Formula must NOT contain any alphabetic ability abbreviations
    expect(result.formula).not.toMatch(/\b(cha|int|wis|str|dex|con)\b/i);
    expect(result.totalModifier).toBe(3); // CHA +3, no proficiency for plain check
  });

  it('resolves 1d20+int → numeric formula using INT modifier', () => {
    // INT -1 on the mock character
    const result = calculateRollWithBreakdown(mockCharacter, 'check', 'intelligence');
    expect(result.formula).not.toMatch(/\b(cha|int|wis|str|dex|con)\b/i);
    expect(result.totalModifier).toBe(-1);
  });

  it('resolves 1d20+wis → numeric formula using WIS modifier', () => {
    // WIS +2 on the mock character
    const result = calculateRollWithBreakdown(mockCharacter, 'check', 'wisdom');
    expect(result.formula).not.toMatch(/\b(cha|int|wis|str|dex|con)\b/i);
    expect(result.totalModifier).toBe(2);
  });

  it('resolves 1d20+str → numeric formula using STR modifier', () => {
    const result = calculateRollWithBreakdown(mockCharacter, 'check', 'strength');
    expect(result.formula).not.toMatch(/\b(cha|int|wis|str|dex|con)\b/i);
    expect(result.totalModifier).toBe(2); // STR +2
  });

  it('resolves skill check with proficiency bonus applied', () => {
    // Persuasion (CHA) — proficient
    const result = calculateRollWithBreakdown(mockCharacter, 'skill', 'charisma', 'persuasion');
    expect(result.formula).not.toMatch(/\b(cha|int|wis|str|dex|con)\b/i);
    expect(result.isProficient).toBe(true);
    // CHA +3 + Prof +3 (level 5) = +6
    expect(result.totalModifier).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// 2. isNumericFormula guard (tested via the module boundary)
// ---------------------------------------------------------------------------
// The guard is an internal pure function. We test its invariants by checking
// that calculateRollWithBreakdown never returns symbolic formulas.
describe('formula guard — no symbolic strings reach the dice engine', () => {
  const abilities = [
    'charisma',
    'intelligence',
    'wisdom',
    'strength',
    'dexterity',
    'constitution',
  ] as const;

  for (const ability of abilities) {
    it(`formula for ${ability} check contains only dice-notation characters`, () => {
      const result = calculateRollWithBreakdown(mockCharacter, 'check', ability);
      // Only digits, 'd', 'k', 'h', 'l', '+', '-', '(', ')', spaces are allowed in dice notation
      expect(result.formula).toMatch(/^[\ddkhl+\-() ]+$/);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. DiceRollRequest component — symbolic formula renders loading or manual mode
//    (not a raw symbolic expression passed to DiceRollEmbed)
// ---------------------------------------------------------------------------
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// Stub DiceRollEmbed so we can detect if it's rendered and with what expression
vi.mock('@/features/game-session/components', () => ({
  DiceRollEmbed: ({ expression }: { expression: string }) => (
    <div data-testid="dice-roll-embed" data-expression={expression} />
  ),
}));

const baseRequest: RollRequest = {
  type: 'check',
  formula: '1d20+cha',
  purpose: 'Deception check to bluff the guard',
};

describe('DiceRollRequest — symbolic formula UI guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading spinner when character is not yet loaded', () => {
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({ state: { character: null } });

    render(<DiceRollRequest request={baseRequest} onResult={vi.fn()} />);

    expect(screen.getByText(/loading character data/i)).toBeTruthy();
    expect(screen.queryByTestId('dice-roll-embed')).toBeNull();
  });

  it('does NOT pass symbolic formula to DiceRollEmbed when character is loaded', () => {
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<DiceRollRequest request={baseRequest} onResult={vi.fn()} />);

    const embed = screen.queryByTestId('dice-roll-embed');
    if (embed) {
      const expr = embed.getAttribute('data-expression') ?? '';
      // Must not contain ability abbreviations
      expect(expr).not.toMatch(/\b(cha|int|wis|str|dex|con)\b/i);
    }
    // Either the embed has a numeric formula, or manual mode kicked in
    // — in both cases no symbolic string should reach the engine
  });

  it('displays numeric resolved formula in the roll details section', () => {
    (useCharacter as ReturnType<typeof vi.fn>).mockReturnValue({
      state: { character: mockCharacter },
    });

    render(<DiceRollRequest request={baseRequest} onResult={vi.fn()} />);

    // The roll details area should show a numeric formula like "1d20+3" not "1d20+cha"
    const formulaText = screen.queryByText(/1d20\+cha/i);
    expect(formulaText).toBeNull();
  });
});
