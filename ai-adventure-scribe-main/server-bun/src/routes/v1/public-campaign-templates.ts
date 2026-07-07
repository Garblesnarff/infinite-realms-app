import { Elysia } from 'elysia';

import { logger } from '../../lib/logger.js';
import { CampaignService } from '../../services/campaign-service.js';

export const publicCampaignTemplateRoutes = new Elysia({
  prefix: '/v1/public/campaign-templates',
}).get('/', async () => {
  try {
    const templates = await CampaignService.listPublicTemplates();
    return templates.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      genre: campaign.genre,
      tone: campaign.tone,
      campaign_length: campaign.campaignLength,
      difficulty_level: campaign.difficultyLevel,
      thumbnail_url: campaign.thumbnailUrl,
      template_version: campaign.templateVersion,
      published_at: campaign.publishedAt,
    }));
  } catch (error) {
    logger.error({ msg: 'PUBLIC_CAMPAIGN_TEMPLATES error', error });
    throw error;
  }
});
