/* eslint-disable max-lines */
import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { requireAuth } from '../../middleware/auth.js';
import { proposeAoECast, resolveAoECast } from '../../services/combat/aoe-cast-service.js';
import { CombatEncounterService } from '../../services/combat/combat-encounter-service.js';
import { executeCombatIntent } from '../../services/combat/combat-intent-service.js';
import {
  applyDmTacticalActions,
  applyTacticalMapAction,
  consumeDmTacticalCorrection,
} from '../../services/combat/tactical-action-service.js';
import { destroyTacticalCombatMap } from '../../services/combat/tactical-combat-lifecycle.js';
import { loadActiveTacticalMap } from '../../services/combat/tactical-map-store.js';
import { dmResponseSchema, parseDmResponse } from '../../services/dm/dm-response-schema.js';
import { LLMProviderService } from '../../services/llm-provider-service.js';
import { checkLineOfSight, getCover, getDistance, getValidMoves } from '../../tactical/engine.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';

import type { MapAction } from '../../tactical/dispatch.js';

/** Session-scoped tactical API; all writes delegate to the shared engine dispatcher. */
export const tacticalMapRoutes = new Elysia({ prefix: '/v1/sessions' })
  .use(requireAuth)
  .get('/:id/tactical-map', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) {
      set.status = access.error!.status;
      return { error: access.error!.message };
    }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) {
      set.status = 404;
      return { error: 'No active tactical map' };
    }
    return map;
  })
  .get('/:id/tactical-map/valid-moves/:entityId', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) {
      set.status = access.error!.status;
      return { error: access.error!.message };
    }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) {
      set.status = 404;
      return { error: 'No active tactical map' };
    }
    return { entityId: params.entityId, moves: getValidMoves(map, params.entityId) };
  })
  .get('/:id/tactical-map/check/:fromId/:toId', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) {
      set.status = access.error!.status;
      return { error: access.error!.message };
    }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) {
      set.status = 404;
      return { error: 'No active tactical map' };
    }
    const from = map.entities.find((entity) => entity.id === params.fromId);
    const to = map.entities.find((entity) => entity.id === params.toId);
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
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) {
      set.status = access.error!.status;
      return { error: access.error!.message };
    }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) {
      set.status = 404;
      return { error: 'No active tactical map' };
    }
    const correction = await consumeDmTacticalCorrection(params.id);
    return {
      tacticalContext: `${buildTacticalPrompt(map, params.entityId)}${correction ? `\n\n<previous_tactical_failure>${correction}</previous_tactical_failure>` : ''}`,
    };
  })
  .post(
    '/:id/tactical-map/move',
    async ({ params, body, user, set }) => {
      const access = await verifySessionOwnership(params.id, user.userId);
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
        const result = await executeCombatIntent(
          encounter.id,
          { type: 'move', actorId: body.entityId, x: body.x, y: body.y },
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
      const access = await verifySessionOwnership(params.id, user.userId);
      if (!access.success) {
        set.status = access.error!.status;
        return { error: access.error!.message };
      }
      if (body.action === 'move' && body.entityId && body.x != null && body.y != null) {
        const encounter = await CombatEncounterService.getActiveEncounter(params.id, user.userId);
        if (!encounter) {
          set.status = 404;
          return { error: 'No active combat encounter' };
        }
        try {
          const result = await executeCombatIntent(
            encounter.id,
            { type: 'move', actorId: body.entityId, x: body.x, y: body.y },
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
      if (!result.applied && (result.refusal as { reason?: string }).reason === 'no_active_map') {
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
      const access = await verifySessionOwnership(params.id, user.userId);
      if (!access.success) {
        set.status = access.error!.status;
        return { error: access.error!.message };
      }
      const parsed = parseDmResponse({
        text: '',
        map_actions: body.actions,
        narration_segments: [],
        roll_requests: [],
        combat_transition: 'none',
        scene_spec: null,
        combatants: [],
        combat_actions: [],
      });
      if (!parsed.success) {
        set.status = 422;
        return { error: 'Invalid DM map action batch', issues: parsed.issues };
      }
      const applied = await applyDmTacticalActions(
        params.id,
        parsed.data.map_actions,
        async (refusal) => {
          const prompt = `You are correcting one rejected tactical map action. Return a complete DM structured response with ONLY one legal replacement in map_actions and all other arrays empty. Do not write prose.\n\n<rejection>${JSON.stringify(refusal)}</rejection>`;
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
      const access = await verifySessionOwnership(params.id, user.userId);
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
        if (body.phase === 'resolve') return { delta: await resolveAoECast(params.id, request, user.userId) };
        const proposal = await proposeAoECast(params.id, request);
        if (proposal.autoConfirm) return { delta: await resolveAoECast(params.id, request, user.userId) };
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
  .post('/:id/tactical-map/end', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) {
      set.status = access.error!.status;
      return { error: access.error!.message };
    }
    await destroyTacticalCombatMap(params.id);
    return { ok: true };
  });
