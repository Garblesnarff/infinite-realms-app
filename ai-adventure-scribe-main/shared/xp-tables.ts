/**
 * The 2014 experience tables, shared by the browser and the Bun server. Every reader of an XP
 * threshold or an encounter budget imports it from here.
 */

/** Total XP a character needs to reach each level (2014 PHB p. 15). */
export const XP_TO_REACH_LEVEL: Readonly<Record<number, number>> = {
  1: 0,
  2: 300,
  3: 900,
  4: 2700,
  5: 6500,
  6: 14000,
  7: 23000,
  8: 34000,
  9: 48000,
  10: 64000,
  11: 85000,
  12: 100000,
  13: 120000,
  14: 140000,
  15: 165000,
  16: 195000,
  17: 225000,
  18: 265000,
  19: 305000,
  20: 355000,
};

/** XP per character for an encounter at each difficulty, by character level: [easy, medium, hard, deadly] (2014 DMG p. 82). */
export const ENCOUNTER_XP_BY_LEVEL: Record<number, [number, number, number, number]> = {
  1: [25, 50, 75, 100],
  2: [50, 100, 150, 200],
  3: [75, 150, 225, 400],
  4: [125, 250, 375, 500],
  5: [250, 500, 750, 1100],
  6: [300, 600, 900, 1400],
  7: [350, 750, 1100, 1700],
  8: [450, 900, 1400, 2100],
  9: [550, 1100, 1600, 2400],
  10: [600, 1200, 1900, 2800],
  11: [800, 1600, 2400, 3600],
  12: [1000, 2000, 3000, 4500],
  13: [1100, 2200, 3400, 5100],
  14: [1250, 2500, 3800, 5700],
  15: [1400, 2800, 4300, 6400],
  16: [1600, 3200, 4800, 7200],
  17: [2000, 3900, 5900, 8800],
  18: [2100, 4200, 6300, 9500],
  19: [2400, 4900, 7300, 10900],
  20: [2800, 5700, 8500, 12700],
};

const DIFFICULTY_INDEX: Record<string, number> = { easy: 0, medium: 1, hard: 2, deadly: 3 };

/**
 * XP per character for an encounter of `difficulty` at `level`. The level is clamped to the table,
 * and an unknown or missing difficulty reads as medium.
 */
export function encounterXpPerCharacter(
  level: number,
  difficulty: string | null | undefined,
): number {
  const clampedLevel = Math.min(Math.max(Math.trunc(level) || 1, 1), 20);
  const band = ENCOUNTER_XP_BY_LEVEL[clampedLevel] ?? ENCOUNTER_XP_BY_LEVEL[1];
  return band[DIFFICULTY_INDEX[(difficulty ?? '').toLowerCase()] ?? 1] ?? 0;
}
