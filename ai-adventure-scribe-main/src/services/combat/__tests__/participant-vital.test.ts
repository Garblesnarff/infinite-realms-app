import { describe, expect, it } from 'vitest';

import { participantVital } from '../participant-vital';

const player = {
  participantType: 'player' as const,
  currentHitPoints: 7,
  isDead: undefined,
  isStable: undefined,
  isUnconscious: false,
  deathSaves: { successes: 0, failures: 0 },
};

describe('participantVital (#2518)', () => {
  it('is standing for a player on their feet', () => {
    expect(participantVital(player)).toBe('standing');
  });

  it('is dying for an unconscious player at 0 HP', () => {
    expect(participantVital({ ...player, currentHitPoints: 0, isUnconscious: true })).toBe('dying');
  });

  it('is stable when the server says so, even though the player is unconscious at 0 HP', () => {
    expect(
      participantVital({ ...player, currentHitPoints: 0, isUnconscious: true, isStable: true }),
    ).toBe('stable');
  });

  it('is dead on the server flag, or on three failures at 0 HP', () => {
    expect(participantVital({ ...player, currentHitPoints: 0, isDead: true })).toBe('dead');
    expect(
      participantVital({
        ...player,
        currentHitPoints: 0,
        isUnconscious: true,
        deathSaves: { successes: 0, failures: 3 },
      }),
    ).toBe('dead');
  });

  it('is standing for any monster: they die at 0 HP, they do not roll saves', () => {
    expect(
      participantVital({
        ...player,
        participantType: 'monster' as never,
        currentHitPoints: 0,
        isUnconscious: true,
      }),
    ).toBe('standing');
  });
});
