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
import { actionFromPurpose } from './legacy-attack-translation.js';
import { readPlayerAttack, WEAPON_NOUN } from './player-attack-input.js';
import { combatLogger } from '../lib/logger.js';
import { isCombatDeescalationSpeech } from '../services/combat/combat-intent-gate.js';

import type { DigestEntity, TacticalDigest } from './digest-parse.js';
import type { DMResponse, DMTargetedCombatAction } from '../services/dm/dm-response-schema.js';

/**
 * Prose that is describing a strike rather than merely mentioning a creature. Two families:
 * things a combatant does, and things a combatant does it with. Run 9's pinned paragraph
 * ("drawing your blade to meet the chitinous threat head-on") carries no attack verb at all —
 * only the weapon — which is precisely why the noun family is not optional.
 */
const ATTACK_VERBS =
  /\b(?:attacks?|attacking|strikes?|striking|swings?|swinging|slash(?:es|ing)?|stabs?|stabbing|lunges?|lunging|thrusts?|thrusting|hacks?|hacking|slices?|slicing|cleaves?|cleaving|bites?|biting|claws?|clawing|mauls?|mauling|charges?|charging|pounces?|pouncing|snaps? at|swipes?|swiping|parr(?:y|ies|ying)|shoots?|shooting|fires?|firing|looses?|loosing|hurls?|hurling|blasts?|blasting|smash(?:es|ing)?|bashes|bashing|punch(?:es|ing|ed)?|kicks?|kicking|drives? .{0,20}\binto\b|wield(?:s|ing)?|brandish(?:es|ing)?)\b/i;

const ATTACK_NOUNS = new RegExp(`\\b(?:${WEAPON_NOUN})\\b`, 'i');

const INSTRUMENT_WEAPON = new RegExp(
  `\\bwith\\s+(?:my|the|a|his|her)\\s+(?:${WEAPON_NOUN})\\b`,
  'i',
);

/** Combat draw of a held weapon, not "draws water". */
const DRAW_WEAPON = new RegExp(
  `\\bdraw(?:s|ing|n)?\\s+(?:your|my|the|his|her)\\s+(?:${WEAPON_NOUN})\\b`,
  'i',
);

/** Narration that has already conceded the strike did not happen must not become one. */
const NEGATED =
  /\b(?:without\s+(?:attacking|striking)|holds?\s+(?:your|its|their|his|her)\s+(?:blade|attack|strike)|does\s+not\s+attack|refuses?\s+to\s+(?:attack|strike))\b/i;

const splitNarrationClauses = (text: string): string[] =>
  text
    .split(/(?<=[.!?;,])\s+|\s+\b(?:and|then|but)\b\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean);

export function hasAttackLanguage(text: string): boolean {
  if (NEGATED.test(text)) return false;
  return splitNarrationClauses(text).some((clause) => {
    if (isCombatDeescalationSpeech(clause)) return false;
    if (ATTACK_VERBS.test(clause)) return true;
    if (DRAW_WEAPON.test(clause)) return true;
    return ATTACK_NOUNS.test(clause) && INSTRUMENT_WEAPON.test(clause);
  });
}

/**
 * The weapon, only when the narration actually names one from the vocabulary above. The
 * legacy translator's `with the <thing>` reader is deliberately not reused here: a roll
 * request's purpose is one clause about one attack, while narration is a paragraph, and "meets
 * it with a snarl" would hand the engine `snarl` as a weapon id.
 */
const UNARMED_INTENT =
  /\b(?:punch(?:es|ing|ed)?|kicks?|kicking|fists?|head-?butts?|unarmed(?:\s+strike)?)\b/i;

