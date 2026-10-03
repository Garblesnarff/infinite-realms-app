import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RollAutoCountdown } from '../RollAutoCountdown';

import {
  markPlayerRollCommitted,
  PLAYER_ATTACK_ROLL_TIMEOUT_MS,
  requestPlayerAttackRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SPEC = {
  actorLabel: 'The Veteran',
  targetLabel: 'Goblin',
  weaponName: 'Longsword',
  attackBonus: 6,
  targetAc: 15,
  advantage: false,
  disadvantage: false,
};

describe('the clock on an engine roll prompt (#2530)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
    setPlayerRollHost({ present: () => ({ rollId: 'attack-roll-1', dismiss: () => {} }) });
  });

  afterEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.useRealTimers();
  });

  it('counts down to the auto-roll the bridge will perform, and the prompt then settles', async () => {
    const outcome = requestPlayerAttackRoll(SPEC);
    render(<RollAutoCountdown rollId="attack-roll-1" />);

    expect(screen.getByTestId('roll-auto-countdown').textContent).toBe(
      `Rolls for you in ${PLAYER_ATTACK_ROLL_TIMEOUT_MS / 1000}s if you don't.`,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId('roll-auto-countdown').textContent).toBe(
      "Rolls for you in 35s if you don't.",
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYER_ATTACK_ROLL_TIMEOUT_MS - 10_000);
    });
    await expect(outcome).resolves.toEqual({ d20: null });
  });

  it('disappears when the player commits to the die, since nothing will auto-roll it now', async () => {
    void requestPlayerAttackRoll(SPEC);
    render(<RollAutoCountdown rollId="attack-roll-1" />);
    expect(screen.queryByTestId('roll-auto-countdown')).not.toBeNull();

    markPlayerRollCommitted('attack-roll-1');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(screen.queryByTestId('roll-auto-countdown')).toBeNull();
  });

  it('shows nothing for a prompt the bridge is not timing', () => {
    render(<RollAutoCountdown rollId="a-narrative-roll" />);

    expect(screen.queryByTestId('roll-auto-countdown')).toBeNull();
  });
});
