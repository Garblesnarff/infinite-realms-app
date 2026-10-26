/* eslint-disable max-lines -- the single mutation gateway for every combat intent; splitting
   the dispatch would put the turn's authorization, resolution, and reporting in three files. */
import { randomUUID } from 'node:crypto';

import { describeRefusedSpell, describeResolvedSpell } from './attack-narration.js';
import { decideAttackApproach, describeResolvedAttack } from './combat-approach-service.js';
import { executeCombatCheck } from './combat-check-service.js';
import { CombatEncounterService } from './combat-encounter-service.js';
import { partyHasLeftTheFight } from './combat-end-guard.js';
import { concludeEncounter } from './combat-ending.js';
import { trackCombatEvent } from './combat-events.js';
import { resolveCombatIntentRefsWithRetry } from './combat-intent-refs.js';
import { assertActorTurn } from './combat-intent-turn.js';
import {
  buildCombatWeaponOptions,
  type WeaponTargetResolution,
} from './combat-weapon-options.js';
import {
  getParticipantAbilityProfile,
  getActiveConditionNames,
  listCarriedWeaponProfiles,
  listEquippedWeaponProfiles,
} from './data-access.js';
import {
  describeGoingDown,
  rollOwedDeathSave,
  settleDownedTurns,
  vitalStateOf,
  applyStableWake,
  planStableWake,
  type VitalsInput,
  type WakeOutcome,
} from './death-saves-service.js';
import { grantTacticalDash, resetTacticalMovementForTurn } from './tactical-combat-lifecycle.js';
import {
  catalogWeaponIsRanged,
  findCatalogWeapon,
  normalizeWeaponName,
  weaponProfileMatches,
  findMagicBaseWeapon,
  isUnarmedWeaponClaim,
  UNARMED_STRIKE,
} from './weapon-catalog.js';
import { groundRequestedWeapon, type GroundedWeapon } from './weapon-grounding.js';
import { resolveWeaponName } from '../../../../shared/equipment-weapon-resolver';
import { logger } from '../../lib/logger.js';
import { checkLineOfSight, getCover, getDistance } from '../../tactical/engine.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
import { resolveAttackRules, type WeaponRuleProfile } from './combat-rules.js';
import { publishCombatState } from './combat-sync-service.js';
import {
  claimTurnActionAndResolve,
  claimTurnBonusActionAndResolve,
  claimTurnVersion,
  setDefensiveAction,
} from './combat-turn-resources.js';
import {
  fighterFeatureUses,
  resolveActionSurge,
  resolveSecondWind,
  type ActionSurgeResult,
  type SecondWindResult,
} from './fighter-features-service.js';
import { resolveParticipantArmorClass } from './participant-armor-class.js';
import {
  hasLeftTheBoard,
  recordPlayerExit,
  selectOpportunityAttacker,
  type OpportunityAttacker,
  type PlayerExitResult,
} from './player-exit-service.js';
import { loadSessionEntityIndex, type SessionEntityIndex } from './session-entity-index.js';
import { showTargetNumbersForSession } from './session-target-numbers.js';
import { applyTacticalMapAction, recordDmTacticalFact } from './tactical-action-service.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import {
  describeDamageAtZeroHp,
  describeInstantDeath,
  describeStrikeOnDowned,
} from '../../../../shared/death-save-lines';
import {
  facingName,
  rosterEntryForParticipant,
  playerFacingWeaponName,
  type EngineRosterEntry,
} from '../../../../shared/engine-display-name';
import {
  playerTextDeclares,
  playerTextDeclaresLeaving,
} from '../../../../shared/player-exit-wording';
import { isPlayerCombatSpell, resolveCatalogSpell } from '../../data/spellData.js';
import { BusinessLogicError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { planApproach } from '../../tactical/approach.js';
import { entitySlug, resolveEntityRef, slugify } from '../../tactical/identity.js';

import type { CombatAttackService as CombatAttackServiceType } from './combat-attack-service.js';
import type { TacticalMap } from '../../tactical/types.js';
import type { AttackRollInput, CombatEndReason, SpellAttackInput } from '../../types/combat.js';

/**
 * Keep the attack resolver out of the intent gateway's eager module graph. Both the gateway and
 * the resolver reach encounter state, and loading them together can expose the resolver's
 * singleton while Bun is linking a full real-DB suite. The import is cached after the first
 * attack, so this changes only module-evaluation order, not runtime behavior.
 */
async function createCombatAttackService(): Promise<CombatAttackServiceType> {
  const { CombatAttackService } = await import('./combat-attack-service.js');
  return new CombatAttackService();
}

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
      /** The player's own attack die, when the popup rolled it. See `AttackRollInput`. */
      d20?: number;
      /** Both popup dice `[kept, dropped]` when it rolled two for advantage/disadvantage (#263). */
      d20Rolls?: [number, number];
    }
  | {
      type: 'spell';
      actorId: string;
      targetIds: string[];
      spellId?: string;
      spellName: string;
      slotLevel?: number | null;
      /** The player's own attack die for attack-roll spells, when the popup rolled it. */
      d20?: number;
      /** Both popup dice `[kept, dropped]` when it rolled two for advantage/disadvantage (#263). */
      d20Rolls?: [number, number];
      expectedVersion: number;
    }
  | { type: 'dash' | 'dodge' | 'disengage'; actorId: string; expectedVersion: number }
  | { type: 'flee' | 'yield'; actorId: string; expectedVersion: number }
  /**
   * A mid-combat ability check (#2420): shove, grapple, hide, or a Charisma parley. Costs the
   * action like an attack. `d20` is the player's own die when the roll dialog rolled it.
   */
  | {
      type: 'check';
      actorId: string;
      targetId?: string;
      checkKind: 'shove' | 'grapple' | 'escape' | 'hide' | 'parley';
      parleySkill?: 'persuade' | 'intimidate';
      shoveOutcome?: 'prone' | 'push';
      expectedVersion: number;
      d20?: number;
    }
  | { type: 'end_turn'; actorId: string }
  /**
   * The death saving throw a dying player owes at the start of their turn. `d20` is the die the
   * player rolled in the roll prompt; absent, the engine rolls it (the prompt's auto-roll).
   */
  | { type: 'death_save'; actorId: string; d20?: number }
  /**
   * The Fighter's short-rest features (#975). Second Wind costs the bonus action and heals;
   * Action Surge costs no action itself and grants one additional action this turn. Both
   * spend the tracked use on the character's sheet.
   */
  | { type: 'second_wind' | 'action_surge'; actorId: string; expectedVersion: number };

export type CombatActionSource = 'player' | 'dm';

/** Who produced the action (#2305); see `COMBAT_ACTION_ORIGINS` in the route's schema. */
export type CombatActionOrigin =
  | 'typed'
  | 'sheet_cast'
  | 'action_bar'
  | 'dice_roll'
  | 'dm'
  | 'repair';

/** The origins that are this turn's player input. Only these may act for the player. */
const PLAYER_INPUT_ORIGINS = new Set<CombatActionOrigin>([
  'typed',
  'sheet_cast',
  'action_bar',
  'dice_roll',
]);

/** A turn boundary is not an action: the client ends the player's turn after one it resolved. */
const PLAYER_ORIGIN_GUARDED_TYPES = new Set([
  'attack',
  'spell',
  'check',
  'move',
  'dash',
  'dodge',
  'disengage',
  'death_save',
  'flee',
  'yield',
  // #975: a feature spend is the player's own resource; a DM- or repair-produced
  // declaration must not burn it without the player's input, like any other action.
  'second_wind',
  'action_surge',
]);

/**
 * The player acts only on the player's own input (#2305). In run M7 round 2 the engine cast
 * Chill Touch for the player 45 s after a turn in which the player sent nothing; the action
 * arrived as `source: 'dm'`, exactly like the player's real round-1 cast, so nothing here could
 * tell them apart. The client now says where each action came from, and an action produced by
 * the DM or the repair loop is refused for a player actor — and logged with that origin, so the
 * next such line is one query away.
 *
 * An absent origin is accepted and logged as `unmarked`: the server-internal callers and a
 * client older than this deploy send none. (The other skew direction is harmless too: a server
 * older than this deploy ignores the field.)
 */
function assertPlayerInputOrigin(
  state: CombatState,
  intent: SubmittedCombatIntent,
  source: CombatActionSource,
  origin: CombatActionOrigin | undefined,
): void {
  if (!PLAYER_ORIGIN_GUARDED_TYPES.has(intent.type)) return;
  const actor = state.participants.find((participant) => participant.id === intent.actorId);
  if (actor?.participantType !== 'player') return;
  if (!origin || PLAYER_INPUT_ORIGINS.has(origin)) return;
  logger.warn({
    msg: 'PLAYER_ACTION_REFUSED_NO_INPUT',
    encounterId: state.encounter.id,
    sessionId: state.encounter.sessionId,
    actorId: intent.actorId,
    intentType: intent.type,
    source,
    origin,
  });
  throw new BusinessLogicError('Player action refused: the player did not declare it this turn', {
    reason: 'player_action_without_input',
    origin,
    intentType: intent.type,
  });
}

/**
 * An intent as submitted, before the dispatch resolves it. `expectedVersion` may be absent —
 * which only a DM-sourced intent is allowed to do.
 */
type VersionOptional<T> = T extends { expectedVersion: number }
  ? Omit<T, 'expectedVersion'> & { expectedVersion?: number }
  : T;
export type SubmittedCombatIntent = VersionOptional<CombatIntent> & { actionId?: string };

export { assertActorTurn } from './combat-intent-turn.js';

export type EncounterAlreadyConcludedResult = {
  encounterAlreadyConcluded: true;
  encounterId: string;
  status: 'completed';
};

const VERSIONED_INTENT_TYPES = new Set([
  'attack',
  'spell',
  'check',
  'dash',
  'dodge',
  'disengage',
  'flee',
  'yield',
  'second_wind',
  'action_surge',
]);

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

/**
 * Everything that is not the player is a hostile.
 *
 * This used to ask `livingTypes.has('npc')`, and that single string is what produced nine
 * encounters in one three-minute session in run 16. `participant_type` carries four values;
 * `startCombat` stamps a DM-authored combatant `'monster'` when it came with an SRD id and
 * `'other'` when it did not, and only a combatant built from an `npcId` -- a database NPC
 * row, which structured combat starts never supply -- is ever `'npc'`. So no structured
 * encounter has ever contained a living `'npc'`, the "are both sides still standing?" test
 * was false from the first damaging action onward, and every landed hit ended the fight and
 * tore down the board with the enemy still up. The DM, correctly reading a session that was
 * no longer in combat, started a new one; the next hit ended that; nine times over.
 *
 * Asking about `'player'` instead is the same question with no vocabulary to drift: it needs
 * one value to be spelled consistently rather than three, and `startCombat` derives
 * `'player'` from the presence of a `characterId` rather than from anything model-authored.
 * Every other participant-type check in the server already reads this way
 * (`participant-size.ts`, `tactical-combat-lifecycle.ts`); this was the odd one out.
 */
const isHostile = (participantType: string): boolean => participantType !== 'player';

/** Preserve the engine result while telling the client that this action crossed combat's end. */
function markCombatEnded(result: unknown, ending?: CombatEnding | null): unknown {
  const facts = ending
    ? { endedReason: ending.reason, ...(ending.wake.length ? { wake: ending.wake } : {}) }
    : {};
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), combatEnded: true, ...facts };
  }
  return { result, combatEnded: true, ...facts };
}

