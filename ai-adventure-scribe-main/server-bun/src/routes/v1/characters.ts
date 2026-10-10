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
import { inArray } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { db } from '../../../../db/client';
import { spells } from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { CampaignService } from '../../services/campaign-service.js';
import { CharacterSpellService } from '../../services/character/character-spell-service.js';
import { CharacterService } from '../../services/character-service.js';
import { SpellSlotDataAccess } from '../../services/spell-slots/spell-slot-data-access.js';

import type { Character, CharacterStats } from '../../../../db/schema/index';

/**
 * Overlay the engine's spell-slot table onto the sheet-facing character
 * payload. The `character_spell_slots` table is the single source of truth for
 * slot usage (#2459); the legacy `characters.spell_slots` JSONB is no longer
 * read anywhere (#2598). A character with no slot rows reports no stored slots:
 * the sheet falls back to its class-calculated totals, which is also the state
 * the engine derives from the progression table on that character's first cast.
 * Rows for legacy characters are seeded by the 20261005 backfill migration.
 */
export async function overlayEngineSpellSlots(
  mapped: Record<string, unknown> | null,
  characterId: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  if (!mapped) return mapped;
  const { slots } = await SpellSlotDataAccess.getCharacterSpellSlots(characterId, userId);
  return {
    ...mapped,
    spell_slots: Object.fromEntries(
      slots.map((slot) => [
        slot.spellLevel,
        { max: slot.totalSlots, current: slot.totalSlots - slot.usedSlots },
      ]),
    ),
  };
}

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
        id: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
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
  inventory_items: t.Optional(
    t.Array(
      t.Object({
        name: t.String({ minLength: 1 }),
        item_type: t.String({ minLength: 1 }),
        quantity: t.Optional(t.Number({ minimum: 0 })),
        weight: t.Optional(t.Number({ minimum: 0 })),
        description: t.Optional(t.Nullable(t.String())),
        is_equipped: t.Optional(t.Boolean()),
        is_attuned: t.Optional(t.Boolean()),
        requires_attunement: t.Optional(t.Boolean()),
        properties: t.Optional(t.Nullable(t.String())),
      }),
    ),
  ),
});

const updateCharacterSchema = t.Partial(characterSchema);

