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

import { db } from '../../../../db/client';
import {
  characterPermissions,
  characterSpells,
  characters,
  classes,
  classSpells,
  spells,
} from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';

import type { Character } from '../../../../db/schema/index';

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
    // Get class ID
    const [classData] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(eq(classes.name, className))
      .limit(1);

    if (!classData) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid class name' });
    }

    // Validate spells in batch if any were provided
    if (spellIds.length > 0) {
      const validClassSpells = await db
        .select({
          spellId: classSpells.spellId,
          spellName: spells.name,
        })
        .from(classSpells)
        .innerJoin(spells, eq(classSpells.spellId, spells.id))
        .where(and(eq(classSpells.classId, classData.id), inArray(classSpells.spellId, spellIds)));

      const validSpellIds = new Set(validClassSpells.map((s: { spellId: string }) => s.spellId));
      const invalidSpellIds = spellIds.filter((id) => !validSpellIds.has(id));

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

    // Clear existing spells with ownership check in WHERE clause for defense-in-depth
    const deleted = await db
      .delete(characterSpells)
      .where(
        and(
          eq(characterSpells.characterId, characterId),
          eq(characterSpells.sourceClassId, classData.id),
          exists(
            db
              .select({ one: sql`1` })
              .from(characters)
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
    if (spellIds.length > 0) {
      const editable = await db
        .select({ one: sql`1` })
        .from(characters)
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
        .limit(1);

      if (editable.length === 0) {
        throw new NotFoundError('Character', characterId);
      }

      // Still one query for the spell list rather than N: the insert-select was
      // reading rows out of class_spells, not just proving ownership.
      const grantable = await db
        .select({ spellId: classSpells.spellId })
        .from(classSpells)
        .where(and(eq(classSpells.classId, classData.id), inArray(classSpells.spellId, spellIds)));

      if (grantable.length > 0) {
        // #2710: when the caller sends an explicit prepared set, write
        // isPrepared per spell. When omitted, keep the old behaviour
        // (all true) so existing callers don't break.
        const preparedSet =
          preparedSpellIds !== undefined ? new Set(preparedSpellIds) : null;
        const inserted = await db
          .insert(characterSpells)
          .values(
            grantable.map((row) => ({
              characterId,
              spellId: row.spellId,
              sourceClassId: classData.id,
              isPrepared: preparedSet ? preparedSet.has(row.spellId) : true,
              sourceFeature: 'base',
            })),
          )
          .returning({ id: characterSpells.id });

        insertedCount = inserted.length;
      }
    }

    // ⚡ Bolt: Verify character existence/ownership only if no rows were affected by DELETE or INSERT.
    // This maintains the NotFoundError contract while skipping the extra query in most cases.
    if (deleted.length === 0 && (spellIds.length === 0 || insertedCount === 0)) {
      const characterExists = await db.query.characters.findFirst({
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
        columns: { id: true },
      });

      if (!characterExists) {
        throw new NotFoundError('Character', characterId);
      }
    }

    // ⚡ Bolt: Maintain data consistency by syncing with comma-separated columns on characters table.
    // Optimized to use SQL aggregation (string_agg) instead of fetching every spell row.
    // This reduces data transfer and memory usage by processing the concatenation in the database.
    // #211 QA-041: the prepared aggregation filters by is_prepared — the old
    // code synced ALL leveled spells into preparedSpells.
    const [spellSummary] = await db
      .select({
        cantrips: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} = 0)`,
        leveled: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} > 0)`,
        prepared: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} > 0 AND ${characterSpells.isPrepared} = true)`,
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
    // #211 QA-041: preparedSpells gets only the prepared ones, not all leveled.
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

    return { success: true, message: 'Character spells saved successfully' };
  }
}
