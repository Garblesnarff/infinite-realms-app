/**
 * Personality Routes for Elysia
 *
 * Provides D&D personality element endpoints:
 * - GET /v1/personality/random/:type - Get random personality element
 * - GET /v1/personality/batch/random - Get random elements for all types
 * - GET /v1/personality/:type - Get all elements of a type
 *
 * Ported from /server/src/routes/v1/personality.ts
 */

import { Elysia, t } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { supabase } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

// Valid personality types
const VALID_TYPES = ['traits', 'ideals', 'bonds', 'flaws'] as const;
type PersonalityType = typeof VALID_TYPES[number];

// Map type to table name
const TABLE_MAP: Record<PersonalityType, string> = {
  traits: 'personality_traits',
  ideals: 'personality_ideals',
  bonds: 'personality_bonds',
  flaws: 'personality_flaws',
};

export const personalityRoutes = new Elysia({ prefix: '/v1/personality' })

  /**
   * GET /v1/personality/random/:type
   * Get a random personality element of the specified type
   */
  .use(planRateLimit('default'))
  .get('/random/:type', async ({ request, params, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { type } = params;
    const { background } = query as { background?: string };

    // Validate type parameter
    if (!VALID_TYPES.includes(type as PersonalityType)) {
      set.status = 400;
      return {
        error: 'Invalid type parameter',
        message: 'Type must be one of: traits, ideals, bonds, flaws',
      };
    }

    const tableName = TABLE_MAP[type as PersonalityType];

    try {
      // Build query with optional filters
      let queryBuilder = supabase.from(tableName).select('*');

      // Add background filter if provided (only for traits table)
      // SECURITY: Validate background parameter to prevent injection
      if (background && typeof background === 'string' && tableName === 'personality_traits') {
        const validBackground = /^[a-zA-Z0-9_-]+$/.test(background);
        if (!validBackground) {
          set.status = 400;
          return {
            error: 'Invalid background parameter',
            message: 'Background must contain only alphanumeric characters, hyphens, and underscores',
          };
        }
        queryBuilder = queryBuilder.or(`background.eq.${background},background.is.null`);
      }

      const { data, error } = await queryBuilder;

      if (error) {
        logger.error({ msg: `Error fetching random ${type}`, error });
        set.status = 500;
        return { error: 'Database error', message: `Failed to fetch ${type}` };
      }

      if (!data || data.length === 0) {
        set.status = 404;
        return { error: 'No data found', message: `No ${type} found matching the criteria` };
      }

      // Return a random item from the results
      const randomIndex = Math.floor(Math.random() * data.length);
      const randomItem = data[randomIndex];

      return { success: true, data: randomItem };
    } catch (e) {
      logger.error({ msg: `Error in GET /personality/random/${type}`, error: e });
      set.status = 500;
      return { error: 'Internal server error', message: 'An unexpected error occurred' };
    }
  })

  /**
   * GET /v1/personality/batch/random
   * Get random personality elements for all types at once
   */
  .get('/batch/random', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { background } = query as { background?: string };

    try {
      const results: Record<string, any> = {};

      // Fetch random items for each type
      for (const type of VALID_TYPES) {
        const tableName = TABLE_MAP[type];

        let queryBuilder = supabase.from(tableName).select('*');

        // Add background filter if provided (only for traits table)
        if (background && typeof background === 'string' && tableName === 'personality_traits') {
          const validBackground = /^[a-zA-Z0-9_-]+$/.test(background);
          if (!validBackground) {
            set.status = 400;
            return {
              error: 'Invalid background parameter',
              message: 'Background must contain only alphanumeric characters, hyphens, and underscores',
            };
          }
          queryBuilder = queryBuilder.or(`background.eq.${background},background.is.null`);
        }

        const { data, error } = await queryBuilder;

        if (error) {
          logger.error({ msg: `Error fetching random ${type}`, error });
          set.status = 500;
          return { error: 'Database error', message: `Failed to fetch ${type}` };
        }

        if (data && data.length > 0) {
          const randomIndex = Math.floor(Math.random() * data.length);
          results[type] = data[randomIndex];
        }

        // For traits, get a second random trait
        if (type === 'traits' && data && data.length > 1) {
          let secondRandomIndex;
          const firstIndex = Math.floor(Math.random() * data.length);
          do {
            secondRandomIndex = Math.floor(Math.random() * data.length);
          } while (secondRandomIndex === firstIndex);

          results.traits2 = data[secondRandomIndex];
        }
      }

      return { success: true, data: results };
    } catch (e) {
      logger.error({ msg: 'Error in GET /personality/batch/random', error: e });
      set.status = 500;
      return { error: 'Internal server error', message: 'An unexpected error occurred' };
    }
  })

  /**
   * GET /v1/personality/:type
   * Get all personality elements of the specified type
   */
  .get('/:type', async ({ request, params, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { type } = params;
    const { background, limit = '100' } = query as { background?: string; limit?: string };

    // Validate type parameter
    if (!VALID_TYPES.includes(type as PersonalityType)) {
      set.status = 400;
      return {
        error: 'Invalid type parameter',
        message: 'Type must be one of: traits, ideals, bonds, flaws',
      };
    }

    const tableName = TABLE_MAP[type as PersonalityType];

    // SECURITY: Validate and bound limit parameter
    const limitRaw = parseInt(limit as string) || 100;
    const boundedLimit = Math.max(1, Math.min(limitRaw, 1000)); // Max 1000 results

    try {
      let queryBuilder = supabase.from(tableName).select('*').limit(boundedLimit);

      // Add background filter if provided (only for traits table)
      if (background && typeof background === 'string' && tableName === 'personality_traits') {
        queryBuilder = queryBuilder.eq('background', background);
      }

      const { data, error } = await queryBuilder;

      if (error) {
        logger.error({ msg: `Error fetching ${type}`, error });
        set.status = 500;
        return { error: 'Database error', message: `Failed to fetch ${type}` };
      }

      return { success: true, data: data || [] };
    } catch (e) {
      logger.error({ msg: `Error in GET /personality/${type}`, error: e });
      set.status = 500;
      return { error: 'Internal server error', message: 'An unexpected error occurred' };
    }
  });
