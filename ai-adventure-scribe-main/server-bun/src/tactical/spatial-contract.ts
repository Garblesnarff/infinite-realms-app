/**
 * Spatial coherence contract for combat turns.
 *
 * The DM may only narrate an attack the board allows. Every spatial fact here comes from
 * the engine: distances and line of sight are read out of the tactical digest, and a
 * proposed corrective move is re-measured with the engine's own `getDistance`.
 */
import { parseTacticalDigest, resolveDigestEntity, resolvePairFromText } from './digest-parse.js';
import { getDistance } from './engine.js';

import type { DigestEntity, TacticalDigest } from './digest-parse.js';
import type { MapEntity } from './types.js';
import type { DMResponse } from '../services/dm/dm-response-schema.js';

export const MELEE_REACH_FEET = 5;

const label = (entity: DigestEntity): string => entity.name || entity.id;

/** Ranged intent is explicit: everything else is treated as reach-limited melee. */
const RANGED_PATTERN =
  /\b(?:ranged?|bow|longbow|shortbow|crossbow|sling|dart|javelin|thrown|throws?|firebolt|fire bolt|eldritch blast|ray|bolt|arrow|blast|beam|cantrip|spell|casts?|magic missile)\b/i;

export function isRangedDescriptor(...descriptors: Array<string | null | undefined>): boolean {
  return RANGED_PATTERN.test(descriptors.filter(Boolean).join(' '));
}

export type SpatialContractViolation = {
  kind: 'melee_out_of_reach' | 'ranged_without_line_of_sight';
  actorId: string;
  targetId: string;
  distanceFeet: number;
  movementRemaining: number;
  message: string;
};

const asPoint = (x: number, y: number): MapEntity => ({
  id: 'probe',
  x,
  y,
  // The digest carries no size; medium is the engine default footprint for a probe cell.
  size: 'medium',
  type: 'object',
  speedFeet: 0,
  movementRemaining: 0,
});

/** A move whose destination the engine measures as within reach cures a melee violation. */
function moveFixesReach(
  response: Pick<DMResponse, 'map_actions'>,
  actorId: string,
  target: DigestEntity,
): boolean {
  return (response.map_actions ?? []).some((action) => {
    if (action.action === 'move')
      return (
        action.entityId === actorId &&
        action.x != null &&
        action.y != null &&
        getDistance(asPoint(action.x, action.y), asPoint(target.x, target.y)) <= MELEE_REACH_FEET
      );
    // Forced movement and teleports relocate the actor by rules the digest cannot replay;
    // their presence is accepted rather than second-guessed.
    return action.action === 'forced_move' && action.target === actorId;
  });
}

const movesActor = (response: Pick<DMResponse, 'map_actions'>, actorId: string): boolean =>
  (response.map_actions ?? []).some(
    (action) =>
      (action.action === 'move' && action.entityId === actorId) ||
      (action.action === 'forced_move' && action.target === actorId),
  );

type AttackIntent = { actor: DigestEntity; target: DigestEntity; ranged: boolean };

function collectAttackIntents(
  response: Pick<DMResponse, 'roll_requests' | 'combat_actions'>,
  digest: TacticalDigest,
): AttackIntent[] {
  const intents: AttackIntent[] = [];
  // The response is model-authored JSON: any array may be missing entirely.
  for (const action of response.combat_actions ?? []) {
    if (!('target_ids' in action)) continue;
    if (action.action_type !== 'attack' && action.action_type !== 'cast_spell') continue;
    const actor = resolveDigestEntity(digest, action.actor_id);
    if (!actor) continue;
    // Weapon/spell ids are the only reliable reach signal here: scanning the whole
    // narration would let one stray "arrow" excuse every melee swing in the turn.
    const ranged =
      action.action_type === 'cast_spell' || isRangedDescriptor(action.weapon_id, action.spell_id);
    for (const targetId of action.target_ids ?? []) {
      const target = resolveDigestEntity(digest, targetId);
      if (target && target.id !== actor.id) intents.push({ actor, target, ranged });
    }
  }
  for (const request of response.roll_requests ?? []) {
    if (request.type !== 'attack') continue;
    const pair = resolvePairFromText(digest, request.purpose);
    if (!pair || pair.actor.id === pair.target.id) continue;
    if (
      intents.some(
        (intent) => intent.actor.id === pair.actor.id && intent.target.id === pair.target.id,
      )
    )
      continue;
    intents.push({ ...pair, ranged: isRangedDescriptor(request.purpose) });
  }
  return intents;
}

/**
 * Returns the first spatially incoherent attack in the response, or null. Only runs while
 * combat is active and a digest is present; without geometry there is nothing to enforce.
 */
export function validateSpatialCombatContract(
  response: Pick<DMResponse, 'roll_requests' | 'combat_actions' | 'map_actions'>,
  prompt: string,
  combatActive: boolean,
): SpatialContractViolation | null {
  if (!combatActive) return null;
  const digest = parseTacticalDigest(prompt);
  if (!digest) return null;
  for (const { actor, target, ranged } of collectAttackIntents(response, digest)) {
    const relation = actor.relations.get(target.id);
    if (!relation) continue;
    if (!ranged && relation.distanceFeet > MELEE_REACH_FEET) {
      if (moveFixesReach(response, actor.id, target)) continue;
      return {
        kind: 'melee_out_of_reach',
        actorId: actor.id,
        targetId: target.id,
        distanceFeet: relation.distanceFeet,
        movementRemaining: actor.movementRemaining,
        message:
          `${label(actor)} is ${relation.distanceFeet}ft from ${label(target)}; ` +
          `melee requires ${MELEE_REACH_FEET}ft; you have ${actor.movementRemaining}ft movement.`,
      };
    }
    if (ranged && !relation.hasLineOfSight && !movesActor(response, actor.id)) {
      return {
        kind: 'ranged_without_line_of_sight',
        actorId: actor.id,
        targetId: target.id,
        distanceFeet: relation.distanceFeet,
        movementRemaining: actor.movementRemaining,
        message:
          `${label(actor)} has no line of sight to ${label(target)} at ${relation.distanceFeet}ft; ` +
          `ranged attacks require line of sight; you have ${actor.movementRemaining}ft movement.`,
      };
    }
  }
  return null;
}

export function buildSpatialCorrectivePrompt(violation: SpatialContractViolation): string {
  return `<corrective_instruction>
Spatial contract violation: ${violation.message}
Return one corrected response now. Keep the same fiction, but either emit a map_actions move for
"${violation.actorId}" that reaches a legal position within its remaining movement before the attack,
or replace the attack with an action that is legal from where it stands. Do not explain the correction.
</corrective_instruction>`;
}
