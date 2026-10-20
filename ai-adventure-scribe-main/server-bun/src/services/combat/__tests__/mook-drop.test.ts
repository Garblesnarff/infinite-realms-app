import { describe, expect, it } from 'bun:test';

import { HPMechanics } from '../hp-mechanics.js';

const status = (currentHp: number, maxHp = 10) =>
  ({
    currentHp,
    maxHp,
    tempHp: 0,
    isConscious: currentHp > 0,
    deathSavesSuccesses: 0,
    deathSavesFailures: 0,
  }) as any;

const resistances = { damageImmunities: [], damageResistances: [], damageVulnerabilities: [] };

describe('mook drop (house rule)', () => {
  it('drops a mook to 0 on any damage that lands', () => {
    const result = HPMechanics.calculateDamageResult('mook-1', status(10), resistances, {
      damageAmount: 1,
      damageType: 'slashing',
      targetIsPlayer: false,
      targetIsMook: true,
    });
    expect(result.newCurrentHp).toBe(0);
    expect(result.isConscious).toBe(false);
  });

  it('keeps the same damage math for a creature that is not a mook', () => {
    const result = HPMechanics.calculateDamageResult('monster-1', status(10), resistances, {
      damageAmount: 3,
      damageType: 'slashing',
      targetIsPlayer: false,
    });
    expect(result.newCurrentHp).toBe(7);
  });

  it('does not drop a mook that took no damage', () => {
    const result = HPMechanics.calculateDamageResult('mook-1', status(10), resistances, {
      damageAmount: 0,
      damageType: 'slashing',
      targetIsPlayer: false,
      targetIsMook: true,
    });
    expect(result.newCurrentHp).toBe(10);
  });

  it('does not drop a mook that succeeded on its save (#728 item 4)', () => {
    const result = HPMechanics.calculateDamageResult('mook-1', status(10), resistances, {
      damageAmount: 3,
      damageType: 'fire',
      targetIsPlayer: false,
      targetIsMook: true,
      saveSucceeded: true,
    });
    expect(result.newCurrentHp).toBe(7);
    expect(result.isConscious).toBe(true);
  });

  it('drops a mook that failed its save', () => {
    const result = HPMechanics.calculateDamageResult('mook-1', status(10), resistances, {
      damageAmount: 3,
      damageType: 'fire',
      targetIsPlayer: false,
      targetIsMook: true,
      saveSucceeded: false,
    });
    expect(result.newCurrentHp).toBe(0);
    expect(result.isConscious).toBe(false);
  });
});
