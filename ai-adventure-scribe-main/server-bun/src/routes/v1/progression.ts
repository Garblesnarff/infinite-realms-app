/**
 * Progression Routes (Elysia/Bun)
 *
 * REST endpoint for D&D 5E XP threshold data:
 * - GET /v1/progression/xp-table
 *
 * Ported from /server/src/routes/v1/progression.ts
 *
 * Award XP, get-progression, level-up, level-up-options, experience-history,
 * and milestone-level endpoints were removed in the 2026-07-22 dead-code
 * sweep (zero frontend/e2e/test callers). /xp-table is kept because
 * starter-template-http-contract.test.ts exercises it as an auth-boundary
 * regression check.
 */

import { Elysia } from 'elysia';

import { mapAppRouteError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { ProgressionService } from '../../services/progression-service.js';

function mapProgressionError(set: { status?: unknown }, error: unknown, fallbackMessage: string) {
  return mapAppRouteError(set, error, fallbackMessage, [404], 'Character not found', 500);
}

export const progressionRoutes = new Elysia({ prefix: '/v1/progression' })
  .use(requireAuth)

  /**
   * GET /v1/progression/xp-table
   * Get the D&D 5E XP threshold table
   */
  .get('/xp-table', async ({ set }) => {
    try {
      const xpTable = ProgressionService.getXPTable();
      return { xpTable };
    } catch (error) {
      logger.error({ msg: 'PROGRESSION_XPTABLE error', error });
      return mapProgressionError(set, error, 'Failed to get XP table');
    }
  });
