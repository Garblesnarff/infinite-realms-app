import { grappleOf } from './grapple-source.js';
import { combatLogger } from '../../lib/logger.js';

import type { SubmittedCombatIntent } from './combat-intent-service.js';
import type { WeaponRuleProfile } from './combat-rules.js';
import type { NpcEngineRow } from './npc-engine-row.js';
import type { CombatState } from '../../types/combat.js';

/** The action shape returned to the browser so it can reuse its transcript formatter. */
export type NpcTurnAction = {
  actor_id: string;
  action_type: 'attack' | 'dodge' | 'check' | 'end_turn';
  target_ids: string[];
  weapon_id: string | null;
  spell_id: string | null;
  slot_level: number | null;
  movement_feet: number;
};

export type NpcTurnOutcome = {
  action: NpcTurnAction;
  /** The encounter round this NPC acted in, read before its turn ended and the order could wrap. */
  round: number;
  outcomes: Array<{
    participantId: string;
    newHp?: number;
    damageType?: string;
    hit?: boolean;
    finalDamage?: number;
    isCritical?: boolean;
  }>;
  engineResult?: unknown;
  actorIsPlayer: false;
  transcriptLines: string[];
};

export type AdvanceNpcTurnsResult = {
  results: NpcTurnOutcome[];
  currentParticipant: {
    id: string;
    name: string;
    participantType: string;
    /** Where the turn holder stands (`vitalStateOf`): a dying player owes a death save. */
    vitalState?: string;
  } | null;
  /** The encounter round after the last NPC turn: the round the next turn holder is in. */
  round: number;
  combatEnded: boolean;
  iterationCount: number;
  iterationCap: number;
  capReached: boolean;
  transcriptLines: string[];
  engineRows?: NpcEngineRow[];
};

type ExecuteNpcIntent = (
  encounterId: string,
  intent: SubmittedCombatIntent,
  userId: string,
  source: 'dm',
  dmStartedAt?: number,
) => Promise<unknown>;

export type NpcTurnRunnerDependencies = {
  getCombatState: (encounterId: string, userId: string) => Promise<CombatState>;
  getDefaultWeapon: (participant: unknown) => Promise<WeaponRuleProfile>;
  executeIntent: ExecuteNpcIntent;
  /**
   * Whether `actor` stands within 5 ft of `target` on the tactical board. Absent, or when no
   * board can say, a creature is taken to be in reach: the fight it was already in is the one
   * it keeps fighting.
   */
  withinMeleeReach?: (state: CombatState, actorId: string, targetId: string) => Promise<boolean>;
  /** Tells the DM what a creature chose to do about a downed player instead of attacking. */
  recordDownedChoice?: (sessionId: string, fact: string) => Promise<void>;
  /** Whether a won parley holds this creature's action in this round (#2420). */
  isParleyHeld?: (sessionId: string, participantId: string, round: number) => Promise<boolean>;
};

