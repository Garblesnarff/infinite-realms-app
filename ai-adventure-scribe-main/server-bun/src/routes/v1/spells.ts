/**
 * Spell Routes for Elysia
 *
 * Provides D&D 5E spell data endpoints:
 * - GET /v1/spells - Get all spells with filtering
 * - GET /v1/spells/class/:className/level/:level - Get class spells by level
 * - GET /v1/spells/progression/:className - Get spell progression
 * - GET /v1/spells/multiclass/slots/:casterLevel - Get multiclass spell slots
 * - GET /v1/spells/classes - Get all spellcasting classes
 * - GET /v1/spells/:id - Get spell by ID
 * - POST /v1/spells/multiclass/calculate - Calculate multiclass caster level
 *
 * Ported from /server/src/routes/v1/spells.ts
 */

/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { Elysia, t } from 'elysia';

import {
  allSpells,
  getClassSpells,
  getSpellById,
  getSpellsByLevel,
  getSpellsBySchool,
  spellProgression,
  spellcastingClasses,
} from '../../data/spellData.js';
import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';
import { authedUser } from '../../middleware/authed-user.js';
import { planRateLimit } from '../../middleware/rate-limit.js';

const spellFiltersQuery = t.Object({
  level: t.Optional(t.String({ minLength: 1, maxLength: 3 })),
  school: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  class: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  ritual: t.Optional(t.String({ minLength: 1, maxLength: 10 })),
  components: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
});

const classLevelParams = t.Object({
  className: t.String({ minLength: 1, maxLength: 100 }),
  level: t.String({ minLength: 1, maxLength: 3 }),
});

const classNameParams = t.Object({
  className: t.String({ minLength: 1, maxLength: 100 }),
});

const casterLevelParams = t.Object({
  casterLevel: t.String({ minLength: 1, maxLength: 3 }),
});

const spellIdParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
});

const multiclassCalculationSchema = t.Object({
  // Optional keeps the existing route-level error for a missing classLevels array.
  classLevels: t.Optional(
    t.Array(
      t.Object({
        className: t.String({ minLength: 1, maxLength: 100 }),
        level: t.Number({ minimum: 1, maximum: 20 }),
      }),
      { maxItems: 20 },
    ),
  ),
});

