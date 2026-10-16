import { afterEach, describe, expect, it } from 'bun:test';

import { rollDamageDice } from '../../services/combat/damage-calculator.js';
import { RestMechanics } from '../../services/rest/rest-mechanics.js';
import { rollD20, rollD20Pair } from '../dice.js';
import { resetRngFromEnv, rollDie, setRngSeed } from '../rng.js';

afterEach(() => {
  delete process.env.DICE_SEED;
  setRngSeed(undefined);
});

const sequence = (count: number): number[] => Array.from({ length: count }, () => rollDie(20));

describe('rng', () => {
  it('produces an identical rollDie(20) sequence for the same seed', () => {
    setRngSeed(1234);
    const first = sequence(100);
    setRngSeed(1234);
    expect(sequence(100)).toEqual(first);
  });

  it('produces different sequences for different seeds', () => {
    setRngSeed(1234);
    const first = sequence(100);
    setRngSeed(4321);
    expect(sequence(100)).not.toEqual(first);
  });

  it('produces a different sequence from an unseeded source', () => {
    setRngSeed(1234);
    const seeded = sequence(100);
    setRngSeed(undefined);
    expect(sequence(100)).not.toEqual(seeded);
  });

  it('keeps every roll within [1, sides]', () => {
    setRngSeed(99);
    for (let i = 0; i < 1000; i += 1) {
      const roll = rollDie(20);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(20);
    }
  });

  it('makes rollD20 repeatable from DICE_SEED via resetRngFromEnv', () => {
    process.env.DICE_SEED = '20260726';
    resetRngFromEnv();
    const first = Array.from({ length: 100 }, () => rollD20());
    process.env.DICE_SEED = '20260726';
    resetRngFromEnv();
    expect(Array.from({ length: 100 }, () => rollD20())).toEqual(first);
  });

  it.each(['', '   ', 'abc', '12.5'])('stays unseeded when DICE_SEED is %p', (value) => {
    setRngSeed(1234);
    const seeded = sequence(100);
    process.env.DICE_SEED = value;
    resetRngFromEnv();
    expect(sequence(100)).not.toEqual(seeded);
  });

  it('makes rollD20Pair, rollDamageDice and hit dice repeatable under one seed', () => {
    const run = () => [
      rollD20Pair(true, false),
      rollD20Pair(false, true),
      rollDamageDice('2d6', true),
      RestMechanics.rollHitDie('d10'),
    ];
    setRngSeed(42);
    const first = Array.from({ length: 20 }, run);
    setRngSeed(42);
    expect(Array.from({ length: 20 }, run)).toEqual(first);
  });
});
