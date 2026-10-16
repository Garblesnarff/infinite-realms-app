/**
 * Seedable dice randomness (client twin of `server-bun/src/lib/rng.ts`).
 *
 * Every dice roll draws from one module-level source so a session can be replayed by
 * setting a seed. Default is unseeded `Math.random`, so production is unchanged.
 */

import { NumberGenerator } from '@dice-roller/rpg-dice-roller';

/** mulberry32 PRNG, the same algorithm as `scripts/combat-harness.ts`. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let currentRng: (() => number) | undefined;

/** Draw from the current source; unseeded reads `Math.random` at call time. */
export function random(): number {
  return currentRng ? currentRng() : Math.random();
}

/** Roll one die of `sides` faces, returning 1..sides. */
export function rollDie(sides: number): number {
  return Math.floor(random() * sides) + 1;
}

/**
 * Seed the current source; `undefined` restores `Math.random`. `DiceEngine` rolls through
 * `@dice-roller/rpg-dice-roller`, so its engine follows the same seed (int32, as random-js
 * engines return) and goes back to the library's `nativeMath` default when unseeded.
 */
export function setRngSeed(seed: number | undefined): void {
  currentRng = seed === undefined ? undefined : mulberry32(seed);
  NumberGenerator.generator.engine =
    seed === undefined
      ? NumberGenerator.engines.nativeMath
      : { next: () => (random() * 0x100000000) | 0 };
}
