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
import { TRPCError } from '@trpc/server';
import { Elysia, t } from 'elysia';

import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { CampaignService } from '../../services/campaign-service.js';
import { CharacterSpellService } from '../../services/character/character-spell-service.js';
import { CharacterService } from '../../services/character-service.js';

import type { Character } from '../../../../db/schema/index';

/**
 * Validation schema for character operations
 */
const characterSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.Nullable(t.String())),
  race: t.Optional(t.Nullable(t.String())),
  subrace: t.Optional(t.Nullable(t.String())),
  class: t.Optional(t.Nullable(t.String())),
  level: t.Optional(t.Number({ minimum: 1, maximum: 20 })),
  alignment: t.Optional(t.Nullable(t.String())),
  experience_points: t.Optional(t.Number({ minimum: 0 })),
  image_url: t.Optional(t.Nullable(t.String())),
  avatar_url: t.Optional(t.Nullable(t.String())),
  appearance: t.Optional(t.Nullable(t.String())),
  personality_traits: t.Optional(t.Nullable(t.String())),
  personality_notes: t.Optional(t.Nullable(t.String())),
  backstory_elements: t.Optional(t.Nullable(t.String())),
  background: t.Optional(t.Nullable(t.String())),
  background_image: t.Optional(t.Nullable(t.String())),
  theme: t.Optional(t.Nullable(t.String())),
  session_notes: t.Optional(t.Nullable(t.String())),
  campaign_id: t.Optional(t.Nullable(t.String())),
  skill_proficiencies: t.Optional(t.Nullable(t.String())),
  expertise_proficiencies: t.Optional(t.Nullable(t.String())),
  tool_proficiencies: t.Optional(t.Nullable(t.String())),
  saving_throw_proficiencies: t.Optional(t.Nullable(t.String())),
  languages: t.Optional(t.Array(t.String())),
  cantrips: t.Optional(t.Nullable(t.String())),
  known_spells: t.Optional(t.Nullable(t.String())),
  prepared_spells: t.Optional(t.Nullable(t.String())),
  ritual_spells: t.Optional(t.Nullable(t.String())),
  spell_slots: t.Optional(t.Any()),
  pact_slots: t.Optional(t.Any()),
  active_concentration: t.Optional(t.Nullable(t.String())),
  class_features: t.Optional(t.Any()),
  fighting_styles: t.Optional(t.Any()),
  copper_pieces: t.Optional(t.Number()),
  silver_pieces: t.Optional(t.Number()),
  electrum_pieces: t.Optional(t.Number()),
  gold_pieces: t.Optional(t.Number()),
  platinum_pieces: t.Optional(t.Number()),
  damage_resistances: t.Optional(t.Any()),
  damage_immunities: t.Optional(t.Any()),
  damage_vulnerabilities: t.Optional(t.Any()),
  vision_types: t.Optional(t.Array(t.String())),
  obscurement: t.Optional(t.Nullable(t.String())),
  is_hidden: t.Optional(t.Boolean()),
  stealth_check_bonus: t.Optional(t.Number()),
  class_levels: t.Optional(t.Any()),
  total_level: t.Optional(t.Number({ minimum: 1 })),
  stats: t.Optional(
    t.Object({
      strength: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      dexterity: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      constitution: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      intelligence: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      wisdom: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      charisma: t.Optional(t.Number({ minimum: 1, maximum: 30 })),
      armor_class: t.Optional(t.Number({ minimum: 0 })),
      max_hit_points: t.Optional(t.Number({ minimum: 0 })),
      current_hit_points: t.Optional(t.Number({ minimum: 0 })),
      temporary_hit_points: t.Optional(t.Number({ minimum: 0 })),
      initiative_bonus: t.Optional(t.Number()),
      speed: t.Optional(t.Number({ minimum: 0 })),
    }),
  ),
  equipment: t.Optional(
    t.Array(
      t.Object({
        item_name: t.String({ minLength: 1 }),
        item_type: t.Optional(t.String()),
        quantity: t.Optional(t.Number({ minimum: 0 })),
        equipped: t.Optional(t.Boolean()),
        is_magic: t.Optional(t.Boolean()),
        magic_bonus: t.Optional(t.Number()),
        magic_properties: t.Optional(t.Nullable(t.String())),
        requires_attunement: t.Optional(t.Boolean()),
        is_attuned: t.Optional(t.Boolean()),
        attunement_requirements: t.Optional(t.Nullable(t.String())),
        magic_item_type: t.Optional(t.Nullable(t.String())),
        magic_item_rarity: t.Optional(t.Nullable(t.String())),
        magic_effects: t.Optional(t.Nullable(t.String())),
      }),
    ),
  ),
});

