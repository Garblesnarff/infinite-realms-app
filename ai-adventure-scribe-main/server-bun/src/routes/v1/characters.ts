/**
 * Character Routes for Elysia
 *
 * Provides character-related API endpoints:
 * - GET /v1/characters/:id/spells - Get character spells
 *
 * Ported from /server/src/routes/v1/characters.ts
 */

import { Elysia, t } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { sql } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';

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
