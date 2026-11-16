import { describe, expect, it } from 'bun:test';

import { attackActionSwings, planAttackSwing } from '../extra-attack.js';

describe('2014 Attack action swings', () => {
  it.each([
    ['Fighter', 1, 1],
    ['Fighter', 5, 2],
    ['Fighter', 11, 3],
    ['Fighter', 20, 4],
    ['Barbarian', 4, 1],
    ['Barbarian', 5, 2],
    ['Monk', 5, 2],
    ['Paladin', 5, 2],
    ['Ranger', 5, 2],
    ['Wizard', 20, 1],
  ])('%s level %i has %i swings', (className, level, expected) => {
    expect(attackActionSwings({ class: className, level, classLevels: null })).toBe(expected);
  });
  it('uses class levels, not total level, and does not stack Extra Attack', () => {
    expect(
      attackActionSwings({
        class: 'Fighter',
        level: 10,
        classLevels: [
          { className: 'Fighter', level: 5 },
          { className: 'Paladin', level: 5 },
        ],
      }),
    ).toBe(2);
    expect(
      attackActionSwings({
        class: 'Fighter',
        level: 5,
        classLevels: [
          { className: 'Fighter', level: 2 },
          { className: 'Wizard', level: 3 },
        ],
      }),
    ).toBe(1);
  });
});

describe('Attack action budget', () => {
  const turn = { encounterId: 'fight', participantId: 'fighter', round: 2, capacity: 2 };
  it('spends the regular Action, its remaining swing, then a separate Surge action', () => {
    const first = planAttackSwing({ ...turn, actionUsed: false, surgeArmed: true, budget: null })!;
    expect(first.payment).toBe('action');
    expect(first.budget.remaining).toBe(1);
    const second = planAttackSwing({
      ...turn,
      actionUsed: true,
      surgeArmed: true,
      budget: first.budget,
    })!;
    expect(second.payment).toBe('remaining');
    expect(second.budget.remaining).toBe(0);
    const third = planAttackSwing({
      ...turn,
      actionUsed: true,
      surgeArmed: true,
      budget: second.budget,
    })!;
    expect(third.payment).toBe('surge');
    expect(third.budget.remaining).toBe(1);
    const fourth = planAttackSwing({
      ...turn,
      actionUsed: true,
      surgeArmed: false,
      budget: third.budget,
    })!;
    expect(fourth.budget.remaining).toBe(0);
    expect(
      planAttackSwing({ ...turn, actionUsed: true, surgeArmed: false, budget: fourth.budget }),
    ).toBeNull();
  });
  it('does not grant a swing after another Action or from a stale turn or actor', () => {
    const old = { ...turn, remaining: 1, round: 1 };
    expect(
      planAttackSwing({ ...turn, actionUsed: true, surgeArmed: false, budget: null }),
    ).toBeNull();
    expect(
      planAttackSwing({ ...turn, actionUsed: true, surgeArmed: false, budget: old }),
    ).toBeNull();
    expect(
      planAttackSwing({
        ...turn,
        actionUsed: true,
        surgeArmed: false,
        budget: { ...old, round: 2, participantId: 'other' },
      }),
    ).toBeNull();
  });
});
