import { act, render, screen } from '@testing-library/react';
import React from 'react';
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
      expression: '1d20+4',
      total: 11,
      rolls: [{ dice: 20, value: 7 }],
      modifiers: 4,
      naturalRoll: 7,
      timestamp: 1,
    }),
  },
}));

describe('DiceRollEmbed breakdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows 7 + 4 = 11 instead of Base: 11+0', () => {
    render(<DiceRollEmbed expression="1d20+4" autoRoll showAnimation={false} />);

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(screen.getByTestId('roll-breakdown')).toHaveTextContent('7 + 4 = 11');
    expect(screen.queryByText(/Base:/)).not.toBeInTheDocument();
  });
});
