import {
  forceMoveEntity,
  moveEntity,
  placeEntity,
  removeEntity,
  updateCell,
  getValidMoves,
} from './engine.js';

import type { Cell, MapEntity, TacticalMap } from './types.js';
import type { DMMapAction, DMResponse } from '../services/dm/dm-response-schema.js';

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

  const violating = response.roll_requests.filter((request) => {
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
