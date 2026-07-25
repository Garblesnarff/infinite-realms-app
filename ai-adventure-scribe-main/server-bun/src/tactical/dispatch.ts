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
    return result.success
      ? { applied: true, action: resolved, path: result.path }
      : {
          applied: false,
          action: resolved,
          refusal: { ...result, validMoves: getValidMoves(map, entity.id) },
        };
  }
  if (action.action === 'forced_move') {
    const entity = resolveEntityRef(map.entities, action.target);
    if (!entity) return unknownEntity(map, action, action.target);
    const resolved: MapAction = { ...action, target: entity.id };
    const result = forceMoveEntity(
      map,
      entity.id,
      action.mode,
      action.origin,
      action.distance,
      action.destination,
    );
    return result.success
      ? { applied: true, action: resolved, path: result.path }
      : {
          applied: false,
          action: resolved,
          refusal: { ...result, reason: 'illegal_forced_movement' },
        };
  }
  if (action.action === 'remove') {
    if (!action.entityId) return { applied: false, action, refusal: { reason: 'invalid_entity' } };
    const entity = resolveEntityRef(map.entities, action.entityId);
    if (!entity) return unknownEntity(map, action, action.entityId);
    return removeEntity(map, entity.id)
      ? { applied: true, action: { ...action, entityId: entity.id } }
      : { applied: false, action, refusal: { reason: 'invalid_entity' } };
  }
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

/**
 * During active combat an attack belongs in `combat_actions`, where it names an actor and a
 * target the engine can path, reach-check, and resolve. The same attack in `roll_requests` is
 * a sentence: no actor, no target, no geometry, and nothing for the engine to execute.
 *
 * This is a migration guard for the old prompt's habit. It steers once; a response that
 * repeats the pattern is accepted and checked by the spatial contract's inference fallback,
 * because stalling the table is worse than validating against an assumption.
 */
export function validateCombatActionChannel(
  response: Pick<DMResponse, 'roll_requests'>,
  combatActive: boolean,
): { purposes: string[]; message: string } | null {
  if (!combatActive) return null;
  const purposes = (response.roll_requests ?? [])
    .filter((request) => request.type === 'attack')
    .map((request) => request.purpose);
  if (!purposes.length) return null;
  return {
    purposes,
    message:
      'Combat channel violation: while combat is active, attacks are declared in combat_actions ' +
      'with actor_id and target_ids copied from the tactical digest. roll_requests is reserved ' +
      'for saving throws and ability checks; an attack there is never rolled or resolved.',
  };
}

export function buildCombatActionChannelCorrectivePrompt(violation: {
  purposes: string[];
  message: string;
}): string {
  return `<corrective_instruction>
${violation.message}
The prior response put these attacks in roll_requests: ${violation.purposes.map((purpose) => JSON.stringify(purpose)).join(', ')}.
Return one corrected response now. Keep the same fiction. Move each attack into combat_actions as
{"actor_id","action_type":"attack","target_ids",...}, using ids copied verbatim from the tactical
digest, and leave roll_requests holding only saves and checks. Do not add map_actions to close
distance: the engine moves the attacker into reach. Do not explain the correction.
</corrective_instruction>`;
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
