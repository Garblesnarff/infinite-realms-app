/**
 * The floor: an attack that exists only as prose still reaches the engine.
 *
 * Run 9 is why this module exists. The model emitted zero attack `roll_requests` and zero
 * `combat_actions` across thirty turns while narrating twenty-three attacks in plain English,
 * so both structured channels — the one the prompt taught and the one the server translated —
 * had nothing to carry. Translation-on-arrival cannot save an arrival that never happens.
 *
 * So the last channel is the one the model never stops using. During active combat, a response
 * that declares nothing but whose narration names a live hostile in attack language is read as
 * the attack it plainly describes, and the synthesized `combat_action` flows through the
 * ordinary engine path exactly as a declared one would.
 *
 * This is deliberately the LAST resort, not the first: it only runs when both structured
 * channels are empty, so a model that speaks either dialect is never second-guessed by a
 * regex. Every inference is logged, because an attack the server inferred rather than read is
 * evidence about elicitation, not a silent success.
 */
import { collectEntityMentions } from './attack-pair.js';
import { parseTacticalDigest } from './digest-parse.js';
import { combatLogger } from '../lib/logger.js';

import type { DigestEntity, TacticalDigest } from './digest-parse.js';
import type { DMResponse, DMTargetedCombatAction } from '../services/dm/dm-response-schema.js';

/**
 * Prose that is describing a strike rather than merely mentioning a creature. Two families:
 * things a combatant does, and things a combatant does it with. Run 9's pinned paragraph
 * ("drawing your blade to meet the chitinous threat head-on") carries no attack verb at all —
 * only the weapon — which is precisely why the noun family is not optional.
 */
const ATTACK_VERBS =
  /\b(?:attacks?|attacking|strikes?|striking|swings?|swinging|slash(?:es|ing)?|stabs?|stabbing|lunges?|lunging|thrusts?|thrusting|hacks?|hacking|slices?|slicing|cleaves?|cleaving|bites?|biting|claws?|clawing|mauls?|mauling|charges?|charging|pounces?|pouncing|snaps? at|swipes?|swiping|parr(?:y|ies|ying)|shoots?|shooting|fires?|firing|looses?|loosing|hurls?|hurling|blasts?|blasting|smash(?:es|ing)?|bashes|bashing|drives? .{0,20}\binto\b)\b/i;

const ATTACK_NOUNS =
  /\b(?:blade|sword|longsword|shortsword|greatsword|rapier|scimitar|dagger|axe|greataxe|handaxe|mace|hammer|warhammer|maul|spear|glaive|halberd|pike|quarterstaff|staff|club|flail|whip|bow|longbow|shortbow|crossbow|sling|javelin|dart|bolt|arrow|fangs?|talons?|claws?|mandibles?|pincers?|stinger|weapon)\b/i;

/** Narration that has already conceded the strike did not happen must not become one. */
const NEGATED =
  /\b(?:without\s+(?:attacking|striking)|holds?\s+(?:your|its|their|his|her)\s+(?:blade|attack|strike)|does\s+not\s+attack|refuses?\s+to\s+(?:attack|strike))\b/i;

export function hasAttackLanguage(text: string): boolean {
  if (NEGATED.test(text)) return false;
  return ATTACK_VERBS.test(text) || ATTACK_NOUNS.test(text);
}

/**
 * The weapon, only when the narration actually names one from the vocabulary above. The
 * legacy translator's `with the <thing>` reader is deliberately not reused here: a roll
 * request's purpose is one clause about one attack, while narration is a paragraph, and "meets
 * it with a snarl" would hand the engine `snarl` as a weapon id.
 */
function weaponIdFromProse(text: string): string | null {
  const match = ATTACK_NOUNS.exec(text);
  if (!match) return null;
  const noun = match[0].toLowerCase();
  return noun === 'weapon' ? null : noun;
}

export type ProseAttackInference = {
  action: DMTargetedCombatAction;
  /** The narration the action was read out of, for the log and the transcript. */
  text: string;
  actorId: string;
  targetId: string;
  targetLabel: string;
  distanceFeet: number;
};

