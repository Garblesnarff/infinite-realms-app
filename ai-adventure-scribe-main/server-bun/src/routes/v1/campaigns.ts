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
 * Refactored to use CampaignService with proper ownership verification
 * and existence masking.
 */

import { Elysia, t, type Static } from 'elysia';

import { authenticateRequest, type AuthUser } from '../../lib/auth.js';
import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { planRateLimit } from '../../middleware/rate-limit.js';
import { CampaignService } from '../../services/campaign-service.js';

import type { Campaign } from '../../../../db/schema/index.js';

/**
 * Validation schemas for campaign requests
 */
const campaignBodySchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.Nullable(t.String())),
  genre: t.Optional(t.Nullable(t.String())),
  difficulty_level: t.Optional(t.Nullable(t.String())),
  campaign_length: t.Optional(t.Nullable(t.String())),
  tone: t.Optional(t.Nullable(t.String())),
  setting: t.Optional(t.Nullable(t.Object({
    era: t.Optional(t.Nullable(t.String())),
    location: t.Optional(t.Nullable(t.String())),
    atmosphere: t.Optional(t.Nullable(t.String())),
  }))),
  thematic_elements: t.Optional(t.Nullable(t.Any())),
  status: t.Optional(t.String()),
  background_image: t.Optional(t.Nullable(t.String())),
});

const updateCampaignBodySchema = t.Partial(campaignBodySchema);

type CampaignBody = Static<typeof campaignBodySchema>;
type UpdateCampaignBody = Static<typeof updateCampaignBodySchema>;

/**
 * Helper to map camelCase Campaign to snake_case for API compatibility
 */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const mapCampaignToApi = (campaign: Campaign) => ({
  id: campaign.id,
  user_id: campaign.userId,
  name: campaign.name,
  description: campaign.description,
  genre: campaign.genre,
  difficulty_level: campaign.difficultyLevel,
  campaign_length: campaign.campaignLength,
  tone: campaign.tone,
  era: campaign.era,
  location: campaign.location,
  atmosphere: campaign.atmosphere,
  setting_details: campaign.settingDetails,
  thematic_elements: campaign.thematicElements,
  status: campaign.status,
  background_image: campaign.backgroundImage,
  art_style: campaign.artStyle,
  style_config: campaign.styleConfig,
  rules_config: campaign.rulesConfig,
  created_at: campaign.createdAt,
  updated_at: campaign.updatedAt,
});

export const campaignsRoutes = new Elysia({ prefix: '/v1/campaigns' })
  /**
   * Centralized authentication and campaign ownership verification
   */
  .derive(async ({ request, params }) => {
    const { user, error: authError } = await authenticateRequest(request);

    let campaign = null;
    if (user && params?.id) {
      // 🛡️ Sentinel: Fetch campaign once in derive block to avoid double-fetching.
      // CampaignService.getById verifies ownership and masks existence.
      campaign = await CampaignService.getById(params.id, user.userId);
    }

    return { user, authError, campaign };
  })
  .onBeforeHandle(async ({ user, authError, params, campaign, set }) => {
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    if (params?.id && !campaign) {
      // 🛡️ Sentinel: Return 404 for unauthorized access to prevent existence leakage.
      set.status = 404;
      return { error: 'Campaign not found' };
    }
  })

  /**
   * GET /v1/campaigns
   * List all campaigns for the authenticated user
   */
  .use(planRateLimit('default'))
  .get('/', async ({ user }) => {
    try {
      const campaigns = await CampaignService.listForUser((user as AuthUser).userId);
      return campaigns.map(mapCampaignToApi);
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_LIST error', error: e });
      throw e;
    }
  })

  /**
   * POST /v1/campaigns
   * Create a new campaign
   */
  .post('/', async ({ body, set, user }) => {
    const payload = body as CampaignBody;

    try {
      const campaign = await CampaignService.create((user as AuthUser).userId, {
        name: payload.name,
        description: payload.description,
        genre: payload.genre,
        difficultyLevel: payload.difficulty_level,
        campaignLength: payload.campaign_length,
        tone: payload.tone,
        era: payload.setting?.era,
        location: payload.setting?.location,
        atmosphere: payload.setting?.atmosphere,
        settingDetails: payload.setting,
        thematicElements: payload.thematic_elements,
        status: payload.status,
        backgroundImage: payload.background_image,
      });

      set.status = 201;
      return mapCampaignToApi(campaign);
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_CREATE error', error: e });
      throw e;
    }
  }, {
    body: campaignBodySchema
  })

  /**
   * GET /v1/campaigns/:id
   * Get a single campaign by ID
   */
  .get('/:id', async ({ campaign }) => {
    // 🛡️ Sentinel: Already verified and fetched by derive/onBeforeHandle
    return mapCampaignToApi(campaign as Campaign);
  })

  /**
   * PUT /v1/campaigns/:id
   * Update a campaign
   */
  .put('/:id', async ({ params, body, user }) => {
    const payload = body as UpdateCampaignBody;

    try {
      const updated = await CampaignService.update(params.id, (user as AuthUser).userId, {
        name: payload.name,
        description: payload.description,
        genre: payload.genre,
        difficultyLevel: payload.difficulty_level,
        campaignLength: payload.campaign_length,
        tone: payload.tone,
        era: payload.setting?.era,
        location: payload.setting?.location,
        atmosphere: payload.setting?.atmosphere,
        settingDetails: payload.setting,
        thematicElements: payload.thematic_elements,
        status: payload.status,
        backgroundImage: payload.background_image,
      });

      return mapCampaignToApi(updated);
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_UPDATE error', error: e });
      if (e instanceof NotFoundError) {
        throw e;
      }
      throw e;
    }
  }, {
    body: updateCampaignBodySchema
  })

  /**
   * DELETE /v1/campaigns/:id
   * Delete a campaign
   */
  .delete('/:id', async ({ params, user }) => {
    try {
      await CampaignService.delete(params.id, (user as AuthUser).userId);
      return { ok: true };
    } catch (e) {
      logger.error({ msg: 'CAMPAIGNS_DELETE error', error: e });
      throw e;
    }
  });
