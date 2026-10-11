/* eslint-disable max-lines -- first-action derivation keeps source selection and engine facts together. */
/**
 * Derives the first player action from the declaration that caused combat entry.
 *
 * This is intentionally a server-side read/derivation step. The model's `combat_actions` are
 * useful for NPC turns and for ordinary combat turns, but they are not the authority for the
 * player's opening attack: the declaration already named the action before the model answered.
 */
import { resolveAttackRules } from './combat-rules.js';
import {
  getActiveConditionNames,
  getParticipantAbilityProfile,
  listEquippedWeaponProfiles,
} from './data-access.js';
import { resolveParticipantArmorClass } from './participant-armor-class.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { isUnarmedAttackVerb, isUnarmedWeaponClaim, UNARMED_STRIKE } from './weapon-catalog.js';
import { groundRequestedWeapon } from './weapon-grounding.js';
import { isPlayerCombatSpell, resolveCatalogSpell } from '../../data/spellData.js';
import { combatLogger } from '../../lib/logger.js';
import { planApproach } from '../../tactical/approach.js';
import { checkLineOfSight, getCover, getDistance } from '../../tactical/engine.js';
import { isUnresolvedNpcName, resolveSceneCombatant } from '../../tactical/seating.js';

import type { DeclaredAttack } from './combat-intent-gate.js';

export type CombatEntryFirstActionSource = 'unarmed' | 'weapon' | 'spell';

export interface CombatEntryReach {
  inReach: boolean;
  distanceFeet: number;
  movedFeetIfApproached: number;
  path: Array<{ x: number; y: number }>;
  refusalReason?: 'movement_exhausted' | 'no_reachable_adjacent_cell';
}

export interface CombatEntryRollRequest {
  type: 'attack';
  formula: string;
  purpose: string;
  dc: null;
  ac: number;
  advantage: boolean;
  disadvantage: boolean;
  /** The exact attack modifier the engine will apply to the player's natural d20. */
  modifier: number;
  actorName: string;
}

export interface CombatEntryFirstAction {
  type: 'attack' | 'spell' | 'move';
  actor: string;
  actorLabel: string;
  target: string;
  targetLabel: string;
  source: CombatEntryFirstActionSource;
  attackSource: CombatEntryFirstActionSource;
  weaponId: string | null;
  weaponName: string | null;
  spellId: string | null;
  slotLevel: number | null;
  reach?: CombatEntryReach;
  notice?: string;
  combat_action: {
    actor_id: string;
    action_type: 'attack' | 'cast_spell' | 'move';
    target_ids: string[];
    weapon_id: string | null;
    spell_id: string | null;
    slot_level: number | null;
    movement_feet: number;
    x?: number;
    y?: number;
  };
  roll_request?: CombatEntryRollRequest;
}

/**
 * A declared opening attack the engine refused to queue, with the reason in player language.
 * Returned instead of a bare `null` when the player named a weapon the sheet does not back
 * (#2551), or a spell the catalog does not know, the engine cannot open with, or the sheet
 * does not list (#2569): combat still seats, but the caller surfaces `notice` so the player
 * learns why there is no opening action instead of a generic "declare your action".
 */
export interface CombatEntryFirstActionRefusal {
  reason:
    | 'declared_weapon_not_equipped'
    | 'declared_spell_unknown'
    | 'declared_spell_unsupported'
    | 'declared_spell_not_known';
  notice: string;
  requestedWeapon: string | null;
  /** Set for spell refusals; the declared spell name or id the player used. */
  requestedSpell?: string | null;
  actor: string;
  target: string;
  /** A refusal queues no action: these stay absent so union readers can narrow on them. */
  type?: undefined;
  combat_action?: undefined;
  roll_request?: undefined;
  reach?: undefined;
}

export interface CombatEntryFirstActionState {
  encounter: { id: string };
  participants: Array<{
    id: string;
    name: string;
    initiative: number;
    initiativeModifier: number;
    characterId?: string | null;
    npcId?: string | null;
    participantType?: string;
    armorClass?: number | null;
    encounterId?: string;
  }>;
}