type AttackVisibilityContext = {
  actorId: string;
  actorName: string;
  targetId: string;
  targetName: string;
  requestedWeapon: string | null;
  resolvedWeapon: string;
  weaponSubstituted: boolean;
  actorIsPlayer: boolean;
  normalizeAutoRolled?: boolean;
};

type SpellResolutionVisibility = Parameters<typeof describeResolvedSpell>[3] & {
  spellName?: string;
  targetNewHp?: number;
  targetIsDead?: boolean;
  deathSaveFailuresAdded?: number;
  deathSavesFailures?: number;
  instantDeath?: boolean;
  damageOverflow?: number;
  hpMaximum?: number;
};

/** Keep the engine's descriptive attack facts attached to the mutation response. */
function exposeAttackVisibility(result: unknown, context: AttackVisibilityContext): unknown {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
  const current = result as Record<string, unknown>;
  return {
    ...current,
    actorId: context.actorId,
    actorName: context.actorName,
    targetId: context.targetId,
    targetName: context.targetName,
    weaponResolution: {
      requested: context.requestedWeapon,
      resolved: context.resolvedWeapon,
      substituted: context.weaponSubstituted,
    },
    ...(context.normalizeAutoRolled
      ? { autoRolled: context.actorIsPlayer && current.autoRolled === true }
      : {}),
  };
}

/** What an ending left behind, for the client: why it ended and who woke after how long. */
type CombatEnding = { reason: CombatEndReason; wake: WakeOutcome[] };

async function endCombatIfResolved(
  encounterId: string,
  userId: string,
  options: { deferVictoryNotice?: boolean } = {},
): Promise<CombatEnding | null> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  // A player who fled or yielded has left the fight, not lost it (#2580). With nobody of the
  // party in the order, the check below would read a defeat on the next end_turn, damage or NPC
  // auto-advance; only the DM's own end closes a fight the party walked out of.
  // Only a roster that HAD a player row can have lost it to an exit: an encounter with no player
  // participant at all still ends the ordinary way.
  const hasPlayerRow = state.participants.some(
    (participant) => (participant.participantType as string) === 'player',
  );
  if (
    hasPlayerRow &&
    partyHasLeftTheFight(
      state.participants as unknown as Parameters<typeof partyHasLeftTheFight>[0],
    )
  )
    return null;
  const active = state.participants.filter((participant) => participant.isActive);
  const vitals = active.map((participant) => ({
    participant,
    state: vitalStateOf(participant as unknown as VitalsInput),
  }));
  /**
   * A character at 0 hit points is not out of the fight. They are dying, and a dying character
   * is one healing word or one lucky d20 away from standing up again — which is exactly the
   * middle state this wave exists to restore. The fight therefore continues while any player
   * is standing OR dying, and only a party with nobody in either state has lost.
   *
   * Stabilised and dead both end it. A stabilised character is safe but cannot be roused by
   * anything the engine will do on its own, so continuing would leave an encounter that no
   * side can advance — a stall wearing a fight's clothes.
   */
  const partyInPlay = vitals.some(
    ({ participant, state: vital }) =>
      !isHostile(participant.participantType as string) &&
      (vital === 'standing' || vital === 'dying'),
  );
  const hostilesStanding = vitals.some(
    ({ participant, state: vital }) =>
      isHostile(participant.participantType as string) && vital === 'standing',
  );
  if (partyInPlay && hostilesStanding) return null;
  // Which side ran out is the difference between a victory and a TPK, and the old fixed
  // string reported a victory for both. A party that ran out of fight but still has someone
  // stable is not a TPK: that player wakes (SRD 5.1) and the run goes on.
  const someoneStable = vitals.some(
    ({ participant, state: vital }) =>
      !isHostile(participant.participantType as string) && vital === 'stabilized',
  );
  // A dying player holds the fight open even with no hostile left: their turn comes round, they
  // roll their save, and the encounter ends when they are stable, back on their feet, or dead.
  const partyStanding = vitals.some(
    ({ participant, state: vital }) =>
      !isHostile(participant.participantType as string) && vital === 'standing',
  );
  if (!hostilesStanding && partyInPlay && !partyStanding) return null;
  const reason: CombatEndReason = !hostilesStanding
    ? 'last_hostile_defeated'
    : someoneStable
      ? 'player_down_stable'
      : 'party_defeated';
  // Roll who wakes first, claim the encounter, and only then wake them: a lost claim or a failed
  // conclusion must not leave a player woken (1d4 hours spent) in a fight that is still live.
  const plan = someoneStable ? await planStableWake(encounterId, userId) : [];
  const claim = { claimed: false };
  await concludeEncounter(encounterId, state.encounter.sessionId, userId, reason, {
    wake: plan,
    claim,
    ...(options.deferVictoryNotice ? { deferVictoryNotice: true } : {}),
  });
  // Only the call that claimed the ending wakes anyone: a lost or refused claim wakes nobody.
  const wake = claim.claimed && plan.length ? await applyStableWake(encounterId, userId, plan) : [];
  return { reason, wake };
}

function rosterFrom(
  participants: ReadonlyArray<{ id: string; name?: string | null; monsterAttack?: unknown }>,
): EngineRosterEntry[] {
  return participants.map(rosterEntryForParticipant);
}

/** The target's display name, for the sentence the DM is handed when an approach falls short. */
async function participantLabel(
  encounterId: string,
  participantId: string,
  userId: string,
): Promise<string> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  return facingName(undefined, participantId, rosterFrom(state.participants));
}

/**
 * The engine slug for a participant — the same addressable token the tactical digest
 * prints, which is what the narration contract and the client post-check match against.
 * Falls back to a slugified name for participants with no token on the map, exactly like
 * the turn-order block does.
 */
function engineSlugForParticipant(
  map: TacticalMap | null,
  participantId: string,
  label: string,
): string {
  const entity = map ? resolveEntityRef(map.entities, participantId) : null;
  return entity ? entitySlug(entity) : slugify(label || participantId);
}

/**
 * Record the one-line engine fact and structured contract action for a resolved discrete
 * action (dash, dodge, disengage). These resolved silently before #2236, so the DM could
 * neither narrate a real Dash nor be caught inventing one — run M4's "You dash across the
 * room" was narrated on a turn where the engine resolved no such action.
 */
async function recordDiscreteActionFact(
  sessionId: string,
  state: CombatState,
  actorId: string,
  kind: 'dash' | 'dodge' | 'disengage',
): Promise<void> {
  const participant = state.participants.find((p) => p.id === actorId);
  const label = facingName(participant?.name, actorId, rosterFrom(state.participants));
  const map = await loadActiveTacticalMap(sessionId);
  const pastTense = kind === 'dash' ? 'dashed' : kind === 'dodge' ? 'dodged' : 'disengaged';
  await recordDmTacticalFact(sessionId, `${label} ${pastTense}.`, {
    kind,
    actorSlug: engineSlugForParticipant(map, actorId, label),
    actorIsPlayer: participant?.participantType === 'player',
  });
}

/**
 * The engine fact for a resolved Fighter feature (#975), sibling to the discrete-action
 * fact above: without it the DM has nothing to narrate for a Second Wind but its own
 * invention, and an Action Surge it was never told about reads as a second action out of
 * nowhere.
 */