/** True when the response already carries an attack in either structured channel. */
function declaresAnAttack(response: DMResponse): boolean {
  if ((response.roll_requests ?? []).some((request) => request.type === 'attack')) return true;
  return (response.combat_actions ?? []).some(
    (action) =>
      !('target_ids' in action) ||
      action.action_type === 'attack' ||
      action.action_type === 'cast_spell',
  );
}

/**
 * The hostile the narration is striking at.
 *
 * The actor is never inferred: during active combat only the ACTIVE entity may act, so the
 * digest's own turn marker is the actor and prose that suggests otherwise is fiction about
 * someone else's turn. Among the creatures the text names, only the active entity's hostiles
 * are eligible (the digest lists an entity's enemies in `vs[...]`), and the last one named
 * wins — narration introduces the scene and then arrives at its target.
 */
function targetFromProse(
  digest: TacticalDigest,
  actor: DigestEntity,
  text: string,
): DigestEntity | null {
  const hostileOf = (id: string): DigestEntity | null => {
    if (!actor.relations.has(id)) return null;
    return digest.entities.get(id) ?? null;
  };
  let chosen: DigestEntity | null = null;
  for (const mention of collectEntityMentions(digest, text)) {
    const candidates = mention.ids
      .map(hostileOf)
      .filter((entity): entity is DigestEntity => !!entity);
    if (!candidates.length) continue;
    // A shared display name ("the Shadow Roach", three on the board) resolves the same way the
    // spatial contract resolves it: to the nearest one, never to an arbitrary one.
    chosen = candidates.reduce((best, entity) =>
      (actor.relations.get(entity.id)?.distanceFeet ?? Infinity) <
      (actor.relations.get(best.id)?.distanceFeet ?? Infinity)
        ? entity
        : best,
    );
  }
  return chosen;
}

/**
 * Reads an attack out of narration when nothing else declared one. Returns null whenever the
 * response already speaks a structured dialect, combat is not active, geometry is missing, or
 * the prose does not actually name a live hostile in attack language.
 */
export function inferProseAttackIntent(
  response: DMResponse,
  prompt: string,
  combatActive: boolean,
): ProseAttackInference | null {
  if (!combatActive) return null;
  if (declaresAnAttack(response)) return null;
  const text = response.text ?? '';
  if (!text.trim() || !hasAttackLanguage(text)) return null;

  const digest = parseTacticalDigest(prompt);
  if (!digest?.activeId) return null;
  const actor = digest.entities.get(digest.activeId);
  if (!actor) return null;

  const target = targetFromProse(digest, actor, text);
  if (!target || target.id === actor.id) return null;

  const action: DMTargetedCombatAction = {
    actor_id: actor.id,
    action_type: 'attack',
    target_ids: [target.id],
    weapon_id: weaponIdFromProse(text),
    spell_id: null,
    slot_level: null,
    // Approach is the engine's job here for the same reason it is in the legacy translation:
    // declaring movement alongside it would double-count the distance.
    movement_feet: 0,
  };
  return {
    action,
    text,
    actorId: actor.id,
    targetId: target.id,
    targetLabel: target.name || target.id,
    distanceFeet: actor.relations.get(target.id)?.distanceFeet ?? -1,
  };
}

/**
 * Adds the inferred attack to the response so everything downstream — the client's
 * `combat_actions` execution, the engine, `<engine_resolved_outcomes>` — sees an ordinary
 * declared action. The narration is left exactly as written: the model's fiction is not the
 * part that was wrong.
 */
export function applyProseAttackIntent(
  response: DMResponse,
  inference: ProseAttackInference,
): DMResponse {
  combatLogger.info(
    {
      actorId: inference.actorId,
      targetId: inference.targetId,
      distanceFeet: inference.distanceFeet,
      action: inference.action,
      text: inference.text.slice(0, 300),
    },
    '[tactical] inferred a combat_action from narration: no attack was declared in either channel',
  );
  return {
    ...response,
    combat_actions: [...(response.combat_actions ?? []), inference.action],
  };
}
