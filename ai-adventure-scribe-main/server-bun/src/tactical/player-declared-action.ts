import { collectEntityMentions } from './attack-pair.js';
import { parseTacticalDigest } from './digest-parse.js';
import { narratedCastInsteadOfWeaponAttack } from './narrated-player-cast.js';
import { readPlayerAttack, WEAPON_NOUN } from './player-attack-input.js';
import {
  contradictsEngineOutcome,
  spliceContradictingSentences,
} from '../../../shared/narration-harm.js';
import { findPlayerCombatSpellInText } from '../data/spellData.js';

import type { DMCombatAction, DMResponse } from '../services/dm/dm-response-schema.js';

/** An unrolled attack has not hit, missed, or dealt damage (#612). */
const UNROLLED_HIT = /\b(?:hits?|strikes?|damage[ds]?)\b/i;

/** Shown when every sentence was a verdict. Must not itself be a hit, miss, or damage claim. */
const UNROLLED_ATTACK_FALLBACK = 'The attack waits on your roll.';

/**
 * A declared attack has not been rolled yet (#612). Drop a sentence that already
 * calls it a miss or a hit. The shared detector, run both ways, catches a miss.
 * A hit or a damage figure is not a contradiction of either side, so those
 * sentences are dropped on their own. A reply that was only the verdict keeps
 * one neutral line.
 */
function withoutUnrolledAttackVerdict(text: string, description: string): string {
  let next = text;
  for (const success of [true, false]) {
    const claims = contradictsEngineOutcome(next, {
      success,
      requestType: 'attack',
      description,
    });
    if (claims.length) next = spliceContradictingSentences(next, claims, '');
  }
  const kept = next
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && !UNROLLED_HIT.test(sentence));
  const joined = kept.join(' ').trim();
  return joined.length > 0 ? joined : UNROLLED_ATTACK_FALLBACK;
}

function requestPlayerAim(response: DMResponse): { response: DMResponse; awaitingTarget: boolean } {
  return {
    response: {
      ...response,
      text: 'Who do you aim at?',
      combat_transition: 'none',
      narration_segments: [],
      roll_requests: [],
      combat_actions: [],
      map_actions: [],
      options: [],
    },
    awaitingTarget: true,
  };
}

/** Ground the player's cast/weapon before accepting a model-selected target or weapon (#823). */
export function groundPlayerDeclaredAction(
  response: DMResponse,
  prompt: string,
  playerInput: string | undefined,
): { response: DMResponse; awaitingTarget: boolean } | null {
  if (!playerInput) return null;
  const digest = parseTacticalDigest(prompt);
  const actor = digest?.activeId ? digest.entities.get(digest.activeId) : null;
  if (!digest || !actor) return null;
  const read = readPlayerAttack(playerInput, {
    namesHostile: (text) => collectEntityMentions(digest, text).length > 0,
    namesWeapon: (text) => new RegExp(`\\b(?:${WEAPON_NOUN})\\b`, 'i').test(text),
  });
  // A cast the engine cannot resolve must not keep the model's weapon attack (#1171).
  // A swing declared beside it still owns the turn: `read.declared` is already true.
  if (!read.declared) {
    return narratedCastInsteadOfWeaponAttack(response, digest, actor, playerInput);
  }
  const spell = findPlayerCombatSpellInText(read.source);
  const targets = [
    ...new Set(
      collectEntityMentions(digest, read.source)
        .flatMap((mention) => mention.ids)
        .filter((id) => actor.relations.has(id)),
    ),
  ];
  const target = targets.length === 1 ? digest.entities.get(targets[0]) : null;
  const modelDeclaredAttack =
    response.combat_actions.some(
      (a) =>
        a.actor_id === actor.id && (a.action_type === 'attack' || a.action_type === 'cast_spell'),
    ) || response.roll_requests.some((r) => r.type === 'attack');
  if (!spell) {
    const weapon = new RegExp(`\\b(?:${WEAPON_NOUN})\\b`, 'i').exec(read.source)?.[0];
    // No named target: keep today's split. A model attack asks who to aim at. A model
    // that declared nothing falls through to the prose floor, which may take the nearest hostile.
    if (!target) {
      if (!modelDeclaredAttack) return null;
      return requestPlayerAim(response);
    }
    const unarmed = /\b(?:punch\w*|kick\w*|unarmed(?: strike)?|fists?)\b/i.test(read.source);
    const action: DMCombatAction = {
      actor_id: actor.id,
      action_type: 'attack',
      target_ids: [target.id],
      weapon_id: unarmed
        ? 'unarmed-strike'
        : weapon?.toLowerCase() === 'weapon'
          ? null
          : (weapon?.toLowerCase() ?? null),
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    };
    // The player named one hostile. That is the attack, even when the model wrote
    // only a miss and no action (#612). The die has not been rolled.
    const description = `${action.weapon_id ?? 'attack'} against ${target.name || target.id}`;
    return {
      response: {
        ...response,
        text: withoutUnrolledAttackVerdict(response.text ?? '', description),
        // The die has not been rolled, so a fabricated hit cannot change HP (#612).
        damage: null,
        combat_actions: [
          ...response.combat_actions.filter(
            (a) =>
              a.actor_id !== actor.id ||
              (a.action_type !== 'attack' && a.action_type !== 'cast_spell'),
          ),
          action,
        ],
        roll_requests: response.roll_requests.filter(
          (r) => r.type !== 'attack' && r.type !== 'damage',
        ),
      },
      awaitingTarget: false,
    };
  }
  const cone = spell.areaOfEffect?.shape === 'cone';
  if (spell.areaOfEffect && !cone) return null;
  const modelCast = response.combat_actions.find(
    (a) => a.actor_id === actor.id && a.action_type === 'cast_spell' && a.spell_id === spell.id,
  );
  const slotLevel = spell.level === 0 ? null : (modelCast?.slot_level ?? spell.level);
  const compass = /\b(north(?:east|west)?|south(?:east|west)?|east|west)\b/i
    .exec(read.source)?.[1]
    .toLowerCase();
  const direction = target
    ? { x: target.x - actor.x, y: target.y - actor.y }
    : cone && compass
      ? {
          x: compass.includes('east') ? 1 : compass.includes('west') ? -1 : 0,
          y: compass.includes('north') ? -1 : compass.includes('south') ? 1 : 0,
        }
      : null;
  if ((!cone && !target) || (cone && (!direction || (!direction.x && !direction.y)))) {
    return requestPlayerAim(response);
  }
  if (!cone && !modelDeclaredAttack) return null;
  const action: DMCombatAction = cone
    ? {
        actor_id: actor.id,
        action_type: 'cast_spell',
        spell_id: spell.id,
        slot_level: slotLevel,
        origin: { x: actor.x, y: actor.y },
        direction,
      }
    : {
        actor_id: actor.id,
        action_type: 'cast_spell',
        spell_id: spell.id,
        slot_level: slotLevel,
        target_ids: [target!.id],
        weapon_id: null,
        movement_feet: 0,
      };
  return {
    response: {
      ...response,
      combat_actions: [
        ...response.combat_actions.filter(
          (a) =>
            a.actor_id !== actor.id ||
            (a.action_type !== 'attack' && a.action_type !== 'cast_spell'),
        ),
        action,
      ],
      roll_requests: response.roll_requests.filter((r) => r.type !== 'attack'),
    },
    awaitingTarget: false,
  };
}
