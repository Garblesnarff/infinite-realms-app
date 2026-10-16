import { afterEach, describe, expect, it } from 'vitest';

import { rollDie, setRngSeed } from '../rng';

import { DiceEngine } from '@/services/dice/DiceEngine';

afterEach(() => {
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

  it('makes DiceEngine rolls repeatable under the same seed', () => {
    const totals = () => Array.from({ length: 50 }, () => DiceEngine.roll('1d20+3').total);
    setRngSeed(77);
    const first = totals();
    setRngSeed(77);
    expect(totals()).toEqual(first);
  });
});