const updateCharacterSchema = t.Partial(characterSchema);

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
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Map character object from database/service (camelCase) to API (snake_case)
 * for backward compatibility with frontend.
 */
function mapCharacterToApi(character: Character & { stats?: any }): any {
  if (!character) return null;

  return {
    id: character.id,
    name: character.name,
    description: character.description,
    race: character.race,
    subrace: character.subrace,
    class: character.class,
    level: character.level,
    alignment: character.alignment,
    experience_points: character.experiencePoints,
    background: character.background,
    skill_proficiencies: character.skillProficiencies,
    expertise_proficiencies: character.expertiseProficiencies,
    languages: character.languages,
    image_url: character.imageUrl,
    avatar_url: character.avatarUrl,
    background_image: character.backgroundImage,
    appearance: character.appearance,
    personality_traits: character.personalityTraits,
    personality_notes: character.personalityNotes,
    backstory_elements: character.backstoryElements,
    theme: character.theme,
    session_notes: character.sessionNotes,
    cantrips: character.cantrips,
    known_spells: character.knownSpells,
    prepared_spells: character.preparedSpells,
    ritual_spells: character.ritualSpells,
    spell_slots: character.spellSlots,
    pact_slots: character.pactSlots,
    active_concentration: character.activeConcentration,
    class_features: character.classFeatures,
    fighting_styles: character.fightingStyles,
    copper_pieces: character.copperPieces,
    silver_pieces: character.silverPieces,
    electrum_pieces: character.electrumPieces,
    gold_pieces: character.goldPieces,
    platinum_pieces: character.platinumPieces,
    damage_resistances: character.damageResistances,
    damage_immunities: character.damageImmunities,
    damage_vulnerabilities: character.damageVulnerabilities,
    class_levels: character.classLevels,
    total_level: character.totalLevel,
    vision_types: character.visionTypes,
    obscurement: character.obscurement,
    is_hidden: character.isHidden,
    stealth_check_bonus: character.stealthCheckBonus,
    campaign_id: character.campaignId,
    user_id: character.userId,
    owner_id: character.ownerId,
    is_public: character.isPublic,
    sharing_mode: character.sharingMode,
    folder_id: character.folderId,
    created_at: character.createdAt,
    updated_at: character.updatedAt,
    stats: character.stats
      ? {
          id: character.stats.id,
          character_id: character.stats.characterId,
          strength: character.stats.strength,
          dexterity: character.stats.dexterity,
          constitution: character.stats.constitution,
          intelligence: character.stats.intelligence,
          wisdom: character.stats.wisdom,
          charisma: character.stats.charisma,
          armor_class: character.stats.armorClass,
          max_hit_points: character.stats.maxHitPoints,
          current_hit_points: character.stats.currentHitPoints,
          temporary_hit_points: character.stats.temporaryHitPoints,
          initiative_bonus: character.stats.initiativeBonus,
          speed: character.stats.speed,
          created_at: character.stats.createdAt,
          updated_at: character.stats.updatedAt,
        }
      : undefined,
  };
}

