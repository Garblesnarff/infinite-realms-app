/**
 * Legacy-dialect adapter: an attack written as a `roll_request` becomes a real combat action.
 *
 * Run 8 settled the argument. The channel corrective fired on all eleven attacks in an
 * encounter, was worded correctly every time, and the model adopted `combat_actions` zero
 * times. Combat then stalled outright — four force-restarts in thirty turns — because an
 * attack in the wrong envelope is an attack nobody rolls. Discipline was the wrong tool: the
 * old dialect is not a mistake to be corrected out of the model, it is a dialect to be
 * translated on arrival.
 *
 * So an attack-shaped roll request during active combat is rewritten here into the
 * `combat_actions` entry it was always describing, using the same turn-context/purpose-text
 * pair inference the spatial contract already trusts. The synthesized action then flows
 * through the ordinary engine path — auto-approach, reach check, cover-adjusted AC,
 * `<engine_resolved_outcomes>` — exactly as if the model had written it that way.
 */
import { resolvePairFromText } from './attack-pair.js';
import { parseTacticalDigest } from './digest-parse.js';
import { describesSpellcasting, findPlayerCombatSpellInText } from '../data/spellData.js';
import { combatLogger } from '../lib/logger.js';

import type { TacticalDigest } from './digest-parse.js';
import type { DMResponse, DMTargetedCombatAction } from '../services/dm/dm-response-schema.js';

type RollRequest = DMResponse['roll_requests'][number];

/**
 * The weapon named in the purpose, as a slug. It is not decoration: `weapon_id` is the
 * spatial contract's melee/ranged signal, so "attack roll with longbow" must not be
 * reach-checked as a sword swing.
 */
