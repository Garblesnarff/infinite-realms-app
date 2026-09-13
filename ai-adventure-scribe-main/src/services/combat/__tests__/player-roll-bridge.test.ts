import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  hasPendingPlayerRoll,
  markPlayerRollCommitted,
  requestPlayerAttackRoll,
  requestPlayerInitiativeRoll,
  PLAYER_INITIATIVE_ROLL_TIMEOUT_MS,
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

const hostHandle = (
  rollId = 'roll-1',
  dismiss = vi.fn(),
): { rollId: string; dismiss: () => void } => ({
  rollId,
  dismiss,
});

describe('the player roll bridge', () => {
  beforeEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands the popup the spec and returns the die the player kept', async () => {
    const present = vi.fn((_spec, settle) => {
      settle({ d20: 18 });
      return hostHandle();
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
        return hostHandle();
      },
    });

    await expect(requestPlayerAttackRoll(SPEC)).resolves.toEqual({ d20: null });
  });

  it('lets the turn pipeline settle a roll the player walked away from', async () => {
    setPlayerRollHost({ present: () => hostHandle() });
    const pending = requestPlayerAttackRoll(SPEC);

    expect(hasPendingPlayerRoll()).toBe(true);
    expect(settlePendingPlayerRoll({ d20: null })).toBe(true);

    await expect(pending).resolves.toEqual({ d20: null });
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('dismisses the abandoned popup rather than leaving it on screen', async () => {
    const dismiss = vi.fn();
    setPlayerRollHost({ present: () => hostHandle('roll-1', dismiss) });
    const pending = requestPlayerAttackRoll(SPEC);

    settlePendingPlayerRoll({ d20: null });

    await pending;
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('never stacks two popups: a superseding attack settles the first engine-rolled', async () => {
    // Two popups at once would ask the player which of two attacks they are rolling for.
    setPlayerRollHost({ present: () => hostHandle() });
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
        return hostHandle();
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

  it('asks for initiative and auto-rolls after the bounded prompt timeout', async () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const present = vi.fn((_spec, _settle) => hostHandle('initiative-roll-1', dismiss));
    setPlayerRollHost({ present });

    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });

    expect(present.mock.calls[0][0]).toEqual({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });
    await vi.advanceTimersByTimeAsync(PLAYER_INITIATIVE_ROLL_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ d20: null });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('clears the initiative timeout when the player supplies a die', async () => {
    vi.useFakeTimers();
    let settleInitiative: ((outcome: { d20: number | null }) => void) | undefined;
    const present = vi.fn((_spec, settle) => {
      settleInitiative = settle;
      return hostHandle('initiative-roll-1');
    });
    setPlayerRollHost({ present });

    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: -1,
    });
    settleInitiative?.({ d20: 17 });

    await expect(pending).resolves.toEqual({ d20: 17 });
    await vi.advanceTimersByTimeAsync(PLAYER_INITIATIVE_ROLL_TIMEOUT_MS);
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('lets a committed initiative roll settle after the 30s prompt window', async () => {
    vi.useFakeTimers();
    let settleInitiative: ((outcome: { d20: number | null }) => void) | undefined;
    setPlayerRollHost({
      present: (_spec, settle) => {
        settleInitiative = settle;
        return hostHandle('initiative-roll-1');
      },
    });

    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });

    await vi.advanceTimersByTimeAsync(8_000);
    expect(markPlayerRollCommitted('initiative-roll-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(3_500);
    settleInitiative?.({ d20: 14 });

    await expect(pending).resolves.toEqual({ d20: 14 });
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('treats a commit after the untouched popup timed out as a no-op', async () => {
    vi.useFakeTimers();
    let settleInitiative: ((outcome: { d20: number | null }) => void) | undefined;
    setPlayerRollHost({
      present: (_spec, settle) => {
        settleInitiative = settle;
        return hostHandle('initiative-roll-1');
      },
    });

    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });
    await vi.advanceTimersByTimeAsync(PLAYER_INITIATIVE_ROLL_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ d20: null });
    expect(markPlayerRollCommitted('initiative-roll-1')).toBe(false);
    settleInitiative?.({ d20: 14 });
    expect(hasPendingPlayerRoll()).toBe(false);
  });
});
