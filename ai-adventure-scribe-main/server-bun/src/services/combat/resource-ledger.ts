import { remainingSpellSlots } from './data-access.js';
import { countedFamilyPool } from '../progression/limited-feature-uses.js';
import { SpellSlotMechanics } from '../spell-slots/spell-slot-mechanics.js';

/**
 * The spell slots a character can spend, keyed by slot level. Stored rows win. A level with no
 * row is granted from class progression, the way ensureSpellSlotRow seeds it when the attack
 * runs, so a premade with no seeded rows is still offered its slots. Reads only: no row is
 * written here.
 */
export async function spellSlotLedger(
  characterId: string,
  actor: {
    characterClass?: string | null;
    characterLevel?: number | null;
    characterClassLevels?: unknown;
  },
): Promise<Map<number, number>> {
  const stored = (await remainingSpellSlots(characterId)) ?? new Map<number, number>();
  const ledger = new Map<number, number>();
  for (const row of SpellSlotMechanics.seedRowsForCharacter(
    actor.characterClass,
    actor.characterLevel ?? 0,
    actor.characterClassLevels,
  )) {
    ledger.set(row.spellLevel, stored.get(row.spellLevel) ?? row.totalSlots);
  }
  for (const [level, count] of stored) {
    if (!ledger.has(level)) ledger.set(level, count);
  }
  return ledger;
}

/**
 * The Font of Magic sorcery-point pool, read without writing. Null when the character has no
 * sorcerer row of the family (not a Sorcerer, or no level in the class).
 */
export async function sorceryPointsLedger(input: {
  characterId: string;
  userId: string;
  className: string;
}): Promise<{ max: number; remaining: number } | null> {
  return countedFamilyPool({ ...input, family: 'sorcerer-sorcery-points' });
}
