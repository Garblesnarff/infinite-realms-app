import { and, desc, eq, sql as drizzleSql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { db } from '../../../../db/client.js';
import {
  campaignChunks,
  campaignJournalEntries,
  gameSessions,
} from '../../../../db/schema/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { broadcastToRoom } from '../../services/collaboration/room-manager.js';
import { dmResponseSchema, parseDmResponse } from '../../services/dm/dm-response-schema.js';
import {
  applyDmHandoutActions,
  type AuthoredHandout,
  type JournalHandoutEntry,
} from '../../services/dm/handout-action-service.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';

const entryFromRow = (
  row: typeof campaignJournalEntries.$inferSelect,
  sessionNumber: number | null,
): JournalHandoutEntry => ({
  id: row.id,
  sessionId: row.sessionId,
  sessionNumber,
  mode: row.handoutMode as 'authored' | 'improvised',
  key: row.handoutKey,
  title: row.title,
  body: row.body,
  giver: row.giver || 'Unknown',
  assetPath: row.assetPath,
  createdAt: row.createdAt.toISOString(),
});

const authoredFromChunk = (metadata: unknown): AuthoredHandout | null => {
  if (!metadata || typeof metadata !== 'object') return null;
  const record = metadata as Record<string, unknown>;
  return typeof record.key === 'string' &&
    typeof record.title === 'string' &&
    typeof record.giver === 'string' &&
    typeof record.body === 'string'
    ? { key: record.key, title: record.title, giver: record.giver, body: record.body }
    : null;
};

const handoutResponseShell = (actions: unknown[]) => ({
  text: '',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: actions,
  combatants: [],
  combat_actions: [],
});

/** Session-owned handout delivery and campaign journal reads. */
export const handoutRoutes = new Elysia({ prefix: '/v1/sessions' })
  .use(requireAuth)
  .get('/:id/journal', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) {
      set.status = access.error!.status;
      return { error: access.error!.message };
    }
    if (!access.session?.campaignId) return { entries: [] };
    const rows = await db
      .select({ entry: campaignJournalEntries, sessionNumber: gameSessions.sessionNumber })
      .from(campaignJournalEntries)
      .innerJoin(gameSessions, eq(campaignJournalEntries.sessionId, gameSessions.id))
      .where(
        and(
          eq(campaignJournalEntries.campaignId, access.session.campaignId),
          eq(campaignJournalEntries.entryType, 'handout'),
        ),
      )
      .orderBy(desc(campaignJournalEntries.createdAt));
    return { entries: rows.map(({ entry, sessionNumber }) => entryFromRow(entry, sessionNumber)) };
  })
  .post(
    '/:id/handout-actions',
    async ({ params, body, user, set }) => {
      const access = await verifySessionOwnership(params.id, user.userId);
      if (!access.success) {
        set.status = access.error!.status;
        return { error: access.error!.message };
      }
      const session = access.session!;
      if (!session.campaignId) {
        set.status = 422;
        return { error: 'Handouts require a campaign-backed session' };
      }
      const parsed = parseDmResponse(handoutResponseShell(body.actions));
      if (!parsed.success) {
        set.status = 422;
        return { error: 'Invalid DM handout batch', issues: parsed.issues };
      }
      const canonCampaignId = session.starterCampaignId || session.campaignId;
      const chunks = async () =>
        db
          .select({ metadata: campaignChunks.metadata })
          .from(campaignChunks)
          .where(
            and(
              eq(campaignChunks.campaignId, canonCampaignId),
              eq(campaignChunks.chunkType, 'handout'),
            ),
          );
      const result = await applyDmHandoutActions(
        parsed.data.handout_actions,
        {
          sessionId: params.id,
          sessionNumber: session.sessionNumber,
          assetCampaignId: canonCampaignId,
          findAuthored: async (key) => {
            const [row] = await db
              .select({ metadata: campaignChunks.metadata })
              .from(campaignChunks)
              .where(
                and(
                  eq(campaignChunks.campaignId, canonCampaignId),
                  eq(campaignChunks.chunkType, 'handout'),
                  drizzleSql`${campaignChunks.metadata}->>'key' = ${key}`,
                ),
              )
              .limit(1);
            return authoredFromChunk(row?.metadata);
          },
          listAuthoredKeys: async () =>
            (await chunks())
              .map((row) => authoredFromChunk(row.metadata)?.key)
              .filter((key): key is string => Boolean(key)),
          persist: async (entry) => {
            const [created] = await db
              .insert(campaignJournalEntries)
              .values({
                campaignId: session.campaignId!,
                sessionId: params.id,
                entryType: 'handout',
                handoutMode: entry.mode,
                handoutKey: entry.key,
                title: entry.title,
                body: entry.body,
                giver: entry.giver,
                assetPath: entry.assetPath,
              })
              .returning();
            if (!created) throw new Error('Failed to persist handout delivery');
            return entryFromRow(created, session.sessionNumber);
          },
          broadcast: (entry) =>
            broadcastToRoom(params.id, null as never, {
              type: 'handout_delivered',
              entry,
              timestamp: Date.now(),
            }),
        },
        async (refusal) => {
          const prompt = `You are correcting one rejected handout delivery. Return a complete DM structured response with exactly one legal replacement in handout_actions and all other action arrays empty. Do not write prose. Authored keys must be one of the listed keys; use improvised only with key=null and a non-empty body.\n\n<rejection>${JSON.stringify(refusal)}</rejection>`;
          const response = await LLMProviderService.generate({
            prompt,
            maxTokens: 700,
            temperature: 0,
            responseSchema: dmResponseSchema,
          });
          if (response.error) return null;
          try {
            const correction = parseDmResponse(JSON.parse(response.text));
            return correction.success ? (correction.data.handout_actions[0] ?? null) : null;
          } catch {
            return null;
          }
        },
      );
      if (result.degraded.length) {
        broadcastToRoom(params.id, null as never, {
          type: 'handout_degraded',
          text: 'A promised document could not be delivered; the DM will correct it on the next turn.',
          reasons: result.degraded,
          timestamp: Date.now(),
        });
      }
      return result;
    },
    { body: t.Object({ actions: t.Array(t.Any()) }) },
  );
