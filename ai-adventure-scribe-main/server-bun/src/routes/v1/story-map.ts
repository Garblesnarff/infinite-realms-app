import { Elysia, t } from 'elysia';

import { NotFoundError } from '../../lib/errors.js';
import { requireAuth } from '../../middleware/auth.js';
import { loadStoryMapPayload } from '../../services/story-map/story-map-service.js';

/**
 * GET /v1/story-map/:campaignId (#1753): the region map for one of the caller's campaigns —
 * known and visited places, usable routes between them, and the current place. Another
 * user's campaign (or no such campaign) is a 404, never the map. A player-made campaign
 * returns `available: false` with empty lists.
 */
export const storyMapRoutes = new Elysia({ prefix: '/v1/story-map' }).use(requireAuth).get(
  '/:campaignId',
  async ({ params, user }) => {
    const payload = await loadStoryMapPayload(params.campaignId, user!.userId);
    if (!payload) throw new NotFoundError('Campaign', params.campaignId);
    return payload;
  },
  { params: t.Object({ campaignId: t.String({ format: 'uuid' }) }) },
);