async function recordFeatureActionFact(
  sessionId: string,
  state: CombatState,
  actorId: string,
  kind: 'second_wind' | 'action_surge',
  result: SecondWindResult | ActionSurgeResult,
): Promise<void> {
  const participant = state.participants.find((p) => p.id === actorId);
  const label = facingName(participant?.name, actorId, rosterFrom(state.participants));
  const map = await loadActiveTacticalMap(sessionId);
  const fact =
    kind === 'second_wind'
      ? `${label} used Second Wind and regained ${(result as SecondWindResult).healed} HP.`
      : `${label} used Action Surge and has one additional action this turn.`;
  await recordDmTacticalFact(sessionId, fact, {
    kind,
    actorSlug: engineSlugForParticipant(map, actorId, label),
    actorIsPlayer: participant?.participantType === 'player',
  });
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
/** `combat_participants` carries the action flags; the service's row type does not name them. */
type TurnResourceView = { id: string; actionUsed?: boolean | null } & VitalsInput;

/**
 * One turn boundary, done properly: advance the order, refund the new actor's movement, and
 * pass over anyone the order reaches who cannot act. A dying player stops the order — their
 * turn is a death save, and `awaitingDeathSave` says so.
 *
 * Deliberately the same three calls the `end_turn` branch of the dispatch makes, in the same
 * order. An implicit end of turn that only nudged `current_turn_order` would be a different
 * kind of turn boundary from an explicit one, and the movement pool of whoever came next would
 * still hold last turn's remainder.
 */
async function advanceOneTurn(
  encounterId: string,
  sessionId: string,
  userId: string,
  from?: { round: number; turnOrder: number },
) {
  const turn = await CombatInitiativeService.advanceTurn(encounterId, userId, from);
  await resetTacticalMovementForTurn(sessionId, turn.currentParticipant.id);
  return settleDownedTurns(encounterId, sessionId, userId, turn);
}

/**
 * The turn cycle, made liberal in exactly one direction.
 *
 * The DM is `gemini-3.1-flash-lite`. It cannot emit `end_turn` — the `combat_actions`
 * vocabulary has no such action type, so every turn boundary in production is synthesized by
 * the client after an action it accepted. Any path that resolves an action WITHOUT going
 * through that client loop — the legacy `roll_requests` dialect translated server-side, a
 * batch whose second action threw before its `end_turn` — leaves a participant that has spent
 * its action sitting as `current` forever. The next thing the DM declares is then for somebody
 * else, and the engine refuses it. Run 18's encounter 2 died exactly there: a run of refusals,
 * no `combat_ended`, a monster left standing at 2 of 11 HP.
 *
 * Three previous waves tried to instruct this model out of a habit and lost all three (the
 * `combat_actions` corrective, the purged dialect, the equipped-weapon list). The established
 * answer in this codebase is Postel: translate rather than correct. So an action declared for
 * a participant that is not current, where the current participant has already spent its
 * action, is read as the end-of-turn the DM never said out loud — the turn advances and the
 * action is accepted.
 *
 * WHAT IS STILL REFUSED, loudly and unchanged: an action for a non-current participant while
 * the current one still HAS its action. That is not a missing `end_turn`, it is one creature
 * being made to act twice in a round, and no amount of tolerance should manufacture a turn for
 * a creature the order has not reached.
 *
 * THE BOUND: exactly one position, and the engine — not this function — is what makes that the
 * right number.
 *
 * Multi-step was written first and is unreachable. `CombatInitiativeService.advanceTurn` calls
 * `resetTurnResources` on whoever it lands on, so the moment the order moves onto the next
 * participant that participant has a full action again. A second step would therefore always
 * be blocked by the very guard above, and the only way past it would be to drop the guard and
 * skip a creature that still had its turn to take. So one step is not a cautious choice among
 * several: it is the only advancement this absorb can ever justify, and everything beyond it is
 * a creature being silently robbed.
 *
 * It is also exactly enough for the failure it exists to absorb. The wedge is "the current
 * participant acted, and the DM's next declaration is for the creature after it" — one
 * position, every time. An action addressed further down the order is refused, and the
 * participant that blocked it is named in the refusal.
 *
 * A participant that cannot act at all (stabilised, dead) is not passed by this function either —
 * `settleDownedTurns`, inside the one advance, moves the order on itself. A DYING player is not
 * passed at all: their turn is a death save only they roll (`vitalOfCurrent` below).
 */
async function resolveActorTurn(
  encounterId: string,
  initial: CombatState,
  actorId: string,
  index: SessionEntityIndex,
  userId: string,
  intentType: SubmittedCombatIntent['type'],
  source: CombatActionSource,
): Promise<{
  actor: NonNullable<CombatState['currentParticipant']>;
  encounter: CombatState['encounter'];
}> {
  const current = initial.currentParticipant as TurnResourceView | null;
  const known = initial.participants.some((participant) => participant.id === actorId);
  const addressed = initial.participants.find(
    (participant) => participant.id === actorId,
  ) as (TurnResourceView & { participantType?: string }) | undefined;
  // An explicit `end_turn` is never absorbed: it is itself a turn boundary, so advancing to
  // reach its actor and then advancing again would consume two turns for one instruction.
  // Player-sourced intents are never absorbed either — a player client acting out of turn is a
  // bug or a race and must still be told so. This tolerance exists because one specific model
  // cannot emit `end_turn`, not because out-of-turn actions became acceptable.
  const absorbable =
    source === 'dm' && known && intentType !== 'end_turn' && !!current && current.id !== actorId;
  // The refusal that must survive this wave, unchanged: a creature being made to act twice.
  // A dying player's turn is a death saving throw only they can roll: it is never absorbed
  // as a "missing end_turn", or the save the rules owe them would be skipped without a die.
  const vitalOfCurrent = current ? vitalStateOf(current) : null;
  if (
    !absorbable ||
    vitalOfCurrent === 'dying' ||
    (vitalOfCurrent === 'standing' && !current!.actionUsed)
  ) {
    return assertActorTurn(initial, actorId, index);
  }

  await advanceOneTurn(encounterId, initial.encounter.sessionId, userId);
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  if (state.currentParticipant?.id !== actorId) {
    // One position was not enough to reach the addressed creature. The advance itself was
    // legitimate — the previous participant really had finished — so the board is left where
    // it now honestly stands rather than rolled back to a position that was already wrong.
    return assertActorTurn(state, actorId, index);
  }
  if (addressed?.participantType === 'player') {
    // #1008: the advance reached the addressed actor, but the actor is a PLAYER, and a
    // player's action is never absorbed. The absorb stitches the DM's own creatures'
    // sequencing; a player's boundary is explicit — their client synthesizes the
    // `end_turn` — so a player action that only becomes current by advancing past a
    // spent holder is a late resolution of a turn that already ended (Hark N22-025:
    // the declared hit landed after "ended their turn" and the next creature's turn).
    // The advance stands, exactly as in the not-enough branch above — the previous
    // participant really had finished, and the player's new turn really has begun —
    // but the stale declaration is refused rather than resolved on it.
    //
    // The refusal is deliberately NOT assertActorTurn's shape. That shape names the
    // current holder in details.currentParticipantId, and here the holder IS the
    // actor: naming them would render "it is not your turn — <the player> acts now"
    // for the player's own action, record the player as the holder who blocked
    // them, and defeat the client's keeps-turn logic, which keys on a refusal that
    // names no other holder. So this refusal names no holder at all and carries a
    // distinguishing reason instead: the client's combatRefusalReason surfaces it,
    // its player-facing line falls back to this message, and its keeps-turn path
    // can recognise that the turn now stands with the player.
    logger.warn({
      msg: 'COMBAT_INTENT_OUT_OF_TURN',
      reason: 'declared_after_turn_ended',
      encounterId,
      sessionId: state.encounter.sessionId,
      actorId,
      advancedPastParticipantId: current!.id,
      advancedPastParticipantSlug: index.slugFor(current!.id) ?? null,
    });
    throw new BusinessLogicError(
      'That action was declared in a turn that has already ended',
      {
        encounterId,
        sessionId: state.encounter.sessionId,
        actorId,
        reason: 'declared_after_turn_ended',
        roster: index.roster(),
      },
    );
  }
  logger.warn({
    msg: 'DM_IMPLICIT_TURN_ADVANCE',
    encounterId,
    sessionId: state.encounter.sessionId,
    intentType,
    addressedActorId: actorId,
    addressedActorSlug: index.slugFor(actorId) ?? null,
    turnWasActorId: current!.id,
    turnWasActorSlug: index.slugFor(current!.id) ?? null,
    positionsAdvanced: 1,
    skipped: [{ id: current!.id, slug: index.slugFor(current!.id) ?? null }],
  });
  return {
    actor: state.currentParticipant,
    encounter: state.encounter,
  };
}

/**
 * The turn boundary the DM was never going to say out loud, taken by the engine instead.
 *
 * `resolveActorTurn` above absorbs a MISSING `end_turn` retroactively: it waits for the next
 * declaration and reads that as the boundary. Which only works when a next declaration arrives,
 * for the creature immediately after this one. Session 2f420489 is what happens when it does
 * not. The #1701 repair loop regenerated a one-action batch for the current-turn NPC, the attack
 * was accepted, the batch carried no `end_turn`, and the NPC stayed `current` with its action
 * spent. Every player action after that was refused — correctly, forever. Three attempts across
 * two clients, and the fight could not advance from any of them.
 *
 * The 2026-08-11 roach encounter recovered from the same shape for one reason: that DM batch
 * happened to contain an `end_turn` and this one did not. That is a coin flip, and #1702 already
 * settled what this codebase does about a rule the model follows half the time. So the boundary
 * is taken here, when the action is spent, instead of hoped for in the next message: an NPC that
 * has spent its action has nothing left this turn the DM has any vocabulary to declare —
 * `combat_actions` carries no bonus action and no post-attack movement — so holding its turn
 * open can only ever wedge the fight.
 *
 * PLAYERS ARE NOT ADVANCED. A player who has attacked may still move, and the popup #1716 added
 * makes their turn a conversation rather than a single message. Their boundary stays explicit.
 *
 * Returns the settled boundary when the order moved, so callers can carry death saves across the
 * implicit transition without performing a second settlement.
 */
async function advanceAfterSpentNpcTurn(
  encounterId: string,
  actorId: string,
  userId: string,
  source: CombatActionSource,
  intentType: SubmittedCombatIntent['type'],
  index: SessionEntityIndex,
): Promise<Awaited<ReturnType<typeof advanceOneTurn>> | null> {
  // `end_turn` is already a boundary; a player-sourced intent belongs to a client that ends its
  // own turn.
  if (source !== 'dm' || intentType === 'end_turn') return null;
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const actor = state.participants.find((participant) => participant.id === actorId) as
    | (TurnResourceView & { participantType?: string })
    | undefined;
  if (!actor || !isHostile(actor.participantType as string)) return null;
  // The action economy is the trigger, not the intent type: a `move`, or an attack that resolved
  // as approach-only, spends nothing and leaves the NPC mid-turn with its attack still to make.
  if (!actor.actionUsed) return null;
  // Something else already moved the order — an absorbed advance, a death-save settlement — and
  // a step here would skip whoever it landed on.
  if (state.currentParticipant?.id !== actorId) return null;
  const settled = await advanceOneTurn(encounterId, state.encounter.sessionId, userId);
  const next = await CombatEncounterService.getCombatState(encounterId, userId);
  logger.warn({
    msg: 'NPC_TURN_AUTO_ADVANCED',
    encounterId,
    sessionId: state.encounter.sessionId,
    intentType,
    actorId,
    actorSlug: index.slugFor(actorId) ?? null,
    nowCurrentId: next.currentParticipant?.id ?? null,
    nowCurrentSlug: index.slugFor(next.currentParticipant?.id) ?? null,
  });
  return settled;
}

/**
 * An `end_turn` for a turn that is already over.
 *
 * The client synthesizes one after every action it submits, and the engine now takes the NPC
 * boundary itself — so the two meet, and without this the client's `end_turn` lands on a board
 * that has already moved and comes back 422 "Actor is not the current-turn participant". That
 * refusal belongs to an NPC, not to anything the player did, and #1744 is largely the story of
 * NPC refusals reaching the player as their own failure.
 *
 * It is also the issue's second defect on its own terms: a DM batch whose remaining actions
 * arrive after a turn boundary the batch itself already crossed. An `end_turn` addressed to a
 * creature that has spent its action and is no longer current asks for something that has
 * happened. Dropped, not refused — and not re-executed, since advancing again would consume a
 * second creature's turn for one instruction.
 *
 * STILL REFUSED: an `end_turn` for a creature that has NOT spent its action. That is not a stale
 * boundary, it is the DM ending somebody else's turn early, and skipping a creature with its
 * whole turn to take is the one thing this file refuses everywhere else.
 */
function alreadyEndedTurn(
  state: CombatState,
  intent: SubmittedCombatIntent,
  source: CombatActionSource,
): { turnAlreadyEnded: true; currentParticipant: CombatState['currentParticipant'] } | null {
  if (source !== 'dm' || intent.type !== 'end_turn') return null;
  if (state.currentParticipant?.id === intent.actorId) return null;
  const actor = state.participants.find((participant) => participant.id === intent.actorId) as
    | TurnResourceView
    | undefined;
  if (!actor?.actionUsed) return null;
  return { turnAlreadyEnded: true, currentParticipant: state.currentParticipant };
}

/**
 * Every entity reference on the way in, normalised against the live board in one read AND
 * checked against the encounter's own roster before anything downstream sees it.
 *
 * The check is the half that was missing. `index.resolve` is best-effort by contract — it
 * returns the token unchanged when no board can say — so an unresolvable reference used to
 * leave here still wearing its slug, and this function's own comment described what happened
 * next: "an attack whose `targetId` is still a slug reaches the engine and fails a uuid lookup
 * two layers down, where the error no longer mentions references". On 2026-08-10 it did
 * exactly that. `sentient-glaze-1` travelled through the gateway, through `resolveAttack`, into
 * `inArray(combatParticipants.id, …)`, and came back as `invalid input syntax for type uuid` —
 * a `DrizzleQueryError`, which is not an `AppError`, so the route answered a bare 500 and the
 * encounter was left active with zero actions on it.
 *
 * So resolution is now total: a reference either names a participant of this encounter or it
 * is refused here, by name, with the board roster the DM can correct itself from. A 404 saying
 * which token missed and what was actually on the board is an answer the caller can act on; a
 * 500 from the database two layers down is not.
 */
/**
 * What a player's attack would be, asked before the player rolls for it.
 *
 * The player rolls their own attack die, and a die means nothing beside numbers the player
 * cannot see. This answers the popup's three questions — what is added to the die, what it must
 * beat, and whether the rules grant advantage — from the same `resolveAttackRules` call that
 * will judge the die when it arrives, so the popup can never promise arithmetic the resolution
 * does not perform.
 *
 * It goes through the same reference resolution and the same weapon grounding as
 * `executeCombatIntent`, because a proposal computed against a different actor, target, or
 * weapon than the commit is worse than no proposal at all.
 *
 * One thing here is not read-only, and it is deliberate: the approach runs. A melee attacker
 * out of reach is walked into reach exactly as the commit would walk it, because distance and
 * cover are what the proposal is reporting and reporting them from the wrong square would be a
 * lie. Movement is not the attack action and claims nothing, so an abandoned proposal costs the
 * player a step taken toward an enemy and nothing else. When the approach cannot reach at all,
 * the answer is the movement result itself: there is no attack to roll for, and the caller
 * resolves it without ever opening the popup.
 */

/** `inventory_items.id` is a uuid; a claim shaped like one names a specific row, not a phrase. */
const INVENTORY_ROW_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #260 / RG-014: refuse a player-sourced intent that names a weapon the sheet does
 * not back, instead of silently swapping to an equipped weapon.
 * - carried but not equipped → `weapon_not_equipped`
 * - a real weapon the character does not own at all → `weapon_not_on_sheet`
 *
 * "Real weapon" means the claim resolves through the SRD catalog by name/alias,
 * resolves through the magic-item catalog (Sun Blade → longsword, the same
 * `findCatalogWeapon ?? findMagicBaseWeapon` pairing data-access.ts uses), or is
 * shaped like an inventory row id — a uuid that names a specific row but matches
 * nothing the character owns (e.g. a stale client row). Loose or invented phrases
 * ("sword", "axe") that resolve to none of these are NOT refusals: they take the
 * substitute path below. DM-sourced intents are never refused — a weapon name must
 * not stop a fight. Throws exactly one error; the message is a single line so
 * callers cannot double-print it.
 */
export function refuseUngroundedPlayerWeapon(
  grounding: GroundedWeapon,
  source: CombatActionSource,
): void {
  if (!grounding.requested || grounding.grounded) return;
  const carriedAmmoWeapon =
    grounding.notEquipped &&
    /crossbow|shortbow|longbow/i.test(findCatalogWeapon(grounding.requested)?.name ?? '');
  if (source !== 'player' && !carriedAmmoWeapon) return;
  if (grounding.notEquipped) {
    throw new BusinessLogicError(
      `Weapon not equipped: ${grounding.requested} is not equipped — equip it before attacking, or choose an equipped weapon`,
      { reason: 'weapon_not_equipped', requestedWeaponId: grounding.requested },
    );
  }
  const namesRealWeapon =
    findCatalogWeapon(grounding.requested) !== undefined ||
    findMagicBaseWeapon(grounding.requested) !== undefined ||
    INVENTORY_ROW_ID_PATTERN.test(grounding.requested);
  if (namesRealWeapon) {
    throw new BusinessLogicError(
      `Weapon not on character sheet: ${grounding.requested} is not on your character sheet — choose an equipped weapon`,
      { reason: 'weapon_not_on_sheet', requestedWeaponId: grounding.requested },
    );
  }
}

function refuseMissingAmmunition(
  requested: string | null | undefined,
  carried: WeaponRuleProfile[],
): void {
  if (!requested) return;
  const weapon = carried.find((profile) => weaponProfileMatches(profile, requested));
  if (weapon?.missingAmmunition) {
    throw new BusinessLogicError(
      `Cannot use ${weapon.name}: no ${weapon.missingAmmunition} — add ammunition or choose another weapon. Which weapon do you use?`,
      {
        reason: 'no_ammunition',
        ammunition: weapon.missingAmmunition,
        requestedWeaponId: requested,
      },
    );
  }
}

/** Spend one round after the engine has accepted a player's ranged attack. */
async function spendRangedAmmunition(
  characterId: string | null | undefined,
  userId: string,
  weaponName: string,
  sessionId: string,
): Promise<void> {
  if (!characterId) return;
  const ammoType = /crossbow/i.test(weaponName)
    ? 'bolts'
    : /(?:shortbow|longbow)/i.test(weaponName)
      ? 'arrows'
      : null;
  if (!ammoType) return;
  const { db } = await import('../../../../db/client');
  const { and, eq, ilike, or } = await import('drizzle-orm');
  const { characters, characterEquipment, inventoryItems } = await import('../../../../db/schema');
  const [owner] = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);
  if (!owner) return;
  const pattern = `%${ammoType === 'bolts' ? 'bolt' : 'arrow'}%`;
  const sheetItem = (
    await db
      .select({ id: characterEquipment.id, quantity: characterEquipment.quantity })
      .from(characterEquipment)
      .where(
        and(
          eq(characterEquipment.characterId, characterId),
          ilike(characterEquipment.itemName, pattern),
        ),
      )
      .orderBy(characterEquipment.createdAt)
      .limit(1)
  )[0];
  if (sheetItem && (sheetItem.quantity ?? 0) > 0) {
    if (sheetItem.quantity === 1) {
      await db.delete(characterEquipment).where(eq(characterEquipment.id, sheetItem.id));
    } else {
      await db
        .update(characterEquipment)
        .set({ quantity: (sheetItem.quantity ?? 1) - 1, updatedAt: new Date() })
        .where(eq(characterEquipment.id, sheetItem.id));
    }
  } else {
    const item = (
      await db
        .select({ id: inventoryItems.id, quantity: inventoryItems.quantity })
        .from(inventoryItems)
        .where(
          and(eq(inventoryItems.characterId, characterId), ilike(inventoryItems.name, pattern)),
        )
        .orderBy(inventoryItems.createdAt)
        .limit(1)
    )[0];
    if (item && item.quantity > 0) {
      if (item.quantity === 1) {
        await db.delete(inventoryItems).where(eq(inventoryItems.id, item.id));
      } else {
        await db
          .update(inventoryItems)
          .set({ quantity: item.quantity - 1, updatedAt: new Date() })
          .where(eq(inventoryItems.id, item.id));
      }
    }
  }
  logger.info({ msg: 'COMBAT_AMMUNITION_SPENT', sessionId, characterId, ammoType });
}

