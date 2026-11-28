import { describe, expect, it } from 'bun:test';

import { describeOutOfCombatWake, resolveDeathSave } from '../death-save-resolution.js';

import type { CharacterVitals } from '../../character-vitals-math.js';

const dying = (successes = 0, failures = 0): CharacterVitals => ({
  characterId: 'char-1',
  currentHitPoints: 0,
  maxHitPoints: 12,
  temporaryHitPoints: 0,
  isConscious: false,
  deathSavesSuccesses: successes,
  deathSavesFailures: failures,
  vitalState: 'dying',
  diedAt: null,
});

describe('resolveDeathSave outside a fight (#1811)', () => {
  it('tallies a success and a failure across successive saves', () => {
    const first = resolveDeathSave({ vitals: dying(0, 0), name: 'Mira', natural: 14 });
    expect(first.isSuccess).toBe(true);
    expect(first.successes).toBe(1);
    expect(first.failures).toBe(0);
    expect(first.vitalState).toBe('dying');
    expect(first.lines[0]).toBe('Death saving throw: 14 — success (1/3)');

    const second = resolveDeathSave({
      vitals: { ...dying(1, 0), ...first.vitals, diedAt: null },
      name: 'Mira',
      natural: 7,
    });
    expect(second.isSuccess).toBe(false);
    expect(second.successes).toBe(1);
    expect(second.failures).toBe(1);
    expect(second.lines[0]).toBe('Death saving throw: 7 — failure (1/3)');
  });

  it('a natural 1 from 2 failures is two failures and kills', () => {
    const result = resolveDeathSave({ vitals: dying(0, 2), name: 'Mira', natural: 1 });
    expect(result.failures).toBe(3);
    expect(result.isDead).toBe(true);
    expect(result.vitalState).toBe('dead');
    expect(result.vitals.currentHitPoints).toBe(0);
    expect(result.diedAt).toBeInstanceOf(Date);
    expect(result.lines[0]).toContain('the third failure');
    expect(result.lines[0]).toContain('DEAD');
  });

  it('a natural 20 sets 1 HP standing and clears the tallies', () => {
    const result = resolveDeathSave({ vitals: dying(2, 2), name: 'Mira', natural: 20 });
    expect(result.wasRevived).toBe(true);
    expect(result.newCurrentHp).toBe(1);
    expect(result.vitalState).toBe('standing');
    expect(result.successes).toBe(0);
    expect(result.failures).toBe(0);
    expect(result.vitals.isConscious).toBe(true);
    expect(result.lines[0]).toContain('natural 20');
    expect(result.lines[0]).toContain('1 HP');
  });

  it('three successes write the stable line, then the 1d4 wake line, and set 1 HP standing', () => {
    const result = resolveDeathSave({
      vitals: dying(2, 1),
      name: 'Mira',
      natural: 11,
      d4: 3,
    });
    expect(result.isStabilized).toBe(true);
    expect(result.vitalState).toBe('standing');
    expect(result.newCurrentHp).toBe(1);
    expect(result.hours).toBe(3);
    expect(result.vitals.isConscious).toBe(true);
    expect(result.lines[0]).toContain('the third success');
    expect(result.lines[1]).toBe(describeOutOfCombatWake('Mira', 3));
    expect(result.lines[1]).toBe('Mira is stable. After 3 hours Mira wakes with 1 HP.');
  });

  it('the wake line uses hour when the 1d4 is 1', () => {
    expect(describeOutOfCombatWake('Mira', 1)).toBe(
      'Mira is stable. After 1 hour Mira wakes with 1 HP.',
    );
  });
});
