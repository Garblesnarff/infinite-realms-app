import { eq } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { characters } from '../../../../db/schema/index';
import { metamagicOptionsFromEnvelope } from '../character-metamagic.js';
import { remainingSpellSlots } from './data-access.js';
import { classLevelOf, countedFamilyPool } from '../progression/limited-feature-uses.js';
import { SpellSlotMechanics } from '../spell-slots/spell-slot-mechanics.js';

import type { MetamagicOptionId } from '../../../../shared/metamagic-options';

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

/**
 * The Metamagic options a Sorcerer knows, read from the stored personality envelope and checked
 * against the 2014 cap for the level in the row (#1233). Fail closed: no list, an invalid list, or
 * a non-Sorcerer reads as no options. Reads only.
 */
export async function metamagicOptionsLedger(characterId: string): Promise<MetamagicOptionId[]> {
  const [row] = await db
    .select({
      personalityNotes: characters.personalityNotes,
      class: characters.class,
      level: characters.level,
      classLevels: characters.classLevels,
    })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!row) return [];
  const sorcererLevel = classLevelOf(row, 'Sorcerer');
  return metamagicOptionsFromEnvelope(row.personalityNotes, sorcererLevel);
}