export const charactersRoutes = new Elysia({ prefix: '/v1/characters' })
  .use(requireAuth)
  /**
   * Centralized character ownership verification
   */
  .derive(async ({ user, params }) => {
    let character = null;
    if (user && params?.id) {
      // 🛡️ Sentinel: Fetch character once in derive block to avoid double-fetching.
      // CharacterService.getById verifies dual-ownership (userId OR ownerId).
      character = await CharacterService.getById(params.id, user.userId);
    }

    return { character };
  })
  .onBeforeHandle(async ({ params, character, set }) => {
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
  .get(
    '/',
    async ({ user, query }) => {
      try {
        // 🛡️ Sentinel: Use CharacterService.listForUser which correctly checks
        // both userId AND ownerId for comprehensive character access.
        const characters = await CharacterService.listForUser(user!.userId, query.campaign_id);
        return (characters || []).map((c) => mapCharacterToApi(c as any));
      } catch (error) {
        logger.error({ msg: 'CHARACTERS_LIST error', error });
        throw error;
      }
    },
    {
      query: t.Object({ campaign_id: t.Optional(t.String()) }),
    },
  )

  /**
   * POST /v1/characters
   * Create a new character
   */
  .post(
    '/',
    async ({ body, set, user }) => {
      try {
        if (body.campaign_id) {
          const campaign = await CampaignService.getById(body.campaign_id, user!.userId);
          if (!campaign) {
            set.status = 404;
            return { error: 'Campaign not found' };
          }
        }

        const character = await CharacterService.create(
          user!.userId,
          {
            name: body.name,
            description: body.description,
            race: body.race,
            subrace: body.subrace,
            class: body.class,
            level: body.level,
            alignment: body.alignment,
            experiencePoints: body.experience_points,
            imageUrl: body.image_url,
            avatarUrl: body.avatar_url,
            appearance: body.appearance,
            personalityTraits: body.personality_traits,
            personalityNotes: body.personality_notes,
            backstoryElements: body.backstory_elements,
            background: body.background,
            backgroundImage: body.background_image,
            theme: body.theme,
            sessionNotes: body.session_notes,
            campaignId: body.campaign_id,
            skillProficiencies: body.skill_proficiencies,
            expertiseProficiencies: body.expertise_proficiencies,
            toolProficiencies: body.tool_proficiencies,
            savingThrowProficiencies: body.saving_throw_proficiencies,
            languages: body.languages,
            cantrips: body.cantrips,
            knownSpells: body.known_spells,
            preparedSpells: body.prepared_spells,
            ritualSpells: body.ritual_spells,
            spellSlots: body.spell_slots,
            pactSlots: body.pact_slots,
            activeConcentration: body.active_concentration,
            classFeatures: body.class_features,
            fightingStyles: body.fighting_styles,
            copperPieces: body.copper_pieces,
            silverPieces: body.silver_pieces,
            electrumPieces: body.electrum_pieces,
            goldPieces: body.gold_pieces,
            platinumPieces: body.platinum_pieces,
            damageResistances: body.damage_resistances,
            damageImmunities: body.damage_immunities,
            damageVulnerabilities: body.damage_vulnerabilities,
            visionTypes: body.vision_types,
            obscurement: body.obscurement,
            isHidden: body.is_hidden,
            stealthCheckBonus: body.stealth_check_bonus,
            classLevels: body.class_levels,
            totalLevel: body.total_level,
          },
          body.stats
            ? {
                strength: body.stats.strength,
                dexterity: body.stats.dexterity,
                constitution: body.stats.constitution,
                intelligence: body.stats.intelligence,
                wisdom: body.stats.wisdom,
                charisma: body.stats.charisma,
                armorClass: body.stats.armor_class,
                maxHitPoints: body.stats.max_hit_points,
                currentHitPoints: body.stats.current_hit_points,
                temporaryHitPoints: body.stats.temporary_hit_points,
                initiativeBonus: body.stats.initiative_bonus,
                speed: body.stats.speed,
              }
            : undefined,
          body.equipment,
        );

        set.status = 201;
        return mapCharacterToApi(character as any);
      } catch (error) {
        logger.error({ msg: 'CHARACTER_CREATE error', error });
        throw error;
      }
    },
    {
      body: characterSchema,
    },
  )

  /**
   * GET /v1/characters/:id
   * Get a single character by ID
   */
  .get('/:id', async ({ character }) => {
    // 🛡️ Sentinel: Already verified and fetched by derive/onBeforeHandle
    return mapCharacterToApi(character as any);
  })

  /**
   * PUT /v1/characters/:id
   * Update a character
   */
  .put(
    '/:id',
    async ({ params, body, user }) => {
      try {
        const updated = await CharacterService.update(params.id, user!.userId, {
          name: body.name,
          description: body.description,
          race: body.race,
          class: body.class,
          level: body.level,
          alignment: body.alignment,
          experiencePoints: body.experience_points,
          imageUrl: body.image_url,
          avatarUrl: body.avatar_url,
          appearance: body.appearance,
          personalityTraits: body.personality_traits,
          personalityNotes: body.personality_notes,
          backstoryElements: body.backstory_elements,
          background: body.background,
          backgroundImage: body.background_image,
          theme: body.theme,
          sessionNotes: body.session_notes,
          skillProficiencies: body.skill_proficiencies,
          expertiseProficiencies: body.expertise_proficiencies,
          toolProficiencies: body.tool_proficiencies,
          savingThrowProficiencies: body.saving_throw_proficiencies,
          languages: body.languages,
          cantrips: body.cantrips,
          knownSpells: body.known_spells,
          preparedSpells: body.prepared_spells,
          ritualSpells: body.ritual_spells,
          spellSlots: body.spell_slots,
          pactSlots: body.pact_slots,
          activeConcentration: body.active_concentration,
          classFeatures: body.class_features,
          fightingStyles: body.fighting_styles,
          copperPieces: body.copper_pieces,
          silverPieces: body.silver_pieces,
          electrumPieces: body.electrum_pieces,
          goldPieces: body.gold_pieces,
          platinumPieces: body.platinum_pieces,
          damageResistances: body.damage_resistances,
          damageImmunities: body.damage_immunities,
          damageVulnerabilities: body.damage_vulnerabilities,
          visionTypes: body.vision_types,
          obscurement: body.obscurement,
          isHidden: body.is_hidden,
          stealthCheckBonus: body.stealth_check_bonus,
          classLevels: body.class_levels,
          totalLevel: body.total_level,
        });

        return mapCharacterToApi(updated as any);
      } catch (error) {
        logger.error({ msg: 'CHARACTER_UPDATE error', error });
        throw error;
      }
    },
    {
      body: updateCharacterSchema,
    },
  )

  .post(
    '/:id/damage',
    async ({ params, body, user }) =>
      CharacterService.applyDamage(params.id, user!.userId, body.amount),
    { body: t.Object({ amount: t.Number({ minimum: 0 }) }) },
  )

  .put(
    '/:id/stats',
    async ({ params, body, user }) => {
      await CharacterService.upsertStats(params.id, user!.userId, {
        strength: body.strength,
        dexterity: body.dexterity,
        constitution: body.constitution,
        intelligence: body.intelligence,
        wisdom: body.wisdom,
        charisma: body.charisma,
        armorClass: body.armor_class,
        maxHitPoints: body.max_hit_points,
        currentHitPoints: body.current_hit_points,
        temporaryHitPoints: body.temporary_hit_points,
        initiativeBonus: body.initiative_bonus,
        speed: body.speed,
      });
      return { ok: true };
    },
    {
      body: t.Partial(
        t.Object({
          strength: t.Number({ minimum: 1, maximum: 30 }),
          dexterity: t.Number({ minimum: 1, maximum: 30 }),
          constitution: t.Number({ minimum: 1, maximum: 30 }),
          intelligence: t.Number({ minimum: 1, maximum: 30 }),
          wisdom: t.Number({ minimum: 1, maximum: 30 }),
          charisma: t.Number({ minimum: 1, maximum: 30 }),
          armor_class: t.Number({ minimum: 0 }),
          max_hit_points: t.Number({ minimum: 0 }),
          current_hit_points: t.Number({ minimum: 0 }),
          temporary_hit_points: t.Number({ minimum: 0 }),
          initiative_bonus: t.Number(),
          speed: t.Number({ minimum: 0 }),
        }),
      ),
    },
  )

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
        const result = await CharacterSpellService.saveCharacterSpells(
          params.id,
          user!.userId,
          spells,
          className,
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
    },
  )

  /**
   * Get character spells with full spell data
   * GET /v1/characters/:id/spells
   */
  .get(
    '/:id/spells',
    async ({ params, character, set, user }) => {
      const characterId = params.id;
      const userId = user!.userId;

      logger.info({
        msg: 'CHARACTER_SPELLS',
        userId,
        characterId,
        timestamp: new Date().toISOString(),
      });

      // 🛡️ Sentinel: Already verified and fetched by derive/onBeforeHandle
      if (!character) {
        set.status = 404;
        return { error: 'Character not found' };
      }

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
        cantrips: cantrips.map((name) => ({ name, level: 0 })),
        spells: knownSpells.map((name) => ({
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
    },
  );
