import {
  CombatIntentRefusedError,
  combatBoundaryFromResult,
  type CombatRefusalDetails,
  type StructuredCombatAction,
  type StructuredCombatActionExecution,
} from './combat-action-executor';

import type { CombatActionOrigin } from './combat-action-origin';
import type { DMAoESpellAction } from '@/services/ai/dm-response-schema';

import { userDataApi } from '@/services/user-data-api';

/** The server answered with a preview the player must confirm on the map; nothing was cast. */
export const AOE_AWAITING_CONFIRMATION = 'AOE_AWAITING_CONFIRMATION';

/** The route's schema refused the body: the cast was never looked at by the engine. */
export const AOE_CAST_UNREADABLE = 'aoe_cast_unreadable';

export const isAoESpellAction = (action: unknown): action is DMAoESpellAction =>
  Boolean(
    action &&
    typeof action === 'object' &&
    (action as { action_type?: unknown }).action_type === 'cast_spell' &&
    'origin' in action &&
    !('target_ids' in action),
  );

type AoECastTarget = { entityId: string };
type AoECastResponse = {
  delta?: { actorId?: string; targets?: AoECastTarget[] };
  result?: unknown;
  preview?: unknown;
  error?: string;
  details?: CombatRefusalDetails;
  /** Present when the route's body schema refused the request (`Validation failed`). */
  issues?: Array<{ path?: string; message?: string }>;
};

/** The wire's `slotLevel` is a slot (1-9) or `null`: a cantrip spends none, whatever the DM wrote. */
export const slotLevelOf = (slotLevel: number | null): number | null =>
  typeof slotLevel === 'number' && slotLevel >= 1 ? slotLevel : null;

/**
 * An area spell, cast through the one route that knows the board (#2304).
 *
 * The DM names an origin rather than targets, so the tactical engine picks the targets and then
 * hands them to the same spell resolution a targeted cast uses. What comes back is shaped like
 * any other execution, plus the targeted action the engine actually resolved — so the caller
 * prints the same engine line, ends the same turn, and narrates the same result. A refusal is a
 * `CombatIntentRefusedError`, never a logged-and-forgotten warning: that warning is how a
 * Burning Hands produced no engine line, spent no slot, and left the DM to invent the turn.
 */
export async function executeAoECombatAction(
  sessionId: string,
  action: DMAoESpellAction,
  /** Who produced the action; the server refuses a player action no player input made (#2305). */
  origin?: CombatActionOrigin,
  signal?: AbortSignal,
): Promise<{ execution: StructuredCombatActionExecution; resolvedAction: StructuredCombatAction }> {
  // `actionOrigin` rides beside the payload type rather than in it: `AoECastPayload` lives in
  // `user-data-api.ts`, which an unrelated open PR is editing (AGENTS.md §5).
  const payload = {
    phase: 'propose' as const,
    actorId: action.actor_id,
    spellId: action.spell_id,
    origin: action.origin,
    direction: action.direction,
    slotLevel: slotLevelOf(action.slot_level),
    ...(origin ? { actionOrigin: origin } : {}),
  };
  const response = signal
    ? await userDataApi.resolveAoECast(sessionId, payload, signal)
    : await userDataApi.resolveAoECast(sessionId, payload);
  const answer = ((await response.json().catch(() => ({}))) ?? {}) as AoECastResponse;
  if (!response.ok) {
    if (answer.issues?.length) {
      // The body schema refused the request, so the cast never reached the engine. The fields
      // ride in `detail` for the log; the player is told the cast was not read, not "Validation
      // failed".
      throw new CombatIntentRefusedError(
        'the game could not read that cast — cast it again and name your target',
        response.status,
        {
          reason: AOE_CAST_UNREADABLE,
          detail: answer.issues.map((issue) => issue.path || 'body').join(', '),
        },
      );
    }
    throw new CombatIntentRefusedError(
      answer.error || `AoE cast refused (${response.status})`,
      response.status,
      answer.details,
    );
  }
  if (!answer.delta) {
    // A player area that is not cast from Self waits for the map's "Confirm spell area".
    throw new CombatIntentRefusedError(
      'the spell area is placed on the tactical map — confirm it there to cast the spell',
      409,
      { reason: AOE_AWAITING_CONFIRMATION },
    );
  }
  const resolvedAction: StructuredCombatAction = {
    actor_id: answer.delta.actorId || action.actor_id,
    action_type: 'cast_spell',
    target_ids: (answer.delta.targets ?? []).map((target) => target.entityId),
    weapon_id: null,
    spell_id: action.spell_id,
    slot_level: slotLevelOf(action.slot_level),
    movement_feet: 0,
  };
  const result = answer.result;
  const boundary = combatBoundaryFromResult(result);
  const outcomes = (
    (result as { results?: Array<Record<string, unknown>> } | undefined)?.results ?? []
  ).map((outcome, index) => ({
    participantId: resolvedAction.target_ids[index] ?? resolvedAction.target_ids[0],
    newHp: outcome.targetNewHp as number | undefined,
    hit: outcome.hit as boolean | undefined,
    finalDamage: outcome.finalDamage as number | undefined,
    isCritical: outcome.isCritical as boolean | undefined,
  }));
  return { execution: { outcomes, result, boundary }, resolvedAction };
}