export async function proposeCombatAttack(
  encounterId: string,
  submitted: SubmittedCombatIntent,
  userId: string,
  source: CombatActionSource,
): Promise<
  { movementOnly: true; result: unknown } | ({ movementOnly: false } & Record<string, unknown>)
> {
  if (submitted.type === 'spell') return proposeCombatSpell(encounterId, submitted, userId, source);
  if (submitted.type !== 'attack') {
    throw new ValidationError('Only attack and spell intents can be proposed', {
      intentType: submitted.type,
    });
  }
  const initialState = await CombatEncounterService.getCombatState(encounterId, userId);
  const { state, index, resolved } = await resolveCombatIntentRefsWithRetry(
    submitted,
    initialState,
    {
      loadState: () => CombatEncounterService.getCombatState(encounterId, userId),
      loadIndex: loadSessionEntityIndex,
      warn: (data) => logger.warn(data),
    },
  );
  const resolvedAttack = resolved as Extract<CombatIntent, { type: 'attack' }>;
  const { actor, encounter } = await resolveActorTurn(
    encounterId,
    state,
    resolvedAttack.actorId,
    index,
    userId,
    resolvedAttack.type,
    source,
  );
  const actorLabel = facingName(actor.name, resolvedAttack.actorId, rosterFrom(state.participants));
  const targetLabel = await participantLabel(encounterId, resolvedAttack.targetId, userId);
  const equipped = await listEquippedWeaponProfiles(actor);
  const carried = await listCarriedWeaponProfiles(actor);
  refuseMissingAmmunition(resolvedAttack.weaponId, carried);
  const grounding = groundRequestedWeapon(resolvedAttack.weaponId, equipped, carried);
  // #260 / RG-014: refuse a player-sourced intent that names a weapon the sheet does
  // not back (see refuseUngroundedPlayerWeapon). DM narration is never refused: a DM
  // naming an unowned weapon takes the ungrounded substitute path below, and a
  // carried-but-unequipped one resolves the same way rather than stopping the fight.
  refuseUngroundedPlayerWeapon(grounding, source);
  const groundedWeaponId = isUnarmedWeaponClaim(resolvedAttack.weaponId)
    ? UNARMED_STRIKE.id
    : grounding.weaponId;
  const approach = await decideAttackApproach({
    sessionId: encounter.sessionId,
    actorId: resolvedAttack.actorId,
    actorLabel,
    targetId: resolvedAttack.targetId,
    targetLabel,
    weapon: grounding.weapon,
  });
  if (approach.movementOnly) return { movementOnly: true, result: approach.result };
  const attackService = await createCombatAttackService();
  const proposal = await attackService.proposeAttack(
    encounterId,
    {
      attackerId: resolvedAttack.actorId,
      targetId: resolvedAttack.targetId,
      weaponId: groundedWeaponId,
      attackType: approach.attackType,
      // The proposal claims no version: it writes nothing that a concurrent write could lose.
      expectedVersion: encounter.version,
      advantage: resolvedAttack.advantage,
      disadvantage: resolvedAttack.disadvantage,
    },
    userId,
  );
  // The resolved ids travel back so the commit addresses exactly what was proposed, rather than
  // re-resolving a slug against a board the approach above may have moved.
  return {
    movementOnly: false,
    ...proposal,
    actorId: resolvedAttack.actorId,
    targetId: resolvedAttack.targetId,
    weaponId: groundedWeaponId,
    expectedVersion: encounter.version,
    targetLabel,
    requestedWeapon: grounding.requested,
    weaponSubstituted: !grounding.grounded,
  };
}

/**
 * What a player's spell would be, asked before the popup opens (#2233).
 *
 * The same reference resolution, turn check, catalog lookup, sheet check, and spell attack bonus
 * as the commit, so the popup reads "Chill Touch spell attack 1d20+5" from the numbers the
 * resolution will use — and a spell the caster does not have is refused here, before any dialog
 * can offer it.
 */
async function proposeCombatSpell(
  encounterId: string,
  submitted: Extract<SubmittedCombatIntent, { type: 'spell' }>,
  userId: string,
  source: CombatActionSource,
): Promise<{ movementOnly: false } & Record<string, unknown>> {
  // The same resolution the commit and the attack proposal use. This called a
  // `resolveIntentRefs` that #2250 had moved into `combat-intent-refs.ts`, so every spell
  // proposal threw a ReferenceError the route answered as a bare 500 (#2303) — which is why no
  // player was ever shown a spell-attack die: a failed proposal opens no popup.
  const initialState = await CombatEncounterService.getCombatState(encounterId, userId);
  const {
    state,
    index,
    resolved: resolvedRefs,
  } = await resolveCombatIntentRefsWithRetry(submitted, initialState, {
    loadState: () => CombatEncounterService.getCombatState(encounterId, userId),
    loadIndex: loadSessionEntityIndex,
    warn: (data) => logger.warn(data),
  });
  const resolved = resolvedRefs as Extract<CombatIntent, { type: 'spell' }>;
  const { encounter } = await resolveActorTurn(
    encounterId,
    state,
    resolved.actorId,
    index,
    userId,
    resolved.type,
    source,
  );
  const attackService = await createCombatAttackService();
  const proposal = await attackService.proposeSpellAttack(
    encounterId,
    {
      casterId: resolved.actorId,
      targetIds: resolved.targetIds,
      spellId: resolved.spellId,
      spellName: resolved.spellName,
      slotLevel: resolved.slotLevel,
    },
    userId,
  );
  return {
    movementOnly: false,
    ...proposal,
    actorId: resolved.actorId,
    targetIds: resolved.targetIds,
    expectedVersion: encounter.version,
    targetLabel: await participantLabel(encounterId, resolved.targetIds[0], userId),
  };
}

