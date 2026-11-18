import type {
  CombatRefusalDetails,
  CombatIntentRefusedError,
  StructuredCombatAction,
} from '@/services/combat/combat-action-executor';

import { renderPlayerCombatWording } from '@/services/combat/player-combat-wording';

export const COMBAT_INTENT_SCHEMA_REJECTED = 'COMBAT_INTENT_SCHEMA_REJECTED';
export const COMBAT_INTENT_OUT_OF_TURN = 'COMBAT_INTENT_OUT_OF_TURN';
/** The target the action named is not a combatant in this fight (#2438). */
export const COMBAT_INTENT_UNRESOLVED_TARGET = 'COMBAT_INTENT_UNRESOLVED_TARGET';

export function combatRefusalReason(
  refusal: Pick<CombatIntentRefusedError, 'message' | 'details'>,
): string {
  const details = refusal.details;
  if (typeof details?.reason === 'string' && details.reason.trim()) return details.reason;
  if (details?.resource === 'Combat participant' && details.role === 'target') {
    return COMBAT_INTENT_UNRESOLVED_TARGET;
  }
  if (details?.stage === 'intent_schema') return COMBAT_INTENT_SCHEMA_REJECTED;
  if (details?.currentParticipantId || details?.currentParticipantSlug) {
    return COMBAT_INTENT_OUT_OF_TURN;
  }
  if (/current[- ]turn|out of turn/i.test(refusal.message)) return COMBAT_INTENT_OUT_OF_TURN;
  return 'COMBAT_INTENT_REFUSED';
}

/**
 * The sentence the engine's refusal line prints in brackets. A player can act on "not your turn"
 * or "no target selected"; they cannot act on "Actor is not the current-turn participant" or
 * "Validation failed" (#2374). Refusals that already say what to do keep their own words.
 */
export function playerFacingRefusal(
  refusal: Pick<CombatIntentRefusedError, 'message' | 'details'>,
  who: { actorIsPlayer: boolean; actor: string; turnHolder: string | null },
): string {
  const reason = combatRefusalReason(refusal);
  if (reason === COMBAT_INTENT_OUT_OF_TURN) {
    const subject = who.actorIsPlayer ? 'your' : `${who.actor}'s`;
    return `it is not ${subject} turn${who.turnHolder ? ` — ${who.turnHolder} acts now` : ''}`;
  }
  if (reason === COMBAT_INTENT_UNRESOLVED_TARGET) {
    return 'no creature by that name is in this fight — name one of the creatures on the board';
  }
  if (reason === COMBAT_INTENT_SCHEMA_REJECTED && refusal.details?.missing?.includes('targetIds')) {
    return 'no target selected — name the creature you cast it at';
  }
  // The envelope's own 422 carries no stage, only the framework's label.
  if (reason === COMBAT_INTENT_SCHEMA_REJECTED || /^validation failed$/i.test(refusal.message)) {
    return 'the game could not read that cast — cast it again and name your target';
  }
  return renderPlayerCombatWording(refusal.message);
}

export function turnNotice(
  turnHolder: { id?: string; name?: string; displayName?: string | null } | null,
  holderIsPlayer: boolean,
  reason?: string,
): string {
  if (reason === COMBAT_INTENT_SCHEMA_REJECTED) {
    return "*(Couldn't read that action, retrying…)*";
  }
  if (holderIsPlayer)
    return '*(Your action was declared out of turn and was not resolved — it is your turn now.)*';
  const who = turnHolder?.displayName ?? turnHolder?.name ?? turnHolder?.id;
  return who
    ? `*(Your declared action has not been resolved — it is ${who}'s turn.)*`
    : '*(Your declared action has not been resolved — it is not your turn yet.)*';
}

/**
 * The player's own action was refused for a reason other than turn order — a spell area that
 * caught nobody, a spell the DM never declared. Nothing resolved, so nothing ended the turn.
 */
export function stillYourTurnNotice(reason?: string): string {
  const explanation = renderPlayerCombatWording(
    reason?.trim() || 'the game could not resolve that action',
  );
  return `*(Your declared action was not resolved: ${explanation} — it is still your turn. You can choose another action or End turn.)*`;
}

/**
 * The player named a target that is not in the fight. The creatures that are here are listed so
 * they can pick one (#2438). Nothing about this refusal moved the turn, but a creature's action
 * resolved in the same reply (a repair) can have: the notice says "nothing was resolved" only
 * when nothing was, and names the turn holder, in `turnNotice`'s words, when it is not the player.
 */
