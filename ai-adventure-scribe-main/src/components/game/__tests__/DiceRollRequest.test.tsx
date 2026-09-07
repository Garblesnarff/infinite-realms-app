/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { DiceRollRequest } from '../DiceRollRequest';

import { useCharacter } from '@/contexts/CharacterContext';
import { calculateRollWithBreakdown } from '@/utils/characterModifiers';

// Mock dependencies
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: vi.fn(),
}));

vi.mock('@/features/game-session/components', () => ({
  DiceRollEmbed: ({ onRoll }: any) => (
    <div data-testid="dice-roll-embed">
      <button onClick={() => onRoll({ total: 15 })} data-testid="mock-roll-button">
        Mock Roll
      </button>
      <button onClick={() => onRoll(20)} data-testid="mock-roll-number-button">
        Mock Roll Number
      </button>
      <button onClick={() => onRoll(null)} data-testid="mock-roll-invalid-button">
        Mock Roll Invalid
      </button>
    </div>
  ),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/utils/characterModifiers', () => ({
  calculateRollWithBreakdown: vi.fn(),
  SKILL_ABILITIES: {
    athletics: 'strength',
    stealth: 'dexterity',
  },
  calculateRollWithBreakdownActual: vi.fn(),
}));

describe('DiceRollRequest', () => {
  const mockOnRoll = vi.fn();
  const mockOnManualResult = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultRequest = {
    type: 'check' as const,
    formula: '1d20',
    purpose: 'Test purpose',
  };

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

  it('renders correctly with default request', () => {
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    expect(screen.getByText(/Ability Check Requested/i)).toBeInTheDocument();
    expect(screen.getByText(/Test purpose/i)).toBeInTheDocument();
    expect(screen.getByText('1d20+2')).toBeInTheDocument();
  });

  it('handles damage rolls without calculating modifiers', () => {
    const damageRequest = {
      type: 'damage' as const,
      formula: '2d6+3',
      purpose: 'Weapon damage',
    };

    render(
      <DiceRollRequest
        request={damageRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    expect(screen.getByText('2d6+3')).toBeInTheDocument();
    expect(screen.queryByText(/STR \+2/i)).not.toBeInTheDocument();
  });

  it('toggles advantage and disadvantage correctly', () => {
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    const advButton = screen.getByRole('button', { name: /Enable Advantage/i });
    const disButton = screen.getByRole('button', { name: /Enable Disadvantage/i });

    expect(advButton).toBeInTheDocument();
    expect(disButton).toBeInTheDocument();

    fireEvent.click(advButton);
    expect(screen.getByRole('button', { name: /Disable Advantage/i })).toBeInTheDocument();

    fireEvent.click(disButton);
    expect(screen.getByRole('button', { name: /Disable Disadvantage/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Enable Advantage/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: /Disable Disadvantage/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Toggle off
    fireEvent.click(screen.getByRole('button', { name: /Disable Disadvantage/i }));
    expect(screen.getByRole('button', { name: /Enable Disadvantage/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    // Toggle advantage on
    fireEvent.click(screen.getByRole('button', { name: /Enable Advantage/i }));
    expect(screen.getByRole('button', { name: /Disable Advantage/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Toggle advantage off
    fireEvent.click(screen.getByRole('button', { name: /Disable Advantage/i }));
    expect(screen.getByRole('button', { name: /Enable Advantage/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('keeps the roll formula in place when the Advantage tooltip opens', async () => {
    const user = userEvent.setup();
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    const formula = screen.getByText('1d20+2');
    const rollPanel = formula.closest('div.bg-white');
    expect(rollPanel).not.toBeNull();

    await user.hover(screen.getByRole('button', { name: /Enable Advantage/i }));

    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Enable Advantage');
    expect(screen.getByText('1d20+2')).toBeVisible();
    expect(rollPanel).not.toContainElement(tooltip);
  });

  it('switches to manual mode, goes back, and submits a result', () => {
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: /Roll physical dice and enter result manually/i }),
    );

    const input = screen.getByLabelText(/Enter your roll result:/i);
    fireEvent.change(input, { target: { value: '18' } });

    // Go back
    fireEvent.click(screen.getByRole('button', { name: /Back to Roll/i }));
    expect(screen.queryByLabelText(/Enter your roll result:/i)).not.toBeInTheDocument();

    // Go manual again and submit
    fireEvent.click(
      screen.getByRole('button', { name: /Roll physical dice and enter result manually/i }),
    );
    const input2 = screen.getByLabelText(/Enter your roll result:/i);
    fireEvent.change(input2, { target: { value: '18' } });
    fireEvent.click(screen.getByRole('button', { name: /Submit/i }));
    expect(mockOnManualResult).toHaveBeenCalledWith(18);
  });

  it('triggers auto-roll and handles completion', () => {
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Roll 1d20\+2 for Test purpose/i }));

    expect(screen.getByTestId('dice-roll-embed')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mock-roll-button'));
    expect(mockOnManualResult).toHaveBeenCalledWith(15);
  });

  it('handles auto-roll with numeric result', () => {
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Roll 1d20\+2 for Test purpose/i }));
    fireEvent.click(screen.getByTestId('mock-roll-number-button'));
    expect(mockOnManualResult).toHaveBeenCalledWith(20);
  });

  it('handles auto-roll with invalid result', () => {
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Roll 1d20\+2 for Test purpose/i }));
    fireEvent.click(screen.getByTestId('mock-roll-invalid-button'));
    expect(mockOnManualResult).toHaveBeenCalledWith(0);
  });

  it('handles cancellation if provided', () => {
    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
        onCancel={mockOnCancel}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Dismiss roll request/i }));
    expect(mockOnCancel).toHaveBeenCalled();
  });

  it('identifies skill check and ability correctly from purpose', () => {
    const skillRequest = {
      type: 'skill_check' as const,
      formula: 'athletics',
      purpose: 'Athletics check',
    };

    render(
      <DiceRollRequest
        request={skillRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'skill',
      'strength',
      'athletics',
    );
  });

  it('identifies ability check correctly from purpose', () => {
    const abilityRequest = {
      type: 'check' as const,
      formula: '1d20',
      purpose: 'Strength check',
    };

    render(
      <DiceRollRequest
        request={abilityRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'strength',
      undefined,
    );
  });

  it('identifies ability from formula string', () => {
    const request = {
      type: 'check' as const,
      formula: '+dex',
      purpose: 'Generic check',
    };

    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'dexterity',
      undefined,
    );
  });

  it('handles error in roll calculation gracefully', () => {
    (calculateRollWithBreakdown as any).mockImplementation(() => {
      throw new Error('Test Error');
    });

    render(
      <DiceRollRequest
        request={defaultRequest}
        onRoll={mockOnRoll}
        onManualResult={mockOnManualResult}
      />,
    );

    expect(screen.getByText('1d20')).toBeInTheDocument();
  });

  it('renders different request types correctly', () => {
    const typeMap = {
      attack: /Attack Roll Requested/i,
      save: /Saving Throw Requested/i,
      initiative: /Initiative Requested/i,
      damage_taken: /Incoming Damage Requested/i,
      skill_check: /Skill Check Requested/i,
      damage: /Damage Roll Requested/i,
    };

    Object.entries(typeMap).forEach(([type, regex]) => {
      const { unmount } = render(
        <DiceRollRequest
          request={{ ...defaultRequest, type: type as any }}
          onRoll={mockOnRoll}
          onManualResult={mockOnManualResult}
        />,
      );
      expect(screen.getByText(regex)).toBeInTheDocument();
      unmount();
    });
  });

  it('handles formula with numbers as-is', () => {
    const request = {
      ...defaultRequest,
      formula: '1d20+5',
    };

    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    expect(screen.getByText('1d20+5')).toBeInTheDocument();
    expect(calculateRollWithBreakdown).not.toHaveBeenCalled();
  });

  it('handles DC and AC display', () => {
    const request = {
      ...defaultRequest,
      dc: 15,
      ac: 18,
    };

    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    expect(screen.getByText(/DC 15/i)).toBeInTheDocument();
    // In DiceRollRequest.tsx: {request.dc ? `DC ${request.dc}` : `AC ${request.ac}`}
    // So if both DC and AC are present, it only shows DC.
  });

  // --- Symbolic formula guard (regression: 1d20+cha/int/wis crashes dice engine) ---

  it('shows loading spinner when character is null and formula is symbolic', () => {
    (useCharacter as any).mockReturnValue({ state: { character: null } });
    // Make calculateRollWithBreakdown return the raw symbolic formula (character is null path)
    (calculateRollWithBreakdown as any).mockReturnValue({
      formula: '1d20+cha',
      breakdown: ['1d20+cha'],
      totalModifier: 0,
      isProficient: false,
    });

    const request = { type: 'check' as const, formula: '1d20+cha', purpose: 'Deception check' };
    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    expect(screen.getByText(/loading character data/i)).toBeInTheDocument();
    expect(screen.queryByTestId('dice-roll-embed')).not.toBeInTheDocument();
  });

  it('auto-switches to manual mode when character loaded but formula remains symbolic', () => {
    // Simulate a resolution failure: calculateRollWithBreakdown returns symbolic formula
    (calculateRollWithBreakdown as any).mockReturnValue({
      formula: '1d20+cha',
      breakdown: ['1d20+cha'],
      totalModifier: 0,
      isProficient: false,
    });

    const request = { type: 'check' as const, formula: '1d20+cha', purpose: 'Charisma check' };
    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    // effectiveManualMode is true synchronously — forced fallback label shown
    expect(screen.getByLabelText(/roll formula could not be resolved/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /roll dice/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /back to roll/i })).not.toBeInTheDocument();
  });

  it('skill_check type without detected skill name falls back to ability check (no throw)', () => {
    (calculateRollWithBreakdown as any).mockReturnValue({
      formula: '1d20+3',
      breakdown: ['1d20', 'CHA +3'],
      totalModifier: 3,
      isProficient: false,
    });

    const request = {
      type: 'skill_check' as const,
      formula: '1d20+cha',
      purpose: 'A general charisma test',
    };
    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    expect(
      screen.getByRole('button', { name: /roll 1d20\+3 for A general charisma test/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/roll formula could not be resolved/i)).not.toBeInTheDocument();
    // Must be called with 'check' rollType (not 'skill' which would throw with no skillName)
    expect(calculateRollWithBreakdown).toHaveBeenCalledWith(
      mockCharacter,
      'check',
      'charisma',
      undefined,
    );
  });

  it('1d20+int — resolved numeric formula enables Roll Dice button', () => {
    (calculateRollWithBreakdown as any).mockReturnValue({
      formula: '1d20-1',
      breakdown: ['1d20', 'INT -1'],
      totalModifier: -1,
      isProficient: false,
    });

    const request = { type: 'check' as const, formula: '1d20+int', purpose: 'Arcana check' };
    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    const rollButton = screen.getByRole('button', { name: /roll 1d20-1 for Arcana check/i });
    expect(rollButton).not.toBeDisabled();
    expect(screen.getByText('1d20-1')).toBeInTheDocument();
  });

  it('1d20+wis — resolved numeric formula enables Roll Dice button', () => {
    (calculateRollWithBreakdown as any).mockReturnValue({
      formula: '1d20+2',
      breakdown: ['1d20', 'WIS +2'],
      totalModifier: 2,
      isProficient: false,
    });

    const request = { type: 'check' as const, formula: '1d20+wis', purpose: 'Perception check' };
    render(
      <DiceRollRequest request={request} onRoll={mockOnRoll} onManualResult={mockOnManualResult} />,
    );

    const rollButton = screen.getByRole('button', { name: /roll 1d20\+2 for Perception check/i });
    expect(rollButton).not.toBeDisabled();
    expect(screen.getByText('1d20+2')).toBeInTheDocument();
  });
});
