import { collectEntityMentions } from './attack-pair.js';
import { playerAffirmedText } from './player-attack-input.js';
import { allSpells, assessPlayerCombatSpell } from '../data/spellData.js';

import type { DigestEntity, TacticalDigest } from './digest-parse.js';
import type { Spell } from '../data/spellData.js';
import type { DMCombatAction, DMResponse } from '../services/dm/dm-response-schema.js';

/** Longer names first, so "Charm Person" wins over a shorter prefix of the same words. */
const SPELLS_BY_NAME_LENGTH = [...allSpells].sort((a, b) => b.name.length - a.name.length);

const CAST_VERB = /\b(?:cast|casts|casting)\s+(?:the\s+spell\s+)?/gi;

/** The catalog spell named immediately after one cast verb. */
function spellAfterCast(text: string, from: number): Spell | undefined {
  const slice = text.slice(from).toLowerCase();
  for (const spell of SPELLS_BY_NAME_LENGTH) {
    const name = spell.name.toLowerCase();
    if (!slice.startsWith(name)) continue;
    const next = slice[name.length];
    if (next && /[a-z0-9]/i.test(next)) continue;
    return spell;
  }
  return undefined;
}

/**
 * Catalog spells the player cast that the combat engine will not resolve (#1171).
 * An engine spell (Fire Bolt, Hex, Bless) is absent: that cast already has a path.
 * A refused cast is absent: `playerAffirmedText` cuts it before this runs.
 * A cast verb that names no catalog spell makes the whole line not this case.
 */
function narratedCasts(playerInput: string): Spell[] {
  const affirmed = playerAffirmedText(playerInput);
  if (!affirmed.trim()) return [];
  const spells: Spell[] = [];
  CAST_VERB.lastIndex = 0;
  for (const match of affirmed.matchAll(CAST_VERB)) {
    const spell = spellAfterCast(affirmed, match.index + match[0].length);
    if (!spell) return [];
    const verdict = assessPlayerCombatSpell(
      spell.id,
      spell.name,
      spell.level > 0 ? spell.level : null,
    );
    if (verdict.castable) return [];
    if (
      verdict.reason !== 'unsupported_spell' &&
      verdict.reason !== 'unsupported_spell_resolution'
    ) {
      return [];
    }
    spells.push(spell);
  }
  return spells;
}

/** One hostile the cast names. Several names, or none, leave the target for the DM. */
function narratedCastTarget(
  digest: TacticalDigest,
  actor: DigestEntity,
  playerInput: string,
): string | null {
  const ids = [
    ...new Set(
      collectEntityMentions(digest, playerInput)
        .flatMap((mention) => mention.ids)
        .filter((id) => actor.relations.has(id)),
    ),
  ];
  return ids.length === 1 ? ids[0] : null;
}

function withoutPlayerStrikes(
  response: DMResponse,
  actorId: string,
  attacksOnly: boolean,
): DMResponse {
  return {
    ...response,
    combat_actions: response.combat_actions.filter(
      (existing) =>
        existing.actor_id !== actorId ||
        (existing.action_type !== 'attack' &&
          (attacksOnly || existing.action_type !== 'cast_spell')),
    ),
    roll_requests: response.roll_requests.filter((request) => request.type !== 'attack'),
  };
}

/**
 * A typed cast the engine cannot resolve, with no swing beside it (#1171).
 * Returns null when the line is not that cast, so the weapon and engine-spell
 * paths keep the turn. One such spell replaces the model's weapon attack with
 * that `cast_spell`. The spell popup skips it, and the engine answers with the
 * existing "no attack roll or damage" refusal.
 */
export function narratedCastInsteadOfWeaponAttack(
  response: DMResponse,
  digest: TacticalDigest,
  actor: DigestEntity,
  playerInput: string,
): { response: DMResponse; awaitingTarget: false } | null {
  const narrated = narratedCasts(playerInput);
  if (!narrated.length) return null;
  if (narrated.length > 1) {
    return {
      response: withoutPlayerStrikes(response, actor.id, true),
      awaitingTarget: false,
    };
  }
  const spell = narrated[0];
  const targetId = narratedCastTarget(digest, actor, playerInput);
  const action: DMCombatAction = {
    actor_id: actor.id,
    action_type: 'cast_spell',
    spell_id: spell.id,
    slot_level: spell.level > 0 ? spell.level : null,
    target_ids: targetId ? [targetId] : [],
    weapon_id: null,
    movement_feet: 0,
  };
  const stripped = withoutPlayerStrikes(response, actor.id, false);
  return {
    response: { ...stripped, combat_actions: [...stripped.combat_actions, action] },
    awaitingTarget: false,
  };
}
