export const MIN_CHARACTER_AGE = 0;
export const MAX_CHARACTER_AGE = 10_000;

export function parseCharacterAge(value: string): number {
  const age = Number(value);
  if (!Number.isSafeInteger(age)) return MIN_CHARACTER_AGE;

  return Math.min(MAX_CHARACTER_AGE, Math.max(MIN_CHARACTER_AGE, age));
}
