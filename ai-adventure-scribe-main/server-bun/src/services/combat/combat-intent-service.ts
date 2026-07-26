/* eslint-disable max-lines -- the single mutation gateway for every combat intent; splitting
   the dispatch would put the turn's authorization, resolution, and reporting in three files. */
import { decideAttackApproach, describeResolvedAttack } from './combat-approach-service.js';
import { CombatAttackService } from './combat-attack-service.js';
import { CombatEncounterService } from './combat-encounter-service.js';
import { trackCombatEvent } from './combat-events.js';
import {
  getEquippedWeaponProfile,
  getParticipantAbilityProfile,
  getActiveConditionNames,
  listEquippedWeaponProfiles,
} from './data-access.js';
import { groundRequestedWeapon } from './weapon-grounding.js';
import { checkLineOfSight, getCover, getDistance } from '../../tactical/engine.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
import { resolveAttackRules } from './combat-rules.js';
import { publishCombatState } from './combat-sync-service.js';
import { claimTurnActionAndResolve, setDefensiveAction } from './combat-turn-resources.js';
import { loadSessionEntityIndex, type SessionEntityIndex } from './session-entity-index.js';
import { applyTacticalMapAction, recordDmTacticalFact } from './tactical-action-service.js';
import {
  destroyTacticalCombatMap,
  grantTacticalDash,
  resetTacticalMovementForTurn,
} from './tactical-combat-lifecycle.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { getSpellById, getSpellByName } from '../../data/spellData.js';
import { BusinessLogicError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

import type { AttackRollInput, SpellAttackInput } from '../../types/combat.js';

export type CombatIntent =
  | { type: 'move'; actorId: string; x: number; y: number }
  | {
      type: 'attack';
      actorId: string;
      targetId: string;
      weaponId?: string;
      expectedVersion: number;
      advantage?: boolean;
      disadvantage?: boolean;
    }
  | {
      type: 'spell';
      actorId: string;
      targetIds: string[];
      spellId?: string;
      spellName: string;
      slotLevel?: number;
      expectedVersion: number;
    }
  | { type: 'dash' | 'dodge' | 'disengage'; actorId: string; expectedVersion: number }
  | { type: 'end_turn'; actorId: string };

export type CombatActionSource = 'player' | 'dm';

/**
 * An intent as submitted, before the dispatch resolves it. `expectedVersion` may be absent —
 * which only a DM-sourced intent is allowed to do.
 */
type VersionOptional<T> = T extends { expectedVersion: number }
  ? Omit<T, 'expectedVersion'> & { expectedVersion?: number }
  : T;
export type SubmittedCombatIntent = VersionOptional<CombatIntent>;

const VERSIONED_INTENT_TYPES = new Set(['attack', 'spell', 'dash', 'dodge', 'disengage']);

/**
 * Optimistic concurrency arbitrates *racing player clients*: two browsers acting on one
 * encounter, where the loser must be told its read is stale. A DM-sourced intent has no such
 * peer — this dispatch is the only writer, and it is the authoritative sequencer — so it reads
 * the version it is about to act on rather than demanding the caller echo one back.
 *
 * Player-sourced intents keep the requirement. A player intent with no version is a
 * lost-update, not a convenience.
 */
function resolveExpectedVersion(
  intent: SubmittedCombatIntent,
  source: CombatActionSource,
  encounterVersion: number,
): CombatIntent {
  if (!VERSIONED_INTENT_TYPES.has(intent.type)) return intent as CombatIntent;
  if ((intent as { expectedVersion?: number }).expectedVersion !== undefined) {
    return intent as CombatIntent;
  }
  if (source !== 'dm') {
    throw new ValidationError('expectedVersion is required for player-sourced combat intents', {
      intentType: intent.type,
    });
  }
  return { ...intent, expectedVersion: encounterVersion } as CombatIntent;
}

async function endCombatIfResolved(encounterId: string, userId: string): Promise<boolean> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const livingTypes = new Set(
    state.participants
      .filter((participant) => {
        const hydrated = participant as typeof participant & {
          status?: { currentHp: number } | null;
        };
        return participant.isActive && (hydrated.status?.currentHp ?? participant.maxHp) > 0;
      })
      .map((participant) => participant.participantType),
  );
  if (livingTypes.has('player') && livingTypes.has('npc')) return false;
  await CombatEncounterService.endCombat(encounterId, userId);
  await destroyTacticalCombatMap(state.encounter.sessionId);
  trackCombatEvent('combat_ended', {
    encounterId,
    sessionId: state.encounter.sessionId,
    reason: 'last_hostile_defeated',
  });
  await publishCombatState(encounterId, userId, 'combat_ended');
  return true;
}

