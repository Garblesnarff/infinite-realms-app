/**
 * Auto-approach: the engine walks an attacker into reach before resolving its attack.
 *
 * The DM declares an intent ("shadow-roach-2 attacks the-seeker"). Whether that requires
 * crossing twenty-five feet of floor is a question about the board, and the board is the
 * engine's to answer. When the gap cannot be closed this turn the attack does not fail
 * quietly: it resolves as movement, and the next DM context says so in plain words.
 */
import { applyTacticalMapAction, recordDmTacticalFact } from './tactical-action-service.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { combatLogger } from '../../lib/logger.js';
// Re-exported from its own module so the sentence stays importable without dragging this
// file's logger dependency along; see attack-narration.ts.
export { describeResolvedAttack } from './attack-narration.js';
import { planApproach } from '../../tactical/approach.js';
import { getDistance } from '../../tactical/engine.js';

import type { Point } from '../../tactical/types.js';

export type ApproachRefusalReason =
  | 'no_geometry'
  | 'no_reachable_adjacent_cell'
  | 'movement_exhausted'
  | 'move_refused';

export type ApproachResult =
  /** Already within reach; no movement was needed or spent. */
  | { kind: 'in_reach'; distanceFeet: number }
  /** The actor moved and can now attack. */
  | { kind: 'approached'; distanceFeet: number; movedFeet: number; from: Point; to: Point }
  /**
   * The actor moved as far as it could and still cannot reach. The attack does not happen;
   * the turn's action becomes the movement.
   */
  | {
      kind: 'unreachable';
      startingDistanceFeet: number;
      distanceFeet: number;
      movedFeet: number;
      movementAvailableFeet: number;
      movementRemainingFeet: number;
      pathCostFeet: number;
      from: Point;
      to: Point;
      reachFeet: number;
      blockingCell?: Point;
      blockingObstacle?: string;
      reason: Exclude<ApproachRefusalReason, 'no_geometry'>;
    }
  /** No board, or the actor/target is not on it: geometry cannot speak, so it does not. */
  | { kind: 'no_geometry' };

/**
 * Moves `actorId` toward `targetId` until it is within `reachFeet`, spending no more than the
 * movement it has left. Returns what the board now looks like so the caller can decide
 * whether an attack still happens.
 */
