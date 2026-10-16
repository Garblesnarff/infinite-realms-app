/**
 * Seedable dice randomness.
 *
 * Every dice roll draws from one module-level source so a whole session can be replayed
 * by setting `DICE_SEED`. Default is unseeded `Math.random`, so production is unchanged
 * unless the env var is set.
 */

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

/** Seed the current source; `undefined` restores `Math.random`. */
export function setRngSeed(seed: number | undefined): void {
  currentRng = seed === undefined ? undefined : mulberry32(seed);
}

/**
 * Point the current source at `DICE_SEED` when it is a finite integer, otherwise
 * `Math.random`. An unset or empty value means unseeded.
 */
export function resetRngFromEnv(): void {
  const raw = process.env.DICE_SEED;
  const seed = raw === undefined || raw.trim() === '' ? Number.NaN : Number(raw);
  setRngSeed(Number.isInteger(seed) ? seed : undefined);
}

resetRngFromEnv();
