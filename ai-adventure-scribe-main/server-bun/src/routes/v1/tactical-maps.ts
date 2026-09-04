/* eslint-disable max-lines */
import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { proposeAoECast, resolveAoECast } from '../../services/combat/aoe-cast-service.js';
import { CombatEncounterService } from '../../services/combat/combat-encounter-service.js';
import { concludeEncounter } from '../../services/combat/combat-ending.js';
import { executeCombatIntent } from '../../services/combat/combat-intent-service.js';
import { resolveSessionEntityId } from '../../services/combat/session-entity-index.js';
import {
  applyDmTacticalActions,
  applyTacticalMapAction,
  consumeDmTacticalCorrection,
  consumeDmTacticalFacts,
  noteEngineResolutions,
} from '../../services/combat/tactical-action-service.js';
import { destroyTacticalCombatMap } from '../../services/combat/tactical-combat-lifecycle.js';
import { loadActiveTacticalMap } from '../../services/combat/tactical-map-store.js';
import { buildTurnOrderBlock } from '../../services/combat/turn-order-block.js';
import { dmResponseSchema, parseDmResponse } from '../../services/dm/dm-response-schema.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';
import { checkLineOfSight, getCover, getDistance, getValidMoves } from '../../tactical/engine.js';
import { entitySlug, resolveEntityRef } from '../../tactical/identity.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';
import { buildStallDirective, shouldBreakStall } from '../../tactical/stall-breaker.js';

import type { MapAction } from '../../tactical/dispatch.js';

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
        const map = await activeMapLoader(params.id);
        // Facts are consumed BEFORE the no-map check, and the no-map case is no longer an
        // unconditional 404.
        //
        // The board is torn down the moment the fight resolves, and the fight's last event — the
        // killing blow, the character going down, the reason the encounter ended — is recorded
        // microseconds before that. Answering 404 here threw all of it away, which is the second
        // half of why no ending has ever been narrated: even once the facts survived the teardown,
        // the endpoint that delivers them refused to answer for a session with no board.
        const [correction, facts] = await Promise.all([
          consumeDmTacticalCorrection(params.id),
          consumeDmTacticalFacts(params.id),
        ]);
        if (!map && !facts.length && !correction) {
          set.status = 404;
          return { error: 'No active tactical map' };
        }
        if (!map) {
          // No board to describe, but something happened on the one that just went away.
          return {
            tacticalContext:
              (facts.length
                ? `<engine_resolved_outcomes>\n${facts.join('\n')}\n</engine_resolved_outcomes>`
                : '') +
              (correction
                ? `\n\n<previous_tactical_failure>${correction}</previous_tactical_failure>`
                : ''),
          };
        }
        // Silence is measured where the context is assembled, because the thing being counted is
        // turns on which the DM was handed nothing the engine had done.
        const silentTurns = await noteEngineResolutions(params.id, facts.length > 0);
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
            (stalled ? `\n\n${buildStallDirective(map, params.entityId, silentTurns)}` : ''),
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
        '/:id/tactical-map/action',
        async ({ params, body, user, set }) => {
          const access = await sessionOwnership(params.id, user.userId);
          if (!access.success) {
            set.status = access.error!.status;
            return { error: access.error!.message };
          }
          if (body.action === 'move' && body.entityId && body.x != null && body.y != null) {
            const encounter = await CombatEncounterService.getActiveEncounter(
              params.id,
              user.userId,
            );
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
          }
          const result = await applyTacticalMapAction(params.id, body as unknown as MapAction);
          if (
            !result.applied &&
            (result.refusal as { reason?: string }).reason === 'no_active_map'
          ) {
            set.status = 404;
            return { error: 'No active tactical map' };
          }
          if (!result.applied) {
            set.status = 422;
            return result;
          }
          return { result };
        },
        {
          body: t.Object({
            action: t.Union([
              t.Literal('move'),
              t.Literal('place'),
              t.Literal('remove'),
              t.Literal('update_cell'),
            ]),
            entityId: t.Optional(t.Nullable(t.String())),
            x: t.Optional(t.Nullable(t.Number())),
            y: t.Optional(t.Nullable(t.Number())),
            changes: t.Optional(t.Nullable(t.Record(t.String(), t.Any()))),
          }),
        },
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
        async ({ params, body, user, set }) => {
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
          };
          try {
            if (body.phase === 'resolve')
              return { delta: await resolveAoECast(params.id, request, user.userId) };
            const proposal = await proposeAoECast(params.id, request);
            if (proposal.autoConfirm)
              return { delta: await resolveAoECast(params.id, request, user.userId) };
            if (proposal.hostile) {
              await Bun.sleep(1500);
              return { delta: await resolveAoECast(params.id, request, user.userId) };
            }
            return proposal;
          } catch (error) {
            set.status = 422;
            return { error: error instanceof Error ? error.message : 'AoE cast refused' };
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
      .post('/:id/tactical-map/end', async ({ params, user, set }) => {
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
        await concludeEncounter(encounter.id, params.id, user.userId, 'dm_ended_scene');
        return { ok: true, encounterEnded: true };
      })
  );
}

export const tacticalMapRoutes = createTacticalMapRoutes();