/**
 * A player's `flee` / `yield`, resolved through the exit machinery (#2580).
 *
 * The provoked opportunity attack goes through the ordinary attack resolver, as a REACTION: the
 * same roll, the same damage write, the same telemetry and the same narration contract entry any
 * other attack takes, with no second attack path to keep honest. `isReaction` is what makes that
 * honest here — it is what lets a creature that is not the current-turn participant swing, and
 * what claims the Reaction instead of a second Action.
 *
 * Deliberately NOT routed back through `executeCombatIntent`: the flee has already claimed this
 * turn's action and bumped the encounter version, so a nested attack intent would be refused by
 * the version check it can no longer satisfy, and the attack would never happen — silently, in
 * the one place the player is entitled to be hit.
 *
 * Submitted before the exit is marked, which is the whole ordering rule: the blow lands while the
 * player is still in reach.
 */
async function resolvePlayerExit(params: {
  encounterId: string;
  sessionId: string;
  userId: string;
  state: CombatState;
  actorId: string;
  intent: 'flee' | 'yield';
}): Promise<PlayerExitResult> {
  const { encounterId, sessionId, userId, state, actorId, intent } = params;
  const map = await loadActiveTacticalMap(sessionId);
  const roster = rosterFrom(state.participants);
  return recordPlayerExit({
    encounterId,
    sessionId,
    userId,
    state,
    actorId,
    intent,
    label: (participantId) => facingName(undefined, participantId, roster),
    slugOf: (participantId) =>
      engineSlugForParticipant(map, participantId, facingName(undefined, participantId, roster)),
    selectAttacker: (actor) =>
      selectOpportunityAttacker({
        state,
        actor,
        map,
        reachOf: async (participant) => {
          const { getDefaultCombatWeapon } = await import('./equipped-loadout.js');
          return getDefaultCombatWeapon(participant);
        },
        hasLineOfSight: (fromId, toId) => (map ? checkLineOfSight(map, fromId, toId) : false),
        distanceFeet: getDistance,
      }),
    resolveOpportunityAttack: async (attacker: OpportunityAttacker) => {
      const attackService = await createCombatAttackService();
      const outcome = await attackService.resolveAttack(
        encounterId,
        {
          attackerId: attacker.participant.id,
          targetId: actorId,
          weaponId: attacker.weapon.id,
          // An opportunity attack is melee by rule; `selectOpportunityAttacker` never offers a
          // ranged weapon, so this is the attack type it was chosen for.
          attackType: 'melee',
          expectedVersion: state.encounter.version,
          isReaction: true,
        } satisfies AttackRollInput,
        userId,
      );
      return {
        hit: outcome.hit,
        finalDamage: outcome.finalDamage,
        targetNewHp: outcome.targetNewHp,
        targetIsConscious: outcome.targetIsConscious,
        targetIsDead: outcome.targetIsDead,
        isCritical: outcome.isCritical,
      };
    },
    markExited: (id, participantId) =>
      CombatEncounterService.markParticipantExited(id, participantId),
  });
}

