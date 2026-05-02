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
import { and, eq, exists, inArray, or, sql } from 'drizzle-orm';

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

import type {
  Character,
  NewCharacter,
} from '../../../../db/schema/index';

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
    }
  ): Promise<Character | null> {
    const updates: Partial<NewCharacter> = {};

    if (spellData.cantrips !== undefined) {
      updates.cantrips = spellData.cantrips.join(',');
    }
    if (spellData.knownSpells !== undefined) {
      updates.knownSpells = spellData.knownSpells.join(',');
    }
    if (spellData.preparedSpells !== undefined) {
      updates.preparedSpells = spellData.preparedSpells.join(',');
    }
    if (spellData.ritualSpells !== undefined) {
      updates.ritualSpells = spellData.ritualSpells.join(',');
    }

    // Direct update to characters table with ownership check
    const [updated] = await db
      .update(characters)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(and(
        eq(characters.id, characterId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          exists(
            db.select()
              .from(characterPermissions)
              .where(and(
                eq(characterPermissions.characterId, characters.id),
                eq(characterPermissions.userId, userId),
                inArray(characterPermissions.permissionLevel, ['editor', 'owner'])
              ))
          )
        )
      ))
      .returning();

    return (updated as Character) || null;
  }

  /**
   * Parse comma-separated spell string to array
   */
  static parseSpells(spellString: string | null): string[] {
    if (!spellString || spellString.trim() === '') return [];
    return spellString.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }

  /**
   * Save character spells (junction table and character columns) with ownership verification.
   * This is a security-hardened method that replaces direct Supabase calls.
   */
  static async saveCharacterSpells(
    characterId: string,
    userId: string,
    spellIds: string[],
    className: string
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
        .where(and(
          eq(classSpells.classId, classData.id),
          inArray(classSpells.spellId, spellIds)
        ));

      const validSpellIds = new Set(validClassSpells.map((s: { spellId: string }) => s.spellId));
      const invalidSpellIds = spellIds.filter(id => !validSpellIds.has(id));

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
    const deleted = await db.delete(characterSpells).where(
      and(
        eq(characterSpells.characterId, characterId),
        eq(characterSpells.sourceClassId, classData.id),
        exists(
          db.select()
            .from(characters)
            .where(and(
              eq(characters.id, characterId),
              or(
                eq(characters.userId, userId),
                eq(characters.ownerId, userId),
                exists(
                  db.select()
                    .from(characterPermissions)
                    .where(and(
                      eq(characterPermissions.characterId, characters.id),
                      eq(characterPermissions.userId, userId),
                      inArray(characterPermissions.permissionLevel, ['editor', 'owner'])
                    ))
                )
              )
            ))
        )
      )
    ).returning({ id: characterSpells.id });

    let insertedCount = 0;

    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth
    if (spellIds.length > 0) {
      // ⚡ Bolt: Optimized N+1 query pattern by replacing O(N) UNION ALL loop with a single O(1) joined SELECT.
      // This maintains atomic ownership verification while significantly reducing SQL complexity.
      const inserted = await db.insert(characterSpells).select(
        db.select({
          characterId: sql`${characterId}`,
          spellId: classSpells.spellId,
          sourceClassId: sql`${classData.id}`,
          isPrepared: sql`true`,
          sourceFeature: sql`'base'`,
        })
        .from(classSpells)
        .innerJoin(characters, and(
          eq(characters.id, characterId),
          or(
            eq(characters.userId, userId),
            eq(characters.ownerId, userId),
            exists(
              db.select()
                .from(characterPermissions)
                .where(and(
                  eq(characterPermissions.characterId, characters.id),
                  eq(characterPermissions.userId, userId),
                  inArray(characterPermissions.permissionLevel, ['editor', 'owner'])
                ))
            )
          )
        ))
        .where(and(
          eq(classSpells.classId, classData.id),
          inArray(classSpells.spellId, spellIds)
        ))
      ).returning({ id: characterSpells.id });

      insertedCount = inserted.length;
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
              db.select()
                .from(characterPermissions)
                .where(and(
                  eq(characterPermissions.characterId, characters.id),
                  eq(characterPermissions.userId, userId),
                  inArray(characterPermissions.permissionLevel, ['editor', 'owner'])
                ))
            )
          )
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
    const [spellSummary] = await db
      .select({
        cantrips: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} = 0)`,
        leveled: sql<string>`string_agg(${spells.name}, ',') FILTER (WHERE ${spells.level} > 0)`,
      })
      .from(characterSpells)
      .innerJoin(spells, eq(characterSpells.spellId, spells.id))
      .innerJoin(characters, eq(characterSpells.characterId, characters.id))
      .where(and(
        eq(characterSpells.characterId, characterId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          exists(
            db.select()
              .from(characterPermissions)
              .where(and(
                eq(characterPermissions.characterId, characters.id),
                eq(characterPermissions.userId, userId)
              ))
          )
        )
      ));

    // Update the character table columns directly with aggregated results
    await this.updateSpells(characterId, userId, {
      cantrips: spellSummary?.cantrips ? spellSummary.cantrips.split(',') : [],
      knownSpells: spellSummary?.leveled ? spellSummary.leveled.split(',') : [],
      preparedSpells: spellSummary?.leveled ? spellSummary.leveled.split(',') : [], // Default all as prepared for now to match current behavior
    });

    return { success: true, message: 'Character spells saved successfully' };
  }
}
