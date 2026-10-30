import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DiceRollEmbed } from '../DiceRollEmbed';

import { tableSettingsKey } from '@/features/settings/table-settings';

const { play, currentUser } = vi.hoisted(() => ({
  play: vi.fn(),
  currentUser: { id: null as string | null },
}));

vi.mock('howler', () => ({
  Howl: vi.fn().mockImplementation(() => ({ play, unload: vi.fn() })),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => (currentUser.id ? { user: { id: currentUser.id } } : undefined),
}));

vi.mock('../Dice3DSection', () => ({
  Dice3DSection: () => null,
}));

vi.mock('@/services/dice/DiceEngine', () => ({
  DiceEngine: {
    roll: () => ({
      expression: '1d20',
      total: 12,
      rolls: [{ dice: 20, value: 12 }],
      modifiers: 0,
      critical: false,
      naturalRoll: 12,
      timestamp: 1,
    }),
  },
}));

/** autoRoll rolls on mount, so the play call happens during render. */
describe('DiceRollEmbed reads the Table > Dice sound setting (#1236 section F)', () => {
  beforeEach(() => {
    play.mockClear();
    window.localStorage.clear();
    currentUser.id = null;
  });

  it('plays the sound when no user is signed in (default on)', () => {
    render(<DiceRollEmbed expression="1d20" autoRoll />);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays the sound for a signed-in user who has not turned it off', () => {
    currentUser.id = 'user-a';
    render(<DiceRollEmbed expression="1d20" autoRoll />);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('does not play the sound when this user turned Dice sound off', () => {
    currentUser.id = 'user-a';
    window.localStorage.setItem(tableSettingsKey('user-a'), JSON.stringify({ diceSound: false }));
    render(<DiceRollEmbed expression="1d20" autoRoll />);
    expect(play).not.toHaveBeenCalled();
  });

  it('ignores another user’s Dice sound setting on the same browser', () => {
    window.localStorage.setItem(tableSettingsKey('user-a'), JSON.stringify({ diceSound: false }));
    currentUser.id = 'user-b';
    render(<DiceRollEmbed expression="1d20" autoRoll />);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