const defaultDependencies: NpcTurnRunnerDependencies = {
  getCombatState: async (encounterId, userId) => {
    const { CombatEncounterService } = await import('./combat-encounter-service.js');
    return CombatEncounterService.getCombatState(encounterId, userId);
  },
  getDefaultWeapon: async (participant) => {
    const { getDefaultCombatWeapon } = await import('./equipped-loadout.js');
    return getDefaultCombatWeapon(participant);
  },
  executeIntent: async (encounterId, intent, userId, source, dmStartedAt) => {
    const { executeCombatIntent } = await import('./combat-intent-service.js');
    return executeCombatIntent(encounterId, intent, userId, source, dmStartedAt);
  },
  withinMeleeReach: async (state, actorId, targetId) => {
    const [{ loadActiveTacticalMap }, { getDistance }] = await Promise.all([
      import('./tactical-map-store.js'),
      import('../../tactical/engine.js'),
    ]);
    const map = await loadActiveTacticalMap(state.encounter.sessionId);
    const from = map?.entities.find((entity) => entity.id === actorId);
    const to = map?.entities.find((entity) => entity.id === targetId);
    return !from || !to || getDistance(from, to) <= 5;
  },
  recordDownedChoice: async (sessionId, fact) => {
    const { recordDmTacticalFact } = await import('./tactical-action-service.js');
    await recordDmTacticalFact(sessionId, fact);
  },
  isParleyHeld: async (sessionId, participantId, round) => {
    const { isParleyHeld } = await import('./parley-hold.js');
    return isParleyHeld(sessionId, participantId, round);
  },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isPlayer = (participant: { participantType?: string }): boolean =>
  participant.participantType === 'player';

const npcIsStanding = (participant: { maxHp: number; status?: { currentHp: number } | null }) =>
  (participant.status?.currentHp ?? participant.maxHp) > 0;

export const nonHostileDisposition = (participant: Record<string, unknown>): boolean => {
  const raw =
    participant.disposition ??
    (participant.stats as Record<string, unknown> | undefined)?.disposition;
  if (typeof raw !== 'string') return false;
  return new Set(['ally', 'friendly', 'neutral', 'peaceful', 'non-hostile', 'non_hostile']).has(
    raw.trim().toLowerCase(),
  );
};

export const isProvoked = (participant: Record<string, unknown>): boolean =>
  participant.provoked === true;

function storedMonsterWeapon(participant: Record<string, unknown>): WeaponRuleProfile | null {
  const profile = participant.monsterAttack;
  if (!isRecord(profile) || !Array.isArray(profile.attacks)) return null;
  const attack = profile.attacks.find((candidate) => isRecord(candidate));
  if (
    !isRecord(attack) ||
    typeof attack.name !== 'string' ||
    typeof attack.damageDice !== 'string'
  ) {
    return null;
  }
  return {
    id: `monster-attack:${attack.name}`,
    name: attack.name,
    damageDice: attack.damageDice,
    damageType: typeof attack.damageType === 'string' ? attack.damageType : 'bludgeoning',
    normalRange: Number(attack.normalRange) || 5,
    ...(Number(attack.longRange) ? { longRange: Number(attack.longRange) } : {}),
    magicBonus: 0,
    finesse: false,
    ranged: attack.ranged === true,
    proficient: true,
    fixedAttackBonus: Number(attack.attackBonus) || 0,
    fixedDamageBonus: Number(attack.damageBonus) || 0,
  };
}

/**
 * What a creature does about a player it has put on the floor. The rules dictate the
 * consequences of each choice, not which one a creature makes: the campaign bible does
 * (`stats.downedTargetBehavior` on the authored creature). With nothing authored, a hostile that
 * is already fighting keeps fighting — which keeps death reachable without the engine inventing
 * behaviour.
 */
export type DownedTargetBehavior = 'finish' | 'ignore' | 'drag' | 'flee';

const DOWNED_BEHAVIORS = new Set<string>(['finish', 'ignore', 'drag', 'flee']);

export function downedBehaviorOf(actor: unknown): DownedTargetBehavior {
  const raw = isRecord(actor) ? actor.downedBehavior : undefined;
  return typeof raw === 'string' && DOWNED_BEHAVIORS.has(raw)
    ? (raw as DownedTargetBehavior)
    : 'finish';
}

const isDownedPlayer = (participant: { participantType?: string; vitalState?: string }): boolean =>
  isPlayer(participant) &&
  (participant.vitalState === 'dying' || participant.vitalState === 'stabilized');

function chooseTarget(state: CombatState, actorId: string) {
  return state.participants.find((participant) => {
    if (participant.id === actorId || !participant.isActive || !isPlayer(participant)) return false;
    return npcIsStanding(
      participant as unknown as { maxHp: number; status?: { currentHp: number } },
    );
  });
}

/** The first player on the floor, when there is nobody left standing to fight. */
function downedTargetOf(state: CombatState, actorId: string) {
  return state.participants.find(
    (participant) =>
      participant.id !== actorId &&
      participant.isActive &&
      isDownedPlayer(participant as unknown as { participantType?: string; vitalState?: string }),
  );
}

function chooseAction(
  state: CombatState,
  actor: CombatState['currentParticipant'],
  weapon: WeaponRuleProfile | null,
  canAct: boolean,
  /** The downed player this creature may strike, already cleared for behaviour and reach. */
  downedTarget?: { id: string },
  parleyHeld = false,
): NpcTurnAction {
  if (!actor) throw new Error('Cannot choose an NPC action without a current participant');

  const endTurn = (): NpcTurnAction => ({
    actor_id: actor.id,
    action_type: 'end_turn',
    target_ids: [],
    weapon_id: null,
    spell_id: null,
    slot_level: null,
    movement_feet: 0,
  });

  if (!canAct || parleyHeld) return endTurn();

  const actorRecord = actor as unknown as Record<string, unknown>;
  if (nonHostileDisposition(actorRecord) && !isProvoked(actorRecord)) {
    return {
      actor_id: actor.id,
      action_type: 'dodge',
      target_ids: [],
      weapon_id: null,
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    };
  }

  // A grappled creature spends its action trying to break free (SRD 5.1); it does not strike
  // while the grapple holds it.
  if (grappleOf(actorRecord)) {
    return {
      actor_id: actor.id,
      action_type: 'check',
      target_ids: [],
      weapon_id: null,
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    };
  }

  const target = chooseTarget(state, actor.id) ?? downedTarget;
  const actionWeapon = storedMonsterWeapon(actorRecord) ?? weapon;
  if (!target || !actionWeapon) return endTurn();

  return {
    actor_id: actor.id,
    action_type: 'attack',
    target_ids: [target.id],
    weapon_id: actionWeapon.id,
    spell_id: null,
    slot_level: null,
    movement_feet: 0,
  };
}

function toIntent(action: NpcTurnAction): SubmittedCombatIntent {
  if (action.action_type === 'attack') {
    return {
      type: 'attack',
      actorId: action.actor_id,
      targetId: action.target_ids[0],
      ...(action.weapon_id ? { weaponId: action.weapon_id } : {}),
    };
  }
  if (action.action_type === 'dodge') return { type: 'dodge', actorId: action.actor_id };
  if (action.action_type === 'check') {
    return { type: 'check', actorId: action.actor_id, checkKind: 'escape' };
  }
  return { type: 'end_turn', actorId: action.actor_id };
}

function combatEndedFrom(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return value.combatEnded === true || value.encounterAlreadyConcluded === true;
}

function outcomesFrom(action: NpcTurnAction, value: unknown): NpcTurnOutcome['outcomes'] {
  if (action.action_type !== 'attack' || !isRecord(value) || value.resolvedAs === 'movement_only') {
    return [];
  }
  return [
    {
      participantId: action.target_ids[0],
      ...(typeof value.targetNewHp === 'number' ? { newHp: value.targetNewHp } : {}),
      ...(typeof value.damageType === 'string' ? { damageType: value.damageType } : {}),
      ...(typeof value.hit === 'boolean' ? { hit: value.hit } : {}),
      ...(typeof value.finalDamage === 'number' ? { finalDamage: value.finalDamage } : {}),
      ...(typeof value.isCritical === 'boolean' ? { isCritical: value.isCritical } : {}),
    },
  ];
}

function mergeBoundaryDeathSaves(resolution: unknown, boundary: unknown): unknown {
  if (!isRecord(boundary) || !Array.isArray(boundary.deathSaves) || !boundary.deathSaves.length) {
    return resolution;
  }
  const boundarySaves = boundary.deathSaves;
  if (!isRecord(resolution)) return { result: resolution, deathSaves: boundarySaves };
  const existingSaves = Array.isArray(resolution.deathSaves) ? resolution.deathSaves : [];
  return { ...resolution, deathSaves: [...existingSaves, ...boundarySaves] };
}

/**
 * Run the autonomous side of the initiative order until a player is current or the encounter
 * ends. Every action still enters `executeCombatIntent`, so dice, grounding, approach, HP,
 * death saves, ending, telemetry, and state publication remain engine-owned.
 */
/**
 * Why `advanceNpcTurns` stopped. `combat_ended` takes precedence over `cap`,
 * and `player_turn` is the ordinary handoff back to the player.
 */
export type NpcTurnLoopStopReason = 'player_turn' | 'combat_ended' | 'cap';

export async function advanceNpcTurns(
  encounterId: string,
  userId: string,
  dependencies: NpcTurnRunnerDependencies = defaultDependencies,
): Promise<AdvanceNpcTurnsResult> {
  const initial = await dependencies.getCombatState(encounterId, userId);
  const iterationCap = Math.max(1, initial.participants.length) * 2;
  const results: NpcTurnOutcome[] = [];
  const transcriptLines: string[] = [];
  let combatEnded = initial.encounter.status !== 'active';
  let iterationCount = 0;

  while (!combatEnded && iterationCount < iterationCap) {
    const state = await dependencies.getCombatState(encounterId, userId);
    if (state.encounter.status !== 'active') {
      combatEnded = true;
      break;
    }
    const actor = state.currentParticipant;
    if (!actor || isPlayer(actor)) break;

    iterationCount += 1;
    const standing = npcIsStanding(
      actor as unknown as { maxHp: number; status?: { currentHp: number } },
    );
    const canAct = standing && actor.actionUsed !== true;
    // Monsters at 0 HP are dead and stat-less NPCs that cannot act must not hold the board.
    const weapon = canAct ? await dependencies.getDefaultWeapon(actor) : null;
    // Nobody standing to fight: a creature may still act on a player on the floor, if that is
    // what it does (authored behaviour, default: keep attacking) and it can reach them.
    let downedTarget: { id: string } | undefined;
    if (canAct && !chooseTarget(state, actor.id)) {
      const downed = downedTargetOf(state, actor.id);
      if (downed) {
        const behavior = downedBehaviorOf(actor);
        const actorWeapon =
          storedMonsterWeapon(actor as unknown as Record<string, unknown>) ?? weapon;
        const inReach =
          actorWeapon?.ranged === true ||
          (await (dependencies.withinMeleeReach?.(state, actor.id, downed.id) ?? true));
        if (behavior === 'finish' && inReach) {
          downedTarget = downed;
        } else {
          await dependencies.recordDownedChoice?.(
            state.encounter.sessionId,
            behavior === 'finish'
              ? `${actor.name} is not within reach of ${downed.name} and does not attack them this turn.`
              : `${actor.name} chooses not to attack the fallen ${downed.name} (${behavior}): no blow is struck at them this turn.`,
          );
        }
      }
    }
    const parleyHeld =
      canAct &&
      (await dependencies.isParleyHeld?.(
        state.encounter.sessionId,
        actor.id,
        state.encounter.currentRound,
      )) === true;
    if (parleyHeld) {
      combatLogger.info({ msg: 'NPC_TURN_HELD_BY_PARLEY', encounterId, actorId: actor.id });
    }
    const action = chooseAction(state, actor, weapon, canAct, downedTarget, parleyHeld);
    const turnKey = `${encounterId}:${state.encounter.currentRound}:${actor.id}`;
    const resolved = await dependencies.executeIntent(
      encounterId,
      { ...toIntent(action), actionId: `${turnKey}:${action.action_type}` },
      userId,
      'dm',
      Date.now(),
    );

    let engineResult = resolved;
    let ended = combatEndedFrom(resolved);
    if (!ended && action.action_type !== 'end_turn') {
      const boundary = await dependencies.executeIntent(
        encounterId,
        { type: 'end_turn', actorId: action.actor_id, actionId: `${turnKey}:boundary` },
        userId,
        'dm',
        Date.now(),
      );
      engineResult = mergeBoundaryDeathSaves(resolved, boundary);
      ended = combatEndedFrom(boundary);
    }

    results.push({
      action,
      round: state.encounter.currentRound,
      outcomes: outcomesFrom(action, engineResult),
      ...(engineResult !== undefined ? { engineResult } : {}),
      actorIsPlayer: false,
      transcriptLines: [],
    });
    combatEnded = ended;
  }

  const finalState = await dependencies.getCombatState(encounterId, userId);
  if (finalState.encounter.status !== 'active') combatEnded = true;
  const capReached =
    !combatEnded &&
    iterationCount >= iterationCap &&
    !!finalState.currentParticipant &&
    !isPlayer(finalState.currentParticipant);
  if (capReached) {
    const line =
      `⚙️ Engine: NPC turn loop stopped after ${iterationCap} iterations; the encounter remains ` +
      'paused for safety.';
    transcriptLines.push(line);
  }

  // Why the loop stopped is not otherwise recoverable. The runner returns
  // iterationCount/iterationCap in the HTTP body and logs nothing, so a turn
  // that ran once and a turn that hit the safety cap look identical in the
  // log. Shape only -- ids, counts and a reason; no narration, no transcript.
  const stoppedBecause: NpcTurnLoopStopReason = combatEnded
    ? 'combat_ended'
    : capReached
      ? 'cap'
      : 'player_turn';
  combatLogger.info({
    msg: 'NPC_TURN_LOOP_DONE',
    sessionId: finalState.encounter.sessionId,
    encounterId,
    iterationCount,
    iterationCap,
    stoppedBecause,
  });

  return {
    results,
    currentParticipant: finalState.currentParticipant
      ? {
          id: finalState.currentParticipant.id,
          name: finalState.currentParticipant.name,
          participantType: finalState.currentParticipant.participantType,
          vitalState: (finalState.currentParticipant as { vitalState?: string }).vitalState,
        }
      : null,
    round: finalState.encounter.currentRound,
    combatEnded,
    iterationCount,
    iterationCap,
    capReached,
    transcriptLines,
    engineRows: results.flatMap(
      (result) =>
        (result.engineResult as { engineRows?: NpcEngineRow[] } | undefined)?.engineRows ?? [],
    ),
  };
}
