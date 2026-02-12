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
import { TRPCError } from '@trpc/server';
import { Elysia, t } from 'elysia';

import { authenticateRequest } from '../../lib/auth.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
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
   * Validate and save character spells.
   * Refactored to use security-hardened service method and Drizzle ORM.
   */
  .post(
    '/:id/spells',
    async ({ params, body, user, set }) => {
      try {
        const { spells, className } = body;

        // 🛡️ Sentinel: Call the security-hardened service method which incorporates
        // ownership checks and masks existence.
        const result = await CharacterService.saveCharacterSpells(
          params.id,
          user!.userId,
          spells,
          className
        );

        return result;
      } catch (error: any) {
        if (error instanceof TRPCError) {
          set.status = 400; // Map TRPC errors to appropriate HTTP status
          return { error: error.message };
        }
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: 'Character not found' };
        }
        logger.error({ msg: 'CHARACTER_SPELLS_SAVE error', error });
        set.status = 500;
        return { error: 'Failed to save character spells' };
      }
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        spells: t.Array(t.String()),
        className: t.String(),
      }),
    }
  )

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

      // ⚡ Bolt: Use a Set for O(1) lookup complexity instead of O(N) array includes.
      // This reduces overall mapping complexity from O(M*N) to O(M+N).
      const preparedSet = new Set(preparedSpells);

      const response = {
        character: {
          id: character.id,
          class: character.class,
          level: character.level,
        },
        cantrips: cantrips.map(name => ({ name, level: 0 })),
        spells: knownSpells.map(name => ({
          name,
          is_prepared: preparedSet.has(name),
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
