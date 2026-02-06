/**
 * Session Routes for Elysia
 *
 * Provides game session endpoints:
 * - POST /v1/sessions - Create game session
 * - GET /v1/sessions/:id - Get session
 * - POST /v1/sessions/:id/complete - Complete session
 *
 * Ported from /server/src/routes/v1/sessions.ts
 */

import { Elysia } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { sql } from '../../lib/db.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { supabaseService } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';
import { CharacterService } from '../../services/character-service.js';

export const sessionsRoutes = new Elysia({ prefix: '/v1/sessions' })

  /**
   * POST /v1/sessions
   * Create a new game session
   */
  .use(planRateLimit('default'))
  .post('/', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { campaign_id, character_id, session_number } = body as {
      campaign_id?: string;
      character_id?: string;
      session_number?: number;
    };

    try {
      // SECURITY: Verify user owns the campaign or character before creating session
      if (campaign_id) {
        const { data: campaign, error: campErr } = await supabaseService
          .from('campaigns')
          .select('user_id')
          .eq('id', campaign_id)
          .eq('user_id', user.userId)
          .single();

        if (campErr || !campaign) {
          set.status = 404;
          return { error: 'Campaign not found' };
        }
      }

      if (character_id) {
        const character = await CharacterService.getById(character_id, user.userId);
        if (!character) {
          set.status = 404;
          return { error: 'Character not found' };
        }
      }

      // Create session only after ownership verified
      const { data, error } = await supabaseService
        .from('game_sessions')
        .insert({
          campaign_id: campaign_id || null,
          character_id: character_id || null,
          session_number: session_number || 1,
          status: 'active',
          start_time: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;
      set.status = 201;
      return data;
    } catch (e) {
      logger.error({ msg: 'SESSION_CREATE error', error: e });
      set.status = 500;
      return { error: 'Failed to create session' };
    }
  })

  /**
   * GET /v1/sessions/:id
   * Get a session by ID (with ownership verification)
   */
  .get('/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { id } = params;

    try {
      const rows = await sql`
        SELECT gs.*
        FROM game_sessions gs
        LEFT JOIN campaigns c ON c.id = gs.campaign_id
        LEFT JOIN characters ch ON ch.id = gs.character_id
        WHERE gs.id = ${id}
          AND (
            c.user_id = ${user.userId}
            OR ch.user_id = ${user.userId}
            OR ch.owner_id = ${user.userId}
          )
        LIMIT 1
      `;

      const session = rows?.[0];
      if (!session) {
        set.status = 404;
        return { error: 'Not found' };
      }

      return session;
    } catch (e) {
      logger.error({ msg: 'SESSION_GET error', error: e });
      set.status = 500;
      return { error: 'Failed to fetch session' };
    }
  })

  /**
   * POST /v1/sessions/:id/complete
   * Mark a session as complete
   */
  .post('/:id/complete', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { id } = params;
    const { summary } = body as { summary?: string };

    try {
      const updated = await sql`
        UPDATE game_sessions gs
        SET
          end_time = NOW(),
          status = 'completed',
          summary = ${summary || null},
          updated_at = NOW()
        WHERE gs.id = ${id}
          AND EXISTS (
            SELECT 1
            FROM game_sessions own
            LEFT JOIN campaigns c ON c.id = own.campaign_id
            LEFT JOIN characters ch ON ch.id = own.character_id
            WHERE own.id = gs.id
              AND (
                c.user_id = ${user.userId}
                OR ch.user_id = ${user.userId}
                OR ch.owner_id = ${user.userId}
              )
          )
        RETURNING gs.*
      `;

      const session = updated?.[0];
      if (!session) {
        set.status = 404;
        return { error: 'Not found' };
      }

      return session;
    } catch (e) {
      logger.error({ msg: 'SESSION_COMPLETE error', error: e });
      set.status = 500;
      return { error: 'Failed to complete session' };
    }
  });
