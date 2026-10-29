/**
 * #1227: the one rule for which spell slot a player's cast spends. The ActionBar, the
 * character sheet's Cast tag, the combat-entry first action and the legal-action offer all
 * pick the slot here, so the slot a chip names is the slot the engine is asked to spend.
 *
 * - A cantrip (level 0) or an unknown level spends no slot: `null`.
 * - A slot the player already chose (a chip's `slotLevel`) wins when it is at or above the
 *   spell's level (2014 PHB: a spell can be cast with a slot of its level or higher).
 * - With the remaining slots known, the lowest remaining slot at or above the spell's level;
 *   none remaining is `null` (the spell cannot be cast).
 * - With nothing known, the spell's own level: the engine's commit enforces the slot.
 */
export function chooseSpellSlotLevel(
  spellLevel: number | null | undefined,
  options: {
    chosen?: number | null;
    remaining?: ReadonlyMap<number, number> | null;
  } = {},
): number | null {
  if (typeof spellLevel !== 'number' || !Number.isInteger(spellLevel) || spellLevel < 1) {
    return null;
  }
  const { chosen, remaining } = options;
  if (
    typeof chosen === 'number' &&
    Number.isInteger(chosen) &&
    chosen >= spellLevel &&
    chosen <= 9
  ) {
    return chosen;
  }
  if (!remaining) return spellLevel;
  for (let level = spellLevel; level <= 9; level += 1) {
    if ((remaining.get(level) ?? 0) > 0) return level;
  }
  return null;
}
