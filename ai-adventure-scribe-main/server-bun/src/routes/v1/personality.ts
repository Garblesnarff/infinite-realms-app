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

import { Elysia } from 'elysia';

import { logger } from '../../lib/logger.js';
import { buildBackgroundOrFilter } from '../../lib/postgrest-filters.js';
import { supabase } from '../../lib/supabase.js';
import { authedUser } from '../../middleware/authed-user.js';
import { planRateLimit } from '../../middleware/rate-limit.js';

// Valid personality types
const VALID_TYPES = ['traits', 'ideals', 'bonds', 'flaws'] as const;
type PersonalityType = (typeof VALID_TYPES)[number];

/**
 * Interface for a single personality element row
 */
interface PersonalityRow {
  id: string;
  text?: string;
  ideal?: string;
  bond?: string;
  flaw?: string;
  background: string | null;
  source: string;
  alignment?: string;
  created_at: string;
}

// Map type to table name
const TABLE_MAP: Record<PersonalityType, string> = {
  traits: 'personality_traits',
  ideals: 'personality_ideals',
  bonds: 'personality_bonds',
  flaws: 'personality_flaws',
};

// ⚡ Bolt: Define explicit column lists for each table to avoid over-fetching and improve query performance.
const COLUMN_MAP: Record<PersonalityType, string> = {
  traits: 'id, text, background, source, created_at',
  ideals: 'id, ideal, background, alignment, source, created_at',
  bonds: 'id, bond, background, source, created_at',
  flaws: 'id, flaw, background, source, created_at',
};

export const personalityRoutes = new Elysia({ prefix: '/v1/personality' })

  /**
   * GET /v1/personality/random/:type
   * Get a random personality element of the specified type
   */
  .use(authedUser)
  .use(planRateLimit('default'))
  .get('/random/:type', async ({ params, query, set }) => {
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
    const backgroundFilter =
      background && tableName === 'personality_traits' ? buildBackgroundOrFilter(background) : null;

    if (background && tableName === 'personality_traits' && !backgroundFilter) {
      set.status = 400;
      return {
        error: 'Invalid background parameter',
        message: 'Background must contain only alphanumeric characters, hyphens, and underscores',
      };
    }

    try {
      // ⚡ Bolt: Optimized to use random offset pattern instead of fetching all rows.
      // This reduces data transfer from O(N) to O(1) for large personality tables.

      // 1. Get total count of matching rows (O(1) metadata operation)
      let countQuery = supabase.from(tableName).select('id', { count: 'exact', head: true });

      // Add background filter if provided (only for traits table)
      if (backgroundFilter) countQuery = countQuery.or(backgroundFilter);

      const { count, error: countError } = await countQuery;

      if (countError) {
        logger.error({ msg: `Error counting random ${type}`, error: countError });
        set.status = 500;
        return { error: 'Database error', message: `Failed to fetch ${type}` };
      }

      if (count === null || count === 0) {
        set.status = 404;
        return { error: 'No data found', message: `No ${type} found matching the criteria` };
      }

      // 2. Generate random offset and fetch exactly one row (O(1) bandwidth)
      const randomIndex = Math.floor(Math.random() * count);
      let dataQuery = supabase.from(tableName).select(COLUMN_MAP[type as PersonalityType]);

      // Re-apply filters to ensure random item belongs to the requested subset
      if (backgroundFilter) dataQuery = dataQuery.or(backgroundFilter);

      const { data, error } = await dataQuery.range(randomIndex, randomIndex).single();

      if (error) {
        logger.error({ msg: `Error fetching random ${type} at offset ${randomIndex}`, error });
        set.status = 500;
        return { error: 'Database error', message: `Failed to fetch ${type}` };
      }

      return { success: true, data };
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
  .get('/batch/random', async ({ query, set }) => {
    const { background } = query as { background?: string };
    const backgroundFilter = background ? buildBackgroundOrFilter(background) : null;

    if (background && !backgroundFilter) {
      set.status = 400;
      return {
        error: 'Invalid background parameter',
        message: 'Background must contain only alphanumeric characters, hyphens, and underscores',
      };
    }

    try {
      const results: Record<string, PersonalityRow> = {};

      // ⚡ Bolt: Optimized with random offset pattern across all types to avoid fetching all rows.
      // O(N) row fetch → O(1) targeted row fetch.

      // 1. Fetch counts for all types in parallel (metadata only)
      const countPromises = VALID_TYPES.map(async (type) => {
        const tableName = TABLE_MAP[type];
        let query = supabase.from(tableName).select('id', { count: 'exact', head: true });

        if (backgroundFilter && tableName === 'personality_traits') {
          query = query.or(backgroundFilter);
        }

        const { count, error } = await query;
        if (error) throw error;
        return { type, count: count ?? 0 };
      });

      const counts = await Promise.all(countPromises);

      // 2. Fetch targeted random rows in parallel
      const rowPromises = counts.map(async ({ type, count }) => {
        if (count === 0) return { type, data: null };

        const tableName = TABLE_MAP[type];
        const offset = Math.floor(Math.random() * count);

        let query = supabase.from(tableName).select(COLUMN_MAP[type]);

        // Re-apply filters to ensures random items belong to the requested subset
        if (backgroundFilter && tableName === 'personality_traits') {
          query = query.or(backgroundFilter);
        }

        const { data, error } = await query.range(offset, offset).single();

        if (error) throw error;

        // Special case: for traits, we want a second random trait
        if (type === 'traits' && count >= 2) {
          let offset2;
          do {
            offset2 = Math.floor(Math.random() * count);
          } while (offset2 === offset);

          // Build a fresh query for the second trait to ensure filter state is clean
          let query2 = supabase.from(tableName).select(COLUMN_MAP[type]);
          if (backgroundFilter) query2 = query2.or(backgroundFilter);

          const { data: data2, error: error2 } = await query2.range(offset2, offset2).single();

          if (error2) throw error2;
          return { type, data, data2 };
        }

        return { type, data };
      });

      const rowResponses = await Promise.all(rowPromises);

      rowResponses.forEach((res) => {
        if (res.data) {
          results[res.type] = res.data as unknown as PersonalityRow;
        }
        if (res.type === 'traits' && (res as any).data2) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (results as any).traits2 = (res as any).data2;
        }
      });

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
  .get('/:type', async ({ params, query, set }) => {
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
      // ⚡ Bolt: Optimized to use explicit columns instead of select('*') to reduce over-fetching.
      let queryBuilder = supabase
        .from(tableName)
        .select(COLUMN_MAP[type as PersonalityType])
        .limit(boundedLimit);

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