const WEAPON_PHRASE = /\b(?:with|using)\s+(?:my|his|her|their|its|the|a|an)?\s*([a-z][a-z' -]*)/i;
const WEAPON_STOP = /\s+(?:against|at|on|toward|towards|targeting|vs\.?)\b/i;

const UNARMED_INTENT =
  /\b(?:punch(?:es|ing|ed)?|kicks?|kicking|fists?|head-?butts?|unarmed(?:\s+strike)?)\b/i;

export function weaponIdFromPurpose(purpose: string): string | null {
  if (UNARMED_INTENT.test(purpose)) return 'unarmed-strike';
  const match = WEAPON_PHRASE.exec(purpose);
  if (!match) return null;
  const phrase = match[1].split(WEAPON_STOP)[0].trim();
  if (!phrase) return null;
  return (
    phrase
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || null
  );
}

export type LegacyAttackTranslation = {
  purpose: string;
  action: DMTargetedCombatAction;
  /** How the pair was recovered; empty means the purpose named both sides outright. */
  fallbacks: string[];
};

export type LegacyAttackTranslationResult = {
  response: DMResponse;
  translations: LegacyAttackTranslation[];
  /** Attack roll requests the digest could not resolve into a pair; left where they were. */
  untranslated: string[];
  /**
   * Why each attack-shaped request was not turned into an engine action (#2563): a
   * reason code and ids only, never the purpose prose, so a `translations: []` log line
   * can say which rung of the ladder let go.
   */
  skipped: LegacyAttackSkip[];
};

/** Why an attack-shaped roll request produced no engine action. */
export type LegacyAttackSkip = {
  reason: 'pair_unresolved' | 'purpose_not_an_attack' | 'already_declared';
  actorId?: string;
  targetId?: string;
};

const isAttackRequest = (request: RollRequest): boolean => request.type === 'attack';

/**
 * The action a purpose describes, for a resolved actor/target pair.
 *
 * A spell attack is a spell (#2233): "Chill Touch spell attack vs the elemental" used to become
 * a weapon attack with no weapon, which a wizard with nothing equipped resolved as an Unarmed
 * Strike nobody declared. A purpose naming one player combat spell becomes that `cast_spell`;
 * a spell-shaped purpose that names none is not an attack of any kind and returns null.
 */
export function actionFromPurpose(
  purpose: string,
  actorId: string,
  targetId: string,
): DMTargetedCombatAction | null {
  const spell = findPlayerCombatSpellInText(purpose);
  if (spell) {
    return {
      actor_id: actorId,
      action_type: 'cast_spell',
      target_ids: [targetId],
      weapon_id: null,
      spell_id: spell.id,
      slot_level: spell.level > 0 ? spell.level : null,
      movement_feet: 0,
    };
  }
  if (describesSpellcasting(purpose)) return null;
  return {
    actor_id: actorId,
    action_type: 'attack',
    target_ids: [targetId],
    weapon_id: weaponIdFromPurpose(purpose),
    spell_id: null,
    slot_level: null,
    // Approach is the engine's job. Declaring movement here would double-count it.
    movement_feet: 0,
  };
}

/** An attack the model already declared properly must not be duplicated by a translation. */
function alreadyDeclared(response: DMResponse, actorId: string, targetId: string): boolean {
  return (response.combat_actions ?? []).some(
    (action) =>
      'target_ids' in action &&
      (action.action_type === 'attack' || action.action_type === 'cast_spell') &&
      action.actor_id === actorId &&
      (action.target_ids ?? []).includes(targetId),
  );
}

/**
 * Rewrites attack-shaped roll requests into `combat_actions`. Returns null when there is
 * nothing to translate — no active combat, no digest, or no attack in `roll_requests` — so
 * callers can leave the response untouched rather than re-serializing it for no reason.
 */
export function translateLegacyAttackRolls(
  response: DMResponse,
  prompt: string,
  combatActive: boolean,
): LegacyAttackTranslationResult | null {
  if (!combatActive) return null;
  const attacks = (response.roll_requests ?? []).filter(isAttackRequest);
  if (!attacks.length) return null;
  // The encounter id rides on every not-translated line so a grep lands on the fight
  // (#2563); ids only, no bodies — the same discipline as the skip reasons.
  const encounterField = ((): { encounterId?: string } => {
    const block = /<immutable_game_state>([\s\S]*?)<\/immutable_game_state>/.exec(prompt)?.[1];
    if (!block) return {};
    try {
      const state: unknown = JSON.parse(block);
      const encounterId = (state as { encounterId?: unknown } | null)?.encounterId;
      return typeof encounterId === 'string' && encounterId ? { encounterId } : {};
    } catch {
      return {};
    }
  })();
  const digest: TacticalDigest | null = parseTacticalDigest(prompt);
  // Without geometry there is no actor, no target, and nothing to synthesize. The response is
  // returned untouched so the existing contracts still see the request they were built for.
  if (!digest) {
    // The silence here is what #2563 removes: an attack-shaped request arrived during
    // active combat and produced no engine action, and the log said nothing at all.
    combatLogger.warn(
      {
        msg: 'DM_ATTACK_NOT_TRANSLATED',
        reason: 'no_digest',
        ...encounterField,
        requestCount: attacks.length,
      },
      '[tactical] attack-shaped roll requests arrived with no tactical digest',
    );
    return null;
  }

  const translations: LegacyAttackTranslation[] = [];
  const untranslated: string[] = [];
  const skipped: LegacyAttackSkip[] = [];
  const translated: DMTargetedCombatAction[] = [];
  const consumed = new Set<RollRequest>();

  for (const request of attacks) {
    const pair = resolvePairFromText(digest, request.purpose);
    if (!pair || pair.actor.id === pair.target.id) {
      untranslated.push(request.purpose);
      skipped.push({ reason: 'pair_unresolved' });
      continue;
    }
    const action = actionFromPurpose(request.purpose, pair.actor.id, pair.target.id);
    if (!action) {
      untranslated.push(request.purpose);
      skipped.push({
        reason: 'purpose_not_an_attack',
        actorId: pair.actor.id,
        targetId: pair.target.id,
      });
      continue;
    }
    consumed.add(request);
    if (alreadyDeclared(response, pair.actor.id, pair.target.id)) {
      // The model declared this attack in `combat_actions` AND repeated it as a roll
      // request. The action stands; the duplicate is dropped — and said so, because
      // run D5's log read `translations: []` with no way to tell this apart from a
      // translation that failed outright.
      skipped.push({
        reason: 'already_declared',
        actorId: pair.actor.id,
        targetId: pair.target.id,
      });
      continue;
    }
    translated.push(action);
    translations.push({ purpose: request.purpose, action, fallbacks: pair.fallbacks });
  }

  // One structured line per skipped request: reason code and ids, no bodies (#2563).
  // Logged before the nothing-consumed return so a response whose every attack fell
  // through still says why.
  for (const skip of skipped)
    combatLogger.warn(
      { msg: 'DM_ATTACK_NOT_TRANSLATED', ...skip, ...encounterField, activeId: digest.activeId },
      '[tactical] an attack-shaped roll_request produced no engine action',
    );

  if (!consumed.size) return null;

  for (const translation of translations)
    combatLogger.info(
      {
        purpose: translation.purpose,
        action: translation.action,
        fallbacks: translation.fallbacks,
        activeId: digest.activeId,
      },
      '[tactical] translated a legacy attack roll_request into a combat_action',
    );

  return {
    response: {
      ...response,
      roll_requests: (response.roll_requests ?? []).filter((request) => !consumed.has(request)),
      combat_actions: [...(response.combat_actions ?? []), ...translated],
    },
    translations,
    untranslated,
    skipped,
  };
}

/**
 * The one-time teaching hint. It carries the JSON the model should have written, with the
 * live slugs from this turn's digest rather than placeholders — a corrective that names
 * `shadow-roach-1` teaches; one that names `<actor_id>` has to be decoded first.
 */
export function buildLegacyAttackHintPrompt(result: LegacyAttackTranslationResult): string {
  const example = JSON.stringify(result.translations.map((translation) => translation.action));
  const purposes = result.translations
    .map((translation) => JSON.stringify(translation.purpose))
    .join(', ');
  return `<corrective_instruction>
While combat is active, attacks belong in combat_actions, where they name an actor and a target
the engine can path, reach-check, and resolve. roll_requests is reserved for saving throws and
ability checks.

The prior response put these attacks in roll_requests: ${purposes}.
The server has already translated them and they will resolve either way — this is how to write
them yourself next time, using the ids from the current tactical digest:

"combat_actions": ${example}

Return one corrected response now. Keep the same fiction, carry those attacks in combat_actions,
and leave roll_requests holding only saves and checks. Do not add map_actions to close distance:
the engine moves the attacker into reach. Do not explain the correction.
</corrective_instruction>`;
}