const omitUndefined = <T extends Record<string, unknown>>(record: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>;

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
 *
 * Exported for `__tests__/character-api-shape.test.ts`, which pins the fields
 * the frontend needs to reconstruct a character sheet — a field silently
 * missing here is invisible until a stat comes out wrong (issue #1827).
 */
export function mapCharacterToApi(
  character: Character & { stats?: CharacterStats },
): Record<string, unknown> | null {
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
    // Both columns are accepted on create and update (see characterSchema) but
    // were never returned, so no client could read back a character's tool or
    // saving-throw proficiencies — the saving-throw half of issue #1827.
    tool_proficiencies: character.toolProficiencies,
    saving_throw_proficiencies: character.savingThrowProficiencies,
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
          // #2517: the single truth for "dead" — /app/characters lists a
          // fallen character read-only and the sheet opens on the end state.
          vital_state: character.stats.vitalState,
          died_at: character.stats.diedAt,
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
  // ⚠️ Must be .resolve(), not .derive(): Elysia runs derive() in the
  // transform phase, before resolve() (which requireAuth uses) populates
  // `user` in beforeHandle. A derive() here always sees user === undefined,
  // so the ownership fetch is silently skipped and every /:id request 404s.
  .resolve({ as: 'scoped' }, async ({ user, params }) => {
    let character = null;
    if (user && params?.id) {
      // 🛡️ Sentinel: Fetch character once in derive block to avoid double-fetching.
      // CharacterService.getById verifies dual-ownership (userId OR ownerId).
      character = await CharacterService.getById(params.id, user.userId);
    }

    return { character };
  })
  .onBeforeHandle(({ params, character, set }) => {
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
        // The list feeds sheet-facing payloads too, so each entry gets the same
        // engine-slot overlay as the single-character read (#2598).
        return Promise.all(
          (characters || []).map((c) =>
            overlayEngineSpellSlots(
              mapCharacterToApi(c as Character & { stats?: CharacterStats }),
              (c as Character).id,
              user!.userId,
            ),
          ),
        );
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
          body.inventory_items,
        );

        set.status = 201;
        return mapCharacterToApi(character as Character & { stats?: CharacterStats });
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
  .get('/:id', async ({ character, user }) => {
    // 🛡️ Sentinel: Already verified and fetched by derive/onBeforeHandle
    const resolved = character as (Character & { stats?: CharacterStats }) | null;
    if (!resolved) return null;
    const mapped = mapCharacterToApi(resolved);
    if (!mapped) return mapped;
    // Serve the engine's slot table so the sheet shows the same source the
    // engine spends from (#2459).
    return overlayEngineSpellSlots(mapped, resolved.id, user!.userId);
  })

  /**
   * PUT /v1/characters/:id
   * Update a character
   */
  .put(
    '/:id',
    async ({ params, body, user, set }) => {
      try {
        const updated = await CharacterService.update(
          params.id,
          user!.userId,
          {
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
          },
          body.equipment,
        );

        if (!updated) {
          set.status = 404;
          return { error: 'Character not found' };
        }

        return mapCharacterToApi(updated as Character & { stats?: CharacterStats });
      } catch (error) {
        logger.error({ msg: 'CHARACTER_UPDATE error', error });
        throw error;
      }
    },
    {
      body: updateCharacterSchema,
    },
  )

  /**
   * POST /v1/characters/:id/damage
   *
   * The out-of-combat damage path. Routed to CharacterVitalsService rather than
   * CharacterService because hit points alone are not the whole story: a character this
   * endpoint reduces to 0 must also come out of the scene unconscious and dying (#1826).
   */
  .post(
    '/:id/damage',
    async ({ params, body, user }) => {
      // One dying transition for every writer: in a live encounter this is the combat path
      // (participant row, sheet mirror, engine line); out of one it is the sheet path (#2518, #2622).
      // Loaded on use: the combat write path is a heavy import chain no other character route needs.
      const { applyNonAttackDamage } = await import('../../services/combat/non-attack-damage.js');
      const { vitals, engineLines } = await applyNonAttackDamage(
        params.id,
        user!.userId,
        body.amount,
        'damage_taken',
        { critical: body.critical === true },
      );
      return { ...vitals, engineLines };
    },
    { body: t.Object({ amount: t.Number({ minimum: 0 }), critical: t.Optional(t.Boolean()) }) },
  )

  /**
   * POST /v1/characters/:id/heal
   *
   * The out-of-combat heal path, mirroring POST /:id/damage. The server adds
   * the amount and clamps to max HP (#214): the client never sends an absolute
   * HP, so a combat or DM HP change made in between is not lost. In a live
   * encounter the participant row is healed (write-through mirrors the sheet).
   */
  .post(
    '/:id/heal',
    async ({ params, body, user }) => {
      const { findLiveParticipant } = await import('../../services/combat/non-attack-damage.js');
      const { CharacterVitalsService } = await import('../../services/character-vitals-service.js');
      const live = body.amount > 0 ? await findLiveParticipant(params.id) : null;
      if (live) {
        const { CombatHPService } = await import('../../services/combat-hp-service.js');
        await CombatHPService.healDamage(
          live.participantId,
          live.encounterId,
          body.amount,
          'healing',
          user!.userId,
        );
      } else {
        await CharacterVitalsService.heal(params.id, user!.userId, body.amount);
      }
      const vitals = await CharacterVitalsService.getVitals(params.id, user!.userId);
      return {
        currentHitPoints: vitals.currentHitPoints,
        temporaryHitPoints: vitals.temporaryHitPoints,
      };
    },
    { body: t.Object({ amount: t.Number({ minimum: 0 }) }) },
  )

  /**
   * POST /v1/characters/:id/temp-hp
   *
   * 2014 5e: temporary hit points do not stack — the server keeps the higher
   * of the current and the new value (#214).
   */
  .post(
    '/:id/temp-hp',
    async ({ params, body, user }) => {
      const { findLiveParticipant } = await import('../../services/combat/non-attack-damage.js');
      const { CharacterVitalsService } = await import('../../services/character-vitals-service.js');
      const live = await findLiveParticipant(params.id);
      if (live) {
        const { CombatHPService } = await import('../../services/combat-hp-service.js');
        const result = await CombatHPService.setTempHP(
          live.participantId,
          live.encounterId,
          body.amount,
          user!.userId,
        );
        return { temporaryHitPoints: result.newTempHp };
      }
      const vitals = await CharacterVitalsService.setTemporaryHitPoints(
        params.id,
        user!.userId,
        body.amount,
      );
      return { temporaryHitPoints: vitals.temporaryHitPoints };
    },
    { body: t.Object({ amount: t.Number({ minimum: 0 }) }) },
  )

  .put(
    '/:id/stats',
    async ({ params, body, user }) => {
      const stats = omitUndefined({
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
      await CharacterService.upsertStats(params.id, user!.userId, stats);
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
        const { spells, className, prepared } = body;

        // 🛡️ Sentinel: Call the security-hardened service method which incorporates
        // ownership checks and masks existence.
        const result = await CharacterSpellService.saveCharacterSpells(
          params.id,
          user!.userId,
          spells,
          className,
          // #2710: pass prepared through unchanged. When omitted (undefined),
          // the service keeps today's behaviour (all true). Only an explicit
          // array changes it.
          prepared,
        );

        return result;
      } catch (error: unknown) {
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
        // #2710: the set of spell ids the user prepared. Written per-spell
        // to character_spells.is_prepared.
        prepared: t.Optional(t.Array(t.String())),
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
      const spellNames = [...new Set([...cantrips, ...knownSpells])];
      const spellRows = spellNames.length
        ? await db
            .select({ id: spells.id, name: spells.name })
            .from(spells)
            .where(inArray(spells.name, spellNames))
        : [];
      const spellIdsByName = new Map(
        spellRows.map((spell) => [spell.name.toLowerCase(), spell.id]),
      );

      const response = {
        character: {
          id: character.id,
          class: character.class,
          level: character.level,
        },
        cantrips: cantrips.map((name) => ({
          id: spellIdsByName.get(name.toLowerCase()) || name,
          name,
          level: 0,
        })),
        spells: knownSpells.map((name) => ({
          id: spellIdsByName.get(name.toLowerCase()) || name,
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
