import { loadActiveTacticalMap, saveTacticalMap } from './tactical-map-store.js';
import { dispatchMapAction, dispatchWithOneCorrectiveRetry } from '../../tactical/dispatch.js';
import { broadcastToRoom } from '../collaboration/room-manager.js';

import type { MapAction } from '../../tactical/dispatch.js';
import type { MapEntity } from '../../tactical/types.js';

const broadcast = (sessionId: string, payload: Record<string, unknown>): void =>
  broadcastToRoom(sessionId, null as never, { ...payload, timestamp: Date.now() });

export type TacticalDelta =
  | {
      type: 'entity_moved';
      entityId: string;
      path: { x: number; y: number }[];
      forced?: boolean;
      mode?: 'shove' | 'pull' | 'teleport';
    }
  | { type: 'entity_placed'; entity: MapEntity }
  | { type: 'entity_removed'; entityId: string }
  | { type: 'cell_updated'; x: number; y: number; changes: Record<string, unknown> };

const deltaFor = (
  action: MapAction,
  result: { path?: { x: number; y: number }[] },
): TacticalDelta => {
  if (action.action === 'move')
    return { type: 'entity_moved', entityId: action.entityId!, path: result.path ?? [] };
  if (action.action === 'forced_move')
    return {
      type: 'entity_moved',
      entityId: action.target,
      path: result.path ?? [],
      forced: true,
      mode: action.mode,
    };
  if (action.action === 'update_cell')
    return {
      type: 'cell_updated',
      x: action.x!,
      y: action.y!,
      changes: (action.changes ?? {}) as Record<string, unknown>,
    };
  if (action.action === 'place')
    return { type: 'entity_placed', entity: action.changes as MapEntity };
  return { type: 'entity_removed', entityId: action.entityId! };
};

/** Common DM/player mutation path: validate with engine, persist, then publish a delta. */
export async function applyTacticalMapAction(
  sessionId: string,
  action: MapAction,
  options: { broadcast?: boolean } = {},
) {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map) return { applied: false as const, action, refusal: { reason: 'no_active_map' } };
  const result = dispatchMapAction(map, action);
  if (!result.applied) return result;
  await saveTacticalMap(map);
  if (options.broadcast !== false) broadcast(sessionId, deltaFor(action, result));
  return result;
}

export type CorrectiveMapReprompt = (refusal: Record<string, unknown>) => Promise<MapAction | null>;

/**
 * DM actions are still ordinary engine actions. One refusal may be sent back to the
 * model with its valid-move summary; a second refusal is logged/dropped, never looped.
 */
export async function applyDmTacticalActions(
  sessionId: string,
  actions: MapAction[],
  correctiveReprompt?: CorrectiveMapReprompt,
) {
  const results = [];
  const appliedDeltas: TacticalDelta[] = [];
  const degraded: Record<string, unknown>[] = [];
  let retried = false;
  for (const action of actions) {
    const retry =
      !retried && correctiveReprompt
        ? async (refusal: Record<string, unknown>) => {
            retried = true;
            return correctiveReprompt({ action, refusal });
          }
        : undefined;
    const result = await dispatchWithOneCorrectiveRetry(
      action,
      (candidate) => applyTacticalMapAction(sessionId, candidate, { broadcast: false }),
      retry,
    );
    if (result.applied) appliedDeltas.push(deltaFor(result.action, result));
    else {
      console.warn('[tactical] dropped invalid DM map action', {
        sessionId,
        action,
        refusal: result.refusal,
      });
      degraded.push(result.refusal);
    }
    results.push(result);
  }
  if (appliedDeltas.length)
    broadcast(sessionId, { type: 'tactical_action_queue', actions: appliedDeltas });
  if (degraded.length) {
    const line = 'A tactical effect glances off; the DM will correct the scene on its next turn.';
    const map = await loadActiveTacticalMap(sessionId);
    if (map) {
      map.pendingDmCorrection = `The prior tactical action was rejected: ${JSON.stringify(degraded)}. Acknowledge the failed effect in the fiction and do not repeat an illegal map action.`;
      await saveTacticalMap(map);
    }
    broadcast(sessionId, { type: 'tactical_degraded', text: line, reasons: degraded });
  }
  return { results, appliedDeltas, degraded };
}

/** Return the one-shot correction fact with the next tactical digest, then clear it. */
export async function consumeDmTacticalCorrection(sessionId: string): Promise<string | null> {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map?.pendingDmCorrection) return null;
  const correction = map.pendingDmCorrection;
  delete map.pendingDmCorrection;
  await saveTacticalMap(map);
  return correction;
}
