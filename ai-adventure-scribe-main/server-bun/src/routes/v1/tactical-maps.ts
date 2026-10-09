/* eslint-disable max-lines */
import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { COMBAT_ACTION_ORIGINS } from './combat/intent-schema.js';
import { requestIdOf } from './combat/intents.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  proposeAoECast,
  resolveAoECast,
  type AoECastDelta,
} from '../../services/combat/aoe-cast-service.js';
import { CombatEncounterService } from '../../services/combat/combat-encounter-service.js';
import { concludeEncounter } from '../../services/combat/combat-ending.js';
import { executeCombatIntent } from '../../services/combat/combat-intent-service.js';
import {
  buildNarrationContract,
  sceneAnchorForActor,
} from '../../services/combat/narration-contract.js';
import { resolveSessionEntityId } from '../../services/combat/session-entity-index.js';
import {
  applyDmTacticalActions,
  consumeTacticalMapContext,
} from '../../services/combat/tactical-action-service.js';
import { destroyTacticalCombatMap } from '../../services/combat/tactical-combat-lifecycle.js';
import { loadActiveTacticalMap } from '../../services/combat/tactical-map-store.js';
import { buildTurnOrderBlock, getCurrentTurnInfo } from '../../services/combat/turn-order-block.js';
import { dmResponseSchema, parseDmResponse } from '../../services/dm/dm-response-schema.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';
import { checkLineOfSight, getCover, getDistance, getValidMoves } from '../../tactical/engine.js';
import { entitySlug, resolveEntityRef } from '../../tactical/identity.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';
import { buildStallDirective, shouldBreakStall } from '../../tactical/stall-breaker.js';

import type { DmFactAction, TacticalMap } from '../../tactical/types.js';

/**
 * The narration contract for #2236: engine-authoritative facts (whose turn it is, the
 * actions resolved this turn with counts and hit/miss, the scene anchor) that the DM's
 * narration must not exceed, plus the `<contract_json>` envelope the client post-check
 * validates the prose against.
 *
 * Emitted on every combat turn, not just turns where something resolved — run M4's
 * "It is not your turn yet" was written on a turn where the engine resolved nothing,
 * and the turn rule is what catches it. Skipped only when there is no turn to contract
 * over (no active encounter) and no resolved actions.
 */
async function buildNarrationContractBlock(params: {
  sessionId: string;
  userId: string;
  map: TacticalMap | null;
  actions: DmFactAction[];
}): Promise<string> {
  const turn = await getCurrentTurnInfo(params.sessionId, params.userId);
  if (!turn && params.actions.length === 0) return '';
  const sceneAnchor = params.map && turn ? sceneAnchorForActor(params.map, turn.slug) : null;
  return (
    '\n\n' +
    buildNarrationContract({
      currentTurn: turn
        ? { slug: turn.slug, label: turn.label, isPlayer: turn.isPlayer, round: turn.round }
        : null,
      actions: params.actions,
      sceneAnchor,
      sceneDescription: params.map?.sceneDescription ?? null,
    })
  );
}

/** Session-scoped tactical API; all writes delegate to the shared engine dispatcher. */
export interface TacticalMapRouteOptions {
  auth?: typeof requireAuth;
  sessionOwnership?: typeof verifySessionOwnership;
  activeMapLoader?: typeof loadActiveTacticalMap;
  dmTacticalActions?: typeof applyDmTacticalActions;
}