export function unresolvedTargetNotice(
  creatures: readonly string[],
  turn: {
    holder: { id?: string; name?: string; displayName?: string | null } | null;
    holderIsPlayer: boolean;
  },
  resolvedEarlier: boolean,
): string {
  const lead = 'No creature by that name is in this fight';
  const outcome = resolvedEarlier ? 'that action was not resolved' : 'nothing was resolved';
  if (!turn.holderIsPlayer) {
    const here = creatures.length ? ` The creatures here: ${creatures.join(', ')}.` : '';
    return `*(${lead}, so ${outcome}.${here})*\n\n${turnNotice(turn.holder, false)}`;
  }
  const who = creatures.length ? ` Who do you mean: ${creatures.join(', ')}?` : '';
  return `*(${lead}, so ${outcome} — it is ${resolvedEarlier ? 'your turn' : 'still your turn'}.${who})*`;
}

/**
 * The player's message declared no combat action at all — talk, a look, a wait — so the engine
 * had nothing to resolve for it and the turn stays open (#2342). When NPC turns were resolved in
 * the same reply, "nothing was rolled" would be untrue, so the line speaks only for the player.
 * Plain text: an engine chip renders it as-is, so no markdown wrapper (#614 FIX).
 */
export function noMechanicalActionNotice(hadEngineLines = false): string {
  return hadEngineLines
    ? 'You took no combat action this turn. It is still your turn.'
    : 'That was not a combat action — nothing was rolled. It is still your turn.';
}

/**
 * A rest is not an action the engine resolves in a fight (2014 SRD: a short or long rest needs
 * time out of combat). The player is told so in an engine line, not in the DM's prose (#614).
 */
export const REST_IN_COMBAT_NOTICE = 'A rest is not possible during combat. It is still your turn.';

/** Player-facing names for the declared action kinds the engine has no owner for (#1640). */
const UNSUPPORTED_ACTION_NAMES: ReadonlyMap<string, string> = new Map([
  ['help', 'Help'],
  ['ready', 'Ready'],
  ['use_object', 'Use an Object'],
]);

/** The line for an unknown kind: the same choices, without naming the action (#1640). */
export const UNSUPPORTED_ACTION_GENERIC_NOTICE =
  'That action is not supported yet. Your turn is not used: choose Attack, Dodge, Dash, Disengage or Hide.';

/**
 * The player declared an action the engine cannot resolve (Help, Ready, Use an Object). Their
 * turn is not used, and the line names the choices they still have. Plain text, no markdown:
 * it is an engine line (#614, #1640).
 */
export function unsupportedActionNotice(actionKind: string | null | undefined): string {
  const name = actionKind ? UNSUPPORTED_ACTION_NAMES.get(actionKind) : undefined;
  if (!name) return UNSUPPORTED_ACTION_GENERIC_NOTICE;
  return `${name} is not a supported action yet. Your turn is not used: choose Attack, Dodge, Dash, Disengage or Hide.`;
}

/**
 * The player's typed message asks to rest: "a short rest", "take a long rest", "I rest", "make
 * camp". A rest is named as the player's own act, so "rest my hand on the wall" is not one (#614).
 */
export function isRestRequest(message: string | null | undefined): boolean {
  const text = message ?? '';
  if (
    /\b(?:short|long)\s+rest\b|\btake\s+a\s+rest\b|\b(?:make|set\s+up)\s+camp\b|\bgo\s+to\s+sleep\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return /\bi\s+(?:want\s+to\s+|try\s+to\s+|would\s+like\s+to\s+|will\s+|'ll\s+|can\s+)?rest\b(?!\s+(?:against|on|upon|my|your|his|her|their|a|an|the|one)\b)/i.test(
    text,
  );
}

/**
 * The player's refused declaration was repaired into the turn holder's own action, and the turn
 * is still not the player's. Nothing was "declared out of turn" from the player's point of view
 * any more — they only need to know who acts before them.
 */
export function repairedTurnNotice(
  turnHolder: { id?: string; name?: string; displayName?: string | null } | null,
): string {
  const who = turnHolder?.displayName ?? turnHolder?.name ?? turnHolder?.id;
  return who ? `*(${who} acts next.)*` : '*(It is not your turn yet.)*';
}

/** Preserve the action shape for schema debugging without logging participant or asset IDs. */
export function redactedCombatIntent(action: StructuredCombatAction): Record<string, unknown> {
  return {
    actor_id: '[redacted]',
    action_type: action.action_type,
    target_ids: action.target_ids.map(() => '[redacted]'),
    weapon_id: action.weapon_id ? '[redacted]' : null,
    spell_id: action.spell_id ? '[redacted]' : null,
    slot_level: action.slot_level,
    movement_feet: action.movement_feet,
    ...(typeof action.x === 'number' ? { x: action.x } : {}),
    ...(typeof action.y === 'number' ? { y: action.y } : {}),
    presentFields: Object.keys(action).sort(),
  };
}

export type { CombatRefusalDetails };