/** The single mutation gateway for player and AI-DM combat intents. */
export async function executeCombatIntent(
  encounterId: string,
  submitted: SubmittedCombatIntent,
  userId: string,
  source: CombatActionSource,
  dmStartedAt?: number,
  origin?: CombatActionOrigin,
  /**
   * The player's own words for this turn (#749). A DM-declared flee/yield/disengage for a player
   * is only applied when these words ask for that exit; undefined means the inline option path and
   * is unchanged.
   */
  playerInput?: string,
  inNpcTransaction = false,
): Promise<unknown> {
  let stateForUnresolved: CombatState | null = null;
  try {
    // A completed encounter still retains its participant rows, but its tactical board is gone.
    // Check the authoritative encounter status before loading that board or resolving a slug;
    // otherwise a valid post-victory follow-through becomes the misleading 404 "Combat
    // participant not found" that #1744 observed.
    let state = await CombatEncounterService.getCombatState(encounterId, userId);
    stateForUnresolved = state;
    if (submitted.actionId !== undefined) {
      const { readNpcEngineResult } = await import('./npc-engine-row.js');
      const replay = await readNpcEngineResult(
        encounterId,
        submitted.actionId,
        state.encounter.sessionId,
      );
      if (replay) return { ...replay, engineRows: [] };
    }
    if (state.encounter.status !== 'active') {
      logger.info({
        msg: 'COMBAT_INTENT_AFTER_CONCLUSION',
        encounterId,
        sessionId: state.encounter.sessionId,
        status: state.encounter.status,
        submittedActorId: submitted.actorId,
        action: submitted.type,
        source,
      });
      return {
        encounterAlreadyConcluded: true,
        encounterId,
        status: 'completed',
      } satisfies EncounterAlreadyConcludedResult;
    }
    // Reference resolution happens before authorization, not after: the turn check keys on
    // participant ids, so asking it about a slug is asking the wrong question.
    const refs = await resolveCombatIntentRefsWithRetry(submitted, state, {
      loadState: () => CombatEncounterService.getCombatState(encounterId, userId),
      loadIndex: loadSessionEntityIndex,
      warn: (data) => logger.warn(data),
    });
    state = refs.state;
    stateForUnresolved = state;
    const { index, resolved } = refs;
    if (state.encounter.status !== 'active') {
      logger.info({
        msg: 'COMBAT_INTENT_AFTER_CONCLUSION',
        encounterId,
        sessionId: state.encounter.sessionId,
        status: state.encounter.status,
        submittedActorId: submitted.actorId,
        action: submitted.type,
        source,
      });
      return {
        encounterAlreadyConcluded: true,
        encounterId,
        status: 'completed',
      } satisfies EncounterAlreadyConcludedResult;
    }
    assertPlayerInputOrigin(state, resolved, source, origin);
    // Before authorization, because a boundary that has already been crossed is not an
    // authorization question: there is no turn left to be out of.
    const stale = alreadyEndedTurn(state, resolved, source);
    if (stale) {
      logger.warn({
        msg: 'DM_END_TURN_ALREADY_ENDED',
        encounterId,
        sessionId: state.encounter.sessionId,
        actorId: resolved.actorId,
        actorSlug: index.slugFor(resolved.actorId) ?? null,
        currentParticipantId: stale.currentParticipant?.id ?? null,
        currentParticipantSlug: index.slugFor(stale.currentParticipant?.id) ?? null,
      });
      return stale;
    }
    // #749: a DM may declare the player's exit, but only the player's own words authorise it.
    // Free-text movement ("I step back", "I edge toward Kaelen") is a move, and treating it as a
    // flee took the player out of a fight they were still in. Before the turn gate, so a skipped
    // exit changes no turn and provokes no opportunity attack. No playerInput (the inline
    // Flee / Yield / Disengage options) leaves the exit path unchanged.
    if (
      (resolved.type === 'flee' || resolved.type === 'yield' || resolved.type === 'disengage') &&
      state.participants.find((participant) => participant.id === resolved.actorId)
        ?.participantType === 'player' &&
      playerInput !== undefined &&
      !playerTextDeclares(resolved.type, playerInput)
    ) {
      logger.warn({
        msg: 'COMBAT_EXIT_WITHOUT_PLAYER_WORDING',
        intentType: resolved.type,
        encounterId,
      });
      return { skipped: 'exit_without_player_wording' };
    }
    const { actor, encounter } = await resolveActorTurn(
      encounterId,
      state,
      resolved.actorId,
      index,
      userId,
      resolved.type,
      source,
    );
    // A creature's result, and a keyed action whoever performs it, is one persisted row:
    // replaying its actionId returns the stored result instead of resolving again (#2658).
    // A player's attack or spell is keyed the same way (#974): when the tray roll carries
    // an actionId, the execution runs in the action transaction below and the settled
    // result is stored under that id — so a duplicate post of the same roll, including a
    // retry after a first attempt that failed midway, can never produce a second
    // resolution.
    const writesEngineRow =
      actor.participantType !== 'player' ||
      (submitted.actionId !== undefined &&
        (resolved.type === 'end_turn' ||
          resolved.type === 'attack' ||
          resolved.type === 'spell'));
    // After the turn gate, not before: an absorbed advance that then refuses must stand (#2666).
    if (!inNpcTransaction && writesEngineRow) {
      const { withNpcActionTransaction } = await import('../../../../db/client');
      return await withNpcActionTransaction(encounterId, () =>
        executeCombatIntent(
          encounterId,
          submitted,
          userId,
          source,
          dmStartedAt,
          origin,
          playerInput,
          true,
        ),
      );
    }
    // An unconscious creature cannot act (SRD 5.1): the only thing a downed player's turn
    // holds is the death saving throw. Typed actions, spells and moves are refused here, at the
    // one gate every producer passes, so no client, DM or repair path can make a body act.
    if (
      actor.participantType === 'player' &&
      resolved.type !== 'death_save' &&
      resolved.type !== 'end_turn' &&
      // flee / yield carry their own, more specific refusal below (#2580).
      resolved.type !== 'flee' &&
      resolved.type !== 'yield' &&
      vitalStateOf(actor as unknown as VitalsInput) !== 'standing'
    ) {
      throw new BusinessLogicError('A downed character cannot act', {
        reason: 'actor_unconscious',
        actorId: resolved.actorId,
        intentType: resolved.type,
      });
    }
    const intent = resolveExpectedVersion(resolved, source, encounter.version);
    let result: unknown;
    // #262: a recorded yield ends the fight right here. The DM never reliably ends the scene
    // after the exit (NT-036/NT-113), so waiting for its `dm_ended_scene` leaves the turn
    // stalled with the player out of the order and nothing left to act.
    let yieldEndedCombat = false;
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
      const movement = result as { path?: Array<{ x: number; y: number }> };
      const destination = movement.path?.at(-1);
      if (destination) {
        await recordDmTacticalFact(
          encounter.sessionId,
          `${actor.name ?? 'The player'} moved to (${destination.x}, ${destination.y}) by the engine. Describe the movement and keep the action unused.`,
        );
        // #2580 option 2: a Disengage that actually leaves the board records the same exit the
        // Flee chip would, with no chip. The inline Disengage + move is an explicit player action
        // and keeps that behaviour (no playerInput). #749: when the turn came from typed text,
        // reaching the outer ring is a departure only if those words said so — a "step back"
        // that lands there is a move, and the fight goes on.
        const map = await loadActiveTacticalMap(encounter.sessionId);
        const actorDisengaged = (actor as unknown as { isDisengaged?: boolean | null })
          .isDisengaged;
        if (
          actorDisengaged &&
          map &&
          hasLeftTheBoard(map, destination) &&
          (playerInput === undefined || playerTextDeclaresLeaving(playerInput))
        ) {
          await resolvePlayerExit({
            encounterId,
            sessionId: encounter.sessionId,
            userId,
            state,
            actorId: intent.actorId,
            // A Disengaged move has already paid the opportunity-attack cost, so the recorded
            // exit is the same one the chip would have made had the player not moved.
            intent: 'flee',
          });
        }
      }
    } else if (intent.type === 'attack') {
      const actorLabel = facingName(actor.name, intent.actorId, rosterFrom(state.participants));
      const targetLabel = await participantLabel(encounterId, intent.targetId, userId);
      // The approach decision and the resolution must swing the same weapon. Deciding approach
      // from `[0]` while resolving with `intent.weaponId` is how a bow-and-sword character got
      // walked into melee to fire an arrow, or reach-refused for a sword she was holding.
      const equipped = await listEquippedWeaponProfiles(actor);
      const carried = await listCarriedWeaponProfiles(actor);
      refuseMissingAmmunition(intent.weaponId, carried);
      const grounding = groundRequestedWeapon(intent.weaponId, equipped, carried);
      // #260 / RG-014: refuse a player-sourced intent that names a weapon the sheet
      // does not back (see refuseUngroundedPlayerWeapon); DM narration keeps the
      // ungrounded substitute path below so a fight is never stopped by a weapon name.
      refuseUngroundedPlayerWeapon(grounding, source);
      const groundedWeaponId = isUnarmedWeaponClaim(intent.weaponId)
        ? UNARMED_STRIKE.id
        : grounding.weaponId;
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
      const actorIsPlayer =
        state.participants.find((participant) => participant.id === intent.actorId)
          ?.participantType === 'player';
      const visibility = {
        actorId: intent.actorId,
        actorName: actorLabel,
        targetId: intent.targetId,
        targetName: targetLabel,
        requestedWeapon: grounding.requested,
        resolvedWeapon: playerFacingWeaponName(weapon.name || 'attack', actorLabel),
        weaponSubstituted: !grounding.grounded,
        actorIsPlayer,
      } satisfies AttackVisibilityContext;
      const approach = await decideAttackApproach({
        sessionId: encounter.sessionId,
        actorId: intent.actorId,
        actorLabel,
        targetId: intent.targetId,
        targetLabel,
        weapon,
      });
      if (approach.movementOnly) {
        result = exposeAttackVisibility(approach.result, visibility);
      } else {
        const attackService = await createCombatAttackService();
        result = exposeAttackVisibility(
          await attackService.resolveAttack(
            encounterId,
            {
              attackerId: intent.actorId,
              targetId: intent.targetId,
              // The grounded id, not the raw claim: resolution re-reads the sheet, and it must
              // land on the weapon the reach check was made against.
              weaponId: groundedWeaponId,
              attackType: approach.attackType,
              expectedVersion: intent.expectedVersion,
              advantage: intent.advantage,
              disadvantage: intent.disadvantage,
              providedD20: intent.d20,
              providedD20Rolls: intent.d20Rolls,
            } satisfies AttackRollInput,
            userId,
          ),
          { ...visibility, normalizeAutoRolled: true },
        );
        if (actorIsPlayer) {
          await spendRangedAmmunition(
            (actor as { characterId?: string }).characterId,
            userId,
            weapon.name,
            encounter.sessionId,
          );
        }
        // Every resolution is reported, not just the ones that failed to reach. A hit the DM is
        // never told about is a hit it cannot narrate, and a DM with nothing to narrate repeats
        // the paragraph it wrote last turn.
        // "(auto-rolled)" belongs only to a die the player was supposed to throw. Every monster
        // attack is engine-rolled by design and marking those would turn the note into noise
        // that means nothing — so the flag is narrowed to player actors here rather than in the
        // attack service, which cannot know whose die it was.
        const resolvedAttack = result as Parameters<typeof describeResolvedAttack>[2];
        // The structured sibling of the sentence below: the narration contract's
        // machine-readable record of exactly what the engine resolved (#2236).
        // A movement-only approach resolved movement, not an attack — recording it as
        // 'move' keeps the contract from authorizing an attack the engine never rolled.
        const factMap = await loadActiveTacticalMap(encounter.sessionId);
        const movementOnly =
          (result as { resolvedAs?: string } | null)?.resolvedAs === 'movement_only';
        await recordDmTacticalFact(
          encounter.sessionId,
          describeResolvedAttack(
            actorLabel,
            targetLabel,
            { ...resolvedAttack, autoRolled: actorIsPlayer && resolvedAttack.autoRolled === true },
            playerFacingWeaponName(weapon.name, actorLabel),
          ),
          {
            kind: movementOnly ? 'move' : 'attack',
            actorSlug: engineSlugForParticipant(factMap, intent.actorId, actorLabel),
            actorIsPlayer,
            targetSlug: engineSlugForParticipant(factMap, intent.targetId, targetLabel),
            hit: movementOnly ? undefined : resolvedAttack.hit,
          },
        );
        // Going down is its own event, and the most important one the DM has never been told
        // about. The attack line above says "is UNCONSCIOUS"; this says what unconscious means
        // in the rules the engine is now enforcing, so the DM narrates a character dying on
        // the floor rather than a character killed.
        const outcome = result as {
          targetNewHp?: number;
          targetIsDead?: boolean;
          deathSaveFailuresAdded?: number;
          deathSavesFailures?: number;
          instantDeath?: boolean;
          damageOverflow?: number;
          hpMaximum?: number;
          autoCritOnDowned?: boolean;
        };
        const targetIsPlayer =
          state.participants.find((participant) => participant.id === intent.targetId)
            ?.participantType === 'player';
        if (
          targetIsPlayer &&
          outcome.targetNewHp === 0 &&
          outcome.targetIsDead !== true &&
          (outcome.deathSaveFailuresAdded ?? 0) === 0
        ) {
          await recordDmTacticalFact(
            encounter.sessionId,
            describeGoingDown(targetLabel, {
              overflow: outcome.damageOverflow,
              hpMax: outcome.hpMaximum,
            }),
          );
        }
        // Instant death is the biggest beat in a run: its own fact, so the killing round is
        // narrated as a death rather than as a hit.
        if (targetIsPlayer && outcome.instantDeath === true) {
          await recordDmTacticalFact(
            encounter.sessionId,
            describeInstantDeath(targetLabel, {
              overflow: outcome.damageOverflow,
              hpMax: outcome.hpMaximum,
            }),
          );
        }
        // Damage at 0 HP adds death-save failures: its own engine fact, in the same
        // sentence the player reads, so the DM narrates the failure it caused (#2457).
        const deathSaveFailuresAdded = outcome.deathSaveFailuresAdded ?? 0;
        if (deathSaveFailuresAdded > 0) {
          await recordDmTacticalFact(
            encounter.sessionId,
            describeStrikeOnDowned(actorLabel, targetLabel, {
              failuresAdded: deathSaveFailuresAdded,
              failures: outcome.deathSavesFailures ?? 0,
              automaticCritical: outcome.autoCritOnDowned === true,
              critical: resolvedAttack.isCritical === true,
            }),
          );
        }
      }
    } else if (intent.type === 'spell') {
      const attackService = await createCombatAttackService();
      result = await attackService.resolveSpellAttack(
        encounterId,
        {
          casterId: intent.actorId,
          targetIds: intent.targetIds,
          spellId: intent.spellId,
          spellName: intent.spellName,
          slotLevel: intent.slotLevel,
          d20: intent.d20,
          d20Rolls: intent.d20Rolls,
          expectedVersion: intent.expectedVersion,
        } satisfies SpellAttackInput,
        userId,
      );
      const rawSpellResults = (result as { results?: unknown[] }).results;
      const spellResults = (
        Array.isArray(rawSpellResults) ? rawSpellResults : []
      ) as SpellResolutionVisibility[];
      if (!spellResults.length) {
        throw new BusinessLogicError(
          `Spell refused: ${intent.spellName} produced no combat result`,
          {
            reason: 'unresolved_spell',
            spell: intent.spellName,
          },
        );
      }
      const actorLabel = facingName(actor.name, intent.actorId, rosterFrom(state.participants));
      const spellActorIsPlayer =
        state.participants.find((participant) => participant.id === intent.actorId)
          ?.participantType === 'player';
      const spellFactMap = await loadActiveTacticalMap(encounter.sessionId);
      const spellActorSlug = engineSlugForParticipant(spellFactMap, intent.actorId, actorLabel);
      // The DM repeats the numbers it is told, so on a campaign that hides target
      // numbers the spell facts are worded without them. The server cannot see the
      // player's local toggle; campaign difficulty is all it follows.
      const spellShowTargetNumbers = await showTargetNumbersForSession(encounter.sessionId);
      for (const [index, outcome] of spellResults.entries()) {
        const targetId = intent.targetIds[index];
        if (!targetId) continue;
        const targetLabel = await participantLabel(encounterId, targetId, userId);
        await recordDmTacticalFact(
          encounter.sessionId,
          describeResolvedSpell(
            actorLabel,
            targetLabel,
            outcome.spellName ?? intent.spellName,
            outcome,
            spellShowTargetNumbers,
          ),
          {
            kind: 'spell',
            actorSlug: spellActorSlug,
            actorIsPlayer: spellActorIsPlayer,
            targetSlug: engineSlugForParticipant(spellFactMap, targetId, targetLabel),
            // Attack-roll spells carry hit; save spells carry saved; auto-hit spells
            // (magic missile) carry autoHit. All three feed the contract's success verbs.
            hit:
              outcome.hit ??
              (outcome.autoHit === true
                ? true
                : outcome.saved === true
                  ? false
                  : outcome.saved === false
                    ? true
                    : undefined),
          },
        );
        const targetIsPlayer =
          state.participants.find((participant) => participant.id === targetId)?.participantType ===
          'player';
        if (
          targetIsPlayer &&
          outcome.targetNewHp === 0 &&
          outcome.targetIsDead !== true &&
          (outcome.deathSaveFailuresAdded ?? 0) === 0
        ) {
          await recordDmTacticalFact(
            encounter.sessionId,
            describeGoingDown(targetLabel, {
              overflow: outcome.damageOverflow,
              hpMax: outcome.hpMaximum,
            }),
          );
        }
        if (targetIsPlayer && outcome.instantDeath === true) {
          await recordDmTacticalFact(
            encounter.sessionId,
            describeInstantDeath(targetLabel, {
              overflow: outcome.damageOverflow,
              hpMax: outcome.hpMaximum,
            }),
          );
        }
        // Damage at 0 HP adds death-save failures: its own engine fact, in the same
        // sentence the player reads, so the DM narrates the failure it caused (#2457).
        const spellDeathSaveFailuresAdded = outcome.deathSaveFailuresAdded ?? 0;
        if (spellDeathSaveFailuresAdded > 0) {
          await recordDmTacticalFact(
            encounter.sessionId,
            describeDamageAtZeroHp(
              targetLabel,
              spellDeathSaveFailuresAdded,
              outcome.deathSavesFailures ?? 0,
            ),
          );
        }
      }
    } else if (intent.type === 'flee' || intent.type === 'yield') {
      // #2580: the player's own exit. Fleeing is movement and yielding is a declaration, so it
      // claims the turn and the encounter version but NOT the Action: "Disengage, then Flee" has
      // to work, and so does leaving with the Action already spent. It provokes one opportunity
      // attack on the way out (flee only), then marks the player exited. A flee leaves the
      // DM's next `dm_ended_scene` to be judged against a roster with nobody left to be fought;
      // a yield ends the fight itself below (#262).
      // A dying character is not choosing to leave: the death-save flow owns them.
      const exiting = state.participants.find((participant) => participant.id === intent.actorId);
      if (vitalStateOf(exiting as unknown as VitalsInput) !== 'standing')
        throw new BusinessLogicError('Only a standing character can flee or yield', {
          actorId: intent.actorId,
        });
      await claimTurnVersion(intent.actorId, encounterId, intent.expectedVersion);
      const exitResult = await resolvePlayerExit({
        encounterId,
        sessionId: encounter.sessionId,
        userId,
        state,
        actorId: intent.actorId,
        intent: intent.type,
      });
      result = exitResult;
      // No discrete-action fact here: `describePlayerExit` is the engine line, and a second
      // "dashed" line under it would tell the DM the player ran and then dashed.
      if (
        intent.type === 'yield' &&
        exitResult.exit !== null &&
        actor.participantType === 'player'
      ) {
        // #262: the surrender is the ending, with its own reason — the engine end line names
        // it, so a typed or clicked yield can never again read as "Combat has ended." with no
        // reason. Flee keeps the #2580 design: the player leaves and the DM ends the scene.
        // The player gate matters: a DM-hallucinated monster yield must not end the fight
        // with false "party surrendered" fiction (the bogus exit itself is a #2580 gap).
        await concludeEncounter(encounterId, encounter.sessionId, userId, 'player_surrendered');
        yieldEndedCombat = true;
      }
    } else if (intent.type === 'dash') {
      result = await claimTurnActionAndResolve(
        intent.actorId,
        encounterId,
        intent.expectedVersion,
        () => grantTacticalDash(encounter.sessionId, intent.actorId),
      );
      await recordDiscreteActionFact(encounter.sessionId, state, intent.actorId, 'dash');
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
      await recordDiscreteActionFact(encounter.sessionId, state, intent.actorId, action);
    } else if (intent.type === 'check') {
      // #2420: a mid-combat ability check. Claimed and resolved by the check service, which
      // rolls the player's die (or takes the popup's), rolls the target's contest, applies the
      // condition, and records the Engine line and the DM fact. It claims the action itself, so
      // a check costs the turn exactly like an attack.
      result = await executeCombatCheck({
        encounterId,
        actorId: intent.actorId,
        ...(intent.targetId ? { targetId: intent.targetId } : {}),
        ...(intent.d20 !== undefined ? { d20: intent.d20 } : {}),
        ...(intent.shoveOutcome ? { shoveOutcome: intent.shoveOutcome } : {}),
        intent: {
          kind: intent.checkKind,
          verb: intent.checkKind,
          ...(intent.parleySkill ? { parleySkill: intent.parleySkill } : {}),
        },
        expectedVersion: intent.expectedVersion,
        userId,
      });
    } else if (intent.type === 'second_wind') {
      // #975: Second Wind is a bonus action. The claim wraps the resolution, so a
      // refusal inside (no feature on the sheet, no uses left, already at full
      // health) refunds the bonus action and the turn is untouched.
      const actorCharacterId = (actor as unknown as { characterId?: string | null }).characterId;
      result = await claimTurnBonusActionAndResolve(
        intent.actorId,
        encounterId,
        intent.expectedVersion,
        async () => {
          if (!actorCharacterId) {
            throw new BusinessLogicError('Second Wind is not on this character\'s sheet', {
              reason: 'feature_not_on_sheet',
              featureName: 'Second Wind',
            });
          }
          return resolveSecondWind({
            characterId: actorCharacterId,
            userId,
            participantId: intent.actorId,
            encounterId,
            sessionId: encounter.sessionId,
          });
        },
      );
      await recordFeatureActionFact(
        encounter.sessionId,
        state,
        intent.actorId,
        'second_wind',
        result as SecondWindResult,
      );
    } else if (intent.type === 'action_surge') {
      // #975: Action Surge costs no action itself — it grants one — so it claims
      // only the encounter version, like flee/yield. The resolver spends the
      // tracked use, then refunds a spent action or arms the extra action for
      // the claim that follows (see combat-turn-resources).
      const actorCharacterId = (actor as unknown as { characterId?: string | null }).characterId;
      await claimTurnVersion(intent.actorId, encounterId, intent.expectedVersion);
      if (!actorCharacterId) {
        throw new BusinessLogicError('Action Surge is not on this character\'s sheet', {
          reason: 'feature_not_on_sheet',
          featureName: 'Action Surge',
        });
      }
      result = await resolveActionSurge({
        characterId: actorCharacterId,
        userId,
        participantId: intent.actorId,
        encounterId,
        sessionId: encounter.sessionId,
        round: encounter.currentRound,
        actionUsed: (actor as unknown as TurnResourceView).actionUsed === true,
      });
      await recordFeatureActionFact(
        encounter.sessionId,
        state,
        intent.actorId,
        'action_surge',
        result as ActionSurgeResult,
      );
    } else if (intent.type === 'death_save') {
      // The dying player's whole turn: one save, rolled by the player (or auto-rolled by the
      // prompt's timer), then the turn ends. It runs before the board moves so the result and
      // the next holder of the turn reach the client together.
      // The save and the advance key on the same turn: a second save for it that found this one
      // recorded must not advance the order again and skip whoever is next (#2724).
      const turn = { round: encounter.currentRound, turnOrder: encounter.currentTurnOrder };
      const save = await rollOwedDeathSave(
        encounterId,
        encounter.sessionId,
        userId,
        intent.actorId,
        intent.d20,
        turn,
      );
      const settled = await advanceOneTurn(encounterId, encounter.sessionId, userId, turn);
      result = { ...settled.turn, deathSaves: save ? [save] : [] };
    } else {
      // An `end_turn` for a dying player is not a turn: the save is owed and only a death_save
      // intent pays it. Refusing here keeps a stray boundary (the action bar's End Turn chip,
      // a replayed client) from skipping the roll.
      const endingActor = state.participants.find(
        (participant) => participant.id === intent.actorId,
      ) as (VitalsInput & { id: string }) | undefined;
      if (endingActor && vitalStateOf(endingActor) === 'dying') {
        throw new BusinessLogicError(
          'A dying player cannot end their turn: a death saving throw is owed',
          {
            reason: 'death_save_required',
            actorId: intent.actorId,
          },
        );
      }
      const settled = await advanceOneTurn(encounterId, encounter.sessionId, userId);
      result = settled.turn;
    }

    trackCombatEvent('action_accepted', {
      encounterId,
      actorId: intent.actorId,
      action: intent.type,
      source,
      origin: origin ?? 'unmarked',
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
    // `end_turn` joins damage as a trigger because a character can now die without any damage
    // being dealt: three failed death saving throws end a campaign, and the check that ends
    // the encounter has to run on the turn that produced the third failure.
    // #570: the conclusion defers its victory notice to the return block below. The
    // notice is a chat row like any other, and chat order is insertion order — posted
    // inside the conclusion it would land ahead of this action's own row, which is
    // only written once the settled result exists.
    let ending: CombatEnding | null = yieldEndedCombat
      ? { reason: 'player_surrendered', wake: [] }
      : damage > 0 || intent.type === 'end_turn' || intent.type === 'death_save'
        ? await endCombatIfResolved(encounterId, userId, { deferVictoryNotice: true })
        : null;
    let combatBoundary = ending !== null;
    if (!ending) {
      // After the end check, never before: a killing blow ends the fight, and there is no next
      // turn to advance to. And before the publish, so the board the client receives already
      // names whoever is up — one broadcast, no window in which the UI shows a spent NPC as
      // current.
      const advanced = await advanceAfterSpentNpcTurn(
        encounterId,
        intent.actorId,
        userId,
        source,
        intent.type,
        index,
      );
      // The advance settles death saves for anyone the order reaches on the floor, and a third
      // failure ends a campaign without a point of damage being dealt. Same reason `end_turn`
      // triggers the check above.
      ending = advanced
        ? await endCombatIfResolved(encounterId, userId, { deferVictoryNotice: true })
        : null;
      combatBoundary = ending !== null;
      if (!ending) await publishCombatState(encounterId, userId, intent.type);
    }
    const settled = combatBoundary ? markCombatEnded(result, ending) : result;
    // #570: the deferred victory notice goes out only once the killing action has a
    // chat row of its own, so the transcript reads blow first, Victory second. The
    // flush reads the award the conclusion stored; it is idempotent, and on a call
    // that did not claim the ending it simply re-posts a lost notice, as before.
    const flushVictoryNotice = async (): Promise<void> => {
      if (ending?.reason !== 'last_hostile_defeated') return;
      // The notice is transcript, not resolution: the fight is already over and
      // the award already stored. A failed post must never fail the completed
      // action — the catch below reads every throw as a refused action — so it
      // is swallowed here and left to the notice's recovery points (#310).
      try {
        const { ensureCombatVictoryXpNotice } = await import('./combat-xp.js');
        await ensureCombatVictoryXpNotice({
          encounterId,
          sessionId: encounter.sessionId,
          userId,
        });
      } catch (flushError) {
        logger.warn({ msg: 'VICTORY_NOTICE_FLUSH_FAILED', encounterId, flushError });
      }
    };
    if (writesEngineRow) {
      const { writeNpcEngineRow } = await import('./npc-engine-row.js');
      const actionId = submitted.actionId ?? randomUUID();
      const npcResult = { ...(settled as Record<string, unknown>), actionId };
      const engineRows = await writeNpcEngineRow(state, intent, actionId, npcResult, userId);
      await flushVictoryNotice();
      return { ...npcResult, engineRows, sessionId: encounter.sessionId };
    }
    if (ending?.reason === 'last_hostile_defeated') {
      // A player's own killing action wrote no row above: its only transcript record
      // was the notice the client posts from this result, which is inserted after
      // the response — behind a Victory posted here. So the actor's row is written
      // from the settled result, exactly as a creature's is (the message builder
      // already renders a player's row, end line included), the notice flushes
      // behind it, and the client renders the row instead of its own notice.
      const { writeNpcEngineRow } = await import('./npc-engine-row.js');
      const actionId = submitted.actionId ?? randomUUID();
      const npcResult = { ...(settled as Record<string, unknown>), actionId };
      let engineRows: Awaited<ReturnType<typeof writeNpcEngineRow>> | null = null;
      try {
        engineRows = await writeNpcEngineRow(state, intent, actionId, npcResult, userId);
      } catch (rowError) {
        // Same reasoning as the flush: the blow landed and the ending is claimed,
        // so a failed transcript write must not reach the catch below and be
        // recorded as a refused action. Log it and fall through row-less: the
        // notice still flushes, and the client posts its own notice for the
        // blow, as it did before this row existed.
        logger.warn({ msg: 'VICTORY_ACTOR_ROW_WRITE_FAILED', encounterId, rowError });
      }
      await flushVictoryNotice();
      return engineRows ? { ...npcResult, engineRows, sessionId: encounter.sessionId } : settled;
    }
    return settled;
  } catch (error) {
    // The outer call reports it once, after the rollback.
    if (inNpcTransaction) throw error;
    trackCombatEvent('action_refused', {
      encounterId,
      actorId: submitted.actorId,
      action: submitted.type,
      source,
      origin: origin ?? 'unmarked',
      reason: error instanceof Error ? error.message : 'unknown',
    });
    const unresolvedActorIsPlayer = stateForUnresolved
      ? stateForUnresolved.participants.find((participant) => participant.id === submitted.actorId)
          ?.participantType === 'player'
      : source === 'dm';
    if (unresolvedActorIsPlayer && (submitted.type === 'spell' || submitted.type === 'attack')) {
      const reason = error instanceof Error ? error.message : 'unknown';
      const actorLabel = facingName(
        undefined,
        submitted.actorId,
        stateForUnresolved ? rosterFrom(stateForUnresolved.participants) : [],
      );
      const spellName =
        submitted.type === 'spell'
          ? submitted.spellName || submitted.spellId || 'unknown spell'
          : null;
      logger.warn({
        msg: 'PLAYER_ACTION_UNRESOLVED',
        encounterId,
        actorId: submitted.actorId,
        actionType: submitted.type === 'spell' ? 'cast_spell' : 'attack',
        spell: spellName,
        reason,
      });
      const sessionId = stateForUnresolved?.encounter.sessionId;
      if (sessionId) {
        try {
          await recordDmTacticalFact(
            sessionId,
            submitted.type === 'spell'
              ? describeRefusedSpell(actorLabel, spellName!, reason)
              : `Engine: ${actorLabel}'s attack was refused (${reason}). No roll, no damage, no wound.`,
          );
        } catch (factError) {
          logger.warn({
            msg: 'PLAYER_ACTION_UNRESOLVED_FACT_FAILED',
            encounterId,
            factError,
          });
        }
      }
    }
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
    maxHp?: number;
    status?: { currentHp?: number };
  };
  if (!actor) throw new NotFoundError('Current combat participant', encounterId);
  // A dying player's turn offers one thing: the death saving throw. No attack, move or spell.
  if (vitalStateOf(actor as unknown as VitalsInput) === 'dying') {
    return {
      encounterId,
      version: state.encounter.version,
      actorId: actor.id,
      actions: [{ type: 'death_save', label: 'Death saving throw' }],
    };
  }
  const map = await loadActiveTacticalMap(state.encounter.sessionId);
  const mapActor = map?.entities.find((entity) => entity.id === actor.id);
  const actions: Array<Record<string, unknown>> = [];
  if (map && mapActor && mapActor.movementRemaining > 0) {
    const nearestHostile = state.participants
      .filter(
        (participant) =>
          participant.id !== actor.id &&
          participant.isActive &&
          participant.participantType !== actor.participantType &&
          map.entities.some((entity) => entity.id === participant.id),
      )
      .map((participant) => ({
        participant,
        distance: getDistance(
          mapActor,
          map.entities.find((entity) => entity.id === participant.id)!,
        ),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    const approach = nearestHostile
      ? planApproach(map, actor.id, nearestHostile.participant.id, 5)
      : null;
    const destination = approach?.destination;
    if (destination && (destination.x !== mapActor.x || destination.y !== mapActor.y)) {
      actions.push({
        type: 'move',
        label: `Move (${mapActor.movementRemaining} ft remaining)`,
        x: destination.x,
        y: destination.y,
      });
    }
  }
  const profile = await getParticipantAbilityProfile(actor);
  if (!actor.actionUsed) {
    const [equippedWeapons, attackerConditions] = await Promise.all([
      listEquippedWeaponProfiles(actor),
      getActiveConditionNames(actor.id),
    ]);
    const weapons = equippedWeapons.length ? equippedWeapons : [UNARMED_STRIKE];
    const opposingTargets = state.participants.filter(
      (participant) =>
        participant.id !== actor.id &&
        participant.isActive &&
        participant.participantType !== actor.participantType &&
        // A dead creature is not a legal target: the attack button must retarget to a living
        // enemy when its original target died, and a dead target grants no advantage (#314
        // CB-074). Monsters die at 0 HP with no death saves (2014 5e).
        vitalStateOf(participant as unknown as VitalsInput) !== 'dead',
    );
    const targetConditions = new Map(
      await Promise.all(
        opposingTargets.map(
          async (target) => [target.id, await getActiveConditionNames(target.id)] as const,
        ),
      ),
    );
    // #259: "Attack with X (move closer first)" is only offered for a target the engine
    // would actually move toward. Offering it with no movement left (or no closer cell)
    // produces the "no attack was rolled" loop: the identical intent retries identically
    // forever because the non-spending movement_only never advances the turn.
    const canCloseDistance =
      map && mapActor
        ? (targetId: string, weapon: WeaponRuleProfile): boolean => {
            const plan = planApproach(map, actor.id, targetId, weapon.normalRange ?? 5);
            const destination = plan?.destination;
            return !!destination && (destination.x !== mapActor.x || destination.y !== mapActor.y);
          }
        : undefined;
    const targetsForWeapon = (weapon: WeaponRuleProfile): WeaponTargetResolution[] =>
      opposingTargets.map((target) => {
        const targetEntity = map?.entities.find((entity) => entity.id === target.id);
        const rules = resolveAttackRules({
          strength: profile.scores.str ?? 10,
          dexterity: profile.scores.dex ?? 10,
          level: profile.level,
          baseTargetAc: resolveParticipantArmorClass(target.armorClass, {
            participantId: target.id,
            encounterId,
          }),
          weapon,
          attackerConditions,
          targetConditions: targetConditions.get(target.id) ?? [],
          geometry:
            map && mapActor && targetEntity
              ? {
                  distanceFeet: getDistance(mapActor, targetEntity),
                  hasLineOfSight: checkLineOfSight(map, actor.id, target.id),
                  cover: getCover(map, actor.id, target.id),
                }
              : undefined,
        });
        return { targetId: target.id, legal: rules.legal, refusal: rules.refusal };
      });
    actions.push(
      ...buildCombatWeaponOptions(weapons, targetsForWeapon, { canCloseDistance }),
    );
    // #1059: a carried ranged weapon the package left unequipped (the
    // shortbow, the light crossbow) while a melee weapon holds the main
    // hand is offered as 'Equip and attack': the client equips it — the
    // turn's free object interaction — before declaring the attack, so
    // the intent finds it equipped. With no weapon equipped at all there
    // is no main hand to preserve; the create pass equips the package's
    // main ranged weapon for that shape, and the sheet/typed equip paths
    // cover the rest.
    if (equippedWeapons.length > 0) {
      const carriedWeapons = await listCarriedWeaponProfiles(actor);
      const equippedNames = new Set(
        equippedWeapons.map((weapon) => normalizeWeaponName(weapon.name)),
      );
      // The same weapon under its display-order spelling ("Light
      // Crossbow" carried, "Crossbow, light" equipped) is the same
      // weapon: the catalog resolver sees through the spelling, the
      // plain name normalizer does not.
      const equippedCatalogIds = new Set(
        equippedWeapons
          .map((weapon) => resolveWeaponName(weapon.name))
          .filter((id): id is string => Boolean(id)),
      );
      const seenNames = new Set<string>();
      const equippableRanged = carriedWeapons.filter((weapon) => {
        const key = normalizeWeaponName(weapon.name);
        if (!key || equippedNames.has(key) || seenNames.has(key)) return false;
        seenNames.add(key);
        const catalogId = resolveWeaponName(weapon.name);
        if (catalogId && equippedCatalogIds.has(catalogId)) return false;
        // No ammunition: the intent would refuse the attack AFTER the
        // client already equipped — a state change in front of a refusal.
        if (weapon.missingAmmunition) return false;
        return catalogWeaponIsRanged(weapon.name);
      });
      if (equippableRanged.length > 0) {
        actions.push(
          ...buildCombatWeaponOptions(equippableRanged, targetsForWeapon, {
            canCloseDistance,
            equipFirst: true,
          }),
        );
      }
    }
    actions.push(
      { type: 'dash', label: 'Dash' },
      { type: 'dodge', label: 'Dodge' },
      { type: 'disengage', label: 'Disengage' },
    );
  }
  // #975: the Fighter's short-rest features, offered while a use remains on the sheet.
  // Second Wind is a bonus action, so it is gated on that resource and not on the Action;
  // Action Surge exists for the turn whose Action is already spent, so it is gated on
  // neither — only on the use itself. Second Wind is also gated on being hurt: the
  // resolver refuses at full health (before spending anything), and a chip that can
  // only produce a refusal in the fighter's most common state is a trap, not an
  // option. HP is read the way vitalStateOf reads it (status first, maxHp fallback).
  if (actor.participantType === 'player' && actor.characterId) {
    const uses = await fighterFeatureUses(actor.characterId);
    const actorCurrentHp = actor.status?.currentHp ?? actor.maxHp ?? 0;
    if (
      !actor.bonusActionUsed &&
      (uses.secondWind ?? 0) > 0 &&
      actorCurrentHp < (actor.maxHp ?? 0)
    ) {
      actions.push({ type: 'second_wind', label: 'Second Wind' });
    }
    if ((uses.actionSurge ?? 0) > 0) {
      actions.push({ type: 'action_surge', label: 'Action Surge' });
    }
  }
  // #2580: the way out of a fight the end guard would otherwise hold open. Offered outside the
  // Action gate on purpose — a player whose Action is already spent is exactly the player stuck
  // in a fight they cannot finish, so gating these would deny the escape to the people who need
  // it most. The Flee label names the attacker, because whether a hostile is in reach is the
  // difference between running away and running at something, and the player is the one who has
  // to make that choice.
  if (actor.participantType === 'player') {
    const flees = await selectOpportunityAttacker({
      state,
      actor: actor as unknown as Parameters<typeof selectOpportunityAttacker>[0]['actor'],
      map: map ?? null,
      reachOf: async (participant) => {
        const { getDefaultCombatWeapon } = await import('./equipped-loadout.js');
        return getDefaultCombatWeapon(participant);
      },
      hasLineOfSight: (fromId, toId) => (map ? checkLineOfSight(map, fromId, toId) : false),
      distanceFeet: getDistance,
    });
    actions.push({
      type: 'flee',
      label: flees
        ? `Flee (${facingName(undefined, flees.participant.id, rosterFrom(state.participants))} attacks)`
        : 'Flee',
    });
    actions.push({ type: 'yield', label: 'Yield' });
  }
  const spells = profile.spellIds
    .map((id) => resolveCatalogSpell(id))
    .filter(
      (spell, index, all) =>
        spell &&
        isPlayerCombatSpell(spell) &&
        all.findIndex((candidate) => candidate?.id === spell.id) === index,
    );
  // One suggestion per spell on the character's own list. A single "Cast a prepared spell" chip
  // went to the DM as text, and the DM picked Fire Bolt for a wizard who does not have it (#2343 A3).
  for (const spell of spells) {
    const usesBonusAction = spell!.castingTime.toLowerCase().includes('bonus action');
    if (usesBonusAction ? actor.bonusActionUsed : actor.actionUsed) continue;
    const action: Record<string, unknown> = {
      type: 'spell',
      label: `Cast ${spell!.name}`,
      spellId: spell!.id,
    };
    // #2581: attack-roll spell chips are attack-shaped — they carry their targets so the
    // client can run the declare → dialog → commit pipeline itself instead of sending chat
    // text for the DM to declare (a Chill Touch narrated as a hit before any roll, run M2).
    // Save-based and auto-hit spells keep today's text-to-DM behavior.
    if (spell!.attackType) {
      const targetIds = state.participants
        .filter(
          (participant) =>
            participant.id !== actor.id &&
            participant.isActive &&
            participant.participantType !== actor.participantType &&
            // #1148: the same dead-target exclusion weapon targets carry (#314 CB-074).
            // Without it a Cast chip lists a dead creature and the bar shows
            // `Cast Chill Touch → {dead goblin}`. Monsters die at 0 HP.
            vitalStateOf(participant as unknown as VitalsInput) !== 'dead',
        )
        .map((participant) => participant.id);
      // No targets, no chip: an attack-shaped option without targets would fall back to
      // chat text on the client — the M2 shape again. Weapons skip the same way.
      if (!targetIds.length) continue;
      action.targetIds = targetIds;
    }
    actions.push(action);
  }
  actions.push({ type: 'end_turn', label: 'End turn' });
  return { encounterId, version: state.encounter.version, actorId: actor.id, actions };
}
