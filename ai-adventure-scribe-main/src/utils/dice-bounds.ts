/**
 * Parse user- or model-provided dice components without allowing unbounded
 * numbers to reach the dice roller.
 */
export const MAX_DICE_COUNT = 100;
export const MAX_DIE_TYPE = 1_000;
export const MAX_DICE_MODIFIER = 1_000;

export function parseBoundedDiceInteger(value: string, min: number, max: number): number | null {
  const parsed = Number.parseInt(value, 10);
  const bounded = Math.min(max, Math.max(min, parsed));

  return Number.isFinite(parsed) && parsed === bounded ? parsed : null;
}

export function clampDiceInteger(value: string, min: number, max: number, fallback = 0): number {
  const parsed = Number.parseInt(value, 10);
  return Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : fallback));
}