type EntryParticipant = CombatEntryFirstActionState['participants'][number] & {
  participantType?: string;
  npcId?: string | null;
  armorClass?: number | null;
  encounterId?: string;
};

export interface CombatEntryFirstActionDeps {
  listEquippedWeaponProfiles: typeof listEquippedWeaponProfiles;
  getParticipantAbilityProfile: typeof getParticipantAbilityProfile;
  getActiveConditionNames: typeof getActiveConditionNames;
  loadActiveTacticalMap: typeof loadActiveTacticalMap;
  logger: Pick<typeof combatLogger, 'warn'>;
}

const defaultDeps: CombatEntryFirstActionDeps = {
  listEquippedWeaponProfiles,
  getParticipantAbilityProfile,
  getActiveConditionNames,
  loadActiveTacticalMap,
  logger: combatLogger,
};

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

function sourceFor(declared: DeclaredAttack): CombatEntryFirstActionSource {
  if (
    declared.attackSource === 'spell' ||
    declared.spellId ||
    declared.spellName ||
    declared.verb.toLowerCase().startsWith('cast ')
  ) {
    return 'spell';
  }
  const weaponClaim = declared.weaponName?.trim();
  if (weaponClaim && !isUnarmedWeaponClaim(weaponClaim)) return 'weapon';
  if (
    !weaponClaim &&
    (isUnarmedAttackVerb(declared.verb) || declared.verb.toLowerCase() === 'attack')
  ) {
    return 'unarmed';
  }
  return declared.attackSource ?? 'weapon';
}

function profileKnowsSpell(
  profile: Awaited<ReturnType<typeof getParticipantAbilityProfile>>,
  spell: { id: string; name: string },
): boolean {
  const knownSpellIds = new Set((profile.spellIds ?? []).map((value) => normalize(value)));
  return knownSpellIds.has(normalize(spell.id)) || knownSpellIds.has(normalize(spell.name));
}

function findPlayer(
  participants: readonly EntryParticipant[],
  player: { characterId?: string | null; name: string },
): EntryParticipant | undefined {
  return (
    participants.find(
      (participant) => player.characterId && participant.characterId === player.characterId,
    ) ??
    participants.find(
      (participant) =>
        participant.participantType === 'player' &&
        normalize(participant.name) === normalize(player.name),
    ) ??
    participants.find((participant) => normalize(participant.name) === normalize(player.name))
  );
}

function findTarget(
  participants: readonly EntryParticipant[],
  declared: DeclaredAttack,
  player: EntryParticipant | undefined,
): EntryParticipant | undefined {
  const claim = declared.actorSlug || declared.actorName;
  const claimSlug = slugify(claim);
  const claimName = normalize(declared.actorName);
  const exact = participants.find((participant) => {
    if (player && participant.id === player.id) return false;
    // #2514: a difficulty-sized encounter seats duplicates as
    // "Faceless Stalker 1 / 2". The declared target is the first of its
    // kind, so a numbered seat of that kind is an exact match, not a miss
    // that would silently drop the player's opening attack (#2551).
    const participantName = normalize(participant.name);
    const baseName = participantName.replace(/\s+\d+$/, '');
    const participantSlug = slugify(participant.name);
    const baseSlug = participantSlug.replace(/-\d+$/, '');
    return (
      participant.id === claim ||
      slugify(participant.id) === claimSlug ||
      participantSlug === claimSlug ||
      baseSlug === claimSlug ||
      participantName === claimName ||
      baseName === claimName ||
      participantName.endsWith(` ${claimName}`) ||
      claimName.endsWith(` ${participantName}`)
    );
  });
  if (exact) return exact;

  // A prose declaration can arrive with the hostile still carrying the old synthetic seat
  // label. If there is exactly one unresolved hostile, its id remains authoritative and the
  // display name is repaired from the declaration below.
  const unresolved = participants.filter(
    (participant) =>
      (!player || participant.id !== player.id) && isUnresolvedNpcName(participant.name),
  );
  return unresolved.length === 1 ? unresolved[0] : undefined;
}

