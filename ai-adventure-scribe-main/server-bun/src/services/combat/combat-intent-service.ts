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
} from './data-access.js';
import { checkLineOfSight, getCover, getDistance } from '../../tactical/engine.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
import { resolveAttackRules } from './combat-rules.js';
import { publishCombatState } from './combat-sync-service.js';
import { claimTurnAction, setDefensiveAction } from './combat-turn-resources.js';
import { applyTacticalMapAction, recordDmTacticalFact } from './tactical-action-service.js';
import {
  destroyTacticalCombatMap,
  grantTacticalDash,
  resetTacticalMovementForTurn,
} from './tactical-combat-lifecycle.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { getSpellById, getSpellByName } from '../../data/spellData.js';
import { BusinessLogicError, NotFoundError } from '../../lib/errors.js';

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

async function assertActorTurn(encounterId: string, actorId: string, userId: string) {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const current = state.currentParticipant;
  if (!current || current.id !== actorId) {
    throw new BusinessLogicError('Actor is not the current-turn participant', { actorId });
  }
  return { actor: current, encounter: state.encounter };
}

/** The single mutation gateway for player and AI-DM combat intents. */
export async function executeCombatIntent(
  encounterId: string,
  intent: CombatIntent,
  userId: string,
  source: CombatActionSource,
  dmStartedAt?: number,
): Promise<unknown> {
  try {
    const { actor, encounter } = await assertActorTurn(encounterId, intent.actorId, userId);
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
      const weapon = await getEquippedWeaponProfile(actor);
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
            weaponId: intent.weaponId,
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
      await claimTurnAction(intent.actorId, encounterId, intent.expectedVersion);
      result = await grantTacticalDash(encounter.sessionId, intent.actorId);
    } else if (intent.type === 'dodge' || intent.type === 'disengage') {
      await claimTurnAction(intent.actorId, encounterId, intent.expectedVersion);
      await setDefensiveAction(intent.actorId, intent.type);
      result = { applied: true, action: intent.type };
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
      actorId: intent.actorId,
      action: intent.type,
      source,
      reason: error instanceof Error ? error.message : 'unknown',
    });
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
