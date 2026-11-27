/**
 * Character Spell Service
 *
 * Handles character spell management operations including:
 * - Saving character spells to junction table
 * - Updating comma-separated spell columns for backward compatibility
 * - Parsing spell strings
 *
 * Extracted from CharacterService.
 *
 * @module server/services/character/character-spell-service
 */

import { TRPCError } from '@trpc/server';
import { and, eq, exists, inArray, or, sql, type SQL } from 'drizzle-orm';

import { grantAlwaysPreparedSubclassSpells } from './always-prepared-spell-grant.js';
import { db } from '../../../../db/client';
import {
  characterPermissions,
  characterSpells,
  characters,
  classes,
  classSpells,
  spells,
} from '../../../../db/schema/index';
import { THAUMATURGY_SPELL_ID } from '../../../../shared/racial-spell-ids';
import { findSrdClass } from '../../../../shared/srd-class-data';
import { NotFoundError } from '../../lib/errors.js';

import type { Character } from '../../../../db/schema/index';

// #1803: the two retired duplicate spell rows (Tasha's Hideous Laughter and
// Tenser's Floating Disk, #254) map to their canonical ids. A save that names a
// retired id must keep the spell under the canonical id instead of storing the
// retired id — and, once migration 0042 removes the retired rows, instead of
// failing on the character_spells -> spells foreign key. The canonical ids carry
// the same class links as the retired ones (Hideous Laughter: Bard + Wizard, a
// superset of Tasha's Bard; Floating Disk: Wizard, the same as Tenser's Wizard),
// so class validation is unchanged by the mapping. Mirrors the alias map in
// shared/spell-aliases.ts (#1784); this copy is self-contained because that file
// is new in #1784 and this service cannot import it yet.
const RETIRED_SPELL_ID_TO_CANONICAL: Record<string, string> = {
  '2f531b61-5626-5b7b-a9f9-bf935e580864': '49679c17-4b59-5e1b-b9a2-8ed2f53f209e', // Tasha's Hideous Laughter -> Hideous Laughter
  'ce62cea7-640b-5439-a175-10289409f59b': '14bccb17-1728-5095-ab6a-35b28812c6b7', // Tenser's Floating Disk -> Floating Disk
};

/**
 * Map any raw retired spell id to its canonical id; every other id passes
 * through unchanged. (#1803, #254.)
 */
export function mapRetiredSpellIdsToCanonical(spellIds: readonly string[]): string[] {
  return spellIds.map((id) => RETIRED_SPELL_ID_TO_CANONICAL[id] ?? id);
}

