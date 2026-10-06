/**
 * The engine owner for mid-combat ability checks (#2420).
 *
 * Until this existed, a player who typed "shove the goblin" in a fight got narration with no
 * roll and no state: the attack path resolved weapons, spells and saves, and nothing resolved a
 * player's ability check. This service is that missing owner. It claims the player's action
 * (the same `claimTurnActionAndResolve` an attack uses, so a check costs the action like any
 * other), resolves the SRD contest, applies the condition, writes the engine line, and feeds the
 * fact to the DM prompt.
 *
 * The rules live in `combat-check-rules.ts`; this file is the state-changing half: roster,
 * action economy, conditions, and the words the DM reads.
 *
 * Additive: no new columns. Prone and Grappled are rows the shipped `conditions_library` seed
 * already inserts, and a shove's push is recorded as an engine fact rather than a map move,
 * because `combat_participants` has no displacement column to write.
 */
import {
  CHECK_DEFINITIONS,
  DEFAULT_PARLEY_DC,
  SHOVE_PUSH_FEET,
  parleyDcFor,
  passivePerception,
  resolveContestedCheck,
  resolveDcCheck,
  resolveEscapeCheck,
  type CheckActorProfile,
  type CombatCheckKind,
  type ResolvedCombatCheck,
  type ShoveOutcome,
} from './combat-check-rules.js';
import { CombatEncounterService } from './combat-encounter-service.js';
import { claimTurnActionAndResolve } from './combat-turn-resources.js';
import { getParticipantAbilityProfile } from './data-access.js';
import { CHECK_CONDITION_SOURCE, grappleOf, grappleSource } from './grapple-source.js';
import { isProvoked, nonHostileDisposition } from './npc-turn-runner.js';
import { recordParleyHold } from './parley-hold.js';
import { showTargetNumbersForSession } from './session-target-numbers.js';
import { recordDmTacticalFact } from './tactical-action-service.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { facingName, rosterEntryForParticipant } from '../../../../shared/engine-display-name';
import { BusinessLogicError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { tacticalSizeForParticipant } from '../../tactical/participant-size.js';
import { ConditionsService } from '../conditions-service.js';

import type { CombatCheckIntent } from '../../../../shared/combat-check-intent.js';

/**
 * How long each condition a check applies lasts. Prone is the 1-round backstop to standing up on
 * the creature's own turn; Grappled has no timer, it ends by `settleCheckConditionsForTurn`.
 */
const CHECK_CONDITION_DURATION = {
  Prone: { durationType: 'rounds' as const, durationValue: 1 },
  Grappled: { durationType: 'permanent' as const, durationValue: undefined },
};

/** What the caller sent, plus the d20 the player's popup kept. */
export interface CombatCheckIntentRequest {
  encounterId: string;
  intent: CombatCheckIntent;
  actorId: string;
  /** The target's participant id, resolved from the intent's `targetName` by the caller. */
  targetId?: string;
  userId: string;
  /**
   * The encounter version the caller read, claimed under `claimTurnAction` exactly as an attack's
   * is (#2420). Passing the CURRENT version instead would make the optimistic-concurrency check
   * pass by construction and let two racing clients both resolve the same check.
   */
  expectedVersion: number;
  /** The player's own d20 from the roll dialog; absent = the engine rolls it. */
  d20?: number;
  /** Which way a successful shove lands, chosen by the player in the confirm. */
  shoveOutcome?: ShoveOutcome;
}

/** The engine's answer: the numbers, the line, and what changed. */
export interface CombatCheckResult {
  kind: CombatCheckKind;
  success: boolean;
  /** The Engine line, e.g. "Shove: 14 (nat 11+3) vs Goblin Athletics 9 — success, Goblin is prone". */
  engineLine: string;
  /** The engine line as the DM reads it: without the DC when target numbers are hidden. */
  dmEngineLine: string;
  /** The fact handed to the DM prompt; always present, on success and on failure alike. */
  dmFact: string;
  actorId: string;
  targetId?: string;
  /** The condition written on a participant, when one was written. */
  conditionApplied?: { participantId: string; condition: string };
  /** The condition an escape removed, when it succeeded. */
  conditionRemoved?: { participantId: string; condition: string };
  /** The parley DC the engine set, for a parley. */
  parleyDc?: number;
  actorRoll: ResolvedCombatCheck['actor'];
  opposedBy: number;
}

type CombatState = Awaited<ReturnType<typeof CombatEncounterService.getCombatState>>;

/**
 * A check participant as the rules need them: their ability scores and their level.
 *
 * Read through `getParticipantAbilityProfile` so a player character resolves through
 * `character_stats` and an NPC through its authored stat block — the same profile the attack
 * resolver uses, rather than a second, subtly different reader.
 */
async function checkProfileOf(participant: unknown): Promise<CheckActorProfile> {
  const profile = await getParticipantAbilityProfile(participant);
  // A DM-structured monster has no `characterId` and no `npcId`, so the reader returns no scores
  // for it. Its printed scores were stored on the row's `monsterAttack` at seating.
  const stored = (
    participant as { monsterAttack?: { abilityScores?: Record<string, number> } } | null
  )?.monsterAttack?.abilityScores;
  const scores = Object.keys(profile.scores).length ? profile.scores : (stored ?? profile.scores);
  if (!Object.keys(scores).length) {
    // No stat block anywhere: every ability reads 10 (+0). Said in the log rather than silently.
    logger.info({
      msg: 'COMBAT_CHECK_ABILITY_DEFAULTED',
      participantId: (participant as { id?: string } | null)?.id ?? null,
      reason: 'no_stat_block',
    });
  }
  return {
    scores,
    level: profile.level,
    skillProficiencies: profile.skillProficiencies,
  };
}

/**
 * Whether the actor's sheet grants the check's skill.
 *
 * An NPC stat block prints no skill proficiencies, so a creature contributes the ability modifier
 * alone. A player character contributes proficiency when `skill_proficiencies` names the skill —
 * a proficient Athletics shove is a different roll from an unproficient one, and resolving both
 * as unproficient quietly costs the player their bonus.
 */
function isProficientIn(profile: CheckActorProfile, skill: string): boolean {
  const target = skill.toLowerCase();
  return (profile.skillProficiencies ?? []).some(
    (entry) => entry.toLowerCase().replace(/[^a-z0-9]/g, '') === target.replace(/[^a-z0-9]/g, ''),
  );
}

/**
 * The highest passive Perception among the creatures searching for the player.
 *
 * SRD: a hide is measured against the searchers' passive Perception, so with two hostiles the
 * HIGHER one is the test — hiding from the ogre while the goblin can still see you is not hidden.
 * Only hostile, standing creatures count; an ally's or a neutral's Perception is not looking for them.
 */
function highestHostilePassivePerception(
  state: CombatState,
  actorId: string,
  profiles: Map<string, CheckActorProfile>,
  authored: Map<string, number | null>,
): { perception: number; watchers: string[] } {
  const watchers: string[] = [];
  let perception = 0;
  for (const participant of state.participants) {
    if (participant.id === actorId || !participant.isActive) continue;
    if (participant.participantType === 'player') continue;
    // Only creatures that are hostile to the player and still standing are searching: an ally or
    // a neutral creature, or one that is down, is not looking for the actor.
    const record = participant as unknown as Record<string, unknown>;
    if (nonHostileDisposition(record) && !isProvoked(record)) continue;
    if (((participant as { status?: { currentHp: number } | null }).status?.currentHp ?? 1) <= 0) {
      continue;
    }
    const profile = profiles.get(participant.id);
    if (!profile) continue;
    const value = passivePerception(profile, authored.get(participant.id) ?? null);
    if (value > perception) {
      perception = value;
      watchers.length = 0;
    }
    if (value === perception) watchers.push(participant.id);
  }
  return { perception, watchers };
}

/**
 * An authored `parleyDc` / `passivePerception` from a creature's stat block.
 *
 * Read from the participant row itself, because that is where `getCombatState` puts them: it
 * flattens the joined `npc` row's authored numbers onto the participant (see
 * `authoredNumbers` in combat-encounter-service), exactly as it has always flattened
 * `disposition`. Reading `participant.npc.stats` here would find nothing on every row.
 */
function authoredStatNumber(participant: unknown, key: string): number | null {
  const value = (participant as Record<string, unknown> | null)?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** "Goblin" / "The Goblin", whichever the encounter already uses for this participant. */
const labelOf = (state: CombatState, participantId: string): string => {
  const participant = state.participants.find((entry) => entry.id === participantId);
  return facingName(
    participant?.name,
    participantId,
    state.participants.map(rosterEntryForParticipant),
  );
};

/**
 * Apply a condition to a participant through the one writer that owns them.
 *
 * `ConditionsService.applyCondition` is the same path the status route uses, so the row lands in
 * `combat_participant_conditions` with the library's mechanical effects attached — which is how
 * Grappled's "speed becomes 0" reaches the rest of the engine without this file re-deriving it.
 */
async function applyCondition(
  participantId: string,
  encounterId: string,
  condition: 'Prone' | 'Grappled',
  source: string,
): Promise<{ participantId: string; condition: string }> {
  const { durationType, durationValue } = CHECK_CONDITION_DURATION[condition];
  await ConditionsService.applyCondition(
    participantId,
    encounterId,
    condition,
    durationType,
    durationValue,
    undefined,
    undefined,
    source,
  );
  return { participantId, condition };
}

/**
 * Resolve a hide or a parley: the two checks measured against a DC rather than a contest die.
 *
 * Split out of `executeCombatCheck` because the hide has to look at the whole room (the highest
 * hostile passive Perception) while the parley reads one creature's disposition — two different
 * reads of the roster, one shared resolution call.
 */
async function resolveNonContestedCheck(params: {
  intent: CombatCheckIntent;
  actorProfile: CheckActorProfile;
  actorSkillProficient: boolean;
  state: CombatState;
  actorId: string;
  target?: unknown;
  actorD20?: number;
  roll: () => number;
}): Promise<ResolvedCombatCheck> {
  const { intent, actorProfile, state, actorId, roll } = params;
  const shared = {
    actorProfile,
    actorSkillProficient: params.actorSkillProficient,
    ...(params.actorD20 !== undefined ? { actorD20: params.actorD20 } : {}),
    roll,
  };

  if (intent.kind === 'hide') {
    const profiles = new Map<string, CheckActorProfile>();
    const authored = new Map<string, number | null>();
    for (const participant of state.participants) {
      profiles.set(participant.id, await checkProfileOf(participant));
      authored.set(participant.id, authoredStatNumber(participant, 'passivePerception'));
    }
    const { perception, watchers } = highestHostilePassivePerception(
      state,
      actorId,
      profiles,
      authored,
    );
    // With nobody searching there is no Perception to beat, so the check cannot fail.
    const dc = watchers.length ? perception : 0;
    return resolveDcCheck({
      ...shared,
      kind: 'hide',
      dc,
      opposedByLabel: watchers.length ? `passive Perception ${dc}` : 'no watchers',
    });
  }

  const target = params.target as { id?: string; disposition?: string | null } | undefined;
  const authored = target?.id ? authoredStatNumber(target, 'parleyDc') : null;
  const { dc, source } = parleyDcFor(target?.disposition, authored);
  logger.info({
    msg: 'COMBAT_CHECK_PARLEY_DC_SET',
    encounterId: state.encounter.id,
    targetId: target?.id ?? null,
    disposition: target?.disposition ?? null,
    dc,
    source,
  });
  return resolveDcCheck({
    ...shared,
    kind: rulesKindFor(intent) as 'persuade' | 'intimidate',
    dc,
    opposedByLabel: `DC ${dc}`,
  });
}

/**
 * What a successful check changes, per kind.
 *
 * Prone and Grappled are the two the SRD names and the two `conditions_library` already carries.
 * A hide has NO condition row in the shipped seed and `combat_participants` has no hidden
 * column, so a successful hide is recorded as a fact the DM must honour rather than as engine
 * state — see the migration proposed in the PR body. A parley likewise writes no condition: the
 * SRD grants no condition for talking, and the outcome is that the creature holds its action.
 */
/**
 * The rules check an intent resolves to.
 *
 * The two vocabularies differ on purpose: the intent says `parley` (what the player was trying to
 * do) while the rules distinguish `persuade` from `intimidate` (which Charisma skill is spent, and
 * therefore which ability and which skill proficiency apply). Everything downstream — the skill
 * the modifier is built from, the definition, the resolution — keys off this one value.
 */
function rulesKindFor(intent: CombatCheckIntent): keyof typeof CHECK_DEFINITIONS {
  if (intent.kind !== 'parley') return intent.kind;
  return intent.parleySkill === 'intimidate' ? 'intimidate' : 'persuade';
}

const SIZE_ORDER = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] as const;

/**
 * SRD 5.1: the target of a shove or a grapple can be no more than one size larger than the
 * creature making it. Sizes come from the board entity, which seating filled from the resolved
 * stat block; a participant the board does not hold falls back to the catalog lookup.
 */
async function refuseOversizedTarget(
  state: CombatState,
  request: CombatCheckIntentRequest,
): Promise<void> {
  const { intent, actorId, targetId } = request;
  if ((intent.kind !== 'shove' && intent.kind !== 'grapple') || !targetId) return;
  const map = await loadActiveTacticalMap(state.encounter.sessionId);
  const sizeOf = (id: string): (typeof SIZE_ORDER)[number] => {
    const entity = map?.entities.find((candidate) => candidate.id === id);
    if (entity) return entity.size;
    const participant = state.participants.find((candidate) => candidate.id === id);
    return tacticalSizeForParticipant({
      name: participant?.name ?? '',
      participantType: participant?.participantType ?? 'monster',
    });
  };
  const actorSize = sizeOf(actorId);
  const targetSize = sizeOf(targetId);
  if (SIZE_ORDER.indexOf(targetSize) - SIZE_ORDER.indexOf(actorSize) <= 1) return;
  throw new BusinessLogicError(
    `${labelOf(state, actorId)} (${actorSize}) cannot ${intent.kind} ${labelOf(state, targetId)} (${targetSize}): ` +
      'the target can be no more than one size larger.',
    { reason: 'check_target_too_large', actorSize, targetSize },
  );
}

/** The round of the target's next turn: this round if it has yet to act, otherwise the next. */
function nextTurnRound(state: CombatState, actorId: string, targetId: string): number {
  const orderOf = (id: string): number =>
    state.participants.find((entry) => entry.id === id)?.turnOrder ?? 0;
  return orderOf(targetId) > orderOf(actorId)
    ? state.encounter.currentRound
    : state.encounter.currentRound + 1;
}

async function applyCheckOutcome(params: {
  resolution: ResolvedCombatCheck;
  request: CombatCheckIntentRequest;
  state: CombatState;
}): Promise<{
  conditionApplied?: { participantId: string; condition: string };
  conditionRemoved?: { participantId: string; condition: string };
  consequence: string;
}> {
  const { resolution, request } = params;
  const { encounterId, targetId } = request;
  if (!resolution.success) return { consequence: '' };

  // A hide targets nobody: it is measured against everyone in the room, so it is settled before
  // the target guard below. Placing it after would make its branch unreachable and a won hide
  // would record nothing at all.
  if (resolution.kind === 'hide') {
    return {
      consequence: `${labelOf(params.state, request.actorId)} is hidden until an attack or discovery`,
    };
  }
  if (!targetId) return { consequence: '' };

  switch (resolution.kind) {
    case 'shove': {
      if (request.shoveOutcome === 'push') {
        return {
          consequence: `${labelOf(params.state, targetId)} is pushed ${SHOVE_PUSH_FEET} feet away from ${labelOf(params.state, request.actorId)}`,
        };
      }
      return {
        conditionApplied: await applyCondition(
          targetId,
          encounterId,
          'Prone',
          CHECK_CONDITION_SOURCE,
        ),
        consequence: `${labelOf(params.state, targetId)} is prone`,
      };
    }
    case 'grapple':
      return {
        conditionApplied: await applyCondition(
          targetId,
          encounterId,
          'Grappled',
          grappleSource(request.actorId),
        ),
        consequence: `${labelOf(params.state, targetId)} is grappled, speed 0`,
      };
    case 'escape': {
      const held = grappleOf(
        params.state.participants.find((entry) => entry.id === request.actorId),
      );
      if (held) await ConditionsService.removeCondition(held.conditionId, encounterId);
      return {
        conditionRemoved: { participantId: request.actorId, condition: 'Grappled' },
        consequence: `${labelOf(params.state, request.actorId)} breaks free of ${labelOf(params.state, targetId)}'s grapple`,
      };
    }
    case 'persuade':
    case 'intimidate':
      await recordParleyHold(
        params.state.encounter.sessionId,
        targetId,
        nextTurnRound(params.state, request.actorId, targetId),
      );
      return { consequence: `${labelOf(params.state, targetId)} holds its next action` };
    default:
      return { consequence: '' };
  }
}

/**
 * The one-line engine fact the DM must honour, and the Engine line the player reads.
 *
 * The narration restates this rather than inventing an outcome — the same contract #2396 gives
 * save results. A parley deliberately stops at "it holds its next action": the engine
 * records a parley, never a surrender, because a surrender is a disposition change the creature
 * stat block did not author and the DM did not grant.
 */
function describeOutcome(params: {
  resolution: ResolvedCombatCheck;
  consequence: string;
  actorLabel: string;
  targetLabel: string | null;
  parleyDc?: number;
  showTargetNumbers: boolean;
}): { engineLine: string; dmEngineLine: string; dmFact: string } {
  const { resolution, consequence, actorLabel, targetLabel, parleyDc, showTargetNumbers } = params;
  const targetPart = targetLabel ? targetLabel : 'the room';
  // `resolution.line` already ends in the one outcome word ("— success" / "— failure"); what
  // follows is only the consequence, so the word is never said twice.
  const engineLine = resolution.success
    ? consequence
      ? `${resolution.line}, ${consequence}`
      : resolution.line
    : `${resolution.line}, nothing changes`;
  const isParley = resolution.kind === 'persuade' || resolution.kind === 'intimidate';
  // The engine line the DM restates carries the parley DC too, so it is worded without it when
  // target numbers are hidden. The player's own Engine line keeps it.
  const dmEngineLine =
    isParley && !showTargetNumbers ? engineLine.replace(` vs DC ${parleyDc}`, '') : engineLine;
  // A parley fact may only assert the stand-down on a SUCCESS. Emitting the PARLEY clause for a
  // failed roll would tell the DM the creature held its action while the engine line beside it
  // says the check failed — the fabricated-outcome shape #2396 exists to prevent.
  const parleyClause = resolution.success
    ? `PARLEY: ${targetPart} holds its next action and does not attack. It has NOT surrendered and does not drop its weapon — narrate a stand-down, not a yielding. `
    : `The ${resolution.definition.skill} check FAILED: ${targetPart} does not stand down and still attacks this round. Narrate no stand-down and no surrender. `;
  const dmFact = isParley
    ? `${actorLabel} ${resolution.definition.skill} check ${resolution.actor.total}` +
      // The DM repeats the numbers it is told, so a campaign that hides target numbers (Hard)
      // gets the fact worded without the DC, through the same shared rule the spell facts use.
      `${showTargetNumbers ? ` against DC ${parleyDc ?? DEFAULT_PARLEY_DC}` : ''}: ${resolution.success ? 'success' : 'failure'}. ${parleyClause}` +
      `Restate the engine line; never invent a surrender or a recruitment.`
    : `${actorLabel} ${resolution.definition.label}: ${engineLine}. ` +
      `Restate the engine numbers exactly; never contradict the outcome.`;
  return { engineLine, dmEngineLine, dmFact };
}

/**
 * Turn a resolved check into everything a turn owes the player: the condition, the Engine line,
 * the DM fact, and the result the intent route returns.
 */
async function applyResolution(params: {
  resolution: ResolvedCombatCheck;
  request: CombatCheckIntentRequest;
  state: CombatState;
  target: unknown;
}): Promise<CombatCheckResult> {
  const { resolution, request, state } = params;
  const { encounterId, actorId, targetId } = request;

  const { conditionApplied, conditionRemoved, consequence } = await applyCheckOutcome({
    resolution,
    request,
    state,
  });
  const targetLabel = targetId ? labelOf(state, targetId) : null;
  const actorLabel = labelOf(state, actorId);
  const isParley = resolution.kind === 'persuade' || resolution.kind === 'intimidate';
  const { engineLine, dmEngineLine, dmFact } = describeOutcome({
    resolution,
    consequence,
    actorLabel,
    targetLabel,
    ...(isParley ? { parleyDc: resolution.opposedBy } : {}),
    showTargetNumbers: await showTargetNumbersForSession(state.encounter.sessionId),
  });

  // The fact goes to the DM prompt through the same channel every other engine fact uses, so a
  // resolved check is a turn the DM was told about rather than a silent one (#2381's narration
  // gate). `recordDmTacticalFact` is a no-op when the encounter has no active board.
  await recordDmTacticalFact(state.encounter.sessionId, dmFact);

  logger.info(
    {
      msg: 'COMBAT_CHECK_RESOLVED',
      encounterId,
      sessionId: state.encounter.sessionId,
      actorId,
      targetId: targetId ?? null,
      kind: resolution.kind,
      success: resolution.success,
      actorTotal: resolution.actor.total,
      opposedBy: resolution.opposedBy,
      condition: conditionApplied?.condition ?? null,
    },
    '[combat] mid-combat ability check resolved',
  );

  return {
    kind: resolution.kind,
    success: resolution.success,
    engineLine,
    dmEngineLine,
    dmFact,
    actorId,
    ...(targetId ? { targetId } : {}),
    ...(conditionApplied ? { conditionApplied } : {}),
    ...(conditionRemoved ? { conditionRemoved } : {}),
    ...(isParley ? { parleyDc: resolution.opposedBy } : {}),
    actorRoll: resolution.actor,
    opposedBy: resolution.opposedBy,
  };
}

/**
 * Resolve one mid-combat check and write down what happened.
 *
 * `roll` is injected so a test can pin both dice; production leaves it undefined and the engine
 * rolls. The action claim wraps the whole resolution, so a check costs the player's action
 * exactly like an attack and a failure mid-resolution cannot strand the turn.
 */
export async function executeCombatCheck(
  request: CombatCheckIntentRequest,
  roll?: () => number,
): Promise<CombatCheckResult> {
  const { encounterId, intent, actorId, userId } = request;
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const actor = state.participants.find((participant) => participant.id === actorId);
  if (!actor) throw new NotFoundError('Combat participant', actorId);

  // An escape names no target: the creature holding the actor is the one it is tested against.
  let targetId = request.targetId;
  if (intent.kind === 'escape') {
    const held = grappleOf(actor);
    if (!held) {
      throw new BusinessLogicError(
        `${labelOf(state, actorId)} is not grappled, so there is nothing to escape.`,
        { reason: 'not_grappled' },
      );
    }
    targetId = held.grapplerId;
  }
  const checkRequest = { ...request, ...(targetId ? { targetId } : {}) };
  // Refused before the action is claimed, so a refusal costs the player nothing.
  await refuseOversizedTarget(state, checkRequest);

  return claimTurnActionAndResolve(actorId, encounterId, request.expectedVersion, async () => {
    const fresh = await CombatEncounterService.getCombatState(encounterId, userId);
    const actorProfile = await checkProfileOf(
      fresh.participants.find((participant) => participant.id === actorId),
    );
    const target = targetId
      ? fresh.participants.find((participant) => participant.id === targetId)
      : undefined;
    const targetProfile = target ? await checkProfileOf(target) : null;
    const die = roll ?? (() => Math.floor(Math.random() * 20) + 1);
    const actorD20 = request.d20 !== undefined ? { actorD20: request.d20 } : {};

    // The sheet grants proficiency only where the character sheet names the skill; a creature's
    // stat block names none, so it contributes the ability modifier alone.
    const rulesKind = rulesKindFor(intent);
    const actorSkillProficient = isProficientIn(actorProfile, CHECK_DEFINITIONS[rulesKind].skill);

    const resolution =
      intent.kind === 'shove' || intent.kind === 'grapple'
        ? resolveContestedCheck({
            kind: intent.kind,
            actorProfile,
            actorSkillProficient,
            ...actorD20,
            targetProfile: targetProfile ?? { scores: {}, level: 1 },
            roll: die,
          })
        : intent.kind === 'escape'
          ? resolveEscapeCheck({
              actorProfile,
              athleticsProficient: isProficientIn(actorProfile, 'Athletics'),
              acrobaticsProficient: isProficientIn(actorProfile, 'Acrobatics'),
              ...actorD20,
              grapplerProfile: targetProfile ?? { scores: {}, level: 1 },
              roll: die,
            })
          : await resolveNonContestedCheck({
              intent,
              actorProfile,
              actorSkillProficient,
              state: fresh,
              actorId,
              ...(target ? { target } : {}),
              ...actorD20,
              roll: die,
            });

    return applyResolution({
      resolution,
      request: checkRequest,
      state: fresh,
      target,
    });
  });
}
