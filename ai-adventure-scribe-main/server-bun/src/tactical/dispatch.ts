import { moveEntity, placeEntity, removeEntity, updateCell, getValidMoves } from './engine.js';
import type { Cell, MapEntity, TacticalMap } from './types.js';

export type MapAction = { action: 'move' | 'place' | 'remove' | 'update_cell'; entityId?: string | null; x?: number | null; y?: number | null; changes?: Partial<Cell> | MapEntity | null };
export type DispatchResult = { applied: true; action: MapAction; path?: { x: number; y: number }[] } | { applied: false; action: MapAction; refusal: Record<string, unknown> };

/** The only mutation gateway used by both player requests and DM structured output. */
export function dispatchMapAction(map: TacticalMap, action: MapAction): DispatchResult {
  if (action.action === 'move') {
    if (!action.entityId || action.x == null || action.y == null) return { applied: false, action, refusal: { reason: 'invalid_action' } };
    const result = moveEntity(map, action.entityId, action.x, action.y);
    return result.success
      ? { applied: true, action, path: result.path }
      : { applied: false, action, refusal: { ...result, validMoves: getValidMoves(map, action.entityId) } };
  }
  if (action.action === 'remove') return action.entityId && removeEntity(map, action.entityId)
    ? { applied: true, action } : { applied: false, action, refusal: { reason: 'invalid_entity' } };
  if (action.action === 'place') return action.changes && placeEntity(map, action.changes as MapEntity)
    ? { applied: true, action } : { applied: false, action, refusal: { reason: 'invalid_placement' } };
  if (action.x != null && action.y != null && updateCell(map, action.x, action.y, (action.changes || {}) as Partial<Cell>)) return { applied: true, action };
  return { applied: false, action, refusal: { reason: 'invalid_cell' } };
}

export function dispatchMapActions(map: TacticalMap, actions: MapAction[]): DispatchResult[] {
  return actions.map((action) => dispatchMapAction(map, action));
}
