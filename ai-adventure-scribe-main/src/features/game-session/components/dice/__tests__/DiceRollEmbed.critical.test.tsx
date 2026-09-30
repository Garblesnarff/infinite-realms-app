import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiceRollEmbed } from '../DiceRollEmbed';

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
    roll: () => ({
      expression: '1d20+5',
      total: 25,
      rolls: [{ dice: 20, value: 20 }],
      modifiers: 5,
      critical: true,
      naturalRoll: 20,
      timestamp: 1,
    }),
  },
}));

describe('DiceRollEmbed natural 20 copy (#2343 item 9)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function rollNat20(props: { isAttack?: boolean; purpose?: string }) {
    render(
      <DiceRollEmbed
        expression="1d20+5"
        autoRoll
        showAnimation={false}
        {...props}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }

  it('says "Critical Hit!" for an attack roll', () => {
    rollNat20({ isAttack: true, purpose: 'Longsword attack' });

    const badge = screen.getByLabelText('Critical Hit');
    expect(badge).toHaveTextContent('Critical Hit!');
    expect(screen.queryByLabelText('Natural 20')).not.toBeInTheDocument();
  });

  it('says "Natural 20" for a skill check, not "Critical Hit!"', () => {
    rollNat20({ purpose: 'Investigation check' });

    const badge = screen.getByLabelText('Natural 20');
    expect(badge).toHaveTextContent('Natural 20');
    expect(screen.queryByLabelText('Critical Hit')).not.toBeInTheDocument();
  });
});