function weaponIdFromProse(text: string): string | null {
  if (UNARMED_INTENT.test(text)) return 'unarmed-strike';
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
  strictTies = false,
): DigestEntity | 'tie' | null {
  const hostileOf = (id: string): DigestEntity | null => {
    if (!actor.relations.has(id)) return null;
    return digest.entities.get(id) ?? null;
  };
  let chosen: DigestEntity | 'tie' | null = null;
  for (const mention of collectEntityMentions(digest, text)) {
    const candidates = mention.ids
      .map(hostileOf)
      .filter((entity): entity is DigestEntity => !!entity);
    if (!candidates.length) continue;
    // A shared display name ("the Shadow Roach", three on the board) resolves the same way the
    // spatial contract resolves it: to the nearest one, never to an arbitrary one. For a
    // player's words a tie is not resolved at all: a wrong-target attack is worse than no prompt.
    chosen = nearestOf(actor, candidates, strictTies);
  }
  return chosen;
}

/** The nearest of `candidates`; on equal distance the first, or `'tie'` when ties are not allowed. */
function nearestOf(
  actor: DigestEntity,
  candidates: DigestEntity[],
  strictTies: boolean,
): DigestEntity | 'tie' {
  const distance = (entity: DigestEntity): number =>
    actor.relations.get(entity.id)?.distanceFeet ?? Infinity;
  const best = candidates.reduce((nearest, entity) =>
    distance(entity) < distance(nearest) ? entity : nearest,
  );
  const tied = candidates.filter((entity) => distance(entity) === distance(best));
  return strictTies && tied.length > 1 ? 'tie' : best;
}

/** The player named no creature ("I finish it off"): the nearest hostile on the board. */
function nearestHostile(digest: TacticalDigest, actor: DigestEntity): DigestEntity | 'tie' | null {
  const hostiles = [...actor.relations.keys()]
    .map((id) => digest.entities.get(id))
    .filter((entity): entity is DigestEntity => !!entity);
  return hostiles.length ? nearestOf(actor, hostiles, true) : null;
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
  playerInput?: string,
): ProseAttackInference | null {
  if (!combatActive) return null;
  if (declaresAnAttack(response)) return null;
  const text = response.text ?? '';
  const digest = parseTacticalDigest(prompt);
  if (!digest?.activeId) return null;
  const actor = digest.entities.get(digest.activeId);
  if (!actor) return null;

  // With player input the turn's attack is read from what the player affirmed (their target,
  // their weapon, their spell), never from the narration and never from what they refused. Without
  // input, narration is all there is.
  const playerWords = playerInput?.trim() ? playerInput : null;
  let source = text;
  if (playerWords) {
    const read = readPlayerAttack(playerWords, {
      namesHostile: (clause) => targetFromProse(digest, actor, clause) !== null,
      namesWeapon: (clause) => weaponIdFromProse(clause) !== null,
    });
    if (!read.declared) return null;
    source = read.source;
  } else if (!text.trim() || !hasAttackLanguage(text)) {
    return null;
  }

  // A player who names no creature ("I finish it off") means the nearest hostile on the board,
  // which is the engine's geometry; narration never picks the target for a player's words.
  let target = targetFromProse(digest, actor, source, Boolean(playerWords));
  if (target === null && playerWords) target = nearestHostile(digest, actor);
  if (target === 'tie') {
    combatLogger.info(
      { actorId: actor.id },
      '[tactical] prose floor: equidistant hostiles and no creature named by the player; no target inferred',
    );
    return null;
  }
  if (!target || target.id === actor.id) return null;

  // Narration of a spell is read as that spell or not at all (#2233): the same reader as the
  // roll-request translation, so prose about Chill Touch never becomes an Unarmed Strike.
  const spellAction = actionFromPurpose(source, actor.id, target.id);
  if (!spellAction) return null;
  const action: DMTargetedCombatAction =
    spellAction.action_type === 'cast_spell'
      ? spellAction
      : {
          actor_id: actor.id,
          action_type: 'attack',
          target_ids: [target.id],
          weapon_id: weaponIdFromProse(source),
          spell_id: null,
          slot_level: null,
          // Approach is the engine's job here for the same reason it is in the legacy
          // translation: declaring movement alongside it would double-count the distance.
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
