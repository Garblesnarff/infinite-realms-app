import { Elysia, t } from 'elysia';
import { and, eq, exists, ilike, sql as drizzleSql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { campaigns, quests } from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';
import { sql } from '../../lib/db.js';
import { logger } from '../../lib/logger.js';
import { normalizeRows } from '../../lib/query-rows.js';
import { requireAuth } from '../../middleware/auth.js';
import { createSimpleRateLimit } from '../../middleware/rate-limit.js';
import { CampaignService } from '../../services/campaign-service.js';

const questBody = t.Object({
  campaign_id: t.String(),
  title: t.String(),
  description: t.Optional(t.Nullable(t.String())),
  quest_giver: t.Optional(t.Nullable(t.String())),
  objectives: t.Optional(t.Array(t.String())),
  rewards: t.Optional(t.Array(t.String())),
  status: t.Optional(t.String()),
  difficulty: t.Optional(t.Nullable(t.String())),
  quest_type: t.Optional(t.Nullable(t.String())),
  location_id: t.Optional(t.Nullable(t.String())),
  metadata: t.Optional(t.Any()),
});

const ownsCampaign = (campaignId: typeof quests.campaignId, userId: string) =>
  exists(
    db
      .select({ one: drizzleSql`1` })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId))),
  );

const mapQuest = (quest: typeof quests.$inferSelect) => ({
  id: quest.id,
  campaign_id: quest.campaignId,
  title: quest.title,
  description: quest.description,
  quest_giver: quest.questGiver,
  objectives: quest.objectives,
  rewards: quest.rewards,
  status: quest.status,
  difficulty: quest.difficulty,
  quest_type: quest.questType,
  location_id: quest.locationId,
  metadata: quest.metadata,
  created_at: quest.createdAt,
  updated_at: quest.updatedAt,
});

const publicStarterCharacterTemplateRoutes = new Elysia({
  name: 'public-starter-character-templates',
})
  // Starter templates are public, marketing-adjacent reference content used
  // before a player commits to a campaign. Keep abuse control route-scoped.
  .use(
    createSimpleRateLimit({
      windowMs: 60_000,
      max: 60,
      key: 'starter-character-templates:get',
    }),
  )
  .get('/starter-character-templates', async ({ query }) => {
    if (query.id) {
      const rows = await normalizeRows(
        sql`SELECT * FROM starter_character_templates WHERE id = ${query.id} LIMIT 1`,
      );
      const body = rows[0] ?? null;
      logger.info({
        templateId: query.id,
        rowCount: rows.length,
        bodyLength: JSON.stringify(body).length,
        msg: 'starter-template.return',
      });
      return body;
    }
    if (!query.campaign_id) {
      logger.info({ campaignId: null, rowCount: 0, bodyLength: 2, msg: 'starter-template.return' });
      return [];
    }
    const rows = await normalizeRows(
      sql`SELECT * FROM starter_character_templates WHERE starter_campaign_id = ${query.campaign_id} ORDER BY display_order`,
    );
    logger.info({
      campaignId: query.campaign_id,
      rowCount: rows.length,
      bodyLength: JSON.stringify(rows).length,
      msg: 'starter-template.return',
    });
    return rows;
  });

export const securedGameDataRoutes = new Elysia({ prefix: '/v1' })
  .use(publicStarterCharacterTemplateRoutes)
  .use(requireAuth)
  .get('/quests', async ({ query, user }) => {
    if (!query.campaign_id) return [];
    const rows = await db
      .select()
      .from(quests)
      .where(
        and(
          eq(quests.campaignId, query.campaign_id),
          query.status ? eq(quests.status, query.status) : undefined,
          ownsCampaign(quests.campaignId, user.userId),
        ),
      );
    return rows.map(mapQuest);
  })
  .post(
    '/quests',
    async ({ body, user, set }) => {
      try {
        await CampaignService.getById(body.campaign_id, user.userId);
      } catch (error) {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: 'Not found' };
        }
        throw error;
      }
      const [created] = await db
        .insert(quests)
        .values({
          campaignId: body.campaign_id,
          title: body.title,
          description: body.description,
          questGiver: body.quest_giver,
          objectives: body.objectives,
          rewards: body.rewards,
          status: body.status ?? 'available',
          difficulty: body.difficulty,
          questType: body.quest_type,
          locationId: body.location_id,
          metadata: body.metadata ?? {},
        })
        .returning();
      if (!created) throw new NotFoundError('Campaign', body.campaign_id);
      set.status = 201;
      return mapQuest(created);
    },
    { body: questBody },
  )
  .post(
    '/quests/upsert',
    async ({ body, user, set }) => {
      const [existing] = await db
        .select()
        .from(quests)
        .where(
          and(
            eq(quests.campaignId, body.campaign_id),
            ilike(quests.title, body.title),
            ownsCampaign(quests.campaignId, user.userId),
          ),
        )
        .limit(1);
      if (existing) {
        const [updated] = await db
          .update(quests)
          .set({
            description: body.description,
            status: body.status ?? existing.status,
            updatedAt: new Date(),
          })
          .where(and(eq(quests.id, existing.id), ownsCampaign(quests.campaignId, user.userId)))
          .returning();
        return mapQuest(updated!);
      }
      try {
        await CampaignService.getById(body.campaign_id, user.userId);
      } catch (error) {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: 'Not found' };
        }
        throw error;
      }
      const [created] = await db
        .insert(quests)
        .values({
          campaignId: body.campaign_id,
          title: body.title,
          description: body.description,
          status: body.status ?? 'active',
          questType: body.quest_type ?? 'side',
          metadata: body.metadata ?? {},
        })
        .returning();
      if (!created) throw new NotFoundError('Campaign', body.campaign_id);
      return mapQuest(created);
    },
    { body: questBody },
  )
  .get('/characters/:id/quest-progress', async ({ params, user }) => {
    return normalizeRows(
      sql`
        SELECT qp.status, qp.updated_at, json_build_object('title', q.title) AS quests
        FROM quest_progress qp
        INNER JOIN quests q ON q.id = qp.quest_id
        INNER JOIN characters ch ON ch.id = qp.character_id
        LEFT JOIN campaigns c ON c.id = q.campaign_id
        WHERE qp.character_id = ${params.id}
          AND (ch.user_id = ${user.userId} OR ch.owner_id = ${user.userId} OR c.user_id = ${user.userId})
        ORDER BY qp.updated_at DESC
      `,
    );
  });
