import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiceRollEmbed } from '../DiceRollEmbed';

import { DiceEngine, type DiceRollResult } from '@/services/dice/DiceEngine';

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({
    play: vi.fn(),
    unload: vi.fn(),
  })),
}));

vi.mock('../Dice3DSection', () => ({
  Dice3DSection: () => null,
}));

vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    roll: vi.fn(),
  },
}));

const resolvedSkillChecks: Array<{
  naturalRoll: number;
  modifier: number;
  total: number;
}> = [
  { naturalRoll: 16, modifier: 6, total: 22 },
  { naturalRoll: 9, modifier: -1, total: 8 },
];

function diceEngineResult(check: (typeof resolvedSkillChecks)[number]): DiceRollResult {
  return {
    expression: `1d20${check.modifier >= 0 ? '+' : ''}${check.modifier}`,
    total: check.total,
    rolls: [{ dice: 20, value: check.naturalRoll, sign: 1 }],
    modifiers: check.modifier,
    critical: false,
    naturalRoll: check.naturalRoll,
    timestamp: 1,
    purpose: 'Resolved skill check',
  };
}

describe('DiceRollEmbed resolved skill-check results', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(resolvedSkillChecks)(
    'labels natural $naturalRoll, modifier $modifier, and total $total',
    (check) => {
      vi.mocked(DiceEngine.roll).mockReturnValue(diceEngineResult(check));

      render(
        <DiceRollEmbed
          expression={`1d20${check.modifier >= 0 ? '+' : ''}${check.modifier}`}
          purpose="Resolved skill check"
          autoRoll
          showAnimation={false}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(screen.getByText(`Total ${check.total}`)).toBeInTheDocument();
      expect(screen.getByTestId('roll-breakdown')).toHaveTextContent(
        check.modifier >= 0
          ? `Natural ${check.naturalRoll} + Modifier +${check.modifier} = Total ${check.total}`
          : `Natural ${check.naturalRoll} \u2212 Modifier ${Math.abs(check.modifier)} = Total ${check.total}`,
      );
      expect(screen.queryByText(`Total ${check.naturalRoll}`)).not.toBeInTheDocument();
      expect(screen.getByTestId('roll-breakdown')).not.toHaveTextContent('+ -');
    },
  );

  // The two-face shape DiceEngine.roll returns for advantage and disadvantage:
  // both d20 faces, the dropped one carrying useInTotal: false (#2589).
  it.each([
    {
      flag: { advantage: true },
      faces: [10, 15],
      kept: 15,
      text: 'Natural 15 (kept, 10 dropped) + Modifier +1 = Total 16',
    },
    {
      flag: { disadvantage: true },
      faces: [15, 10],
      kept: 10,
      text: 'Natural 10 (kept, 15 dropped) + Modifier +1 = Total 11',
    },
  ])('shows the kept die and the dropped die ($text)', ({ flag, faces, kept, text }) => {
    vi.mocked(DiceEngine.roll).mockReturnValue({
      expression: `1d20${'advantage' in flag ? 'kh1' : 'kl1'}+1`,
      total: kept + 1,
      rolls: faces.map((value) => ({
        dice: 20,
        value,
        sign: 1 as const,
        useInTotal: value === kept,
      })),
      modifiers: 1,
      advantage: 'advantage' in flag,
      disadvantage: 'disadvantage' in flag,
      critical: false,
      naturalRoll: kept,
      timestamp: 1,
      purpose: 'Resolved skill check',
    });

    render(
      <DiceRollEmbed
        expression="1d20+1"
        purpose="Resolved skill check"
        autoRoll
        showAnimation={false}
        {...flag}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByText(`Total ${kept + 1}`)).toBeInTheDocument();
    expect(screen.getByTestId('roll-breakdown')).toHaveTextContent(text);
  });
});