export class CharacterSpellService {
  /**
   * Update character spells (comma-separated text fields)
   */
  static async updateSpells(
    characterId: string,
    userId: string,
    spellData: {
      cantrips?: string[];
      knownSpells?: string[];
      preparedSpells?: string[];
      ritualSpells?: string[];
    },
    options: { fillEmptyOnly?: boolean } = {},
  ): Promise<Character | null> {
    // Legacy spell columns are also populated by the character-create payload. The create-time
    // selection is authoritative, so this sync may only fill a column that is still NULL/empty.
    // Keep the condition in SQL so a concurrent create/update cannot be overwritten between a
    // read and a write.
    type LegacySpellColumn = 'cantrips' | 'knownSpells' | 'preparedSpells' | 'ritualSpells';
    const updates: Partial<Record<LegacySpellColumn, string | SQL<unknown>>> = {};

    const valueForColumn = (column: unknown, value: string): string | SQL<unknown> =>
      options.fillEmptyOnly
        ? sql`
            CASE
              WHEN ${column} IS NULL OR btrim(${column}) = ''
                THEN ${value}
              ELSE ${column}
            END`
        : value;

    if (spellData.cantrips !== undefined) {
      updates.cantrips = valueForColumn(characters.cantrips, spellData.cantrips.join(','));
    }
    if (spellData.knownSpells !== undefined) {
      updates.knownSpells = valueForColumn(characters.knownSpells, spellData.knownSpells.join(','));
    }
    if (spellData.preparedSpells !== undefined) {
      updates.preparedSpells = valueForColumn(
        characters.preparedSpells,
        spellData.preparedSpells.join(','),
      );
    }
    if (spellData.ritualSpells !== undefined) {
      updates.ritualSpells = valueForColumn(
        characters.ritualSpells,
        spellData.ritualSpells.join(','),
      );
    }

    // Direct update to characters table with ownership check
    const [updated] = await db
      .update(characters)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(characters.id, characterId),
          or(
            eq(characters.userId, userId),
            eq(characters.ownerId, userId),
            exists(
              db
                .select({ one: sql`1` })
                .from(characterPermissions)
                .where(
                  and(
                    eq(characterPermissions.characterId, characters.id),
                    eq(characterPermissions.userId, userId),
                    inArray(characterPermissions.permissionLevel, ['editor', 'owner']),
                  ),
                ),
            ),
          ),
        ),
      )
      .returning();

    return (updated as Character) || null;
  }

  /**
   * Parse comma-separated spell string to array
   */
  static parseSpells(spellString: string | null): string[] {
    if (!spellString || spellString.trim() === '') return [];
    return spellString
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  /**
   * Save character spells (junction table and character columns) with ownership verification.
   * This is a security-hardened method that replaces direct Supabase calls.
   */
  static async saveCharacterSpells(
    characterId: string,
    userId: string,
    spellIds: string[],
    className: string,
    preparedSpellIds?: string[],
  ): Promise<{ success: boolean; message: string }> {
    // #1803: canonicalize retired ids before validation, so the save stores the
    // canonical spell. Applied to both arrays: `spells` and `prepared`.
    const canonicalSpellIds = mapRetiredSpellIdsToCanonical(spellIds);
    const canonicalPreparedSpellIds =
      preparedSpellIds === undefined ? undefined : mapRetiredSpellIdsToCanonical(preparedSpellIds);

    // Get class ID
    const [classData] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.name, className))
      .limit(1);

    if (!classData) {
      // The lookup above is exact, so only the canonical SRD name (what the client sends) can
      // mean "catalog not seeded yet". An alias such as "wizard" stays "Invalid class name".
      const srdClass = findSrdClass(className);
      const seedMissing = srdClass !== undefined && srdClass.name === className;
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: seedMissing
          ? `The spell catalog for ${srdClass.name} is not loaded on this server yet. Your saved spells were not changed.`
          : 'Invalid class name',
      });
    }

    const racialSpellIds = new Set<string>();
    if (canonicalSpellIds.includes(THAUMATURGY_SPELL_ID)) {
      const [catalogSpell] = await db
        .select({ id: spells.id })
        .from(spells)
        .where(
          and(
            eq(spells.id, THAUMATURGY_SPELL_ID),
            eq(spells.name, 'Thaumaturgy'),
            eq(spells.level, 0),
          ),
        )
        .limit(1);
      if (!catalogSpell)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Thaumaturgy is temporarily unavailable. Your saved spells were not changed.',
        });
      const character = await db.query.characters.findFirst({
        where: and(
          eq(characters.id, characterId),
          or(
            eq(characters.userId, userId),
            eq(characters.ownerId, userId),
            exists(
              db
                .select({ one: sql`1` })
                .from(characterPermissions)
                .where(
                  and(
                    eq(characterPermissions.characterId, characters.id),
                    eq(characterPermissions.userId, userId),
                    inArray(characterPermissions.permissionLevel, ['editor', 'owner']),
                  ),
                ),
            ),
          ),
        ),
      });
      if (!character) throw new NotFoundError('Character', characterId);
      if (character.race?.trim().toLowerCase() === 'tiefling')
        racialSpellIds.add(THAUMATURGY_SPELL_ID);
    }

    // Validate spells in batch if any were provided
    if (canonicalSpellIds.length > 0) {
      const validClassSpells = await db
        .select({
          spellId: classSpells.spellId,
          spellName: spells.name,
        })
        .from(classSpells)
        .innerJoin(spells, eq(classSpells.spellId, spells.id))
        .where(
          and(
            eq(classSpells.classId, classData.id),
            inArray(classSpells.spellId, canonicalSpellIds),
          ),
        );

      const validSpellIds = new Set(validClassSpells.map((s: { spellId: string }) => s.spellId));
      const invalidSpellIds = canonicalSpellIds.filter(
        (id) => !validSpellIds.has(id) && !racialSpellIds.has(id),
      );

      if (invalidSpellIds.length > 0) {
        // Get names for invalid spells for better error reporting
        const invalidSpellData = await db
          .select({ name: spells.name })
          .from(spells)
          .where(inArray(spells.id, invalidSpellIds));

        const invalidNames = invalidSpellData.map((s: { name: string | null }) => s.name);
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid spells for ${className}: ${invalidNames.join(', ')}`,
        });
      }
    }

    await db.transaction(async (tx) => {
      // Same per-character lock as the always-prepared grant, so a save and a grant (or two
      // saves) for one character queue instead of racing on (character_id, spell_id).
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${characterId}::text, 0))`,
      );
      // Clear existing spells with ownership check in WHERE clause for defense-in-depth
      const deleted = await tx
        .delete(characterSpells)
        .where(
          and(
            eq(characterSpells.characterId, characterId),
            eq(characterSpells.sourceClassId, classData.id),
            exists(
              tx
                .select({ one: sql`1` })
                .from(characters)
                .where(
                  and(
                    eq(characters.id, characterId),
                    or(
                      eq(characters.userId, userId),
                      eq(characters.ownerId, userId),
                      exists(
                        tx
                          .select({ one: sql`1` })
                          .from(characterPermissions)
                          .where(
                            and(
                              eq(characterPermissions.characterId, characters.id),
                              eq(characterPermissions.userId, userId),
                              inArray(characterPermissions.permissionLevel, ['editor', 'owner']),
                            ),
                          ),
                      ),
                    ),
                  ),
                ),
            ),
          ),
        )
        .returning({ id: characterSpells.id });

      let insertedCount = 0;

      // The ownership check used to ride along inside an insert-select. Its projection
      // covered 5 of character_spells' 10 columns, so Drizzle rejected the statement
      // before it was ever sent -- every spell write on this path had been failing
      // since it shipped. Split into an explicit authorization query plus a plain
      // insert. The pattern is now banned outright by the insert-select rule in
      // eslint.config.js.
      if (canonicalSpellIds.length > 0) {
        const editable = await tx
          .select({ one: sql`1` })
          .from(characters)
          .where(
            and(
              eq(characters.id, characterId),
              or(
                eq(characters.userId, userId),
                eq(characters.ownerId, userId),
                exists(
                  tx
                    .select({ one: sql`1` })
                    .from(characterPermissions)
                    .where(
                      and(
                        eq(characterPermissions.characterId, characters.id),
                        eq(characterPermissions.userId, userId),
                        inArray(characterPermissions.permissionLevel, ['editor', 'owner']),
                      ),
                    ),
                ),
              ),
            ),
          )
          .limit(1);

        if (editable.length === 0) {
          throw new NotFoundError('Character', characterId);
        }

        // Still one query for the spell list rather than N: the insert-select was
        // reading rows out of class_spells, not just proving ownership.
        const grantable = await tx
          .select({ spellId: classSpells.spellId })
          .from(classSpells)
          .where(
            and(
              eq(classSpells.classId, classData.id),
              inArray(classSpells.spellId, canonicalSpellIds),
            ),
          );

        for (const spellId of racialSpellIds)
          if (!grantable.some((row) => row.spellId === spellId)) grantable.push({ spellId });

        // Dedupe by spellId so a class_spells table with duplicate rows never
        // produces duplicate (character_id, spell_id) inserts.
        // Sorted so concurrent saves take row locks in the same order.
        const dedupedGrantable = Array.from(
          new Map(grantable.map((row) => [row.spellId, row])).values(),
        ).sort((x, y) => x.spellId.localeCompare(y.spellId));

        if (dedupedGrantable.length > 0) {
          // #2710: when the caller sends an explicit prepared set, write
          // isPrepared per spell. When omitted, keep the old behaviour
          // (all true) so existing callers don't break.
          const preparedSet =
            canonicalPreparedSpellIds !== undefined ? new Set(canonicalPreparedSpellIds) : null;
          const inserted = await tx
            .insert(characterSpells)
            .values(
              dedupedGrantable.map((row) => ({
                characterId,
                spellId: row.spellId,
                sourceClassId: classData.id,
                isPrepared: preparedSet ? preparedSet.has(row.spellId) : true,
                sourceFeature: racialSpellIds.has(row.spellId) ? 'racial' : 'base',
              })),
            )
            .onConflictDoUpdate({
              target: [characterSpells.characterId, characterSpells.spellId],
              set: {
                isPrepared: sql`excluded.is_prepared OR ${characterSpells.isAlwaysPrepared}`,
                updatedAt: new Date(),
              },
            })
            .returning({ id: characterSpells.id });

          insertedCount = inserted.length;
        }
      }

      // ⚡ Bolt: Verify character existence/ownership only if no rows were affected by DELETE or INSERT.
      // This maintains the NotFoundError contract while skipping the extra query in most cases.
      if (deleted.length === 0 && (canonicalSpellIds.length === 0 || insertedCount === 0)) {
        const characterExists = await tx.query.characters.findFirst({
          where: and(
            eq(characters.id, characterId),
            or(
              eq(characters.userId, userId),
              eq(characters.ownerId, userId),
              exists(
                tx
                  .select({ one: sql`1` })
                  .from(characterPermissions)
                  .where(
                    and(
                      eq(characterPermissions.characterId, characters.id),
                      eq(characterPermissions.userId, userId),
                      inArray(characterPermissions.permissionLevel, ['editor', 'owner']),
                    ),
                  ),
              ),
            ),
          ),
          columns: { id: true },
        });

        if (!characterExists) {
          throw new NotFoundError('Character', characterId);
        }
      }
    });

    // ⚡ Bolt: Maintain data consistency by syncing with comma-separated columns on characters table.
    // Optimized to use SQL aggregation (string_agg) instead of fetching every spell row.
    // This reduces data transfer and memory usage by processing the concatenation in the database.
    // #211: the preparedSpells legacy column must hold only the prepared names, not every
    // leveled spell — the junction table's is_prepared flags are authoritative here.
    const [spellSummary] = await db
      .select({
        cantrips: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} = 0)`,
        leveled: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} > 0)`,
        prepared: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} > 0 AND ${characterSpells.isPrepared})`,
      })
      .from(characterSpells)
      .innerJoin(spells, eq(characterSpells.spellId, spells.id))
      .innerJoin(characters, eq(characterSpells.characterId, characters.id))
      .where(
        and(
          eq(characterSpells.characterId, characterId),
          or(
            eq(characters.userId, userId),
            eq(characters.ownerId, userId),
            exists(
              db
                .select({ one: sql`1` })
                .from(characterPermissions)
                .where(
                  and(
                    eq(characterPermissions.characterId, characters.id),
                    eq(characterPermissions.userId, userId),
                  ),
                ),
            ),
          ),
        ),
      );

    // Update the character table columns directly with aggregated results
    await this.updateSpells(
      characterId,
      userId,
      {
        cantrips: spellSummary?.cantrips ? spellSummary.cantrips.split(',') : [],
        knownSpells: spellSummary?.leveled ? spellSummary.leveled.split(',') : [],
        preparedSpells: spellSummary?.prepared ? spellSummary.prepared.split(',') : [],
      },
      { fillEmptyOnly: true },
    );

    await grantAlwaysPreparedSubclassSpells(characterId, userId);

    return { success: true, message: 'Character spells saved successfully' };
  }
}