function attackFormula(modifier: number): string {
  return `1d20${modifier < 0 ? `-${Math.abs(modifier)}` : `+${modifier}`}`;
}

function projectedMap(
  map: Awaited<ReturnType<typeof loadActiveTacticalMap>>,
  actorId: string,
  destination: { x: number; y: number },
): Awaited<ReturnType<typeof loadActiveTacticalMap>> {
  if (!map) return map;
  return {
    ...map,
    entities: map.entities.map((entity) =>
      entity.id === actorId ? { ...entity, ...destination } : entity,
    ),
  };
}

function geometryFor(
  map: Awaited<ReturnType<typeof loadActiveTacticalMap>>,
  actorId: string,
  targetId: string,
): { distanceFeet: number; hasLineOfSight: boolean; cover: 0 | 1 | 2 | 3 } | undefined {
  const from = map?.entities.find((entity) => entity.id === actorId);
  const to = map?.entities.find((entity) => entity.id === targetId);
  return map && from && to
    ? {
        distanceFeet: getDistance(from, to),
        hasLineOfSight: checkLineOfSight(map, actorId, targetId),
        cover: getCover(map, actorId, targetId),
      }
    : undefined;
}

/** Build the engine-backed first action after `/enter` has seated participant rows. */
export async function deriveCombatEntryFirstAction(
  params: {
    sessionId: string;
    combatState: CombatEntryFirstActionState;
    player: { characterId?: string | null; name: string };
    declaredAttack: DeclaredAttack;
  },
  injected: Partial<CombatEntryFirstActionDeps> = {},
): Promise<CombatEntryFirstAction | CombatEntryFirstActionRefusal | null> {
  const deps = { ...defaultDeps, ...injected };
  const participants = params.combatState.participants as EntryParticipant[];
  const playerParticipant = findPlayer(participants, params.player);
  const targetParticipant = findTarget(participants, params.declaredAttack, playerParticipant);
  if (!playerParticipant || !targetParticipant) return null;

  const requestedSource = sourceFor(params.declaredAttack);
  const targetLabel = resolveSceneCombatant({
    candidateName: targetParticipant.name,
    sceneEntityName: params.declaredAttack.actorName,
  }).name;
  const actorLabel = playerParticipant.name;
  let profile: Awaited<ReturnType<typeof getParticipantAbilityProfile>> | undefined;

  if (requestedSource === 'spell') {
    const spell = resolveCatalogSpell(
      params.declaredAttack.spellId,
      params.declaredAttack.spellName || params.declaredAttack.verb.replace(/^cast\s+/i, ''),
    );
    profile = await deps.getParticipantAbilityProfile(playerParticipant);
    if (spell && isPlayerCombatSpell(spell) && spell.damage && profileKnowsSpell(profile, spell)) {
      const slotLevel = spell.level > 0 ? spell.level : null;
      return {
        type: 'spell',
        actor: playerParticipant.id,
        actorLabel,
        target: targetParticipant.id,
        targetLabel,
        source: requestedSource,
        attackSource: requestedSource,
        weaponId: null,
        weaponName: null,
        spellId: spell.id,
        slotLevel,
        combat_action: {
          actor_id: playerParticipant.id,
          action_type: 'cast_spell',
          target_ids: [targetParticipant.id],
          weapon_id: null,
          spell_id: spell.id,
          slot_level: slotLevel,
          movement_feet: 0,
        },
      };
    }

    deps.logger.warn({
      msg: 'FIRST_ACTION_SPELL_REFUSED',
      sessionId: params.sessionId,
      participantId: playerParticipant.id,
      characterId: playerParticipant.characterId ?? null,
      spellId: spell?.id ?? params.declaredAttack.spellId ?? null,
      spellName: spell?.name ?? params.declaredAttack.spellName ?? params.declaredAttack.verb,
      reason: !spell
        ? 'unknown_spell'
        : !isPlayerCombatSpell(spell)
          ? 'unsupported_spell'
          : 'spell_not_known',
    });
    // Never turn a refused spell declaration into a fabricated weapon attack. Like the weapon
    // refusal (#2551), return the reason in player language so the entry notice can name the
    // miss instead of falling back to a silent generic notice (#2569).
    const spellRefusalReason = !spell
      ? ('declared_spell_unknown' as const)
      : !isPlayerCombatSpell(spell)
        ? ('declared_spell_unsupported' as const)
        : ('declared_spell_not_known' as const);
    const declaredSpellLabel =
      params.declaredAttack.spellName || params.declaredAttack.verb.replace(/^cast\s+/i, '');
    const spellRefusalWhy =
      spellRefusalReason === 'declared_spell_unknown'
        ? 'no such spell was recognized'
        : spellRefusalReason === 'declared_spell_unsupported'
          ? 'the engine cannot open combat with that spell'
          : 'it is not on your character sheet';
    return {
      reason: spellRefusalReason,
      notice: `You declared casting ${declaredSpellLabel}, but ${spellRefusalWhy}, so your opening spell was not queued.`,
      requestedWeapon: null,
      requestedSpell: declaredSpellLabel,
      actor: playerParticipant.id,
      target: targetParticipant.id,
    };
  }

  const requestedAttackSource = requestedSource;
  profile ??= await deps.getParticipantAbilityProfile(playerParticipant);
  const equipped = await deps.listEquippedWeaponProfiles(playerParticipant);
  const grounded =
    requestedAttackSource === 'unarmed'
      ? {
          weapon: { ...UNARMED_STRIKE },
          weaponId: undefined,
          grounded: true,
          requested: null,
          notEquipped: false,
        }
      : groundRequestedWeapon(params.declaredAttack.weaponName, equipped);
  const weaponStated =
    params.declaredAttack.weaponStated ?? Boolean(params.declaredAttack.weaponName?.trim());
  if (requestedAttackSource === 'weapon' && grounded.grounded === false) {
    const swappedToUnarmed = !grounded.weaponId || grounded.weapon.id === UNARMED_STRIKE.id;
    if (!weaponStated || swappedToUnarmed) {
      deps.logger.warn({
        msg: weaponStated ? 'DECLARED_WEAPON_NOT_EQUIPPED' : 'INFERRED_WEAPON_DROPPED',
        sessionId: params.sessionId,
        requested: grounded.requested,
        weaponStated,
      });
      // The player named this weapon: say so, so the entry notice can explain why the
      // declared opening attack was not queued (#2551). An inferred name stays silent —
      // the player never claimed it, so there is nothing to correct.
      if (weaponStated) {
        return {
          reason: 'declared_weapon_not_equipped',
          notice: `You declared an attack with the ${grounded.requested ?? params.declaredAttack.weaponName ?? 'weapon'}, but it is not on your character sheet, so your opening attack was not queued.`,
          requestedWeapon: grounded.requested,
          actor: playerParticipant.id,
          target: targetParticipant.id,
        };
      }
      return null;
    }
  }
  // An empty equipment list is a valid character state. Once grounding supplies the rules
  // default, expose it as an unarmed source so every downstream fact agrees with the weapon.
  const source: Exclude<CombatEntryFirstActionSource, 'spell'> =
    requestedAttackSource === 'weapon' && grounded.weaponId === undefined
      ? 'unarmed'
      : requestedAttackSource;
  const map = await deps.loadActiveTacticalMap(params.sessionId);
  const approach =
    !grounded.weapon.ranged && map
      ? planApproach(map, playerParticipant.id, targetParticipant.id, grounded.weapon.normalRange)
      : null;
  const mapActor = map?.entities.find((entity) => entity.id === playerParticipant.id);
  const refusalReason =
    approach && !approach.inReach
      ? !mapActor ||
        mapActor.movementRemaining <= 0 ||
        approach.costFeet >= mapActor.movementRemaining
        ? ('movement_exhausted' as const)
        : ('no_reachable_adjacent_cell' as const)
      : undefined;
  const reach: CombatEntryReach | undefined = approach
    ? {
        inReach: approach.inReach,
        distanceFeet: approach.resultingDistanceFeet,
        movedFeetIfApproached: approach.costFeet,
        path: approach.path,
        ...(refusalReason ? { refusalReason } : {}),
      }
    : undefined;

  if (approach && !approach.inReach) {
    const targetDistance = approach.resultingDistanceFeet;
    const moved = approach.costFeet;
    const reasonText =
      refusalReason === 'movement_exhausted'
        ? 'movement ran out before you reached the required distance'
        : 'no reachable adjacent cell was available';
    return {
      type: 'move',
      actor: playerParticipant.id,
      actorLabel,
      target: targetParticipant.id,
      targetLabel,
      source,
      attackSource: source,
      weaponId: source === 'unarmed' ? UNARMED_STRIKE.id : (grounded.weaponId ?? null),
      weaponName: grounded.weapon.name,
      spellId: null,
      slotLevel: null,
      reach,
      notice:
        moved > 0
          ? `You close ${moved} ft. ${targetLabel} is still ${targetDistance} ft away because ${reasonText}. Your turn is spent.`
          : `You could not move closer to ${targetLabel}; it is still ${targetDistance} ft away because ${reasonText}. Your turn is spent.`,
      combat_action: {
        actor_id: playerParticipant.id,
        action_type: 'move',
        target_ids: [],
        weapon_id: source === 'unarmed' ? UNARMED_STRIKE.id : (grounded.weaponId ?? null),
        spell_id: null,
        slot_level: null,
        movement_feet: moved,
        x: approach.destination.x,
        y: approach.destination.y,
      },
    };
  }

  const rulesMap = approach ? projectedMap(map, playerParticipant.id, approach.destination) : map;
  const seatedAc = resolveParticipantArmorClass(targetParticipant.armorClass, {
    participantId: targetParticipant.id,
    encounterId: params.combatState.encounter.id,
  });
  const rules = resolveAttackRules({
    strength: profile.scores.str ?? 10,
    dexterity: profile.scores.dex ?? 10,
    level: profile.level,
    baseTargetAc: seatedAc,
    weapon: grounded.weapon,
    geometry: geometryFor(rulesMap, playerParticipant.id, targetParticipant.id),
    attackerConditions: await deps.getActiveConditionNames(playerParticipant.id),
    targetConditions: await deps.getActiveConditionNames(targetParticipant.id),
  });
  const purpose = `${grounded.weapon.name} attack against ${targetLabel}`;
  return {
    type: 'attack',
    actor: playerParticipant.id,
    actorLabel,
    target: targetParticipant.id,
    targetLabel,
    source,
    attackSource: source,
    weaponId: source === 'unarmed' ? UNARMED_STRIKE.id : (grounded.weaponId ?? null),
    weaponName: grounded.weapon.name,
    spellId: null,
    slotLevel: null,
    ...(reach ? { reach } : {}),
    combat_action: {
      actor_id: playerParticipant.id,
      action_type: 'attack',
      target_ids: [targetParticipant.id],
      weapon_id: source === 'unarmed' ? UNARMED_STRIKE.id : (grounded.weaponId ?? null),
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    },
    roll_request: {
      type: 'attack',
      formula: attackFormula(rules.attackBonus),
      purpose,
      dc: null,
      ac: rules.targetAc,
      advantage: rules.advantage,
      disadvantage: rules.disadvantage,
      modifier: rules.attackBonus,
      actorName: actorLabel,
    },
  };
}
