import {
  forceMoveEntity,
  moveEntity,
  placeEntity,
  removeEntity,
  updateCell,
  getValidMoves,
} from './engine.js';

import type { Cell, MapEntity, TacticalMap } from './types.js';
import type { DMMapAction } from '../services/dm/dm-response-schema.js';

export type MapAction = DMMapAction;
export type DispatchResult =
  | { applied: true; action: MapAction; path?: { x: number; y: number }[] }
  | { applied: false; action: MapAction; refusal: Record<string, unknown> };

/** The only mutation gateway used by both player requests and DM structured output. */
export function dispatchMapAction(map: TacticalMap, action: MapAction): DispatchResult {
  if (action.action === 'move') {
    if (!action.entityId || action.x == null || action.y == null)
      return { applied: false, action, refusal: { reason: 'invalid_action' } };
    const result = moveEntity(map, action.entityId, action.x, action.y);
    return result.success
      ? { applied: true, action, path: result.path }
      : {
          applied: false,
          action,
          refusal: { ...result, validMoves: getValidMoves(map, action.entityId) },
        };
  }
  if (action.action === 'forced_move') {
    const result = forceMoveEntity(
      map,
      action.target,
      action.mode,
      action.origin,
      action.distance,
      action.destination,
    );
    return result.success
      ? { applied: true, action, path: result.path }
      : { applied: false, action, refusal: { ...result, reason: 'illegal_forced_movement' } };
  }
  if (action.action === 'remove')
    return action.entityId && removeEntity(map, action.entityId)
      ? { applied: true, action }
      : { applied: false, action, refusal: { reason: 'invalid_entity' } };
  if (action.action === 'place')
    return action.changes && placeEntity(map, action.changes as MapEntity)
      ? { applied: true, action }
      : { applied: false, action, refusal: { reason: 'invalid_placement' } };
  if (
    action.x != null &&
    action.y != null &&
    updateCell(map, action.x, action.y, (action.changes || {}) as Partial<Cell>)
  )
    return { applied: true, action };
  return { applied: false, action, refusal: { reason: 'invalid_cell' } };
}

export function dispatchMapActions(map: TacticalMap, actions: MapAction[]): DispatchResult[] {
  return actions.map((action) => dispatchMapAction(map, action));
}

/** Generic bounded retry coordinator used by the DM transport. It can never tool-loop. */
export async function dispatchWithOneCorrectiveRetry(
  action: MapAction,
  dispatch: (action: MapAction) => Promise<DispatchResult>,
  correctiveReprompt?: (refusal: Record<string, unknown>) => Promise<MapAction | null>,
): Promise<DispatchResult> {
  const initial = await dispatch(action);
  if (initial.applied || !correctiveReprompt) return initial;
  const replacement = await correctiveReprompt(initial.refusal);
  return replacement ? dispatch(replacement) : initial;
}
