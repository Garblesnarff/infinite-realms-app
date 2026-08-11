/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  hasPendingPlayerRoll,
  requestPlayerAttackRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '../player-roll-bridge';

/**
 * The seam between a combat resolution and the player's hand.
 *
 * Everything here is about one property: the promise always settles. A bridge that can hang is
 * a combat that can wedge behind a modal, and this is a stop-anytime product — players close
 * laptops mid-popup and must come back to a session that still works.
 */

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const SPEC = {
  actorLabel: 'The Seeker',
  targetLabel: 'Sentient Glaze',
  weaponName: 'claws',
  attackBonus: 7,
  targetAc: 15,
  advantage: false,
  disadvantage: false,
};

describe('the player roll bridge', () => {
  beforeEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
  });

  it('hands the popup the spec and returns the die the player kept', async () => {
    const present = vi.fn((_spec, settle) => {
      settle({ d20: 18 });
      return () => {};
    });
    setPlayerRollHost({ present });

    await expect(requestPlayerAttackRoll(SPEC)).resolves.toEqual({ d20: 18 });
    expect(present.mock.calls[0][0].attackBonus).toBe(7);
  });

  it('resolves to an engine roll when no popup is mounted', async () => {
    // Headless callers and tests must still be able to resolve combat.
    await expect(requestPlayerAttackRoll(SPEC)).resolves.toEqual({ d20: null });
  });

  it('resolves to an engine roll when the player cancels', async () => {
    setPlayerRollHost({
      present: (_spec, settle) => {
        setTimeout(() => settle({ d20: null }), 0);
        return () => {};
      },
    });

    await expect(requestPlayerAttackRoll(SPEC)).resolves.toEqual({ d20: null });
  });

  it('lets the turn pipeline settle a roll the player walked away from', async () => {
    setPlayerRollHost({ present: () => () => {} });
    const pending = requestPlayerAttackRoll(SPEC);

    expect(hasPendingPlayerRoll()).toBe(true);
    expect(settlePendingPlayerRoll({ d20: null })).toBe(true);

    await expect(pending).resolves.toEqual({ d20: null });
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('dismisses the abandoned popup rather than leaving it on screen', async () => {
    const dismiss = vi.fn();
    setPlayerRollHost({ present: () => dismiss });
    const pending = requestPlayerAttackRoll(SPEC);

    settlePendingPlayerRoll({ d20: null });

    await pending;
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('never stacks two popups: a superseding attack settles the first engine-rolled', async () => {
    // Two popups at once would ask the player which of two attacks they are rolling for.
    setPlayerRollHost({ present: () => () => {} });
    const first = requestPlayerAttackRoll(SPEC);
    const second = requestPlayerAttackRoll({ ...SPEC, weaponName: 'dagger' });

    await expect(first).resolves.toEqual({ d20: null });
    expect(hasPendingPlayerRoll()).toBe(true);
    settlePendingPlayerRoll({ d20: 4 });
    await expect(second).resolves.toEqual({ d20: 4 });
  });

  it('ignores a host that settles twice', async () => {
    let settleTwice: (outcome: { d20: number | null }) => void = () => {};
    setPlayerRollHost({
      present: (_spec, settle) => {
        settleTwice = settle;
        return () => {};
      },
    });
    const pending = requestPlayerAttackRoll(SPEC);

    settleTwice({ d20: 12 });
    settleTwice({ d20: 3 });

    await expect(pending).resolves.toEqual({ d20: 12 });
  });

  it('reports no pending roll when nothing is outstanding', () => {
    expect(hasPendingPlayerRoll()).toBe(false);
    expect(settlePendingPlayerRoll({ d20: null })).toBe(false);
  });
});
