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

// The result shape `DiceEngine.roll` returns for the options DiceRollEmbed
// passes it (`{ purpose, advantage, disadvantage }`): expression, total, the
// parsed faces, modifiers, the edge flags, `critical` (a natural 20), the
// natural face, and the timestamp/purpose/actor fields it always sets.
const mockRoll = vi.hoisted(() => ({
  current: {
    expression: '1d20+3',
    total: 4,
    rolls: [{ dice: 20, value: 1, sign: 1 as const, critical: true }],
    modifiers: 3,
    advantage: false,
    disadvantage: false,
    critical: false,
    naturalRoll: 1,
    timestamp: 1,
    purpose: 'Perception check',
    actorId: undefined,
    secret: undefined,
  },
}));

vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    roll: () => mockRoll.current,
  },
}));

describe('DiceRollEmbed natural 1 and 20 copy (#2513)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockRoll.current = {
      expression: '1d20+3',
      total: 4,
      rolls: [{ dice: 20, value: 1, sign: 1, critical: true }],
      modifiers: 3,
      advantage: false,
      disadvantage: false,
      critical: false,
      naturalRoll: 1,
      timestamp: 1,
      purpose: 'Perception check',
      actorId: undefined,
      secret: undefined,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function roll(props: { isAttack?: boolean; purpose?: string }): void {
    render(
      <DiceRollEmbed expression="1d20+3" autoRoll showAnimation={false} {...props} />,
    );
    act(() => {
      vi.advanceTimersByTime(200);
    });
  }

  it('says "Critical Miss" for a natural 1 on an attack roll', () => {
    roll({ isAttack: true, purpose: 'Longsword attack' });

    const badge = screen.getByLabelText('Critical Miss');
    expect(badge).toHaveTextContent('Critical Miss');
    expect(screen.queryByLabelText('Natural 1')).not.toBeInTheDocument();
    expect(screen.getByTestId('roll-breakdown')).toHaveTextContent('— 1 + 3 = 4');
  });

  it('says "Natural 1" for a natural 1 on a skill check, with no miss word', () => {
    roll({ purpose: 'Perception check' });

    const badge = screen.getByLabelText('Natural 1');
    expect(badge).toHaveTextContent('Natural 1');
    expect(screen.queryByLabelText('Critical Miss')).not.toBeInTheDocument();
    expect(screen.queryByText(/Critical Miss/)).not.toBeInTheDocument();
    // Badge only: the natural line under the breakdown does not repeat it, and
    // a separator stands before the breakdown, so the face value does not
    // stutter ("Natural 1 — 1 + 3 = 4", not "Natural 1 1 + 3 = 4").
    expect(screen.getAllByText('Natural 1')).toHaveLength(1);
    expect(screen.getByTestId('roll-breakdown')).toHaveTextContent('— 1 + 3 = 4');
  });

  it('says "Natural 1" for a natural 1 on a saving throw, with no miss word', () => {
    roll({ purpose: 'Wisdom saving throw' });

    expect(screen.getByLabelText('Natural 1')).toHaveTextContent('Natural 1');
    expect(screen.queryByText(/Critical Miss/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Natural 1')).toHaveLength(1);
  });

  it('says "Natural 20" for a natural 20 on a check, with no hit word and no repeat', () => {
    mockRoll.current = {
      ...mockRoll.current,
      total: 23,
      rolls: [{ dice: 20, value: 20, sign: 1, critical: true }],
      critical: true,
      naturalRoll: 20,
    };

    roll({ purpose: 'Perception check' });

    expect(screen.getByLabelText('Natural 20')).toHaveTextContent('Natural 20');
    expect(screen.queryByText(/Critical Hit/)).not.toBeInTheDocument();
    expect(screen.getAllByText('Natural 20')).toHaveLength(1);
    expect(screen.getByTestId('roll-breakdown')).toHaveTextContent('— 20 + 3 = 23');
  });
});
