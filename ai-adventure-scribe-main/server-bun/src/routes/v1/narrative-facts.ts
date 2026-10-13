import { Elysia, t } from 'elysia';

import { alert } from '../../lib/alerting.js';
import { requireAuth } from '../../middleware/auth.js';
import { NarrativeLedgerService } from '../../services/narrative/narrative-ledger-service.js';

import type { NarrativeFact } from '../../../../db/schema/index';

const subjectTypeSchema = t.Union([
  t.Literal('npc'),
  t.Literal('location'),
  t.Literal('item'),
  t.Literal('quest'),
  t.Literal('faction'),
  t.Literal('party'),
  t.Literal('world'),
  t.Literal('thread'),
]);

const mapFact = (fact: NarrativeFact) => ({
  id: fact.id,
  session_id: fact.sessionId,
  campaign_id: fact.campaignId,
  subject_type: fact.subjectType,
  subject_name: fact.subjectName,
  predicate: fact.predicate,
  value: fact.value,
  known_by: fact.knownBy,
  is_belief: fact.isBelief,
  source: fact.source,
  turn_index: fact.turnIndex,
  message_id: fact.messageId,
  needs_review: fact.needsReview,
  valid_from: fact.validFrom,
  invalidated_at: fact.invalidatedAt,
  invalidated_by: fact.invalidatedBy,
  created_at: fact.createdAt,
});

export type NarrativeFactService = Pick<
  typeof NarrativeLedgerService,
  'currentFacts' | 'renderSceneState' | 'history' | 'assertFact'
>;

export interface NarrativeFactRouteOptions {
  auth?: typeof requireAuth;
  ledger?: NarrativeFactService;
  alertFn?: typeof alert;
}

export function createNarrativeFactRoutes({
  auth = requireAuth,
  ledger = NarrativeLedgerService,
  alertFn = alert,
}: NarrativeFactRouteOptions = {}) {
  return new Elysia({ prefix: '/v1/narrative-facts' })
    .use(auth)
    .get(
      '/',
      async ({ query, user }) => {
        const facts = await ledger.currentFacts(query.session_id, user!.userId, {
          subjectType: query.subject_type,
          subjectName: query.subject_name,
          includeStaged: query.include_staged,
        });
        return facts.map(mapFact);
      },
      {
        query: t.Object({
          session_id: t.String(),
          subject_type: t.Optional(subjectTypeSchema),
          subject_name: t.Optional(t.String({ maxLength: 200 })),
          include_staged: t.Optional(t.Boolean()),
        }),
      },
    )
    .get(
      '/scene-state',
      // A ledger read that fails must degrade the turn's quality, not break the turn: the
      // caller treats a null block as "no ground truth to state" and still sends the prompt.
      // Degrading quietly is what v2 guardrail 3 forbids, though, so the failure pages
      // through alert() (#1680) before the null goes back.
      async ({ query, user }) => {
        try {
          return {
            scene_state: await ledger.renderSceneState(query.session_id, user!.userId, {
              audience: query.audience,
            }),
          };
        } catch (renderError) {
          alertFn('scene_state_render_failed', {
            sessionId: query.session_id,
            error: renderError instanceof Error ? renderError.message : String(renderError),
          });
          return { scene_state: null };
        }
      },
      {
        query: t.Object({
          session_id: t.String(),
          audience: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 10 })),
        }),
      },
    )
    .post(
      '/',
      async ({ body, user }) => {
        // Player-facing corrections only. The engine and the DM gateway write via
        // NarrativeLedgerService directly, so `source` is forced here rather than
        // accepted from the client - an HTTP caller cannot claim engine authority.
        const result = await ledger.assertFact(
          {
            sessionId: body.session_id,
            campaignId: body.campaign_id,
            subjectType: body.subject_type,
            subjectName: body.subject_name,
            predicate: body.predicate,
            value: body.value,
            knownBy: body.known_by,
            isBelief: body.is_belief,
            source: 'player_correction',
            turnIndex: body.turn_index,
            messageId: body.message_id,
          },
          user!.userId,
        );
        if (result.rejected) {
          return { rejected: true, action: result.action, reason: result.reason };
        }
        return { rejected: false, action: result.action, fact: mapFact(result.fact) };
      },
      {
        body: t.Object({
          session_id: t.String(),
          campaign_id: t.Optional(t.String()),
          subject_type: subjectTypeSchema,
          subject_name: t.String({ minLength: 1, maxLength: 200 }),
          predicate: t.String({ minLength: 1, maxLength: 200 }),
          value: t.Unknown(),
          known_by: t.Optional(t.Array(t.String({ maxLength: 64 }), { maxItems: 20 })),
          is_belief: t.Optional(t.Boolean()),
          turn_index: t.Optional(t.Number({ minimum: 0 })),
          message_id: t.Optional(t.String()),
        }),
      },
    );
}

export const narrativeFactRoutes = createNarrativeFactRoutes();