export async function approachForAttack(
  sessionId: string,
  actorId: string,
  targetId: string,
  reachFeet: number,
): Promise<ApproachResult> {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map) {
    logApproachPlan({
      sessionId,
      actorId,
      targetId,
      from: null,
      to: null,
      distance: null,
      path: [],
      reason: 'no_geometry',
    });
    return { kind: 'no_geometry' };
  }
  const actor = map.entities.find((entity) => entity.id === actorId);
  const target = map.entities.find((entity) => entity.id === targetId);
  if (!actor || !target) {
    logApproachPlan({
      sessionId,
      actorId,
      targetId,
      from: actor ? { x: actor.x, y: actor.y } : null,
      to: target ? { x: target.x, y: target.y } : null,
      distance: actor && target ? getDistance(actor, target) : null,
      path: [],
      reason: 'no_geometry',
    });
    return { kind: 'no_geometry' };
  }

  const from: Point = { x: actor.x, y: actor.y };
  const startingDistance = getDistance(actor, target);
  if (startingDistance <= reachFeet) return { kind: 'in_reach', distanceFeet: startingDistance };

  const plan = planApproach(map, actorId, targetId, reachFeet);
  if (!plan) {
    logApproachPlan({
      sessionId,
      actorId,
      targetId,
      from,
      to: null,
      distance: startingDistance,
      path: [],
      reason: 'no_geometry',
    });
    return { kind: 'no_geometry' };
  }

  let movedFeet = 0;
  let to = from;
  if (plan.destination.x !== from.x || plan.destination.y !== from.y) {
    const move = await applyTacticalMapAction(sessionId, {
      action: 'move',
      entityId: actorId,
      x: plan.destination.x,
      y: plan.destination.y,
      changes: null,
    });
    if (move.applied) {
      movedFeet = plan.costFeet;
      to = plan.destination;
    } else {
      // The plan came from the same engine that just refused it, so this means the board
      // changed underneath us. Report the unmoved truth rather than a hoped-for position.
      combatLogger.warn(
        { sessionId, actorId, targetId, plan, refusal: (move as { refusal?: unknown }).refusal },
        '[tactical] auto-approach move was refused by the engine',
      );
      logApproachPlan({
        sessionId,
        actorId,
        targetId,
        from,
        to: from,
        distance: startingDistance,
        path: plan.path,
        startingDistance,
        movementRemaining: actor.movementRemaining,
        pathCost: plan.pathCostFeet ?? plan.costFeet,
        ...(plan.blockingCell ? { blockingCell: plan.blockingCell } : {}),
        reason: 'move_refused',
      });
      return {
        kind: 'unreachable',
        startingDistanceFeet: startingDistance,
        distanceFeet: startingDistance,
        movedFeet: 0,
        movementAvailableFeet: actor.movementRemaining,
        movementRemainingFeet: actor.movementRemaining,
        pathCostFeet: plan.pathCostFeet ?? plan.costFeet,
        from,
        to: from,
        reachFeet,
        ...(plan.blockingCell ? { blockingCell: plan.blockingCell } : {}),
        ...(plan.blockingObstacle ? { blockingObstacle: plan.blockingObstacle } : {}),
        reason: 'move_refused',
      };
    }
  }

  if (plan.inReach)
    return movedFeet > 0
      ? { kind: 'approached', distanceFeet: plan.resultingDistanceFeet, movedFeet, from, to }
      : { kind: 'in_reach', distanceFeet: plan.resultingDistanceFeet };

  const movementRemainingFeet = Math.max(0, actor.movementRemaining - movedFeet);
  const reason: Exclude<ApproachRefusalReason, 'no_geometry'> =
    movementRemainingFeet <= 0 ? 'movement_exhausted' : 'no_reachable_adjacent_cell';
  logApproachPlan({
    sessionId,
    actorId,
    targetId,
    from,
    to,
    distance: plan.resultingDistanceFeet,
    path: plan.path,
    startingDistance,
    movementRemaining: movementRemainingFeet,
    movementAvailable: actor.movementRemaining,
    pathCost: plan.pathCostFeet ?? plan.costFeet,
    ...(plan.blockingCell ? { blockingCell: plan.blockingCell } : {}),
    reason,
  });
  return {
    kind: 'unreachable',
    startingDistanceFeet: startingDistance,
    distanceFeet: plan.resultingDistanceFeet,
    movedFeet,
    movementAvailableFeet: actor.movementRemaining,
    movementRemainingFeet,
    pathCostFeet: plan.pathCostFeet ?? plan.costFeet,
    from,
    to,
    reachFeet,
    ...(plan.blockingCell ? { blockingCell: plan.blockingCell } : {}),
    ...(plan.blockingObstacle ? { blockingObstacle: plan.blockingObstacle } : {}),
    reason,
  };
}

function logApproachPlan(params: {
  sessionId: string;
  actorId: string;
  targetId: string;
  from: Point | null;
  to: Point | null;
  distance: number | null;
  path: Point[];
  startingDistance?: number;
  movementRemaining?: number;
  movementAvailable?: number;
  pathCost?: number;
  blockingCell?: Point;
  reason: ApproachRefusalReason;
}): void {
  combatLogger.warn({ event: 'APPROACH_PLAN', ...params }, 'APPROACH_PLAN');
}

/**
 * The sentence the DM reads on its next turn. It states the movement that happened and the
 * attack that did not, because a DM told only "the attack failed" will invent a reason.
 */