/** The target's display name, for the sentence the DM is handed when an approach falls short. */
async function participantLabel(
  encounterId: string,
  participantId: string,
  userId: string,
): Promise<string> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  return (
    state.participants.find((participant) => participant.id === participantId)?.name ??
    participantId
  );
}

type CombatState = Awaited<ReturnType<typeof CombatEncounterService.getCombatState>>;

/**
 * Two failures used to be reported as one, and the wrong one is what production kept seeing.
 *
 * "Actor is not the current-turn participant" is a *sequencing* answer: it says the caller is
 * early, so wait its turn. When the actorId names nobody in the encounter at all — a slug the
 * board never resolved, a stale id from a previous encounter — that answer is a lie, and it
 * sent three separate investigations looking at initiative order for a reference bug. An
 * unresolvable actor is a 404 naming the reference; only a real participant acting out of
 * sequence is a 422 about turns.
 */
function assertActorTurn(state: CombatState, actorId: string, index: SessionEntityIndex) {
  const current = state.currentParticipant;
  const known = state.participants.some((participant) => participant.id === actorId);
  // The current participant is logged on every refusal because the refusal alone never said
  // whose turn it actually was, and the slug is logged beside the id because the slug is the
  // only form the DM ever sees.
  const currentContext = {
    encounterId: state.encounter.id,
    sessionId: state.encounter.sessionId,
    actorId,
    currentParticipantId: current?.id ?? null,
    currentParticipantSlug: index.slugFor(current?.id) ?? null,
  };
  if (!known) {
    logger.warn({ msg: 'COMBAT_INTENT_UNKNOWN_ACTOR', ...currentContext, roster: index.roster() });
    throw new NotFoundError('Combat participant', actorId);
  }
  if (!current || current.id !== actorId) {
    logger.warn({ msg: 'COMBAT_INTENT_OUT_OF_TURN', ...currentContext });
    throw new BusinessLogicError('Actor is not the current-turn participant', currentContext);
  }
  return { actor: current, encounter: state.encounter };
}

/**
 * Every entity reference on the way in, normalised against the live board in one read. Targets
 * matter as much as the actor: an attack whose `targetId` is still a slug reaches the engine
 * and fails a uuid lookup two layers down, where the error no longer mentions references.
 */
function resolveIntentRefs(
  submitted: SubmittedCombatIntent,
  index: SessionEntityIndex,
): SubmittedCombatIntent {
  const actorId = index.resolve(submitted.actorId);
  if (submitted.type === 'attack')
    return { ...submitted, actorId, targetId: index.resolve(submitted.targetId) };
  if (submitted.type === 'spell')
    return { ...submitted, actorId, targetIds: submitted.targetIds.map((id) => index.resolve(id)) };
  return { ...submitted, actorId };
}

