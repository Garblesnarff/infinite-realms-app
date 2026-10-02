import { describe, expect, it } from 'vitest';

import {
  describeDamageAtZeroHp,
  describeDeathSave,
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
