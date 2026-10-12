/**
 * #310: combat victory XP mechanics (pure — no database import, so unit tests can load it).
 *
 * When an encounter concludes with the last hostile defeated, each player character earns XP
 * per the 2014 DMG "XP Thresholds by Character Level" table (DMG p. 82) for the encounter's
 * difficulty. Participants carry no monster reference, so per-monster XP is not recoverable at
 * conclude time; the difficulty threshold is the per-character share of the XP budget an
 * encounter of that difficulty is built from, which is what 2014 divides among the party.
 */

/** 2014 DMG p. 82, XP Thresholds by Character Level: [easy, medium, hard, deadly] per character. */
export const ENCOUNTER_XP_THRESHOLDS: Record<number, [number, number, number, number]> = {
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
 * XP one character of `level` earns for a victory at `difficulty`. An unknown or missing
 * difficulty reads as medium — the encounter still happened, and medium is the middle band.
 */
export function combatVictoryXp(level: number, difficulty: string | null): number {
  const band = ENCOUNTER_XP_THRESHOLDS[Math.min(Math.max(Math.trunc(level) || 1, 1), 20)] ?? [
    0, 0, 0, 0,
  ];
  return band[DIFFICULTY_INDEX[(difficulty ?? '').toLowerCase()] ?? 1] ?? 0;
}
