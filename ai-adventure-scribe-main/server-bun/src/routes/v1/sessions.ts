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

import { Elysia, t } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { supabaseService } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

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
          .single();

        if (campErr || !campaign || campaign.user_id !== user.userId) {
          set.status = 404;
          return { error: 'Campaign not found' };
        }
      }

      if (character_id) {
        const { data: character, error: charErr } = await supabaseService
          .from('characters')
          .select('user_id')
          .eq('id', character_id)
          .single();

        if (charErr || !character || character.user_id !== user.userId) {
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
      // Fetch session with related campaign and character to verify ownership
      const { data, error } = await supabaseService
        .from('game_sessions')
        .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id)')
        .eq('id', id)
        .single();

      if (error) {
        if ((error as any).code === 'PGRST116') {
          set.status = 404;
          return { error: 'Not found' };
        }
        throw error;
      }

      if (!data) {
        set.status = 404;
        return { error: 'Not found' };
      }

      // Verify ownership through campaign or character
      const campaignOwner = (data as any).campaigns?.user_id;
      const characterOwner = (data as any).characters?.user_id;

      if (campaignOwner !== user.userId && characterOwner !== user.userId) {
        set.status = 404;
        return { error: 'Not found' };
      }

      // Remove the joined data before returning
      const { campaigns, characters, ...session } = data as any;
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
      // First verify ownership
      const { data: sessionData, error: fetchError } = await supabaseService
        .from('game_sessions')
        .select('*, campaigns!game_sessions_campaign_id_fkey(user_id), characters!game_sessions_character_id_fkey(user_id)')
        .eq('id', id)
        .single();

      if (fetchError) {
        if ((fetchError as any).code === 'PGRST116') {
          set.status = 404;
          return { error: 'Not found' };
        }
        throw fetchError;
      }

      if (!sessionData) {
        set.status = 404;
        return { error: 'Not found' };
      }

      // Verify ownership through campaign or character
      const campaignOwner = (sessionData as any).campaigns?.user_id;
      const characterOwner = (sessionData as any).characters?.user_id;

      if (campaignOwner !== user.userId && characterOwner !== user.userId) {
        set.status = 404;
        return { error: 'Not found' };
      }

      // Now update the session
      const { data, error } = await supabaseService
        .from('game_sessions')
        .update({
          end_time: new Date().toISOString(),
          status: 'completed',
          summary: summary || null,
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      if (!data) {
        set.status = 404;
        return { error: 'Not found' };
      }

      return data;
    } catch (e) {
      logger.error({ msg: 'SESSION_COMPLETE error', error: e });
      set.status = 500;
      return { error: 'Failed to complete session' };
    }
  });
