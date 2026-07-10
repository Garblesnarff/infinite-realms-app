import { Elysia, t } from 'elysia';
import { getValidMoves } from '../../tactical/engine.js';
import { buildTacticalPrompt } from '../../tactical/prompt.js';
import { loadActiveTacticalMap } from '../../services/combat/tactical-map-store.js';
import { applyTacticalMapAction } from '../../services/combat/tactical-action-service.js';
import { destroyTacticalCombatMap } from '../../services/combat/tactical-combat-lifecycle.js';
import { requireAuth } from '../../middleware/auth.js';
import { verifySessionOwnership } from './combat/helpers.js';

/** Session-scoped tactical API; all writes delegate to the shared engine dispatcher. */
export const tacticalMapRoutes = new Elysia({ prefix: '/v1/sessions' })
  .use(requireAuth)
  .get('/:id/tactical-map', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) { set.status = 404; return { error: 'No active tactical map' }; }
    return map;
  })
  .get('/:id/tactical-map/valid-moves/:entityId', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) { set.status = 404; return { error: 'No active tactical map' }; }
    return { entityId: params.entityId, moves: getValidMoves(map, params.entityId) };
  })
  .get('/:id/tactical-map/context/:entityId', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) { set.status = 404; return { error: 'No active tactical map' }; }
    return { tacticalContext: buildTacticalPrompt(map, params.entityId) };
  })
  .post('/:id/tactical-map/move', async ({ params, body, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const result = await applyTacticalMapAction(params.id, { action: 'move', entityId: body.entityId, x: body.x, y: body.y });
    if (!result.applied && (result.refusal as { reason?: string }).reason === 'no_active_map') { set.status = 404; return { error: 'No active tactical map' }; }
    if (!result.applied) { set.status = 422; return result; }
    return { result };
  }, { body: t.Object({ entityId: t.String(), x: t.Number(), y: t.Number() }) })
  .post('/:id/tactical-map/action', async ({ params, body, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const result = await applyTacticalMapAction(params.id, body);
    if (!result.applied && (result.refusal as { reason?: string }).reason === 'no_active_map') { set.status = 404; return { error: 'No active tactical map' }; }
    if (!result.applied) { set.status = 422; return result; }
    return { result };
  }, { body: t.Object({
    action: t.Union([t.Literal('move'), t.Literal('place'), t.Literal('remove'), t.Literal('update_cell')]),
    entityId: t.Optional(t.Nullable(t.String())), x: t.Optional(t.Nullable(t.Number())), y: t.Optional(t.Nullable(t.Number())), changes: t.Optional(t.Nullable(t.Record(t.String(), t.Any()))),
  }) })
  .post('/:id/tactical-map/end', async ({ params, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    await destroyTacticalCombatMap(params.id);
    return { ok: true };
  });