export const spellsRoutes = new Elysia({ prefix: '/v1/spells' })

  /**
   * GET /v1/spells
   * Get all spells with optional filtering
   */
  .use(authedUser)
  .use(planRateLimit('default'))
  .get(
    '/',
    async ({ query, set }) => {
      const { level, school, class: className, ritual, components } = query;

      try {
        let spells: any[];

        // ⚡ Bolt: Optimized spell retrieval path.
        // Use pre-calculated allSpells instead of manual O(Classes * Spells) aggregation.
        if (className) {
          const classSpells = getClassSpells(className);
          spells = [...classSpells.cantrips, ...classSpells.spells];
        } else if (level !== undefined) {
          // SECURITY: Bound parseInt to valid spell levels (0-9)
          const levelNum = Math.max(0, Math.min(parseInt(level) || 0, 9));
          spells = getSpellsByLevel(levelNum);
        } else if (school) {
          spells = getSpellsBySchool(school);
        } else {
          spells = allSpells;
        }

        // ⚡ Bolt: Consolidate component filtering into a set for O(1) lookup.
        const componentSet = components
          ? new Set(components.split(',').map((c) => c.trim().toUpperCase()))
          : null;

        // ⚡ Bolt: Combine multiple filter passes into a single O(N) traversal.
        const filteredSpells = spells.filter((spell) => {
          if (ritual !== undefined && spell.ritual !== (ritual === 'true')) {
            return false;
          }

          if (componentSet) {
            if (componentSet.has('V') && !spell.verbal) return false;
            if (componentSet.has('S') && !spell.somatic) return false;
            if (componentSet.has('M') && !spell.material) return false;
          }

          return true;
        });

        // Sort by level then name
        // NOTE: We keep sorting here because filtered results might need re-sorting
        // if derived from multiple sources, though allSpells is likely already sorted.
        filteredSpells.sort((a, b) => {
          if (a.level !== b.level) {
            return a.level - b.level;
          }
          return a.name.localeCompare(b.name);
        });

        return filteredSpells;
      } catch (e) {
        logger.error({ msg: 'Error fetching spells', error: e });
        set.status = 500;
        return { error: 'Failed to fetch spells' };
      }
    },
    { query: spellFiltersQuery },
  )

  /**
   * GET /v1/spells/class/:className/level/:level
   * Get spells available to a specific class at a specific level
   */
  .get(
    '/class/:className/level/:level',
    async ({ params, set }) => {
      const { className, level } = params;

      try {
        const classSpells = getClassSpells(className || '');

        // Filter spells by level (include spells up to the specified level)
        // SECURITY: Bound parseInt to valid spell levels (0-9)
        const maxLevel = Math.max(0, Math.min(parseInt(level || '0') || 0, 9));
        const { cantrips, spells } = classSpells;

        const availableCantrips = cantrips; // Cantrips are always available
        const availableSpells = spells.filter((spell: any) => spell.level <= maxLevel);

        // Combine and sort
        const allSpells = [...availableCantrips, ...availableSpells];
        allSpells.sort((a: any, b: any) => {
          if (a.level !== b.level) {
            return a.level - b.level;
          }
          return a.name.localeCompare(b.name);
        });

        return allSpells;
      } catch (e) {
        logger.error({ msg: 'Error fetching class spells', error: e });
        set.status = 500;
        return { error: 'Failed to fetch class spells' };
      }
    },
    { params: classLevelParams },
  )

  /**
   * GET /v1/spells/progression/:className
   * Get spell progression for a class
   */
  .get(
    '/progression/:className',
    async ({ params, set }) => {
      const { className } = params;

      try {
        const progression = spellProgression[className as keyof typeof spellProgression];

        if (!progression) {
          set.status = 404;
          return { error: `Spell progression not found for class: ${className}` };
        }

        return progression;
      } catch (e) {
        logger.error({ msg: 'Error fetching spell progression', error: e });
        set.status = 500;
        return { error: 'Failed to fetch spell progression' };
      }
    },
    { params: classNameParams },
  )

  /**
   * GET /v1/spells/multiclass/slots/:casterLevel
   * Get multiclass spell slots for a given caster level
   */
  .get(
    '/multiclass/slots/:casterLevel',
    async ({ params, set }) => {
      const { casterLevel } = params;

      try {
        const { data, error } = await supabaseService
          .from('multiclass_spell_slots')
          .select(
            `
          caster_level, spell_slots_1, spell_slots_2, spell_slots_3, spell_slots_4,
          spell_slots_5, spell_slots_6, spell_slots_7, spell_slots_8, spell_slots_9
        `,
          )
          // SECURITY: Bound parseInt to valid caster levels (1-20)
          .eq('caster_level', Math.max(1, Math.min(parseInt(casterLevel || '1') || 1, 20)))
          .single();

        if (error) {
          if (error.code === 'PGRST116') {
            set.status = 404;
            return { error: 'Caster level not found' };
          }
          logger.error({ msg: 'Error fetching multiclass spell slots', error });
          set.status = 500;
          return { error: 'Failed to fetch multiclass spell slots' };
        }

        return data;
      } catch (e) {
        logger.error({ msg: 'Error fetching multiclass spell slots', error: e });
        set.status = 500;
        return { error: 'Failed to fetch multiclass spell slots' };
      }
    },
    { params: casterLevelParams },
  )

  /**
   * GET /v1/spells/classes
   * Get all classes with their spellcasting information
   */
  .get('/classes', async ({ set }) => {
    try {
      return spellcastingClasses;
    } catch (e) {
      logger.error({ msg: 'Error fetching spellcasting classes', error: e });
      set.status = 500;
      return { error: 'Failed to fetch spellcasting classes' };
    }
  })

  /**
   * GET /v1/spells/:id
   * Get a specific spell by ID
   */
  .get(
    '/:id',
    async ({ params, set }) => {
      const { id } = params;

      try {
        const spell = getSpellById(id || '');

        if (!spell) {
          set.status = 404;
          return { error: 'Spell not found' };
        }

        return spell;
      } catch (e) {
        logger.error({ msg: 'Error fetching spell', error: e });
        set.status = 500;
        return { error: 'Failed to fetch spell' };
      }
    },
    { params: spellIdParams },
  )

  /**
   * POST /v1/spells/multiclass/calculate
   * Calculate multiclass caster level
   */
  .post(
    '/multiclass/calculate',
    async ({ body, set }) => {
      const { classLevels } = body;

      if (!Array.isArray(classLevels)) {
        set.status = 400;
        return { error: 'classLevels must be an array' };
      }

      try {
        let totalCasterLevel = 0;
        let pactMagicSlots = { level: 0, slots: 0 };

        // ⚡ Bolt: Use static spellcastingClasses data instead of database query.
        // This eliminates a database round-trip for multiclass calculations.
        const casterTypeMap = new Map(spellcastingClasses.map((c) => [c.name, c.caster_type]));

        for (const classLevel of classLevels) {
          const { className, level } = classLevel;
          const casterType = casterTypeMap.get(className);

          if (!casterType) {
            set.status = 400;
            return { error: `Class ${className} not found` };
          }

          switch (casterType) {
            case 'full':
              totalCasterLevel += level;
              break;
            case 'half':
              totalCasterLevel += Math.floor(level / 2);
              break;
            case 'third':
              totalCasterLevel += Math.floor(level / 3);
              break;
            case 'pact':
              // Warlock pact magic is separate but can be used with other spell slots
              if (level >= 1) {
                const pactLevel = Math.min(Math.ceil(level / 2), 5);
                pactMagicSlots = {
                  level: pactLevel,
                  slots: level >= 11 ? 3 : 2,
                };
              }
              break;
          }
        }

        // Get multiclass spell slots for the calculated caster level
        let spellSlots = null;
        if (totalCasterLevel > 0) {
          // ⚡ Bolt: Use explicit column list for spell slots to avoid over-fetching and improve performance.
          const { data: slotsData } = await supabaseService
            .from('multiclass_spell_slots')
            .select(
              `
            caster_level, spell_slots_1, spell_slots_2, spell_slots_3, spell_slots_4,
            spell_slots_5, spell_slots_6, spell_slots_7, spell_slots_8, spell_slots_9
          `,
            )
            .eq('caster_level', Math.min(totalCasterLevel, 20))
            .single();
          spellSlots = slotsData || null;
        }

        return {
          totalCasterLevel,
          spellSlots,
          pactMagicSlots: pactMagicSlots.slots > 0 ? pactMagicSlots : null,
        };
      } catch (e) {
        logger.error({ msg: 'Error calculating multiclass caster level', error: e });
        set.status = 500;
        return { error: 'Failed to calculate multiclass caster level' };
      }
    },
    { body: multiclassCalculationSchema },
  );