export function describeUnreachableApproach(
  actorLabel: string,
  targetLabel: string,
  result: Extract<ApproachResult, { kind: 'unreachable' }>,
  _intent: string,
): string {
  const blocker = result.blockingCell
    ? ` (${result.blockingObstacle ?? 'obstacle'} at ${result.blockingCell.x},${result.blockingCell.y})`
    : '';
  const startingDistance = result.startingDistanceFeet ?? result.distanceFeet + result.movedFeet;
  const movementAvailable =
    result.movementAvailableFeet ?? result.movedFeet + (result.movementRemainingFeet ?? 0);
  const pathCost = result.pathCostFeet ?? result.movedFeet;
  return (
    `${actorLabel} could not reach ${targetLabel}: started ${startingDistance} ft away; ` +
    `${pathCost} ft path${blocker} with ${movementAvailable} ft of movement; moved ` +
    `${result.movedFeet} ft, now ${result.distanceFeet} ft away; no attack was rolled.`
  );
}

/** What the intent gateway records when an attack could not survive its own approach. */
export type MovementOnlyResult = {
  resolvedAs: 'movement_only';
  actorId: string;
  targetId: string;
  movedFeet: number;
  distanceFeet: number;
  reachFeet: number;
  from: Point;
  to: Point;
  startingDistanceFeet: number;
  movementRemainingFeet: number;
  movementAvailableFeet: number;
  pathCostFeet: number;
  blockingCell?: Point;
  blockingObstacle?: string;
  /** Stable result discriminator retained for existing combat consumers. */
  reason: 'out_of_reach_after_full_movement';
  refusalReason: Exclude<ApproachRefusalReason, 'no_geometry'>;
  narrative: string;
};

export type AttackApproachDecision =
  | { movementOnly: false; attackType: 'melee' | 'ranged' }
  | { movementOnly: true; result: MovementOnlyResult };

/**
 * Walks a melee attacker into reach before its attack is rolled, and reports whether the
 * attack still happens.
 *
 * The weapon is supplied rather than looked up so this module stays pure geometry with no
 * database behind it. Ranged attacks are left alone: their legality is range and line of
 * sight, which `resolveAttackRules` already judges from where the attacker stands. Melee is
 * the case the DM could never be relied on to handle, so the engine handles it.
 */
export async function decideAttackApproach(params: {
  sessionId: string;
  actorId: string;
  actorLabel: string;
  targetId: string;
  targetLabel: string;
  weapon: { name: string; ranged: boolean; normalRange: number };
}): Promise<AttackApproachDecision> {
  const { sessionId, actorId, actorLabel, targetId, targetLabel, weapon } = params;
  const attackType = weapon.ranged ? 'ranged' : 'melee';
  if (weapon.ranged) return { movementOnly: false, attackType };

  const approach = await approachForAttack(sessionId, actorId, targetId, weapon.normalRange);
  if (approach.kind !== 'unreachable') return { movementOnly: false, attackType };

  const narrative = describeUnreachableApproach(
    actorLabel,
    targetLabel,
    approach,
    `an attack with its ${weapon.name}`,
  );
  // The DM asked for a strike the board does not permit. It gets the movement it implicitly
  // asked for, plus a plain statement of what happened, rather than a silent no-op.
  await recordDmTacticalFact(sessionId, narrative);
  combatLogger.info(
    { sessionId, actorId, targetId, ...approach },
    '[tactical] attack resolved as movement: target out of reach after full movement',
  );
  return {
    movementOnly: true,
    result: {
      resolvedAs: 'movement_only',
      actorId,
      targetId,
      movedFeet: approach.movedFeet,
      distanceFeet: approach.distanceFeet,
      reachFeet: approach.reachFeet,
      from: approach.from,
      to: approach.to,
      startingDistanceFeet: approach.startingDistanceFeet,
      movementRemainingFeet: approach.movementRemainingFeet,
      movementAvailableFeet: approach.movementAvailableFeet,
      pathCostFeet: approach.pathCostFeet,
      ...(approach.blockingCell ? { blockingCell: approach.blockingCell } : {}),
      ...(approach.blockingObstacle ? { blockingObstacle: approach.blockingObstacle } : {}),
      reason: 'out_of_reach_after_full_movement',
      refusalReason: approach.reason,
      narrative,
    },
  };
}
