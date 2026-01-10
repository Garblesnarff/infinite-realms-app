/**
 * Campaign Routes for Elysia
 *
 * Provides campaign CRUD endpoints:
 * - GET /v1/campaigns - List all campaigns
 * - POST /v1/campaigns - Create campaign
 * - GET /v1/campaigns/:id - Get single campaign
 * - PUT /v1/campaigns/:id - Update campaign
 * - DELETE /v1/campaigns/:id - Delete campaign
 *
 * Ported from /server/src/routes/v1/campaigns.ts
 */

import { Elysia, t } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { supabaseService } from '../../lib/supabase.js';
import { logger } from '../../lib/logger.js';

export const campaignsRoutes = new Elysia({ prefix: '/v1/campaigns' })

  /**
   * GET /v1/campaigns
   * List all campaigns for the authenticated user
   */
  .use(planRateLimit('default'))
  .get('/', async ({ request, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      // Only select minimal fields needed for campaign list view
      // Excludes heavy JSONB fields (setting_details, thematic_elements, style_config, rules_config)
      const { data, error } = await supabaseService
        .from('campaigns')
        .select(`
          id, name, description, genre,
          difficulty_level, campaign_length, tone,
          status, background_image, art_style,
          created_at, updated_at
        `)
        .eq('user_id', user.userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_LIST error', error: e });
      set.status = 500;
      return { error: 'Failed to fetch campaigns' };
    }
  })

  /**
   * POST /v1/campaigns
   * Create a new campaign
   */
  .post('/', async ({ request, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const {
      name,
      description,
      genre,
      difficulty_level,
      campaign_length,
      tone,
      setting,
      thematic_elements,
      status,
      background_image,
    } = body as any;

    try {
      const { data, error } = await supabaseService
        .from('campaigns')
        .insert({
          user_id: user.userId,
          name,
          description: description || null,
          genre: genre || null,
          difficulty_level: difficulty_level || null,
          campaign_length: campaign_length || null,
          tone: tone || null,
          era: setting?.era || null,
          location: setting?.location || null,
          atmosphere: setting?.atmosphere || null,
          setting_details: setting || null,
          thematic_elements: thematic_elements || null,
          status: status || 'active',
          background_image: background_image || null,
        })
        .select()
        .single();

      if (error) throw error;
      set.status = 201;
      return data;
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_CREATE error', error: e });
      set.status = 500;
      return { error: 'Failed to create campaign' };
    }
  })

  /**
   * GET /v1/campaigns/:id
   * Get a single campaign by ID
   */
  .get('/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { id } = params;

    try {
      const { data, error } = await supabaseService
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .eq('user_id', user.userId)
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

      return data;
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_GET error', error: e });
      set.status = 500;
      return { error: 'Failed to fetch campaign' };
    }
  })

  /**
   * PUT /v1/campaigns/:id
   * Update a campaign
   */
  .put('/:id', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { id } = params;
    const {
      name,
      description,
      genre,
      difficulty_level,
      campaign_length,
      tone,
      setting,
      thematic_elements,
      status,
      background_image,
    } = body as any;

    try {
      const { data, error } = await supabaseService
        .from('campaigns')
        .update({
          name,
          description: description || null,
          genre: genre || null,
          difficulty_level: difficulty_level || null,
          campaign_length: campaign_length || null,
          tone: tone || null,
          era: setting?.era || null,
          location: setting?.location || null,
          atmosphere: setting?.atmosphere || null,
          setting_details: setting || null,
          thematic_elements: thematic_elements || null,
          status: status || 'active',
          background_image: background_image || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('user_id', user.userId)
        .select()
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

      return data;
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_UPDATE error', error: e });
      set.status = 500;
      return { error: 'Failed to update campaign' };
    }
  })

  /**
   * DELETE /v1/campaigns/:id
   * Delete a campaign
   */
  .delete('/:id', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    const { id } = params;

    try {
      const { data, error } = await supabaseService
        .from('campaigns')
        .delete()
        .eq('id', id)
        .eq('user_id', user.userId)
        .select('id')
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

      return { ok: true };
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_DELETE error', error: e });
      set.status = 500;
      return { error: 'Failed to delete campaign' };
    }
  });
