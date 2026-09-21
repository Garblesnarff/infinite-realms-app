import { combatLogger } from '../../lib/logger.js';

import type { SubmittedCombatIntent } from './combat-intent-service.js';
import type { WeaponRuleProfile } from './combat-rules.js';
import type { CombatState, DeathSaveResult } from '../../types/combat.js';

/** The action shape returned to the browser so it can reuse its transcript formatter. */
export type NpcTurnAction = {
  actor_id: string;
  action_type: 'attack' | 'dodge' | 'end_turn';
  target_ids: string[];
  weapon_id: string | null;
  spell_id: string | null;
  slot_level: number | null;
  movement_feet: number;
};

export type NpcTurnOutcome = {
  action: NpcTurnAction;
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
  currentParticipant: { id: string; name: string; participantType: string } | null;
  combatEnded: boolean;
  iterationCount: number;
  iterationCap: number;
  capReached: boolean;
  transcriptLines: string[];
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
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const isPlayer = (participant: { participantType?: string }): boolean =>
  participant.participantType === 'player';

const npcIsStanding = (participant: { maxHp: number; status?: { currentHp: number } | null }) =>
  (participant.status?.currentHp ?? participant.maxHp) > 0;

const nonHostileDisposition = (participant: Record<string, unknown>): boolean => {
  const raw =
    participant.disposition ??
    (participant.stats as Record<string, unknown> | undefined)?.disposition;
  if (typeof raw !== 'string') return false;
  return new Set(['ally', 'friendly', 'neutral', 'peaceful', 'non-hostile', 'non_hostile']).has(
    raw.trim().toLowerCase(),
  );
};

const isProvoked = (participant: Record<string, unknown>): boolean => participant.provoked === true;

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

function chooseTarget(state: CombatState, actorId: string) {
  return state.participants.find((participant) => {
    if (participant.id === actorId || !participant.isActive || !isPlayer(participant)) return false;
    return npcIsStanding(
      participant as unknown as { maxHp: number; status?: { currentHp: number } },
    );
  });
}

function chooseAction(
  state: CombatState,
  actor: CombatState['currentParticipant'],
  weapon: WeaponRuleProfile | null,
  canAct: boolean,
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

  if (!canAct) return endTurn();

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

  const target = chooseTarget(state, actor.id);
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

function deathSaveLines(value: unknown, state: CombatState): string[] {
  if (!isRecord(value) || !Array.isArray(value.deathSaves)) return [];
  return value.deathSaves.flatMap((save) => {
    if (!isRecord(save) || typeof save.participantId !== 'string') return [];
    const participant = state.participants.find((candidate) => candidate.id === save.participantId);
    if (!participant) return [];
    return [describeDeathSaveForTranscript(participant.name, save as unknown as DeathSaveResult)];
  });
}

function describeDeathSaveForTranscript(name: string, result: DeathSaveResult): string {
  const tally = `${result.successes} success${result.successes === 1 ? '' : 'es'}, ${
    result.failures
  } failure${result.failures === 1 ? '' : 's'}`;
  if (result.wasRevived) {
    return `${name} rolled a NATURAL 20 on their death saving throw and is back on their feet at 1 HP, conscious and able to act. Narrate this; it already happened.`;
  }
  if (result.isDead) {
    return `${name} rolled ${result.roll} on their death saving throw — their third failure. ${name} is DEAD. Narrate the death; it already happened.`;
  }
  if (result.isStabilized) {
    return `${name} rolled ${result.roll} on their death saving throw — their third success. ${name} is STABILISED: unconscious at 0 HP, no longer dying, and will make no further death saving throws. Narrate this; it already happened.`;
  }
  const outcome = result.isSuccess ? 'SUCCESS' : 'FAILURE';
  return `${name} rolled ${result.roll} on their death saving throw — ${outcome} (${tally}). ${name} is still unconscious at 0 HP and still dying. Narrate this; it already happened.`;
}

function mergeBoundaryDeathSaves(resolution: unknown, boundary: unknown): unknown {
  if (!isRecord(boundary) || !Array.isArray(boundary.deathSaves) || !boundary.deathSaves.length) {
    return resolution;
  }
  if (!isRecord(resolution)) return { result: resolution, deathSaves: boundary.deathSaves };
  return { ...resolution, deathSaves: boundary.deathSaves };
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
    const action = chooseAction(state, actor, weapon, canAct);
    const resolved = await dependencies.executeIntent(
      encounterId,
      toIntent(action),
      userId,
      'dm',
      Date.now(),
    );

    let engineResult = resolved;
    let ended = combatEndedFrom(resolved);
    if (!ended && action.action_type !== 'end_turn') {
      const boundary = await dependencies.executeIntent(
        encounterId,
        { type: 'end_turn', actorId: action.actor_id },
        userId,
        'dm',
        Date.now(),
      );
      engineResult = mergeBoundaryDeathSaves(resolved, boundary);
      ended = combatEndedFrom(boundary);
    }

    const resultTranscript = deathSaveLines(engineResult, state);
    transcriptLines.push(...resultTranscript);
    results.push({
      action,
      outcomes: outcomesFrom(action, engineResult),
      ...(engineResult !== undefined ? { engineResult } : {}),
      actorIsPlayer: false,
      transcriptLines: resultTranscript,
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
        }
      : null,
    combatEnded,
    iterationCount,
    iterationCap,
    capReached,
    transcriptLines,
  };
}
