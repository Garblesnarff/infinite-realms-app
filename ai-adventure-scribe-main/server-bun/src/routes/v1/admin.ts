/**
 * Admin Routes for Elysia
 *
 * Provides admin-only system maintenance endpoints:
 * - POST /v1/admin/archive-sessions - Archive old game sessions
 * - POST /v1/admin/restore-session/:sessionId - Restore archived session
 * - GET /v1/admin/archive-statistics - Get archive statistics
 * - GET /v1/admin/archivable-sessions - List sessions eligible for archival
 *
 * Ported from /server/src/routes/v1/admin.ts
 *
 * @deprecated Session archive endpoints have no frontend callers as of 2026-07-08.
 */

import { Elysia, t } from 'elysia';

import { authenticateRequest } from '../../lib/auth.js';
import { logger } from '../../lib/logger.js';
import { supabaseService } from '../../lib/supabase.js';
import { isAdmin } from '../../middleware/admin.js';
import { planRateLimit } from '../../middleware/rate-limit.js';

export const adminRoutes = new Elysia({ prefix: '/v1/admin' })

  /**
   * POST /v1/admin/archive-sessions
   * Archive old game sessions to prevent database bloat
   */
  .use(planRateLimit('default'))
  .post('/archive-sessions', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isAdmin(user)) {
      set.status = 403;
      return { error: 'Admin access required' };
    }

    const { retentionDays = 90, dryRun = false } = body as {
      retentionDays?: number;
      dryRun?: boolean;
    };

    // Validate retention days
    if (typeof retentionDays !== 'number' || retentionDays < 30) {
      set.status = 400;
      return {
        error: 'Invalid retention period',
        message: 'Retention period must be a number and at least 30 days for safety',
      };
    }

    try {
      logger.info({ msg: 'Archive request', retentionDays, dryRun, userId: user.userId });

      // Call the database function to archive sessions
      const { data, error } = await supabaseService.rpc('archive_old_sessions', {
        retention_days: retentionDays,
        dry_run: dryRun,
      });

      if (error) {
        logger.error({ msg: 'Archive function error', error });
        throw error;
      }

      logger.info({ msg: 'Archive result', data });
      return data;
    } catch (e) {
      logger.error({ msg: 'Archive error', error: e });
      set.status = 500;
      return {
        error: 'Failed to archive sessions',
        message: 'An internal error occurred. Please check server logs.',
      };
    }
  }, {
    body: t.Optional(
      t.Object({
        retentionDays: t.Optional(t.Number({ minimum: 30, maximum: 3650 })),
        dryRun: t.Optional(t.Boolean()),
      }),
    ),
  })

  /**
   * POST /v1/admin/restore-session/:sessionId
   * Restore an archived session back to the main tables
   */
  .post('/restore-session/:sessionId', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isAdmin(user)) {
      set.status = 403;
      return { error: 'Admin access required' };
    }

    const { sessionId } = params;

    if (!sessionId) {
      set.status = 400;
      return { error: 'Missing session ID', message: 'Session ID is required' };
    }

    try {
      logger.info({ msg: 'Restore request', sessionId, userId: user.userId });

      // Call the database function to restore session
      const { data, error } = await supabaseService.rpc('restore_archived_session', {
        session_id_to_restore: sessionId,
      });

      if (error) {
        logger.error({ msg: 'Restore function error', error });
        throw error;
      }

      logger.info({ msg: 'Restore result', data });

      if (!data.success) {
        set.status = 404;
        return data;
      }

      return data;
    } catch (e) {
      logger.error({ msg: 'Restore error', error: e });
      set.status = 500;
      return {
        error: 'Failed to restore session',
        message: 'An internal error occurred. Please check server logs.',
      };
    }
  }, {
    params: t.Object({
      sessionId: t.String({ minLength: 1, maxLength: 100 }),
    }),
  })

  /**
   * GET /v1/admin/archive-statistics
   * Get statistics about archived vs active data
   */
  .get('/archive-statistics', async ({ request, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isAdmin(user)) {
      set.status = 403;
      return { error: 'Admin access required' };
    }

    try {
      logger.info({ msg: 'Statistics request', userId: user.userId });

      const { data, error } = await supabaseService
        .from('archive_statistics')
        .select('*');

      if (error) {
        logger.error({ msg: 'Statistics query error', error });
        throw error;
      }

      return { success: true, statistics: data };
    } catch (e) {
      logger.error({ msg: 'Statistics error', error: e });
      set.status = 500;
      return {
        error: 'Failed to fetch statistics',
        message: 'An internal error occurred. Please check server logs.',
      };
    }
  })

  /**
   * GET /v1/admin/archivable-sessions
   * Get list of sessions eligible for archival
   */
  .get('/archivable-sessions', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (!isAdmin(user)) {
      set.status = 403;
      return { error: 'Admin access required' };
    }

    try {
      // SECURITY: Validate and bound input parameters
      const retentionDays = Math.max(30, Math.min(parseInt(query.retentionDays as string) || 90, 3650));
      const limit = Math.max(1, Math.min(parseInt(query.limit as string) || 100, 1000));

      logger.info({ msg: 'Archivable sessions request', retentionDays, limit, userId: user.userId });

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const { data, error, count } = await supabaseService
        .from('game_sessions')
        .select('id, campaign_id, character_id, start_time, end_time, status, session_number', { count: 'exact' })
        .eq('status', 'completed')
        .not('end_time', 'is', null)
        .lt('end_time', cutoffDate.toISOString())
        .order('end_time', { ascending: true })
        .limit(limit);

      if (error) {
        logger.error({ msg: 'Archivable sessions query error', error });
        throw error;
      }

      return {
        success: true,
        sessions: data,
        count,
        cutoff_date: cutoffDate.toISOString(),
        retention_days: retentionDays,
      };
    } catch (e) {
      logger.error({ msg: 'Archivable sessions error', error: e });
      set.status = 500;
      return {
        error: 'Failed to fetch archivable sessions',
        message: 'An internal error occurred. Please check server logs.',
      };
    }
  }, {
    query: t.Object({
      retentionDays: t.Optional(t.String({ maxLength: 10 })),
      limit: t.Optional(t.String({ maxLength: 10 })),
    }),
  });
