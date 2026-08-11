import { Elysia, t } from 'elysia';

import { requireAuth } from '../../middleware/auth.js';
import { MemoryService } from '../../services/memory-service.js';

import type { Memory } from '../../../../db/schema/index';

const ALLOWED_MEMORY_TYPES = [
  'general',
  'npc',
  'location',
  'quest',
  'item',
  'event',
  'story_beat',
  'character_moment',
  'world_detail',
  'dialogue_gem',
  'atmosphere',
  'plot_point',
  'foreshadowing',
] as const;

const isAllowedMemoryType = (value: string) =>
  ALLOWED_MEMORY_TYPES.includes(value as (typeof ALLOWED_MEMORY_TYPES)[number]);

const memorySchema = t.Object({
  id: t.Optional(t.String()),
  campaign_id: t.Optional(t.String()),
  session_id: t.Optional(t.String()),
  type: t.Optional(t.String({ maxLength: 64 })),
  memory_type: t.Optional(t.String({ maxLength: 64 })),
  subcategory: t.Optional(t.String({ maxLength: 64 })),
  content: t.String({ minLength: 1, maxLength: 100_000 }),
  importance: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
  narrative_weight: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
  context: t.Optional(t.Unknown()),
  metadata: t.Optional(t.Unknown()),
  embedding: t.Optional(t.Nullable(t.String())),
  emotional_tone: t.Optional(t.Nullable(t.String())),
  story_arc: t.Optional(t.Nullable(t.String())),
  prose_quality: t.Optional(t.Boolean()),
  chapter_marker: t.Optional(t.Boolean()),
});

const mapMemory = (memory: Memory) => ({
  id: memory.id,
  campaign_id: memory.campaignId,
  session_id: memory.sessionId,
  type: memory.type,
  memory_type: memory.memoryType,
  subcategory: memory.subcategory,
  content: memory.content,
  importance: memory.importance,
  narrative_weight: memory.narrativeWeight,
  context: memory.context,
  metadata: memory.metadata,
  embedding: memory.embedding,
  emotional_tone: memory.emotionalTone,
  story_arc: memory.storyArc,
  prose_quality: memory.proseQuality,
  chapter_marker: memory.chapterMarker,
  created_at: memory.createdAt,
  updated_at: memory.updatedAt,
});

export const memoryRoutes = new Elysia({ prefix: '/v1/memories' })
  .use(requireAuth)
  .get(
    '/',
    async ({ query, user }) => {
      const recentSince = query.recent_minutes
        ? new Date(Date.now() - query.recent_minutes * 60_000)
        : undefined;
      const memories = await MemoryService.list(query.session_id, user!.userId, {
        limit: query.limit,
        category: query.category,
        recentSince,
        minNarrativeWeight: query.min_narrative_weight,
        top: query.top,
      });
      return memories.map(mapMemory);
    },
    {
      query: t.Object({
        session_id: t.String(),
        limit: t.Optional(t.Number({ minimum: 1, maximum: 200 })),
        category: t.Optional(t.String()),
        recent_minutes: t.Optional(t.Number({ minimum: 1, maximum: 10_080 })),
        min_narrative_weight: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        top: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    '/',
    async ({ body, user, set }) => {
      const payload = Array.isArray(body) ? body : [body];
      const invalidType = payload
        .map((memory) => memory.type)
        .find((value) => value !== undefined && !isAllowedMemoryType(value));

      if (invalidType) {
        set.status = 422;
        return {
          error: 'Invalid memory type',
          reason: `type must be one of ${ALLOWED_MEMORY_TYPES.join(', ')}; received "${invalidType}"`,
        };
      }

      const inserted = await MemoryService.insert(
        payload.map((memory) => ({
          id: memory.id,
          campaignId: memory.campaign_id,
          sessionId: memory.session_id,
          type: memory.type,
          memoryType: memory.memory_type,
          subcategory: memory.subcategory,
          content: memory.content,
          importance: memory.importance,
          narrativeWeight: memory.narrative_weight,
          context: memory.context,
          metadata: memory.metadata,
          embedding: memory.embedding,
          emotionalTone: memory.emotional_tone,
          storyArc: memory.story_arc,
          proseQuality: memory.prose_quality,
          chapterMarker: memory.chapter_marker,
        })),
        user!.userId,
      );
      return inserted.map(mapMemory);
    },
    {
      body: t.Union([memorySchema, t.Array(memorySchema, { minItems: 1, maxItems: 50 })]),
    },
  )
  .get('/:id', async ({ params, user }) =>
    mapMemory(await MemoryService.getById(params.id, user!.userId)),
  )
  .patch(
    '/:id',
    async ({ params, body, user }) => {
      await MemoryService.updateContent(params.id, user!.userId, body.content);
      return { ok: true };
    },
    { body: t.Object({ content: t.String({ minLength: 1, maxLength: 100_000 }) }) },
  )
  .patch(
    '/:id/scores',
    async ({ params, body, user }) => {
      await MemoryService.updateScores(params.id, user!.userId, {
        importance: body.importance,
        narrativeWeight: body.narrative_weight,
      });
      return { ok: true };
    },
    {
      body: t.Object({
        importance: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
        narrative_weight: t.Optional(t.Number({ minimum: 1, maximum: 10 })),
      }),
    },
  )
  .post(
    '/match',
    async ({ body, user }) =>
      MemoryService.match(
        body.session_id,
        user!.userId,
        body.embedding,
        body.limit,
        body.threshold,
      ),
    {
      body: t.Object({
        session_id: t.String(),
        embedding: t.String({ minLength: 2, maxLength: 50_000 }),
        limit: t.Number({ minimum: 1, maximum: 100 }),
        threshold: t.Number({ minimum: 0, maximum: 1 }),
      }),
    },
  );