/** The single mutation gateway for player and AI-DM combat intents. */
export async function executeCombatIntent(
  encounterId: string,
  submitted: SubmittedCombatIntent,
  userId: string,
  source: CombatActionSource,
  dmStartedAt?: number,
): Promise<unknown> {
  try {
    // Reference resolution happens before authorization, not after: the turn check keys on
    // participant ids, so asking it about a slug is asking the wrong question.
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const index = await loadSessionEntityIndex(state.encounter.sessionId);
    const resolved = resolveIntentRefs(submitted, index);
    const { actor, encounter } = assertActorTurn(state, resolved.actorId, index);
    const intent = resolveExpectedVersion(resolved, source, encounter.version);
    let result: unknown;
    if (intent.type === 'move') {
      result = await applyTacticalMapAction(encounter.sessionId, {
        action: 'move',
        entityId: intent.actorId,
        x: intent.x,
        y: intent.y,
        changes: null,
      });
      if (!(result as { applied?: boolean }).applied) {
        throw new BusinessLogicError(
          'Movement refused',
          (result as { refusal?: Record<string, unknown> }).refusal,
        );
      }
    } else if (intent.type === 'attack') {
      const actorLabel = actor.name ?? intent.actorId;
      const targetLabel = await participantLabel(encounterId, intent.targetId, userId);
      // The approach decision and the resolution must swing the same weapon. Deciding approach
      // from `[0]` while resolving with `intent.weaponId` is how a bow-and-sword character got
      // walked into melee to fire an arrow, or reach-refused for a sword she was holding.
      const equipped = await listEquippedWeaponProfiles(actor);
      const grounding = groundRequestedWeapon(intent.weaponId, equipped);
      if (!grounding.grounded) {
        logger.warn(
          {
            event: 'DM_WEAPON_UNGROUNDED',
            encounterId,
            actorId: intent.actorId,
            source,
            requested: grounding.requested,
            resolved: grounding.weapon.name,
            equipped: equipped.map((profile) => profile.name),
          },
          '[combat] narrated weapon is not on the character sheet; resolved to a real one',
        );
      }
      const weapon = grounding.weapon;
      const approach = await decideAttackApproach({
        sessionId: encounter.sessionId,
        actorId: intent.actorId,
        actorLabel,
        targetId: intent.targetId,
        targetLabel,
        weapon,
      });
      if (approach.movementOnly) {
        result = approach.result;
      } else {
        result = await new CombatAttackService().resolveAttack(
          encounterId,
          {
            attackerId: intent.actorId,
            targetId: intent.targetId,
            // The grounded id, not the raw claim: resolution re-reads the sheet, and it must
            // land on the weapon the reach check was made against.
            weaponId: grounding.weaponId,
            attackType: approach.attackType,
            expectedVersion: intent.expectedVersion,
            advantage: intent.advantage,
            disadvantage: intent.disadvantage,
          } satisfies AttackRollInput,
          userId,
        );
        // Every resolution is reported, not just the ones that failed to reach. A hit the DM is
        // never told about is a hit it cannot narrate, and a DM with nothing to narrate repeats
        // the paragraph it wrote last turn.
        await recordDmTacticalFact(
          encounter.sessionId,
          describeResolvedAttack(
            actorLabel,
            targetLabel,
            result as Parameters<typeof describeResolvedAttack>[2],
            weapon.name,
          ),
        );
      }
    } else if (intent.type === 'spell') {
      result = await new CombatAttackService().resolveSpellAttack(
        encounterId,
        {
          casterId: intent.actorId,
          targetIds: intent.targetIds,
          spellId: intent.spellId,
          spellName: intent.spellName,
          slotLevel: intent.slotLevel,
          expectedVersion: intent.expectedVersion,
        } satisfies SpellAttackInput,
        userId,
      );
    } else if (intent.type === 'dash') {
      result = await claimTurnActionAndResolve(
        intent.actorId,
        encounterId,
        intent.expectedVersion,
        () => grantTacticalDash(encounter.sessionId, intent.actorId),
      );
    } else if (intent.type === 'dodge' || intent.type === 'disengage') {
      const action = intent.type;
      result = await claimTurnActionAndResolve(
        intent.actorId,
        encounterId,
        intent.expectedVersion,
        async () => {
          await setDefensiveAction(intent.actorId, action);
          return { applied: true, action };
        },
      );
    } else {
      const turn = await CombatInitiativeService.advanceTurn(encounterId, userId);
      await resetTacticalMovementForTurn(encounter.sessionId, turn.currentParticipant.id);
      result = turn;
    }

    trackCombatEvent('action_accepted', {
      encounterId,
      actorId: intent.actorId,
      action: intent.type,
      source,
    });
    const directDamage = Number((result as { finalDamage?: number })?.finalDamage ?? 0);
    const spellDamage =
      (result as { results?: Array<{ finalDamage?: number }> })?.results?.reduce(
        (total, item) => total + Number(item.finalDamage ?? 0),
        0,
      ) ?? 0;
    const damage = directDamage + spellDamage;
    if (damage > 0)
      trackCombatEvent('damage_applied', { encounterId, actorId: intent.actorId, damage, source });
    if (source === 'dm' && dmStartedAt) {
      trackCombatEvent('dm_latency', {
        encounterId,
        latencyMs: Math.max(0, Date.now() - dmStartedAt),
      });
    }
    const combatEnded = damage > 0 && (await endCombatIfResolved(encounterId, userId));
    if (!combatEnded) await publishCombatState(encounterId, userId, intent.type);
    return result;
  } catch (error) {
    trackCombatEvent('action_refused', {
      encounterId,
      actorId: submitted.actorId,
      action: submitted.type,
      source,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    // A killing blow can commit and the call still throw on the way out -- the HP
    // write lands, then something downstream fails. The success path is the only
    // thing that calls endCombatIfResolved, so without this the last hostile is at
    // 0 HP and the encounter never ends: no living enemy left to attack, so no
    // later damaging action to re-trigger the check either.
    //
    // Guarded and swallowed on purpose. This is recovery, and recovery must not
    // replace the error that caused it.
    try {
      await endCombatIfResolved(encounterId, userId);
    } catch (endError) {
      logger.warn({ msg: 'COMBAT_END_CHECK_AFTER_FAILURE_FAILED', endError, encounterId });
    }
    throw error;
  }
}

export async function getLegalCombatActions(encounterId: string, userId: string) {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const actor = state.currentParticipant as typeof state.currentParticipant & {
    actionUsed?: boolean;
    bonusActionUsed?: boolean;
    characterId?: string | null;
    encounterId: string;
  };
  if (!actor) throw new NotFoundError('Current combat participant', encounterId);
  const map = await loadActiveTacticalMap(state.encounter.sessionId);
  const mapActor = map?.entities.find((entity) => entity.id === actor.id);
  const actions: Array<Record<string, unknown>> = [];
  if (mapActor && mapActor.movementRemaining > 0) {
    actions.push({ type: 'move', label: `Move (${mapActor.movementRemaining} ft remaining)` });
  }
  const profile = await getParticipantAbilityProfile(actor);
  if (!actor.actionUsed) {
    const [weapon, attackerConditions] = await Promise.all([
      getEquippedWeaponProfile(actor),
      getActiveConditionNames(actor.id),
    ]);
    const targets: string[] = [];
    for (const target of state.participants.filter(
      (participant) =>
        participant.id !== actor.id &&
        participant.isActive &&
        participant.participantType !== actor.participantType,
    )) {
      const targetEntity = map?.entities.find((entity) => entity.id === target.id);
      const rules = resolveAttackRules({
        strength: profile.scores.str ?? 10,
        dexterity: profile.scores.dex ?? 10,
        level: profile.level,
        baseTargetAc: target.armorClass,
        weapon,
        attackerConditions,
        targetConditions: await getActiveConditionNames(target.id),
        geometry:
          map && mapActor && targetEntity
            ? {
                distanceFeet: getDistance(mapActor, targetEntity),
                hasLineOfSight: checkLineOfSight(map, actor.id, target.id),
                cover: getCover(map, actor.id, target.id),
              }
            : undefined,
      });
      if (rules.legal) targets.push(target.id);
    }
    if (targets.length)
      actions.push({
        type: 'attack',
        label: `Attack with ${weapon.name}`,
        weaponId: weapon.id,
        targetIds: targets,
      });
    actions.push(
      { type: 'dash', label: 'Dash' },
      { type: 'dodge', label: 'Dodge' },
      { type: 'disengage', label: 'Disengage' },
    );
  }
  const spells = profile.spellIds
    .map((id) => getSpellById(id) ?? getSpellByName(id))
    .filter(
      (spell, index, all) =>
        spell && all.findIndex((candidate) => candidate?.id === spell.id) === index,
    );
  const hasAvailableSpell = spells.some((spell) => {
    const usesBonusAction = spell!.castingTime.toLowerCase().includes('bonus action');
    return usesBonusAction ? !actor.bonusActionUsed : !actor.actionUsed;
  });
  if (hasAvailableSpell) actions.push({ type: 'spell', label: 'Cast a prepared spell' });
  actions.push({ type: 'end_turn', label: 'End turn' });
  return { encounterId, version: state.encounter.version, actorId: actor.id, actions };
}
