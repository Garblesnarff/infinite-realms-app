import { and, desc, eq, sql as drizzleSql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { authoredFromChunk, entryFromRow } from './handout-route-helpers.js';
import { db } from '../../../../db/client.js';
import {
  campaignChunks,
  campaignJournalEntries,
  characters,
  gameSessions,
} from '../../../../db/schema/index.js';
import { requireAuth } from '../../middleware/auth.js';
import { broadcastToRoom } from '../../services/collaboration/room-manager.js';
import { dmResponseSchema, parseDmResponse } from '../../services/dm/dm-response-schema.js';
import { applyDmHandoutActions } from '../../services/dm/handout-action-service.js';
import { recordHandoutPossessionFact } from '../../services/dm/handout-ledger-service.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';

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
  .resolve({ as: 'scoped' }, async ({ user, params }) => {
    let access = null;
    if (user && params?.id) {
      access = await verifySessionOwnership(params.id, user.userId);
    }
    return { access };
  })
  .onBeforeHandle(async ({ params, access, set }) => {
    if (params?.id && (!access || !access.success)) {
      set.status = access?.error?.status || 404;
      return { error: access?.error?.message || 'Not found' };
    }
  })
  .get('/:id/journal', async ({ access }) => {
    const session = access!.session!;
    if (!session.campaignId) return { entries: [] };
    const rows = await db
      .select({
        entry: campaignJournalEntries,
        sessionNumber: gameSessions.sessionNumber,
        recipient: characters.name,
      })
      .from(campaignJournalEntries)
      .innerJoin(gameSessions, eq(campaignJournalEntries.sessionId, gameSessions.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(
        and(
          eq(campaignJournalEntries.campaignId, session.campaignId),
          eq(campaignJournalEntries.entryType, 'handout'),
        ),
      )
      .orderBy(desc(campaignJournalEntries.createdAt));
    return {
      entries: rows.map(({ entry, sessionNumber, recipient }) =>
        entryFromRow(entry, sessionNumber, recipient),
      ),
    };
  })
  .post(
    '/:id/handout-actions',
    async ({ params, body, access, set, user }) => {
      const session = access!.session!;
      if (!session.campaignId) {
        set.status = 422;
        return { error: 'Handouts require a campaign-backed session' };
      }
      const [recipient] = session.characterId
        ? await db
            .select({ name: characters.name })
            .from(characters)
            .where(eq(characters.id, session.characterId))
            .limit(1)
        : [];
      const recipientName = recipient?.name || null;
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
          recipient: recipientName,
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
            return entryFromRow(created, session.sessionNumber, recipientName);
          },
          recordFact: (entry) =>
            recordHandoutPossessionFact({
              entry,
              recipientName,
              sessionId: params.id,
              campaignId: session.campaignId,
              userId: user!.userId,
            }),
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
