/**
 * Character Service
 *
 * Handles complex character management operations using Drizzle ORM.
 * Provides type-safe database queries for character creation, updates,
 * and retrieval with proper authorization checks.
 *
 * @module server/services/character-service
 */

/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, exists, inArray, or, sql } from 'drizzle-orm';

import { CharacterSpellService } from './character/character-spell-service.js';
import { db } from '../../../db/client';
import {
  characterPermissions,
  characterEquipment,
  inventoryItems,
  characterStats,
  characters,
} from '../../../db/schema/index';
import { InternalServerError } from '../lib/errors.js';

import type { Character, NewCharacter, NewCharacterStats } from '../../../db/schema/index';

export class CharacterService {
  /**
   * List all characters for a user
   */
  static async listForUser(userId: string, campaignId?: string): Promise<Character[]> {
    // ⚡ Bolt: Eager-load characterStats to avoid N+1 queries when displaying
    // character lists that show HP, ability scores, or modifiers.
    const chars = await db.query.characters.findMany({
      where: and(
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        campaignId ? eq(characters.campaignId, campaignId) : undefined,
      ),
      orderBy: [desc(characters.createdAt)],
      with: {
        stats: true,
      },
    });

    return chars as Character[];
  }

  /**
   * Get a single character by ID with authorization check
   */
  static async getById(characterId: string, userId: string): Promise<Character | null> {
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
                ),
              ),
          ),
        ),
      ),
      with: {
        stats: true,
      },
    });

    return character || null;
  }

  /**
   * Get character with campaign details
   */
  static async getWithCampaign(characterId: string, userId: string): Promise<any> {
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
                ),
              ),
          ),
        ),
      ),
      with: {
        campaign: {
          columns: {
            id: true,
            name: true,
            description: true,
            backgroundImage: true,
          },
        },
        stats: true,
      },
    });

    return character || null;
  }

  /**
   * Create a new character
   */
  static async create(
    userId: string,
    data: Partial<NewCharacter>,
    stats?: Omit<Partial<NewCharacterStats>, 'characterId'>,
    equipment?: Array<Record<string, unknown>>,
    inventory?: Array<Record<string, unknown>>,
  ): Promise<Character> {
    return db.transaction(async (tx) => {
      const [character] = await tx
        .insert(characters)
        .values({
          ...data,
          userId,
          ownerId: userId,
          name: data.name || 'Unnamed Character',
          level: data.level || 1,
          experiencePoints: data.experiencePoints || 0,
        })
        .returning();

      if (!character) throw new InternalServerError('Failed to create character');

      if (stats) {
        await tx.insert(characterStats).values({
          ...stats,
          characterId: character.id,
        });
      }

      if (equipment?.length) {
        await tx.insert(characterEquipment).values(
          equipment.map((item) => ({
            characterId: character.id,
            itemName: String(item.item_name || ''),
            itemType: String(item.item_type || 'equipment'),
            quantity: Number(item.quantity || 1),
            equipped: Boolean(item.equipped),
            isMagic: Boolean(item.is_magic),
            magicBonus: Number(item.magic_bonus || 0),
            magicProperties: item.magic_properties ? String(item.magic_properties) : null,
            requiresAttunement: Boolean(item.requires_attunement),
            isAttuned: Boolean(item.is_attuned),
            attunementRequirements: item.attunement_requirements
              ? String(item.attunement_requirements)
              : null,
            magicItemType: item.magic_item_type ? String(item.magic_item_type) : null,
            magicItemRarity: String(item.magic_item_rarity || 'common'),
            magicEffects: item.magic_effects ? String(item.magic_effects) : null,
          })),
        );
      }

      if (inventory?.length) {
        await tx.insert(inventoryItems).values(
          inventory.map((item) => ({
            characterId: character.id,
            name: String(item.name || ''),
            itemType: String(item.item_type || 'custom'),
            quantity: Number(item.quantity || 1),
            weight: String(item.weight ?? 0),
            description: item.description ? String(item.description) : null,
            properties: item.properties ? String(item.properties) : null,
            isEquipped: Boolean(item.is_equipped),
            isAttuned: Boolean(item.is_attuned),
            requiresAttunement: Boolean(item.requires_attunement),
          })),
        );
      }

      return character;
    });
  }

  static async upsertStats(
    characterId: string,
    userId: string,
    data: Omit<Partial<NewCharacterStats>, 'characterId'>,
  ): Promise<void> {
    const character = await this.getById(characterId, userId);
    if (!character) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
    }

    await db
      .insert(characterStats)
      .values({ ...data, characterId })
      .onConflictDoUpdate({
        target: characterStats.characterId,
        set: { ...data, updatedAt: new Date() },
      });
  }

  static async applyDamage(characterId: string, userId: string, amount: number) {
    const [updated] = await db
      .update(characterStats)
      .set({
        currentHitPoints: sql`greatest(0, ${characterStats.currentHitPoints} - greatest(0, ${amount} - coalesce(${characterStats.temporaryHitPoints}, 0)))`,
        temporaryHitPoints: sql`greatest(0, coalesce(${characterStats.temporaryHitPoints}, 0) - ${amount})`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(characterStats.characterId, characterId),
        exists(db.select({ one: sql`1` }).from(characters).where(and(
          eq(characters.id, characterStats.characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        ))),
      ))
      .returning({
        currentHitPoints: characterStats.currentHitPoints,
        temporaryHitPoints: characterStats.temporaryHitPoints,
      });
    if (!updated) throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
    return updated;
  }

  /**
   * Update an existing character
   */
  static async update(
    characterId: string,
    userId: string,
    data: Partial<NewCharacter>,
  ): Promise<Character | null> {
    // 🛡️ Sentinel: Explicitly destructure to prevent Mass Assignment of sensitive fields
    const {
      id: _id,
      userId: _userId,
      ownerId: _ownerId,
      campaignId: _campaignId,
      ...safeUpdates
    } = data as any;

    const [updated] = await db
      .update(characters)
      .set({
        ...safeUpdates,
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

    return updated || null;
  }

  /**
   * Delete a character
   */
  static async delete(characterId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(characters)
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
                    eq(characterPermissions.permissionLevel, 'owner'),
                  ),
                ),
            ),
          ),
        ),
      )
      .returning({ id: characters.id });

    return result.length > 0;
  }

  /**
   * Update character spells (comma-separated text fields)
   * @deprecated Use CharacterSpellService.updateSpells directly
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
  ): Promise<Character | null> {
    return CharacterSpellService.updateSpells(characterId, userId, spellData);
  }

  /**
   * Parse comma-separated spell string to array
   * @deprecated Use CharacterSpellService.parseSpells directly
   */
  static parseSpells(spellString: string | null): string[] {
    return CharacterSpellService.parseSpells(spellString);
  }

  /**
   * Export character to JSON
   */
  static async exportCharacter(characterId: string, userId: string): Promise<any> {
    // ⚡ Bolt: Removed redundant checkPermission call.
    // Authorization is verified atomically within the main query's WHERE clause.
    // This reduces database round-trips from 2 to 1.
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          exists(
            sql`SELECT 1 FROM character_permissions WHERE character_id = ${characters.id} AND user_id = ${userId}`,
          ),
        ),
      ),
      with: {
        stats: true,
      },
    });

    if (!character) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Character not found',
      });
    }

    // Strip sensitive data
    const exportData = {
      version: '1.0',
      character: {
        name: character.name,
        description: character.description,
        race: character.race,
        class: character.class,
        level: character.level,
        alignment: character.alignment,
        experiencePoints: character.experiencePoints,
        background: character.background,
        imageUrl: character.imageUrl,
        avatarUrl: character.avatarUrl,
        backgroundImage: character.backgroundImage,
        appearance: character.appearance,
        personalityTraits: character.personalityTraits,
        personalityNotes: character.personalityNotes,
        backstoryElements: character.backstoryElements,
        cantrips: character.cantrips,
        knownSpells: character.knownSpells,
        preparedSpells: character.preparedSpells,
        ritualSpells: character.ritualSpells,
        visionTypes: character.visionTypes,
        obscurement: character.obscurement,
        isHidden: character.isHidden,
      },
      stats: character.stats
        ? {
            strength: character.stats.strength,
            dexterity: character.stats.dexterity,
            constitution: character.stats.constitution,
            intelligence: character.stats.intelligence,
            wisdom: character.stats.wisdom,
            charisma: character.stats.charisma,
          }
        : null,
      exportedAt: new Date().toISOString(),
    };

    return exportData;
  }

  /**
   * Import character from JSON
   */
  static async importCharacter(userId: string, characterData: any): Promise<Character> {
    // Validate structure
    if (!characterData.version) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid character data: missing version',
      });
    }

    if (!characterData.character) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid character data: missing character object',
      });
    }

    const charData = characterData.character;

    // Validate required fields
    if (!charData.name) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid character data: missing name',
      });
    }

    // Create character
    const [character] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        name: charData.name,
        description: charData.description || null,
        race: charData.race || null,
        class: charData.class || null,
        level: charData.level || 1,
        alignment: charData.alignment || null,
        experiencePoints: charData.experiencePoints || 0,
        background: charData.background || null,
        imageUrl: charData.imageUrl || null,
        avatarUrl: charData.avatarUrl || null,
        backgroundImage: charData.backgroundImage || null,
        appearance: charData.appearance || null,
        personalityTraits: charData.personalityTraits || null,
        personalityNotes: charData.personalityNotes || null,
        backstoryElements: charData.backstoryElements || null,
        cantrips: charData.cantrips || null,
        knownSpells: charData.knownSpells || null,
        preparedSpells: charData.preparedSpells || null,
        ritualSpells: charData.ritualSpells || null,
        visionTypes: charData.visionTypes || null,
        obscurement: charData.obscurement || null,
        isHidden: charData.isHidden || false,
      })
      .returning();

    if (!character) {
      throw new InternalServerError('Failed to import character');
    }

    // Create stats if provided
    if (characterData.stats) {
      await db.insert(characterStats).values({
        characterId: character.id,
        strength: characterData.stats.strength || 10,
        dexterity: characterData.stats.dexterity || 10,
        constitution: characterData.stats.constitution || 10,
        intelligence: characterData.stats.intelligence || 10,
        wisdom: characterData.stats.wisdom || 10,
        charisma: characterData.stats.charisma || 10,
      });
    }

    return character;
  }

  /**
   * Save character spells (junction table and character columns) with ownership verification.
   * This is a security-hardened method that replaces direct Supabase calls.
   * @deprecated Use CharacterSpellService.saveCharacterSpells directly
   */
  static async saveCharacterSpells(
    characterId: string,
    userId: string,
    spellIds: string[],
    className: string,
  ): Promise<{ success: boolean; message: string }> {
    return CharacterSpellService.saveCharacterSpells(characterId, userId, spellIds, className);
  }
}
