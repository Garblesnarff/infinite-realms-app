import { collectEntityMentions } from './attack-pair.js';
import { parseTacticalDigest } from './digest-parse.js';
import { readPlayerAttack, WEAPON_NOUN } from './player-attack-input.js';
import { findPlayerCombatSpellInText } from '../data/spellData.js';

import type { DMResponse, DMCombatAction } from '../services/dm/dm-response-schema.js';

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
  if (!read.declared) return null;
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
    if (!modelDeclaredAttack) return null;
    const weapon = new RegExp(`\\b(?:${WEAPON_NOUN})\\b`, 'i').exec(read.source)?.[0];
    if (!target) return null;
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
