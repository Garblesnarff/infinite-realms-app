export const MIN_CHARACTER_AGE = 0;
export const MAX_CHARACTER_AGE = 10_000;

const MAX_STARTING_GOLD_DICE = 100;
const MAX_STARTING_GOLD_DIE_SIZE = 100;

export function parseCharacterAge(value: string): number {
  const age = Number(value);
  if (!Number.isSafeInteger(age)) return MIN_CHARACTER_AGE;

  return Math.min(MAX_CHARACTER_AGE, Math.max(MIN_CHARACTER_AGE, age));
}

export function parseStartingGoldDice(notation: string): { count: number; sides: number } | null {
  const match = /^(\d+)d(\d+)$/.exec(notation);
  if (!match) return null;

  const count = Number(match[1]);
  const sides = Number(match[2]);
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_STARTING_GOLD_DICE ||
    !Number.isSafeInteger(sides) ||
    sides < 2 ||
    sides > MAX_STARTING_GOLD_DIE_SIZE
  ) {
    return null;
  }

  return { count, sides };
}
