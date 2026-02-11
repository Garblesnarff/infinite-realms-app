/**
 * Character Routes for Elysia
 *
 * Provides character-related API endpoints:
 * - GET /v1/characters - List all characters
 * - POST /v1/characters - Create character
 * - GET /v1/characters/:id - Get single character
 * - PUT /v1/characters/:id - Update character
 * - DELETE /v1/characters/:id - Delete character
 * - GET /v1/characters/:id/spells - Get character spells
 * - POST /v1/characters/:id/spells - Save character spells
 *
 * Ported from /server/src/routes/v1/characters.ts
 */

/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Elysia, t } from 'elysia';

import { authenticateRequest } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';
import { CharacterService } from '../../services/character-service.js';

/**
 * Parse spell strings stored in the database
 * Handles comma-separated values, JSON arrays, and null values
 */
function parseSpellString(value: string | string[] | null): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [value];
    } catch {
      return value.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

/**
 * Map character object from database/service (camelCase) to API (snake_case)
 * for backward compatibility with frontend.
 */
function mapCharacterToApi(character: any): any {
  if (!character) return null;

  return {
    id: character.id,
    name: character.name,
    description: character.description,
    race: character.race,
    class: character.class,
    level: character.level,
    alignment: character.alignment,
    experience_points: character.experiencePoints,
    background: character.background,
    image_url: character.imageUrl,
    avatar_url: character.avatarUrl,
    background_image: character.backgroundImage,
    appearance: character.appearance,
    personality_traits: character.personalityTraits,
    personality_notes: character.personalityNotes,
    backstory_elements: character.backstoryElements,
    cantrips: character.cantrips,
    known_spells: character.knownSpells,
    prepared_spells: character.preparedSpells,
    ritual_spells: character.ritualSpells,
    vision_types: character.visionTypes,
    obscurement: character.obscurement,
    is_hidden: character.isHidden,
    campaign_id: character.campaignId,
    user_id: character.userId,
    owner_id: character.ownerId,
    is_public: character.isPublic,
    sharing_mode: character.sharingMode,
    folder_id: character.folderId,
    created_at: character.createdAt,
    updated_at: character.updatedAt,
    stats: character.stats ? {
      id: character.stats.id,
      character_id: character.stats.characterId,
      strength: character.stats.strength,
      dexterity: character.stats.dexterity,
      constitution: character.stats.constitution,
      intelligence: character.stats.intelligence,
      wisdom: character.stats.wisdom,
      charisma: character.stats.charisma,
      created_at: character.stats.createdAt,
      updated_at: character.stats.updatedAt,
    } : undefined,
  };
}

export const charactersRoutes = new Elysia({ prefix: '/v1/characters' })
  /**
   * Centralized authentication and character ownership verification
   */
  .derive(async ({ request, params }) => {
    const { user, error: authError } = await authenticateRequest(request);

    let character = null;
    if (user && params?.id) {
      // 🛡️ Sentinel: Fetch character once in derive block to avoid double-fetching.
      // CharacterService.getById verifies dual-ownership (userId OR ownerId).
      character = await CharacterService.getById(params.id, user.userId);
    }

    return { user, authError, character };
  })
  .onBeforeHandle(async ({ user, authError, params, character, set }) => {
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (params?.id && !character) {
      // 🛡️ Sentinel: Return 404 for unauthorized access to prevent existence leakage.
      set.status = 404;
      return { error: 'Character not found' };
    }
  })

  /**
   * GET /v1/characters
   * List all characters for the authenticated user
   */
  .get('/', async ({ user }) => {
    try {
      // 🛡️ Sentinel: Use CharacterService.listForUser which correctly checks
      // both userId AND ownerId for comprehensive character access.
      const characters = await CharacterService.listForUser(user!.userId);
      return (characters || []).map(mapCharacterToApi);
    } catch (error) {
      logger.error({ msg: 'CHARACTERS_LIST error', error });
      throw error;
    }
  })

  /**
   * POST /v1/characters
   * Create a new character
   */
  .post('/', async ({ body, set, user }) => {
    try {
      const charData = body as any;
      const character = await CharacterService.create(user!.userId, {
        name: charData.name,
        description: charData.description,
        race: charData.race,
        class: charData.class,
        level: charData.level,
        alignment: charData.alignment,
        experiencePoints: charData.experience_points,
        imageUrl: charData.image_url,
        appearance: charData.appearance,
        personalityTraits: charData.personality_traits,
        backstoryElements: charData.backstory_elements,
        background: charData.background,
      });

      set.status = 201;
      return mapCharacterToApi(character);
    } catch (error) {
      logger.error({ msg: 'CHARACTER_CREATE error', error });
      throw error;
    }
  })

  /**
   * GET /v1/characters/:id
   * Get a single character by ID
   */
  .get('/:id', async ({ character }) => {
    // 🛡️ Sentinel: Already verified and fetched by derive/onBeforeHandle
    return mapCharacterToApi(character);
  })

  /**
   * PUT /v1/characters/:id
   * Update a character
   */
  .put('/:id', async ({ params, body, user }) => {
    try {
      const charData = body as any;
      const updated = await CharacterService.update(params.id, user!.userId, {
        name: charData.name,
        description: charData.description,
        race: charData.race,
        class: charData.class,
        level: charData.level,
        alignment: charData.alignment,
        experiencePoints: charData.experience_points,
        imageUrl: charData.image_url,
        appearance: charData.appearance,
        personalityTraits: charData.personality_traits,
        backstoryElements: charData.backstory_elements,
        background: charData.background,
      });

      return mapCharacterToApi(updated);
    } catch (error) {
      logger.error({ msg: 'CHARACTER_UPDATE error', error });
      throw error;
    }
  })

  /**
   * DELETE /v1/characters/:id
   * Delete a character
   */
  .delete('/:id', async ({ params, user }) => {
    try {
      await CharacterService.delete(params.id, user!.userId);
      return { ok: true };
    } catch (error) {
      logger.error({ msg: 'CHARACTER_DELETE error', error });
      throw error;
    }
  })

  /**
   * POST /v1/characters/:id/spells
   * Validate and save character spells
   */
  .post('/:id/spells', async ({ params, body }) => {
    try {
      const { spells, className } = body as { spells: string[]; className: string };

      if (!spells || !className) {
        throw new Error('Missing required fields: spells and className');
      }

      // 🛡️ Sentinel: Already verified by onBeforeHandle (checks dual-ownership)

      // Get class ID
      const { data: classData, error: classError } = await supabaseService
        .from('classes')
        .select('id')
        .eq('name', className)
        .single();

      if (classError || !classData) {
        throw new Error('Invalid class name');
      }

      // Validate all spells in a single batch query
      const { data: validClassSpells, error: validationError } = await supabaseService
        .from('class_spells')
        .select('spell_id, spells(id, name)')
        .eq('class_id', classData.id)
        .in('spell_id', spells);

      if (validationError) {
        logger.error({ msg: 'CHARACTER_SPELLS_VALIDATE error', error: validationError });
        throw new Error('Failed to validate spells');
      }

      // Create a Set of valid spell IDs for O(1) lookup
      const validSpellIds = new Set(validClassSpells?.map((cs: any) => cs.spell_id) || []);

      // Find any invalid spells
      const invalidSpells = spells.filter((spellId: string) => !validSpellIds.has(spellId));

      if (invalidSpells.length > 0) {
        // Get spell names for invalid spells to provide helpful error messages
        const { data: invalidSpellData } = await supabaseService
          .from('spells')
          .select('id, name')
          .in('id', invalidSpells);

        const spellNameMap = new Map(
          invalidSpellData?.map((spell: any) => [spell.id, spell.name]) || []
        );

        const validationErrors = invalidSpells.map(
          (spellId: string) => `${className} cannot learn ${spellNameMap.get(spellId) || spellId}`
        );

        return {
          error: 'Invalid spell selection',
          details: validationErrors,
        };
      }

      // Clear existing spells for this character and class
      await supabaseService
        .from('character_spells')
        .delete()
        .eq('character_id', params.id)
        .eq('source_class_id', classData.id);

      // Insert validated spells
      if (spells.length > 0) {
        const spellInserts = spells.map((spellId: string) => ({
          character_id: params.id,
          spell_id: spellId,
          source_class_id: classData.id,
          is_prepared: true,
          source_feature: 'base',
        }));

        const { error: insertError } = await supabaseService
          .from('character_spells')
          .insert(spellInserts);

        if (insertError) {
          logger.error({ msg: 'CHARACTER_SPELLS_INSERT error', error: insertError });
          throw new Error('Failed to save character spells');
        }
      }

      return { success: true, message: 'Character spells saved successfully' };
    } catch (error: any) {
      logger.error({ msg: 'CHARACTER_SPELLS_SAVE error', error });
      return { error: error.message || 'Failed to validate character spells' };
    }
  })

  /**
   * Get character spells with full spell data
   * GET /v1/characters/:id/spells
   */
  .get(
    '/:id/spells',
    async ({ params, character, user }) => {
      const characterId = params.id;
      const userId = user!.userId;

      logger.info({
        msg: 'CHARACTER_SPELLS',
        userId,
        characterId,
        timestamp: new Date().toISOString(),
      });

      // 🛡️ Sentinel: Already verified and fetched by derive/onBeforeHandle

      logger.info({
        msg: 'CHARACTER_SPELLS_FOUND',
        characterId: character.id,
        class: character.class,
        level: character.level,
        ownerId: character.userId,
      });

      // Parse spell strings
      const cantrips = parseSpellString(character.cantrips);
      const knownSpells = parseSpellString(character.knownSpells);
      const preparedSpells = parseSpellString(character.preparedSpells);

      logger.info({
        msg: 'CHARACTER_SPELLS_PARSED',
        cantripCount: cantrips.length,
        knownSpellCount: knownSpells.length,
        preparedSpellCount: preparedSpells.length,
      });

      const response = {
        character: {
          id: character.id,
          class: character.class,
          level: character.level,
        },
        cantrips: cantrips.map(name => ({ name, level: 0 })),
        spells: knownSpells.map(name => ({
          name,
          is_prepared: preparedSpells.includes(name),
        })),
        total_spells: cantrips.length + knownSpells.length,
      };

      logger.info({
        msg: 'CHARACTER_SPELLS_RESPONSE',
        characterId: response.character.id,
        cantripCount: response.cantrips.length,
        spellCount: response.spells.length,
        totalSpells: response.total_spells,
      });

      return response;
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
