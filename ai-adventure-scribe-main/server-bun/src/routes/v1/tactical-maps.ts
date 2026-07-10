import { Elysia, t } from 'elysia';
import { broadcastToRoom } from '../../services/collaboration/room-manager.js';
import { dispatchMapAction } from '../../tactical/dispatch.js';
import { getValidMoves } from '../../tactical/engine.js';
import { loadActiveTacticalMap, saveTacticalMap } from '../../services/combat/tactical-map-store.js';
import { requireAuth } from '../../middleware/auth.js';
import { verifySessionOwnership } from './combat/helpers.js';

function broadcast(sessionId: string, payload: Record<string, unknown>) {
  // A null sender intentionally includes every connection in the session room.
  broadcastToRoom(sessionId, null as never, { ...payload, timestamp: Date.now() });
}

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
  .post('/:id/tactical-map/move', async ({ params, body, user, set }) => {
    const access = await verifySessionOwnership(params.id, user.userId);
    if (!access.success) { set.status = access.error!.status; return { error: access.error!.message }; }
    const map = await loadActiveTacticalMap(params.id);
    if (!map) { set.status = 404; return { error: 'No active tactical map' }; }
    const result = dispatchMapAction(map, { action: 'move', entityId: body.entityId, x: body.x, y: body.y });
    if (!result.applied) { set.status = 422; return result; }
    await saveTacticalMap(map);
    broadcast(params.id, { type: 'entity_moved', entityId: body.entityId, path: result.path });
    return { map, result };
  }, { body: t.Object({ entityId: t.String(), x: t.Number(), y: t.Number() }) });
