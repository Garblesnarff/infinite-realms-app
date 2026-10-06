import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  hasPendingPlayerRoll,
  markPlayerRollCommitted,
  pendingPlayerRollDeadline,
  pendingPlayerRollLabel,
  requestPlayerAttackRoll,
  requestPlayerDeathSaveRoll,
  requestPlayerInitiativeRoll,
  PLAYER_ATTACK_ROLL_TIMEOUT_MS,
  PLAYER_DEATH_SAVE_ROLL_TIMEOUT_MS,
  PLAYER_INITIATIVE_ROLL_TIMEOUT_MS,
  setPlayerRollHost,
  settlePendingPlayerRoll,
  releasePlayerRollHost,
  trackPlayerRollDismissal,
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
  /**
   * #2190: the attack prompt used to have no timer. A prompt the player never answers — or one
   * whose queue slot was taken by another request, so it was never visible — left the resolution
   * awaiting forever, the turn unfinished and the composer disabled. That was the M3 dead-end.
   */
  it('auto-rolls an unanswered attack prompt after the bounded timeout', async () => {
    vi.useFakeTimers();
    const dismiss = vi.fn();
    const present = vi.fn((_spec, _settle) => hostHandle('attack-roll-1', dismiss));
    setPlayerRollHost({ present });

    const pending = requestPlayerAttackRoll(SPEC);

    expect(hasPendingPlayerRoll()).toBe(true);
    await vi.advanceTimersByTimeAsync(PLAYER_ATTACK_ROLL_TIMEOUT_MS);

    await expect(pending).resolves.toEqual({ d20: null });
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('clears the attack timeout when the player supplies a die', async () => {
    vi.useFakeTimers();
    let settleAttack: ((outcome: { d20: number | null }) => void) | undefined;
    setPlayerRollHost({
      present: (_spec, settle) => {
        settleAttack = settle;
        return hostHandle('attack-roll-1');
      },
    });

    const pending = requestPlayerAttackRoll(SPEC);
    settleAttack?.({ d20: 18 });

    await expect(pending).resolves.toEqual({ d20: 18 });
    await vi.advanceTimersByTimeAsync(PLAYER_ATTACK_ROLL_TIMEOUT_MS);
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('lets a committed attack roll settle after its prompt window', async () => {
    vi.useFakeTimers();
    let settleAttack: ((outcome: { d20: number | null }) => void) | undefined;
    setPlayerRollHost({
      present: (_spec, settle) => {
        settleAttack = settle;
        return hostHandle('attack-roll-1');
      },
    });

    const pending = requestPlayerAttackRoll(SPEC);

    await vi.advanceTimersByTimeAsync(8_000);
    expect(markPlayerRollCommitted('attack-roll-1')).toBe(true);
    await vi.advanceTimersByTimeAsync(PLAYER_ATTACK_ROLL_TIMEOUT_MS);
    settleAttack?.({ d20: 11 });

    await expect(pending).resolves.toEqual({ d20: 11 });
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('tells a dismissed prompt apart from a timed-out one (#2234)', async () => {
    vi.useFakeTimers();
    let answer: ((outcome: { d20: number | null; cancelled?: boolean }) => void) | undefined;
    setPlayerRollHost({
      present: (_spec, settle) => {
        answer = settle;
        return hostHandle();
      },
    });

    const dismissed = trackPlayerRollDismissal(() => requestPlayerAttackRoll(SPEC));
    answer?.({ d20: null, cancelled: true });
    await expect(dismissed).resolves.toEqual({
      value: { d20: null, cancelled: true },
      dismissed: true,
    });

    const timedOut = trackPlayerRollDismissal(() => requestPlayerAttackRoll(SPEC));
    await vi.advanceTimersByTimeAsync(PLAYER_ATTACK_ROLL_TIMEOUT_MS);
    await expect(timedOut).resolves.toEqual({ value: { d20: null }, dismissed: false });
  });

  it('lets the engine roll once a released host is not replaced', async () => {
    const dismiss = vi.fn();
    const onlyHost = { present: vi.fn(() => hostHandle('roll-1', dismiss)) };
    setPlayerRollHost(onlyHost);

    const pending = requestPlayerInitiativeRoll({
      actorLabel: 'The Seeker',
      initiativeModifier: 2,
    });
    releasePlayerRollHost(onlyHost);

    await expect(pending).resolves.toEqual({ d20: null });
    expect(dismiss).toHaveBeenCalled();
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('ignores the release of a host that was already replaced', async () => {
    const oldHost = { present: vi.fn(() => hostHandle('roll-1')) };
    let settleNew: ((outcome: { d20: number | null }) => void) | undefined;
    const newHost = {
      present: vi.fn((_spec, settle) => {
        settleNew = settle;
        return hostHandle('roll-2');
      }),
    };
    setPlayerRollHost(oldHost);
    setPlayerRollHost(newHost);

    const pending = requestPlayerAttackRoll(SPEC);
    releasePlayerRollHost(oldHost);
    await Promise.resolve();

    expect(hasPendingPlayerRoll()).toBe(true);
    settleNew?.({ d20: 9 });
    await expect(pending).resolves.toEqual({ d20: 9 });
  });
});

describe('what the prompt tells the player about its own timer (#2530)', () => {
  beforeEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T12:00:00.000Z'));
  });

  afterEach(() => {
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
    vi.useRealTimers();
  });

  it('exposes the moment the engine will roll the attack, and what it is asking for', () => {
    setPlayerRollHost({ present: () => hostHandle('attack-roll-1') });
    void requestPlayerAttackRoll(SPEC);

    expect(pendingPlayerRollDeadline('attack-roll-1')).toBe(
      Date.parse('2026-10-02T12:00:00.000Z') + PLAYER_ATTACK_ROLL_TIMEOUT_MS,
    );
    expect(pendingPlayerRollLabel()).toBe('attack claws');
    expect(pendingPlayerRollDeadline('some-other-roll')).toBeNull();
  });

  it('uses the shorter initiative window for an initiative prompt', () => {
    setPlayerRollHost({ present: () => hostHandle('initiative-roll-1') });
    void requestPlayerInitiativeRoll({ actorLabel: 'The Seeker', initiativeModifier: 2 });

    expect(pendingPlayerRollDeadline('initiative-roll-1')).toBe(
      Date.parse('2026-10-02T12:00:00.000Z') + PLAYER_INITIATIVE_ROLL_TIMEOUT_MS,
    );
    expect(pendingPlayerRollLabel()).toBe('initiative');
  });

  it('has no deadline once the player has committed to the die, and none once it settles', () => {
    setPlayerRollHost({ present: () => hostHandle('attack-roll-1') });
    void requestPlayerAttackRoll(SPEC);

    expect(markPlayerRollCommitted('attack-roll-1')).toBe(true);
    expect(pendingPlayerRollDeadline('attack-roll-1')).toBeNull();

    settlePendingPlayerRoll({ d20: 11 });
    expect(pendingPlayerRollLabel()).toBeNull();
  });
});

describe('the death saving throw prompt (#2518)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T12:00:00.000Z'));
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is told it is a death save, and returns the die the player kept', async () => {
    const present = vi.fn((_spec, settle) => {
      settle({ d20: 14 });
      return hostHandle('death-roll-1');
    });
    setPlayerRollHost({ present });

    await expect(requestPlayerDeathSaveRoll({ actorLabel: 'The Scholar' })).resolves.toEqual({
      d20: 14,
    });
    expect(present.mock.calls[0][0]).toEqual({ actorLabel: 'The Scholar', deathSave: true });
  });

  it('auto-rolls after 45 s with a visible deadline, so a hidden prompt cannot make death silent', async () => {
    setPlayerRollHost({ present: () => hostHandle('death-roll-1') });
    const pending = requestPlayerDeathSaveRoll({ actorLabel: 'The Scholar' });

    expect(pendingPlayerRollLabel()).toBe('death saving throw');
    expect(pendingPlayerRollDeadline('death-roll-1')).toBe(
      Date.parse('2026-10-05T12:00:00.000Z') + PLAYER_DEATH_SAVE_ROLL_TIMEOUT_MS,
    );
    expect(PLAYER_DEATH_SAVE_ROLL_TIMEOUT_MS).toBe(45_000);

    await vi.advanceTimersByTimeAsync(PLAYER_DEATH_SAVE_ROLL_TIMEOUT_MS);
    await expect(pending).resolves.toEqual({ d20: null });
    expect(hasPendingPlayerRoll()).toBe(false);
  });

  it('a dismissed prompt is not a way out: it reads as "the engine rolls it"', async () => {
    setPlayerRollHost({
      present: (_spec, settle) => {
        settle({ d20: null, cancelled: true });
        return hostHandle('death-roll-1');
      },
    });

    await expect(requestPlayerDeathSaveRoll({ actorLabel: 'The Scholar' })).resolves.toEqual({
      d20: null,
    });
  });

  it('with no dice host mounted the engine rolls it, so the turn can never wedge', async () => {
    await expect(requestPlayerDeathSaveRoll({ actorLabel: 'The Scholar' })).resolves.toEqual({
      d20: null,
    });
  });
});
