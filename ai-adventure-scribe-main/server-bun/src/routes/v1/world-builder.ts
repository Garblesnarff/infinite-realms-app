import { and, eq, ilike } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { db } from '../../../../db/client';
import { locations, npcs, quests } from '../../../../db/schema/index';
import { requireAuth } from '../../middleware/auth.js';
import { CampaignService } from '../../services/campaign-service.js';

const campaignQuery = t.Object({ campaign_id: t.String() });
const elementQuery = t.Object({
  campaign_id: t.String(),
  name: t.Optional(t.String()),
});

const npcBody = t.Object({
  campaign_id: t.String(),
  name: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.Nullable(t.String())),
  race: t.Optional(t.Nullable(t.String())),
  occupation: t.Optional(t.Nullable(t.String())),
  personality: t.Optional(t.Nullable(t.String())),
  backstory: t.Optional(t.Nullable(t.String())),
  relationship: t.Optional(t.Nullable(t.String())),
  location: t.Optional(t.Nullable(t.String())),
  image_url: t.Optional(t.Nullable(t.String())),
  voice_id: t.Optional(t.Nullable(t.String())),
  stats: t.Optional(t.Nullable(t.Any())),
});

const locationBody = t.Object({
  campaign_id: t.String(),
  name: t.String({ minLength: 1, maxLength: 255 }),
  description: t.Optional(t.Nullable(t.String())),
  location_type: t.Optional(t.Nullable(t.String())),
  metadata: t.Optional(t.Nullable(t.Any())),
  generated_by: t.Optional(t.Nullable(t.String())),
});

const mapNpc = (npc: typeof npcs.$inferSelect) => ({
  id: npc.id,
  campaign_id: npc.campaignId,
  name: npc.name,
  description: npc.description,
  race: npc.race,
  occupation: npc.occupation,
  personality: npc.personality,
  backstory: npc.backstory,
  relationship: npc.relationship,
  location: npc.location,
  image_url: npc.imageUrl,
  voice_id: npc.voiceId,
  stats: npc.stats,
  created_at: npc.createdAt,
  updated_at: npc.updatedAt,
});

const mapLocation = (location: typeof locations.$inferSelect) => ({
  id: location.id,
  campaign_id: location.campaignId,
  name: location.name,
  description: location.description,
  location_type: location.locationType,
  population: location.population,
  climate: location.climate,
  terrain: location.terrain,
  notable_features: location.notableFeatures,
  connected_locations: location.connectedLocations,
  image_url: location.imageUrl,
  map_url: location.mapUrl,
  metadata: location.metadata,
  created_at: location.createdAt,
  updated_at: location.updatedAt,
});

const ownedCampaign = async (campaignId: string, userId: string) =>
  CampaignService.getById(campaignId, userId);

const notFound = (set: { status?: number | string }) => {
  set.status = 404;
  return { error: 'Not found' };
};

export const worldBuilderRoutes = new Elysia({ prefix: '/v1/world-builder' })
  .use(requireAuth)
  .get(
    '/stats',
    async ({ query, user, set }) => {
      if (!(await ownedCampaign(query.campaign_id, user.userId))) return notFound(set);

      const [locationRows, npcRows, questRows] = await Promise.all([
        db
          .select({ id: locations.id })
          .from(locations)
          .where(eq(locations.campaignId, query.campaign_id)),
        db.select({ id: npcs.id }).from(npcs).where(eq(npcs.campaignId, query.campaign_id)),
        db.select({ id: quests.id }).from(quests).where(eq(quests.campaignId, query.campaign_id)),
      ]);

      return {
        locations: locationRows.length,
        npcs: npcRows.length,
        quests: questRows.length,
        totalElements: locationRows.length + npcRows.length + questRows.length,
      };
    },
    { query: campaignQuery },
  )
  .get(
    '/npcs',
    async ({ query, user, set }) => {
      if (!(await ownedCampaign(query.campaign_id, user.userId))) return notFound(set);

      const rows = await db
        .select()
        .from(npcs)
        .where(
          and(
            eq(npcs.campaignId, query.campaign_id),
            query.name ? ilike(npcs.name, query.name) : undefined,
          ),
        )
        .limit(1);
      return rows.map(mapNpc);
    },
    { query: elementQuery },
  )
  .get(
    '/locations',
    async ({ query, user, set }) => {
      if (!(await ownedCampaign(query.campaign_id, user.userId))) return notFound(set);

      const rows = await db
        .select()
        .from(locations)
        .where(
          and(
            eq(locations.campaignId, query.campaign_id),
            query.name ? ilike(locations.name, query.name) : undefined,
          ),
        )
        .limit(1);
      return rows.map(mapLocation);
    },
    { query: elementQuery },
  )
  .post(
    '/npcs',
    async ({ body, user, set }) => {
      if (!(await ownedCampaign(body.campaign_id, user.userId))) return notFound(set);

      const [created] = await db
        .insert(npcs)
        .values({
          campaignId: body.campaign_id,
          name: body.name,
          description: body.description,
          race: body.race,
          occupation: body.occupation,
          personality: body.personality,
          backstory: body.backstory,
          relationship: body.relationship,
          location: body.location,
          imageUrl: body.image_url,
          voiceId: body.voice_id,
          stats: body.stats,
        })
        .returning();
      if (!created) return notFound(set);
      set.status = 201;
      return mapNpc(created);
    },
    { body: npcBody },
  )
  .post(
    '/locations',
    async ({ body, user, set }) => {
      if (!(await ownedCampaign(body.campaign_id, user.userId))) return notFound(set);

      const metadata =
        body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
          ? { ...(body.metadata as Record<string, unknown>) }
          : {};
      if (body.generated_by) metadata.generated_by = body.generated_by;

      const [created] = await db
        .insert(locations)
        .values({
          campaignId: body.campaign_id,
          name: body.name,
          description: body.description,
          locationType: body.location_type,
          metadata,
        })
        .returning();
      if (!created) return notFound(set);
      set.status = 201;
      return mapLocation(created);
    },
    { body: locationBody },
  );
