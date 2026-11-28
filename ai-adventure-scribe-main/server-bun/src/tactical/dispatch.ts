import {
  forceMoveEntity,
  moveEntity,
  placeEntity,
  removeEntity,
  updateCell,
  getValidMoves,
} from './engine.js';
import { entitySlug, resolveEntityRef, unknownEntityMessage } from './identity.js';

import type { Cell, MapEntity, TacticalMap } from './types.js';
import type { DMMapAction, DMResponse } from '../services/dm/dm-response-schema.js';

export type MapAction = DMMapAction;
export type DispatchResult =
  | { applied: true; action: MapAction; path?: { x: number; y: number }[] }
  | { applied: false; action: MapAction; refusal: Record<string, unknown> };

/**
 * The DM addresses the board in digest slugs, and spells them inconsistently. Every entity
 * reference in a map action is therefore resolved here before it reaches the engine, and a
 * reference that resolves to nothing becomes a correctable refusal carrying the live roster
 * — never a silent drop, which is what froze the board for a whole encounter in run 6.
 */
function unknownEntity(map: TacticalMap, action: MapAction, token: string): DispatchResult {
  return {
    applied: false,
    action,
    refusal: {
      reason: 'unknown_entity',
      entityId: token,
      message: unknownEntityMessage(map.entities, token),
      entities: map.entities.map((entity) => ({
        entityId: entitySlug(entity),
        x: entity.x,
        y: entity.y,
      })),
    },
  };
}

/**
 * #1802 (round 1): a `resolvedUnreachableApproaches` marker records that one actor could
 * not reach one target from where they stood this turn. Any move of either side voids
 * that premise — the next proposal must re-plan from the new board, not answer "could
 * not reach" from the old positions. This gateway is the single choke point, so the
 * clear lives here: the manual-move route reaches it through `applyTacticalMapAction`,
 * and the AoE forced-move route calls it directly and saves. The approach's own move
 * passes through here too; that is harmless because the marker is re-recorded after
 * the approach — by the fact write for an unreachable resolution, and by the
 * fall-through upsert in `decideAttackApproach`. A death clears the same way,
 * but from the HP service (`CombatHPService.applyDamage`), which owns the death
 * event: death is a status flag, not a board event, so no dispatch path ever
 * sees it. That hook writes the map row directly rather than importing this
 * helper — the import edge would break the 31 test files that mock the engine
 * or the map store (see the hook's comment).
 */
function clearStaleApproachMarkers(map: TacticalMap, entityId: string): void {
  if (!map.resolvedUnreachableApproaches?.length) return;
  map.resolvedUnreachableApproaches = map.resolvedUnreachableApproaches.filter(
    (marker) => marker.actorId !== entityId && marker.targetId !== entityId,
  );
}

