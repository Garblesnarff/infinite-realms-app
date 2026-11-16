/**
 * Write always-prepared subclass spells (Life Domain, Oath of Devotion)
 * onto character_spells. The names come from the shared table the client
 * reads. Rows are is_always_prepared, so they do not count against the
 * prepared limit. Missing catalog spells are skipped; a second call adds
 * only spells the new level grants.
 */

import { and, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  characters,
  characterSpells,
  characterSubclasses,
  classes,
  spells,
} from '../../../../db/schema/index';
import {
  ALWAYS_PREPARED_SUBCLASS_SPELLS,
  alwaysPreparedSpellNames,
} from '../../../../shared/always-prepared-subclass-spells';
import { subclassFromClassFeatureChoices } from '../../../../shared/class-feature-choices';
import { logger } from '../../lib/logger.js';
import { AVAILABLE_SUBCLASSES } from '../../types/class-features.js';
import { parseClassLevels } from '../spell-slots/spell-slot-mechanics.js';

function classLevelFor(
  character: { class: string | null; level: number | null; classLevels: unknown },
  className: string,
): number {
  // Spell slots use character.level for one class and the classLevels
  // entries only when there is more than one. Level-up writes
  // characters.level and leaves classLevels as stored at creation, so a
  // single-class paladin must be read the same way or later oath spells
  // never arrive.
  const parsed = parseClassLevels(character.classLevels);
  if (parsed.length > 1) {
    const match = parsed.find((entry) => entry.className.toLowerCase() === className.toLowerCase());
    if (match) return match.level;
  }
  return character.level ?? 1;
}

interface PreparedTarget {
  classId: string;
  catalog: { id: string; name: string; level: number }[];
}

export async function grantAlwaysPreparedSubclassSpells(
  characterId: string,
  userId: string,
): Promise<void> {
  const [character] = await db
    .select({
      id: characters.id,
      class: characters.class,
      level: characters.level,
      classLevels: characters.classLevels,
      classFeatures: characters.classFeatures,
      knownSpells: characters.knownSpells,
    })
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);
  if (!character) return;

  const recorded = await db
    .select({
      className: characterSubclasses.className,
      subclassName: characterSubclasses.subclassName,
    })
    .from(characterSubclasses)
    .where(eq(characterSubclasses.characterId, characterId));

  const targets = recorded.filter((row) => ALWAYS_PREPARED_SUBCLASS_SPELLS[row.subclassName]);
  if (targets.length === 0 && character.class) {
    const fromChoices = subclassFromClassFeatureChoices(
      character.classFeatures,
      AVAILABLE_SUBCLASSES[character.class] ?? [],
    );
    if (fromChoices && ALWAYS_PREPARED_SUBCLASS_SPELLS[fromChoices]) {
      targets.push({ className: character.class, subclassName: fromChoices });
    }
  }
  if (targets.length === 0) return;

  const prepared: PreparedTarget[] = [];
  const namesToAdd: string[] = [];
  for (const target of targets) {
    const names = alwaysPreparedSpellNames(
      target.subclassName,
      classLevelFor(character, target.className),
    );
    if (names.length === 0) continue;

    const [classRow] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(sql`lower(${classes.name})`, target.className.toLowerCase()))
      .limit(1);
    if (!classRow) continue;

    const catalog = await db
      .select({ id: spells.id, name: spells.name, level: spells.level })
      .from(spells)
      .where(inArray(spells.name, names));

    const foundNames = new Set(catalog.map((spell) => spell.name));
    const missingNames = names.filter((name) => !foundNames.has(name));
    if (missingNames.length > 0) {
      logger.warn({
        event: 'ALWAYS_PREPARED_SPELL_MISSING',
        missing: missingNames,
        count: missingNames.length,
      });
    }

    if (catalog.length === 0) continue;

    prepared.push({ classId: classRow.id, catalog });
    for (const spell of catalog) namesToAdd.push(spell.name);
  }

  if (prepared.length > 0) {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${characterId}::text, 0))`,
      );
      for (const entry of prepared) {
        const held = await tx
          .select({ id: characterSpells.id, spellId: characterSpells.spellId })
          .from(characterSpells)
          .where(
            and(
              eq(characterSpells.characterId, characterId),
              inArray(
                characterSpells.spellId,
                entry.catalog.map((spell) => spell.id),
              ),
            ),
          );
        const heldIds = new Set(held.map((row) => row.spellId));
        if (held.length > 0) {
          await tx
            .update(characterSpells)
            .set({ isAlwaysPrepared: true, isPrepared: true, updatedAt: new Date() })
            .where(
              inArray(
                characterSpells.id,
                held.map((row) => row.id),
              ),
            );
        }

        const missing = entry.catalog.filter((spell) => !heldIds.has(spell.id));
        if (missing.length > 0) {
          await tx.insert(characterSpells).values(
            missing.map((spell) => ({
              characterId,
              spellId: spell.id,
              sourceClassId: entry.classId,
              isPrepared: true,
              isAlwaysPrepared: true,
              sourceFeature: 'always-prepared',
              spellLevelLearned: spell.level,
            })),
          );
        }
      }
    });
  }

  if (namesToAdd.length === 0) return;
  const known = (character.knownSpells ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
  const knownKeys = new Set(known.map((name) => name.toLowerCase()));
  const appended = namesToAdd.filter((name) => !knownKeys.has(name.toLowerCase()));
  if (appended.length === 0) return;

  await db
    .update(characters)
    .set({
      knownSpells: [...known, ...appended].join(','),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    );
}
