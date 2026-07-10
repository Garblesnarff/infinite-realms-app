import { broadcastToRoom } from '../collaboration/room-manager.js';
import { dispatchMapAction, dispatchWithOneCorrectiveRetry } from '../../tactical/dispatch.js';
import { loadActiveTacticalMap, saveTacticalMap } from './tactical-map-store.js';
import type { MapAction } from '../../tactical/dispatch.js';

const broadcast = (sessionId: string, payload: Record<string, unknown>): void => broadcastToRoom(sessionId, null as never, { ...payload, timestamp: Date.now() });

/** Common DM/player mutation path: validate with engine, persist, then publish a delta. */
export async function applyTacticalMapAction(sessionId: string, action: MapAction) {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map) return { applied: false as const, action, refusal: { reason: 'no_active_map' } };
  const result = dispatchMapAction(map, action);
  if (!result.applied) return result;
  await saveTacticalMap(map);
  if (action.action === 'move') broadcast(sessionId, { type: 'entity_moved', entityId: action.entityId, path: result.path });
  else if (action.action === 'update_cell') broadcast(sessionId, { type: 'cell_updated', x: action.x, y: action.y, changes: action.changes });
  else broadcast(sessionId, { type: action.action === 'place' ? 'entity_placed' : 'entity_removed', entityId: action.entityId });
  return result;
}

export type CorrectiveMapReprompt = (refusal: Record<string, unknown>) => Promise<MapAction | null>;

/**
 * DM actions are still ordinary engine actions. One refusal may be sent back to the
 * model with its valid-move summary; a second refusal is logged/dropped, never looped.
 */
export async function applyDmTacticalActions(sessionId: string, actions: MapAction[], correctiveReprompt?: CorrectiveMapReprompt) {
  const results = [];
  let retried = false;
  for (const action of actions) {
    const retry = !retried && correctiveReprompt ? async (refusal: Record<string, unknown>) => { retried = true; return correctiveReprompt(refusal); } : undefined;
    const result = await dispatchWithOneCorrectiveRetry(action, (candidate) => applyTacticalMapAction(sessionId, candidate), retry);
    if (!result.applied) console.warn('[tactical] dropped invalid DM map action', { sessionId, action, refusal: result.refusal });
    results.push(result);
  }
  return results;
}
