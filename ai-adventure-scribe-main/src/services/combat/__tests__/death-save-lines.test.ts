import { describe, expect, it } from 'vitest';

import {
  describeDamageAtZeroHp,
  describeDeathSave,
  describeDeathSaveRollLine,
  type DeathSaveFacts,
} from '../../../../shared/death-save-lines';
import {
  DEATH_SAVE_FAILED,
  DEATH_SAVE_PASSED,
} from '../../../../shared/test-fixtures/engine-results';

/** No DM-facing instruction text anywhere the player can read (#2457). */
const assertNoDmInstructions = (strings: readonly string[]): void => {
  for (const text of strings) {
    expect(text).not.toContain('Narrate');
    expect(text).not.toContain('already happened');
  }
};

describe('describeDeathSave (#2457)', () => {
  it('describes a plain pass and failure with the running tally', () => {
    expect(describeDeathSave('The Scholar', DEATH_SAVE_FAILED)).toBe(
      'The Scholar rolled 6 on their death saving throw — FAILURE (0 successes, 2 failures).',
    );
    expect(describeDeathSave('The Scholar', DEATH_SAVE_PASSED)).toBe(
      'The Scholar rolled 14 on their death saving throw — SUCCESS (1 success, 1 failure).',
    );
  });

  it('makes the natural 20 revival explicit', () => {
    const line = describeDeathSave('The Scholar', {
      ...DEATH_SAVE_FAILED,
      roll: 20,
      isSuccess: true,
      isCritical: true,
      wasRevived: true,
    });
    expect(line).toContain('natural 20');
    expect(line).toContain('1 HP');
  });

  it("makes the natural 1's two failures explicit", () => {
    const line = describeDeathSave('The Scholar', {
      ...DEATH_SAVE_FAILED,
      roll: 1,
      isCritical: true,
      failures: 2,
    });
    expect(line).toContain('natural 1');
    expect(line).toContain('two failures');
    expect(line).toContain('2 failures');
  });

  it('names the third failure as death and the third success as stable', () => {
    expect(
      describeDeathSave('The Scholar', { ...DEATH_SAVE_FAILED, isDead: true, failures: 3 }),
    ).toContain('DEAD');
    expect(
      describeDeathSave('The Scholar', {
        ...DEATH_SAVE_PASSED,
        isStabilized: true,
        successes: 3,
      }),
    ).toContain('stable');
  });

  it('carries no DM-facing instruction text in any branch', () => {
    assertNoDmInstructions([
      describeDeathSave('The Scholar', DEATH_SAVE_FAILED),
      describeDeathSave('The Scholar', DEATH_SAVE_PASSED),
      describeDeathSave('The Scholar', {
        ...DEATH_SAVE_FAILED,
        roll: 20,
        isSuccess: true,
        isCritical: true,
        wasRevived: true,
      }),
      describeDeathSave('The Scholar', {
        ...DEATH_SAVE_FAILED,
        roll: 1,
        isCritical: true,
        failures: 2,
      }),
      describeDeathSave('The Scholar', { ...DEATH_SAVE_FAILED, isDead: true, failures: 3 }),
      describeDeathSave('The Scholar', {
        ...DEATH_SAVE_PASSED,
        isStabilized: true,
        successes: 3,
      }),
    ]);
  });
});

describe('describeDeathSaveRollLine (#874)', () => {
  // Fixtures follow the real producer: HPMechanics.resolveDeathSave's return
  // (participantId, roll, isSuccess, isCritical, successes, failures,
  // isStabilized, isDead, wasRevived, newCurrentHp), tallies already updated.
  const save = (overrides: Record<string, unknown>): DeathSaveFacts & Record<string, unknown> => ({
    participantId: 'hero-1',
    roll: 14,
    isSuccess: true,
    isCritical: false,
    successes: 1,
    failures: 0,
    isStabilized: false,
    isDead: false,
    wasRevived: false,
    newCurrentHp: 0,
    ...overrides,
  });

  it('prints the roll, the outcome word and the success count for a success', () => {
    expect(describeDeathSaveRollLine(save({}))).toBe('Death saving throw: 14 — success (1/3)');
    expect(describeDeathSaveRollLine(save({ roll: 18, successes: 2, failures: 1 }))).toBe(
      'Death saving throw: 18 — success (2/3)',
    );
  });

  it('prints the failure count (not the success count) for a failure', () => {
    expect(
      describeDeathSaveRollLine(
        save({ roll: 3, isSuccess: false, successes: 0, failures: 1 }),
      ),
    ).toBe('Death saving throw: 3 — failure (1/3)');
    expect(
      describeDeathSaveRollLine(
        save({ roll: 6, isSuccess: false, successes: 1, failures: 2 }),
      ),
    ).toBe('Death saving throw: 6 — failure (2/3)');
  });

  it("counts a natural 1's two failures", () => {
    expect(
      describeDeathSaveRollLine(
        save({ roll: 1, isSuccess: false, isCritical: true, successes: 0, failures: 2 }),
      ),
    ).toBe('Death saving throw: 1 — failure (2/3)');
  });

  it('returns null for a save with no rolled die rather than fabricating a roll', () => {
    expect(describeDeathSaveRollLine(save({ roll: undefined }))).toBeNull();
  });

  it('returns null for the terminal states, which keep the full sentence', () => {
    // Stabilized, dead and revived saves print describeDeathSave's sentence
    // ("…rolled 13 on their death saving throw — the third success. … is
    // stable."); the compact line covers the ordinary saves only.
    expect(
      describeDeathSaveRollLine(save({ roll: 12, successes: 3, isStabilized: true })),
    ).toBeNull();
    expect(
      describeDeathSaveRollLine(
        save({ roll: 4, isSuccess: false, successes: 0, failures: 3, isDead: true }),
      ),
    ).toBeNull();
    expect(
      describeDeathSaveRollLine(
        save({ roll: 20, isCritical: true, successes: 0, failures: 0, wasRevived: true }),
      ),
    ).toBeNull();
  });

  it('carries no DM-facing instruction text', () => {
    assertNoDmInstructions([
      describeDeathSaveRollLine(save({})) ?? '',
      describeDeathSaveRollLine(save({ roll: 3, isSuccess: false, successes: 0, failures: 1 })) ??
        '',
    ]);
  });
});

describe('describeDamageAtZeroHp (#2457)', () => {
  it('describes one automatic failure from a hit at 0 HP', () => {
    expect(describeDamageAtZeroHp('The Scholar', 1, 1)).toBe(
      'The Scholar takes damage at 0 HP — one automatic death-save failure (1 of 3 failures).',
    );
  });

  it('describes two automatic failures from a crit and names death at the third', () => {
    const line = describeDamageAtZeroHp('The Scholar', 2, 3);
    expect(line).toContain('2 automatic death-save failures');
    expect(line).toContain('3 of 3 failures');
    expect(line).toContain('DEAD');
  });

  it('carries no DM-facing instruction text', () => {
    assertNoDmInstructions([
      describeDamageAtZeroHp('The Scholar', 1, 1),
      describeDamageAtZeroHp('The Scholar', 2, 3),
    ]);
  });
});
