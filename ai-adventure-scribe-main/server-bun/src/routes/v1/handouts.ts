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
import { planRateLimit } from '../../middleware/rate-limit.js';
import { broadcastToRoom } from '../../services/collaboration/room-manager.js';
import {
  prepareCorrectiveCall,
  type CorrectiveUsageService,
} from '../../services/dm/corrective-model-guard.js';
import { dmResponseSchema, parseDmResponse } from '../../services/dm/dm-response-schema.js';
import { applyDmHandoutActions } from '../../services/dm/handout-action-service.js';
import { recordHandoutPossessionFact } from '../../services/dm/handout-ledger-service.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';

/**
 * #841: one DM turn never legitimately carries more handout actions than
 * this. The bound stops oversized-batch abuse (an unbounded array costs a
 * parse and a refusal scan per element, and each refusal used to be able to
 * summon a model call).
 */
export const MAX_HANDOUT_ACTIONS_PER_REQUEST = 10;

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

export interface HandoutRouteOptions {
  auth?: typeof requireAuth;
  sessionOwnership?: typeof verifySessionOwnership;
  usageService?: CorrectiveUsageService;
}

/** Session-owned handout delivery and campaign journal reads. */
export function createHandoutRoutes({
  auth = requireAuth,
  sessionOwnership = verifySessionOwnership,
  usageService,
}: HandoutRouteOptions = {}) {
  return (
    new Elysia({ prefix: '/v1/sessions' })
      .use(auth)
      .resolve({ as: 'scoped' }, async ({ user, params }) => {
        let access = null;
        if (user && params?.id) {
          access = await sessionOwnership(params.id, user.userId);
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
        // A playthrough is one character in one campaign: every session of that character shares its
        // journal, and another character's handouts in the same campaign are not part of this story.
        const thisPlaythrough = session.characterId
          ? eq(gameSessions.characterId, session.characterId)
          : eq(campaignJournalEntries.sessionId, session.id);
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
              thisPlaythrough,
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
      // #841: the corrective reprompt below is a paid model call; rate-limit
      // this write in its own 'dm-actions' bucket, not the shared 'llm'
      // generate bucket, so action batches never 429 legit turns mid-combat.
      // The journal read above stays unlimited.
      .use(planRateLimit('dm-actions'))
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
              // #841: the correction is a paid model call. It runs only when
              // the refused action came from a DM reply this session owns
              // and the caller's llm_system quota is not exhausted; the
              // charge lands after a usable correction (#196). A denied gate
              // degrades the refusal with no provider call, like a failed
              // correction does today.
              const corrective = await prepareCorrectiveCall({
                usageService,
                userId: user!.userId,
                plan: user!.plan,
                sessionId: params.id,
                kind: 'handout',
                dmReplyId: body.dmReplyId ?? null,
                refusedHandoutKey: refusal.action.key,
              });
              if (!corrective.ok) return null;
              const prompt = `You are correcting one rejected handout delivery. Return a complete DM structured response with exactly one legal replacement in handout_actions and all other action arrays empty. Do not write prose. Authored keys must be one of the listed keys; use improvised only with key=null and a non-empty body.\n\n<rejection>${JSON.stringify(refusal)}</rejection>`;
              // The provider may fail (timeout, network): that is a refused
              // correction, not a 500 — earlier actions in the batch are
              // already persisted, and a charge only ever follows a usable
              // correction (#196).
              let response: Awaited<ReturnType<typeof LLMProviderService.generate>>;
              try {
                response = await LLMProviderService.generate({
                  prompt,
                  maxTokens: 700,
                  temperature: 0,
                  responseSchema: dmResponseSchema,
                });
              } catch {
                return null;
              }
              if (response.error) return null;
              try {
                const correction = parseDmResponse(JSON.parse(response.text));
                if (!correction.success) return null;
                const action = correction.data.handout_actions[0] ?? null;
                if (!action) return null;
                await corrective.recordUsage({
                  provider: response.provider,
                  model: response.model,
                  inputTokens: response.usage?.inputTokens,
                  outputTokens: response.usage?.outputTokens,
                });
                return action;
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
        {
          body: t.Object({
            actions: t.Array(t.Any(), { maxItems: MAX_HANDOUT_ACTIONS_PER_REQUEST }),
            // #841: the DM reply whose actions this batch corrects. The
            // corrective model call is bound to a reply the session owns.
            dmReplyId: t.Optional(t.String({ maxLength: 255 })),
          }),
        },
      )
  );
}

export const handoutRoutes = createHandoutRoutes();