export function createTacticalMapRoutes({
  auth = requireAuth,
  sessionOwnership = verifySessionOwnership,
  activeMapLoader = loadActiveTacticalMap,
  dmTacticalActions = applyDmTacticalActions,
}: TacticalMapRouteOptions = {}) {
  return (
    new Elysia({ prefix: '/v1/sessions' })
      .use(auth)
      .get('/:id/tactical-map', async ({ params, user, set }) => {
        const access = await sessionOwnership(params.id, user.userId);
        if (!access.success) {
          set.status = access.error!.status;
          return { error: access.error!.message };
        }
        const map = await activeMapLoader(params.id);
        if (!map) {
          // An absent map is normal outside tactical combat, so this optional
          // read returns an empty result instead of an error response.
          return { map: null };
        }
        return map;
      })
      .get('/:id/tactical-map/valid-moves/:entityId', async ({ params, user, set }) => {
        const access = await sessionOwnership(params.id, user.userId);
        if (!access.success) {
          set.status = access.error!.status;
          return { error: access.error!.message };
        }
        const map = await activeMapLoader(params.id);
        if (!map) {
          set.status = 404;
          return { error: 'No active tactical map' };
        }
        const entity = resolveEntityRef(map.entities, params.entityId);
        return { entityId: params.entityId, moves: entity ? getValidMoves(map, entity.id) : [] };
      })
      .get('/:id/tactical-map/check/:fromId/:toId', async ({ params, user, set }) => {
        const access = await sessionOwnership(params.id, user.userId);
        if (!access.success) {
          set.status = access.error!.status;
          return { error: access.error!.message };
        }
        const map = await activeMapLoader(params.id);
        if (!map) {
          set.status = 404;
          return { error: 'No active tactical map' };
        }
        const from = resolveEntityRef(map.entities, params.fromId);
        const to = resolveEntityRef(map.entities, params.toId);
        if (!from || !to) {
          set.status = 404;
          return { error: 'Map entity not found' };
        }
        return {
          distanceFeet: getDistance(from, to),
          hasLineOfSight: checkLineOfSight(map, from.id, to.id),
          cover: getCover(map, from.id, to.id),
        };
      })
      .get('/:id/tactical-map/context/:entityId', async ({ params, user, set }) => {
        const access = await sessionOwnership(params.id, user.userId);
        if (!access.success) {
          set.status = access.error!.status;
          return { error: access.error!.message };
        }
        const { map, correction, facts, actions, silentTurns } = await consumeTacticalMapContext(
          params.id,
        );
        if (!map && !facts.length && !correction && !actions.length) {
          set.status = 404;
          return { error: 'No active tactical map' };
        }
        if (!map) {
          // No board to describe, but something happened on the one that just went away.
          const contract = await buildNarrationContractBlock({
            sessionId: params.id,
            userId: user.userId,
            map: null,
            actions,
          });
          return {
            tacticalContext:
              (facts.length
                ? `<engine_resolved_outcomes>\n${facts.join('\n')}\n</engine_resolved_outcomes>`
                : '') +
              (correction
                ? `\n\n<previous_tactical_failure>${correction}</previous_tactical_failure>`
                : '') +
              contract,
          };
        }
        const stalled = shouldBreakStall(silentTurns);
        if (stalled) {
          // The id and the slug are both recorded: the log is read against DM transcripts, which
          // only ever contain slugs, so an id-only line cannot be matched to the turn it describes.
          const active = resolveEntityRef(map.entities, params.entityId);
          logger.warn({
            msg: 'DM_COMBAT_STALL_DIRECTIVE',
            alert: true,
            sessionId: params.id,
            silentTurns,
            activeEntityId: params.entityId,
            activeEntitySlug: active ? entitySlug(active) : null,
          });
        }
        return {
          tacticalContext:
            buildTacticalPrompt(map, params.entityId) +
            // Standing state, every turn, not just on the turn it changed. A fact is a one-shot
            // announcement; this is the answer to "is my character dying right now?", which the DM
            // needs on every turn a character spends on the floor and not merely on the turn they
            // hit it.
            (await buildTurnOrderBlock(params.id, user.userId)) +
            // Engine-resolved outcomes come before failures: they are what actually happened last
            // turn, and the DM must narrate them rather than the strike it originally declared.
            (facts.length
              ? `\n\n<engine_resolved_outcomes>\n${facts.join('\n')}\n</engine_resolved_outcomes>`
              : '') +
            (correction
              ? `\n\n<previous_tactical_failure>${correction}</previous_tactical_failure>`
              : '') +
            (stalled ? `\n\n${buildStallDirective(map, params.entityId, silentTurns)}` : '') +
            // The narration contract: engine-authoritative facts the DM must not exceed
            // (whose turn, resolved actions with counts and hit/miss, scene anchor).
            // The client post-check validates the prose against its <contract_json>.
            (await buildNarrationContractBlock({
              sessionId: params.id,
              userId: user.userId,
              map,
              actions,
            })),
        };
      })
      .post(
        '/:id/tactical-map/move',
        async ({ params, body, user, set }) => {
          const access = await sessionOwnership(params.id, user.userId);
          if (!access.success) {
            set.status = access.error!.status;
            return { error: access.error!.message };
          }
          const encounter = await CombatEncounterService.getActiveEncounter(params.id, user.userId);
          if (!encounter) {
            set.status = 404;
            return { error: 'No active combat encounter' };
          }
          try {
            const actorId = await resolveSessionEntityId(params.id, body.entityId);
            const result = await executeCombatIntent(
              encounter.id,
              { type: 'move', actorId, x: body.x, y: body.y },
              user.userId,
              'player',
            );
            return { result };
          } catch (error) {
            set.status = 422;
            return { error: error instanceof Error ? error.message : 'Movement refused' };
          }
        },
        { body: t.Object({ entityId: t.String(), x: t.Number(), y: t.Number() }) },
      )
      .post(
        '/:id/tactical-map/dm-actions',
        async ({ params, body, user, set }) => {
          const access = await sessionOwnership(params.id, user.userId);
          if (!access.success) {
            set.status = access.error!.status;
            return { error: access.error!.message };
          }
          // Every array the canonical parser validates must be present: a missing one (this
          // endpoint omitted `handout_actions`) rejected every DM map-action batch with a 422.
          const parsed = parseDmResponse({
            text: '',
            map_actions: body.actions,
            narration_segments: [],
            roll_requests: [],
            combat_transition: 'none',
            scene_spec: null,
            combatants: [],
            combat_actions: [],
            handout_actions: [],
          });
          if (!parsed.success) {
            set.status = 422;
            return { error: 'Invalid DM map action batch', issues: parsed.issues };
          }
          const applied = await dmTacticalActions(
            params.id,
            parsed.data.map_actions,
            async (refusal) => {
              const prompt = `You are correcting one rejected tactical map action. Return a complete DM structured response with ONLY one legal replacement in map_actions and all other arrays empty. Do not write prose. If the rejection lists current entities, copy one of those entityId values verbatim.\n\n<rejection>${JSON.stringify(refusal)}</rejection>`;
              const response = await LLMProviderService.generate({
                prompt,
                maxTokens: 700,
                temperature: 0,
                responseSchema: dmResponseSchema,
              });
              if (response.error) return null;
              try {
                const correction = parseDmResponse(JSON.parse(response.text));
                return correction.success ? (correction.data.map_actions[0] ?? null) : null;
              } catch {
                return null;
              }
            },
          );
          return applied;
        },
        { body: t.Object({ actions: t.Array(t.Any()) }) },
      )
      .post(
        '/:id/tactical-map/aoe-cast',
        async (context) => {
          const { params, body, user, set, request: httpRequest } = context;
          const access = await sessionOwnership(params.id, user.userId);
          if (!access.success) {
            set.status = access.error!.status;
            return { error: access.error!.message };
          }
          const request = {
            actorId: body.actorId,
            spellId: body.spellId,
            origin: body.origin,
            direction: body.direction,
            slotLevel: body.slotLevel,
            ...(body.actionOrigin ? { actionOrigin: body.actionOrigin } : {}),
          };
          const resolved = async (): Promise<{ delta: AoECastDelta; result: unknown }> => {
            const { delta, engineResult } = await resolveAoECast(params.id, request, user.userId);
            return { delta, result: engineResult };
          };
          try {
            if (body.phase === 'resolve') return await resolved();
            const proposal = await proposeAoECast(params.id, request);
            if (proposal.autoConfirm) return await resolved();
            if (proposal.hostile) {
              await Bun.sleep(1500);
              return await resolved();
            }
            return proposal;
          } catch (error) {
            // The reason used to live only in the response body, and nginx does not log bodies:
            // #2304's refusal had to be recovered from a 53-byte length.
            const message = error instanceof Error ? error.message : 'AoE cast refused';
            const details = error instanceof AppError ? error.details : undefined;
            logger.warn(
              {
                event: 'AOE_CAST_REFUSED',
                requestId: requestIdOf(context, httpRequest),
                sessionId: params.id,
                actorId: request.actorId,
                spellId: request.spellId,
                slotLevel: request.slotLevel,
                actionOrigin: request.actionOrigin ?? 'unmarked',
                phase: body.phase,
                err: message,
                reason: (details as { reason?: string } | undefined)?.reason,
                details,
              },
              'AOE_CAST_REFUSED',
            );
            if (error instanceof AppError && error.statusCode >= 500) {
              set.status = 500;
              return { error: 'AoE cast failed' };
            }
            set.status = error instanceof AppError ? error.statusCode : 422;
            return { error: message, ...(details ? { details } : {}) };
          }
        },
        {
          body: t.Object({
            phase: t.Union([t.Literal('propose'), t.Literal('resolve')]),
            actorId: t.String(),
            spellId: t.String(),
            origin: t.Object({ x: t.Number(), y: t.Number() }),
            direction: t.Nullable(t.Object({ x: t.Number(), y: t.Number() })),
            slotLevel: t.Nullable(t.Number({ minimum: 1, maximum: 9 })),
            actionOrigin: t.Optional(
              t.Union(COMBAT_ACTION_ORIGINS.map((origin) => t.Literal(origin))),
            ),
          }),
        },
      )
      /**
       * The DM's `combat_transition: "end"` lands here, and it must end the whole encounter.
       *
       * It used to destroy only the map. That asymmetry is what run 9's "four restarts" actually
       * were: `enter` creates an encounter AND a map, `end` removed the map and left the encounter
       * active forever, and the entry gate then correctly refused every subsequent entry as a
       * no-op.
       * The result was combat with a live encounter and no board: `getMap()` 404s, no digest
       * reaches the prompt, nothing can resolve, and each end/entry cycle reads as a restart. The
       * gate was never the bug; this endpoint's half-transition was.
       *
       * It then remained the one ending that recorded nothing. This is the path a DM reaches when
       * it decides a scene is over, and in run 18 it closed a fight whose monster was standing at
       * 2 of 11 hit points: no reason on the row, no `combat_ended`, and no sentence in the DM's
       * next context — so the following encounter opened as if nothing had happened. It now goes
       * through `concludeEncounter` like every other ending, and the reason it names says
       * truthfully that combatants were still up.
       */
      .post(
        '/:id/tactical-map/end',
        async ({ params, user, set, body }) => {
          const access = await sessionOwnership(params.id, user.userId);
          if (!access.success) {
            set.status = access.error!.status;
            return { error: access.error!.message };
          }
          const encounter = await CombatEncounterService.getActiveEncounter(params.id, user.userId);
          // No encounter to conclude means the map is the only thing left to remove. With one, the
          // teardown belongs to `concludeEncounter` — which must write the DM's fact onto the board
          // before destroying it.
          if (!encounter) {
            await destroyTacticalCombatMap(params.id);
            return { ok: true, encounterEnded: false };
          }
          const concluded = await concludeEncounter(
            encounter.id,
            params.id,
            user.userId,
            'dm_ended_scene',
            {
              exits: body?.combat_exits,
            },
          );
          if (!concluded) {
            // #2524: a hostile is still standing and no fled/surrendered/withdrew exit
            // accounts for it. Combat stays active; the engine notice is already on
            // the DM's next context saying why.
            set.status = 409;
            return { error: 'combat_end_refused_live_hostiles', encounterEnded: false };
          }
          return { ok: true, encounterEnded: true };
        },
        {
          body: t.Optional(
            t.Object({
              combat_exits: t.Optional(
                t.Array(
                  t.Object({
                    participant_id: t.String(),
                    exit: t.Union([
                      t.Literal('fled'),
                      t.Literal('surrendered'),
                      t.Literal('withdrew'),
                    ]),
                  }),
                ),
              ),
            }),
          ),
        },
      )
  );
}

export const tacticalMapRoutes = createTacticalMapRoutes();