/** The only mutation gateway used by both player requests and DM structured output. */
export function dispatchMapAction(map: TacticalMap, action: MapAction): DispatchResult {
  if (action.action === 'move') {
    if (!action.entityId || action.x == null || action.y == null)
      return { applied: false, action, refusal: { reason: 'invalid_action' } };
    const entity = resolveEntityRef(map.entities, action.entityId);
    if (!entity) return unknownEntity(map, action, action.entityId);
    // Downstream deltas and the frontend board key on the internal id, so the resolved
    // action — not the model's spelling — is what the result reports.
    const resolved: MapAction = { ...action, entityId: entity.id };
    const result = moveEntity(map, entity.id, action.x, action.y);
    if (!result.success)
      return {
        applied: false,
        action: resolved,
        refusal: { ...result, validMoves: getValidMoves(map, entity.id) },
      };
    // A move to the entity's own cell succeeds with a one-cell path and changes
    // nothing: it must not void the repeat protection (self-review nit 3).
    if (result.path && result.path.length > 1) clearStaleApproachMarkers(map, entity.id);
    return { applied: true, action: resolved, path: result.path };
  }
  if (action.action === 'forced_move') {
    const entity = resolveEntityRef(map.entities, action.target);
    if (!entity) return unknownEntity(map, action, action.target);
    const resolved: MapAction = { ...action, target: entity.id };
    const result = forceMoveEntity(
      map,
      entity.id,
      action.mode,
      action.origin ?? null,
      action.distance ?? null,
      action.destination ?? null,
    );
    if (!result.success)
      return {
        applied: false,
        action: resolved,
        refusal: { ...result, reason: 'illegal_forced_movement' },
      };
    // Same no-op guard as the move branch: a forced move that lands the target on
    // its own cell changed nothing, so it clears nothing.
    if (result.path && result.path.length > 1) clearStaleApproachMarkers(map, entity.id);
    return { applied: true, action: resolved, path: result.path };
  }
  if (action.action === 'remove') {
    if (!action.entityId) return { applied: false, action, refusal: { reason: 'invalid_entity' } };
    const entity = resolveEntityRef(map.entities, action.entityId);
    if (!entity) return unknownEntity(map, action, action.entityId);
    if (!removeEntity(map, entity.id))
      return { applied: false, action, refusal: { reason: 'invalid_entity' } };
    clearStaleApproachMarkers(map, entity.id);
    return { applied: true, action: { ...action, entityId: entity.id } };
  }
  if (action.action === 'place') {
    if (!action.changes || !placeEntity(map, action.changes as MapEntity))
      return { applied: false, action, refusal: { reason: 'invalid_placement' } };
    clearStaleApproachMarkers(map, (action.changes as MapEntity).id);
    return { applied: true, action };
  }
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

export type CombatTransitionContractViolation = {
  rollTypes: Array<'initiative' | 'attack' | 'save'>;
  message: string;
};

const CREATURE_SAVE_PATTERN =
  /\b(?:attack|attacks|attacking|breath|bite|claw|fang|venom|poison|spell|fireball|dragon|goblin|orc|enemy|creature|monster|beast|undead)\b/i;

/**
 * Structured roll requests are authoritative combat signals. Prose is included
 * only to identify a creature-caused save because the roll schema has no source
 * field; it never starts combat by itself.
 */
export function validateCombatTransitionContract(
  response: Pick<
    DMResponse,
    'text' | 'roll_requests' | 'combat_transition' | 'scene_spec' | 'combatants'
  >,
  combatActive: boolean,
): CombatTransitionContractViolation | null {
  if (combatActive) return null;

  // #782 item 3: the route now always enforces the server-built schema, so
  // this runs on every turn. Be defensive: a parsed envelope that is not
  // schema-valid (e.g. a test mock) may lack roll_requests.
  const rollRequests = Array.isArray(response.roll_requests) ? response.roll_requests : [];
  const violating = rollRequests.filter((request) => {
    if (request.type === 'initiative' || request.type === 'attack') return true;
    if (request.type !== 'save' || /\bdeath\b/i.test(request.purpose)) return false;
    return CREATURE_SAVE_PATTERN.test(`${request.purpose}\n${response.text}`);
  });
  if (!violating.length) return null;
  if (
    response.combat_transition === 'start' &&
    response.scene_spec &&
    response.combatants.length > 0
  ) {
    return null;
  }

  const rollTypes = [...new Set(violating.map((request) => request.type))] as Array<
    'initiative' | 'attack' | 'save'
  >;
  return {
    rollTypes,
    message:
      'Combat contract violation: while combat is inactive, initiative, attacks against creatures, ' +
      'and saves caused by a creature\'s attack require combat_transition="start" with a non-null ' +
      'scene_spec and populated combatants. Combat prose without that transition has no authority.',
  };
}

export function buildCombatTransitionCorrectivePrompt(
  violation: CombatTransitionContractViolation,
): string {
  return `<corrective_instruction>
${violation.message}
The prior response requested: ${violation.rollTypes.join(', ')}.
Return one corrected response now. Preserve the narrative setup, set combat_transition to "start",
provide scene_spec and combatants, and keep the required roll_requests. Do not explain the correction.
</corrective_instruction>`;
}
