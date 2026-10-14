/**
 * #310: combat victory XP mechanics (pure — no database import, so unit tests can load it).
 *
 * When an encounter concludes with the last hostile defeated, each player character earns XP
 * per the 2014 DMG "XP Thresholds by Character Level" table (DMG p. 82) for the encounter's
 * difficulty. Participants carry no monster reference, so per-monster XP is not recoverable at
 * conclude time; the difficulty threshold is the per-character share of the XP budget an
 * encounter of that difficulty is built from, which is what 2014 divides among the party.
 */

import { encounterXpPerCharacter } from '../../../../shared/xp-tables';

export { ENCOUNTER_XP_BY_LEVEL as ENCOUNTER_XP_THRESHOLDS } from '../../../../shared/xp-tables';

/**
 * XP one character of `level` earns for a victory at `difficulty`. An unknown or missing
 * difficulty reads as medium — the encounter still happened, and medium is the middle band.
 */
export function combatVictoryXp(level: number, difficulty: string | null): number {
  return encounterXpPerCharacter(level, difficulty);
}
