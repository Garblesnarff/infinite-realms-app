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

import { Elysia, t } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { sql } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';

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

export const charactersRoutes = new Elysia({ prefix: '/v1/characters' })

  /**
   * GET /v1/characters
   * List all characters for the authenticated user
   */
  .get('/', async ({ request, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { data: characters, error } = await supabaseService
        .from('characters')
        .select(`
          id, name, race, class, level,
          image_url, avatar_url,
          campaign_id,
          created_at, updated_at
        `)
        .eq('user_id', user.userId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error({ msg: 'CHARACTERS_LIST error', error });
        set.status = 500;
        return { error: 'Failed to fetch characters' };
      }

      return characters || [];
    } catch (error) {
      logger.error({ msg: 'CHARACTERS_LIST error', error });
      set.status = 500;
      return { error: 'Failed to fetch characters' };
    }
  })

  /**
   * POST /v1/characters
   * Create a new character
   */
  .post('/', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const {
        name,
        description,
        race,
        class: charClass,
        level,
        alignment,
        experience_points,
        image_url,
        appearance,
        personality_traits,
        backstory_elements,
        background,
      } = body as any;

      const { data: character, error } = await supabaseService
        .from('characters')
        .insert({
          user_id: user.userId,
          name,
          description: description || null,
          race,
          class: charClass,
          level: level || 1,
          alignment: alignment || null,
          experience_points: experience_points || 0,
          image_url: image_url || null,
          appearance: appearance || null,
          personality_traits: personality_traits || null,
          backstory_elements: backstory_elements || null,
          background: background || null,
        })
        .select()
        .single();

      if (error) {
        logger.error({ msg: 'CHARACTER_CREATE error', error });
        set.status = 500;
        return { error: 'Failed to create character' };
      }

      set.status = 201;
      return character;
    } catch (error) {
      logger.error({ msg: 'CHARACTER_CREATE error', error });
      set.status = 500;
      return { error: 'Failed to create character' };
    }
  })

  /**
   * GET /v1/characters/:id
   * Get a single character by ID
   */
  .get('/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { data: character, error } = await supabaseService
        .from('characters')
        .select(`
          id, name, description, race, class, level, alignment, experience_points,
          image_url, avatar_url, background_image,
          appearance, personality_traits, backstory_elements, background,
          personality_notes, vision_types, obscurement, is_hidden,
          campaign_id, user_id,
          created_at, updated_at
        `)
        .eq('id', params.id)
        .eq('user_id', user.userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          set.status = 404;
          return { error: 'Character not found' };
        }
        logger.error({ msg: 'CHARACTER_GET error', error });
        set.status = 500;
        return { error: 'Failed to fetch character' };
      }

      return character;
    } catch (error) {
      logger.error({ msg: 'CHARACTER_GET error', error });
      set.status = 500;
      return { error: 'Failed to fetch character' };
    }
  })

  /**
   * PUT /v1/characters/:id
   * Update a character
   */
  .put('/:id', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const {
        name,
        description,
        race,
        class: charClass,
        level,
        alignment,
        experience_points,
        image_url,
        appearance,
        personality_traits,
        backstory_elements,
        background,
      } = body as any;

      const { data: character, error } = await supabaseService
        .from('characters')
        .update({
          name,
          description: description || null,
          race,
          class: charClass,
          level: level || 1,
          alignment: alignment || null,
          experience_points: experience_points || 0,
          image_url: image_url || null,
          appearance: appearance || null,
          personality_traits: personality_traits || null,
          backstory_elements: backstory_elements || null,
          background: background || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', params.id)
        .eq('user_id', user.userId)
        .select()
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          set.status = 404;
          return { error: 'Character not found' };
        }
        logger.error({ msg: 'CHARACTER_UPDATE error', error });
        set.status = 500;
        return { error: 'Failed to update character' };
      }

      return character;
    } catch (error) {
      logger.error({ msg: 'CHARACTER_UPDATE error', error });
      set.status = 500;
      return { error: 'Failed to update character' };
    }
  })

  /**
   * DELETE /v1/characters/:id
   * Delete a character
   */
  .delete('/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { data: character, error } = await supabaseService
        .from('characters')
        .delete()
        .eq('id', params.id)
        .eq('user_id', user.userId)
        .select('id')
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          set.status = 404;
          return { error: 'Character not found' };
        }
        logger.error({ msg: 'CHARACTER_DELETE error', error });
        set.status = 500;
        return { error: 'Failed to delete character' };
      }

      return { ok: true };
    } catch (error) {
      logger.error({ msg: 'CHARACTER_DELETE error', error });
      set.status = 500;
      return { error: 'Failed to delete character' };
    }
  })

  /**
   * POST /v1/characters/:id/spells
   * Validate and save character spells
   */
  .post('/:id/spells', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { spells, className } = body as { spells: string[]; className: string };

      if (!spells || !className) {
        set.status = 400;
        return { error: 'Missing required fields: spells and className' };
      }

      // Verify character ownership
      const { data: character, error: charError } = await supabaseService
        .from('characters')
        .select('id, class')
        .eq('id', params.id)
        .eq('user_id', user.userId)
        .single();

      if (charError || !character) {
        set.status = 404;
        return { error: 'Character not found' };
      }

      // Get class ID
      const { data: classData, error: classError } = await supabaseService
        .from('classes')
        .select('id')
        .eq('name', className)
        .single();

      if (classError || !classData) {
        set.status = 400;
        return { error: 'Invalid class name' };
      }

      // Validate all spells in a single batch query
      const { data: validClassSpells, error: validationError } = await supabaseService
        .from('class_spells')
        .select('spell_id, spells(id, name)')
        .eq('class_id', classData.id)
        .in('spell_id', spells);

      if (validationError) {
        logger.error({ msg: 'CHARACTER_SPELLS_VALIDATE error', error: validationError });
        set.status = 500;
        return { error: 'Failed to validate spells' };
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

        set.status = 400;
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
          set.status = 500;
          return { error: 'Failed to save character spells' };
        }
      }

      return { success: true, message: 'Character spells saved successfully' };
    } catch (error) {
      logger.error({ msg: 'CHARACTER_SPELLS_SAVE error', error });
      set.status = 500;
      return { error: 'Failed to validate character spells' };
    }
  })

  /**
   * Get character spells with full spell data
   * GET /v1/characters/:id/spells
   */
  .get(
    '/:id/spells',
    async ({ request, params, set }) => {
      // Direct auth check - bypasses Elysia plugin context issues
      const { user, error } = await authenticateRequest(request);
      if (error || !user) {
        set.status = 401;
        return { error: error || 'Unauthorized' };
      }

      const characterId = params.id;
      const userId = user.userId;

      logger.info({
        msg: 'CHARACTER_SPELLS',
        userId,
        characterId,
        timestamp: new Date().toISOString(),
      });

      try {
        // Query character data including spell columns from characters table
        const rows = await sql`
          SELECT
            id,
            class,
            level,
            user_id,
            cantrips,
            known_spells,
            prepared_spells
          FROM characters
          WHERE id = ${characterId}
            AND user_id = ${userId}
          LIMIT 1
        `;

        const character = rows?.[0];

        if (!character) {
          logger.info({
            msg: 'CHARACTER_SPELLS_NOT_FOUND',
            characterId,
            userId,
          });
          set.status = 404;
          return { error: 'Character not found' };
        }

        logger.info({
          msg: 'CHARACTER_SPELLS_FOUND',
          characterId: character.id,
          class: character.class,
          level: character.level,
          ownerId: character.user_id,
        });

        // Parse spell strings
        const cantrips = parseSpellString(character.cantrips);
        const knownSpells = parseSpellString(character.known_spells);
        const preparedSpells = parseSpellString(character.prepared_spells);

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
      } catch (error) {
        logger.error({ msg: 'CHARACTER_SPELLS_ERROR', error });
        set.status = 500;
        return { error: 'Failed to fetch character spells' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    }
  );
