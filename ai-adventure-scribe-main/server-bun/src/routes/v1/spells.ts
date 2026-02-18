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
import { inArray } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { db } from '../../../../db/client';
import { classes } from '../../../../db/schema/index';
import {
  getClassSpells,
  getSpellById,
  getSpellsByLevel,
  getSpellsBySchool,
  spellProgression,
  spellcastingClasses,
} from '../../data/spellData.js';
import { authenticateRequest } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';
import { planRateLimit } from '../../middleware/rate-limit.js';

export const spellsRoutes = new Elysia({ prefix: '/v1/spells' })

  /**
   * GET /v1/spells
   * Get all spells with optional filtering
   */
  .use(planRateLimit('default'))
  .get('/', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { level, school, class: className, ritual, components } = query as {
      level?: string;
      school?: string;
      class?: string;
      ritual?: string;
      components?: string;
    };

    try {
      let spells: any[];

      // Get spells by class if specified
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
        // Get all spells - combine cantrips and level 1+ spells from all classes
        const bardSpells = getClassSpells('Bard');
        const druidSpells = getClassSpells('Druid');
        const clericSpells = getClassSpells('Cleric');
        const sorcererSpells = getClassSpells('Sorcerer');
        const warlockSpells = getClassSpells('Warlock');
        const wizardSpells = getClassSpells('Wizard');

        // Combine all unique spells
        const allClassSpells = [
          ...bardSpells.cantrips, ...bardSpells.spells,
          ...druidSpells.cantrips, ...druidSpells.spells,
          ...clericSpells.cantrips, ...clericSpells.spells,
          ...sorcererSpells.cantrips, ...sorcererSpells.spells,
          ...warlockSpells.cantrips, ...warlockSpells.spells,
          ...wizardSpells.cantrips, ...wizardSpells.spells,
        ];

        // ⚡ Bolt: Use a Map for O(N) de-duplication instead of O(N^2) filter/findIndex.
        // This is significantly faster for large spell lists.
        const uniqueSpellsMap = new Map();
        allClassSpells.forEach((spell) => {
          uniqueSpellsMap.set(spell.id, spell);
        });

        spells = Array.from(uniqueSpellsMap.values());
      }

      // Apply additional filters
      let filteredSpells = spells;

      // Filter by ritual
      if (ritual !== undefined) {
        const isRitual = ritual === 'true';
        filteredSpells = filteredSpells.filter((spell) => spell.ritual === isRitual);
      }

      // Filter by components
      if (components) {
        const componentArray = components.split(',');
        componentArray.forEach((component) => {
          switch (component.trim().toUpperCase()) {
            case 'V':
              filteredSpells = filteredSpells.filter((spell) => spell.verbal);
              break;
            case 'S':
              filteredSpells = filteredSpells.filter((spell) => spell.somatic);
              break;
            case 'M':
              filteredSpells = filteredSpells.filter((spell) => spell.material);
              break;
          }
        });
      }

      // Sort by level then name
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
  })

  /**
   * GET /v1/spells/class/:className/level/:level
   * Get spells available to a specific class at a specific level
   */
  .get('/class/:className/level/:level', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

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
  })

  /**
   * GET /v1/spells/progression/:className
   * Get spell progression for a class
   */
  .get('/progression/:className', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

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
  })

  /**
   * GET /v1/spells/multiclass/slots/:casterLevel
   * Get multiclass spell slots for a given caster level
   */
  .get('/multiclass/slots/:casterLevel', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { casterLevel } = params;

    try {
      const { data, error } = await supabaseService
        .from('multiclass_spell_slots')
        .select(`
          caster_level, spell_slots_1, spell_slots_2, spell_slots_3, spell_slots_4,
          spell_slots_5, spell_slots_6, spell_slots_7, spell_slots_8, spell_slots_9
        `)
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
  })

  /**
   * GET /v1/spells/classes
   * Get all classes with their spellcasting information
   */
  .get('/classes', async ({ request, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

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
  .get('/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

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
  })

  /**
   * POST /v1/spells/multiclass/calculate
   * Calculate multiclass caster level
   */
  .post('/multiclass/calculate', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { classLevels } = body as { classLevels?: any[] };

    if (!Array.isArray(classLevels)) {
      set.status = 400;
      return { error: 'classLevels must be an array' };
    }

    try {
      let totalCasterLevel = 0;
      let pactMagicSlots = { level: 0, slots: 0 };

      // ⚡ Bolt: Batch fetch class caster types instead of O(N) database queries.
      const classNames = classLevels.map((cl) => cl.className);
      const classesData = await db
        .select({
          name: classes.name,
          casterType: classes.casterType,
        })
        .from(classes)
        .where(inArray(classes.name, classNames));

      const casterTypeMap = new Map(classesData.map((c) => [c.name, c.casterType]));

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
          .select(`
            caster_level, spell_slots_1, spell_slots_2, spell_slots_3, spell_slots_4,
            spell_slots_5, spell_slots_6, spell_slots_7, spell_slots_8, spell_slots_9
          `)
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
  });
