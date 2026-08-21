/* eslint-disable max-lines -- the single mutation gateway for every combat intent; splitting
   the dispatch would put the turn's authorization, resolution, and reporting in three files. */
import { decideAttackApproach, describeResolvedAttack } from './combat-approach-service.js';
import { CombatEncounterService } from './combat-encounter-service.js';
import { concludeEncounter } from './combat-ending.js';
import { trackCombatEvent } from './combat-events.js';
import { publishCombatState } from './combat-sync-service.js';
import { claimTurnActionAndResolve, setDefensiveAction } from './combat-turn-resources.js';
import {
  getEquippedWeaponProfile,
  getParticipantAbilityProfile,
  getActiveConditionNames,
  listEquippedWeaponProfiles,
} from './data-access.js';
import {
  describeGoingDown,
  settleDownedTurns,
  vitalStateOf,
  type VitalsInput,
} from './death-saves-service.js';
import { groundRequestedWeapon } from './weapon-grounding.js';
import { checkLineOfSight, getCover, getDistance } from '../../tactical/engine.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
import { resolveAttackRules } from './combat-rules.js';
import { resolveParticipantArmorClass } from './participant-armor-class.js';
import { loadSessionEntityIndex, type SessionEntityIndex } from './session-entity-index.js';
import { applyTacticalMapAction, recordDmTacticalFact } from './tactical-action-service.js';
import { grantTacticalDash, resetTacticalMovementForTurn } from './tactical-combat-lifecycle.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { getSpellById, getSpellByName } from '../../data/spellData.js';
import { BusinessLogicError, NotFoundError, ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

import type { CombatAttackService as CombatAttackServiceType } from './combat-attack-service.js';
import type { AttackRollInput, SpellAttackInput } from '../../types/combat.js';

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

export type EncounterAlreadyConcludedResult = {
  encounterAlreadyConcluded: true;
  encounterId: string;
  status: 'completed';
};

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
function markCombatEnded(result: unknown): unknown {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return { ...(result as Record<string, unknown>), combatEnded: true };
  }
  return { result, combatEnded: true };
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

async function endCombatIfResolved(encounterId: string, userId: string): Promise<boolean> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
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
  if (partyInPlay && hostilesStanding) return false;
  // Which side ran out is the difference between a victory and a TPK, and the old fixed
  // string reported a victory for both.
  const reason = hostilesStanding ? 'party_defeated' : 'last_hostile_defeated';
  await concludeEncounter(encounterId, state.encounter.sessionId, userId, reason);
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
    // The roster rides along on the refusal, not just in the log. A caller that is told only
    // "wrong actor" can do nothing but repeat itself; one told who the board actually holds can
    // re-choose. This is what the client-side repair loop regenerates against.
    throw new BusinessLogicError('Actor is not the current-turn participant', {
      ...currentContext,
      roster: index.roster(),
    });
  }
  return { actor: current, encounter: state.encounter };
}

/** `combat_participants` carries the action flags; the service's row type does not name them. */
type TurnResourceView = { id: string; actionUsed?: boolean | null } & VitalsInput;

/**
 * One turn boundary, done properly: advance the order, refund the new actor's movement, and
 * roll death saving throws for anyone the order reaches on the floor.
 *
 * Deliberately the same three calls the `end_turn` branch of the dispatch makes, in the same
 * order. An implicit end of turn that only nudged `current_turn_order` would be a different
 * kind of turn boundary from an explicit one — a dying character passed this way would never
 * roll the save the rules owe them, and the movement pool of whoever came next would still
 * hold last turn's remainder.
 */
async function advanceOneTurn(encounterId: string, sessionId: string, userId: string) {
  const turn = await CombatInitiativeService.advanceTurn(encounterId, userId);
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
 * A participant that cannot act at all (unconscious, stabilised, dead) is not passed by this
 * function either — `settleDownedTurns`, inside the one advance, rolls the save the rules owe
 * them and moves the order on itself.
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
  // An explicit `end_turn` is never absorbed: it is itself a turn boundary, so advancing to
  // reach its actor and then advancing again would consume two turns for one instruction.
  // Player-sourced intents are never absorbed either — a player client acting out of turn is a
  // bug or a race and must still be told so. This tolerance exists because one specific model
  // cannot emit `end_turn`, not because out-of-turn actions became acceptable.
  const absorbable =
    source === 'dm' && known && intentType !== 'end_turn' && !!current && current.id !== actorId;
  // The refusal that must survive this wave, unchanged: a creature being made to act twice.
  if (!absorbable || (vitalStateOf(current!) === 'standing' && !current!.actionUsed)) {
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
  return { actor: state.currentParticipant, encounter: state.encounter };
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
 * Returns whether the order actually moved, so the caller knows the board it publishes is a new
 * turn.
 */
async function advanceAfterSpentNpcTurn(
  encounterId: string,
  actorId: string,
  userId: string,
  source: CombatActionSource,
  intentType: SubmittedCombatIntent['type'],
  index: SessionEntityIndex,
): Promise<boolean> {
  // `end_turn` is already a boundary; a player-sourced intent belongs to a client that ends its
  // own turn.
  if (source !== 'dm' || intentType === 'end_turn') return false;
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const actor = state.participants.find((participant) => participant.id === actorId) as
    | (TurnResourceView & { participantType?: string })
    | undefined;
  if (!actor || !isHostile(actor.participantType as string)) return false;
  // The action economy is the trigger, not the intent type: a `move`, or an attack that resolved
  // as approach-only, spends nothing and leaves the NPC mid-turn with its attack still to make.
  if (!actor.actionUsed) return false;
  // Something else already moved the order — an absorbed advance, a death-save settlement — and
  // a step here would skip whoever it landed on.
  if (state.currentParticipant?.id !== actorId) return false;
  await advanceOneTurn(encounterId, state.encounter.sessionId, userId);
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
  return true;
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
function resolveIntentRefs(
  submitted: SubmittedCombatIntent,
  index: SessionEntityIndex,
  state: CombatState,
): SubmittedCombatIntent {
  const roster = new Set(state.participants.map((participant) => participant.id));
  const require = (token: string, role: 'actor' | 'target'): string => {
    const resolved = index.resolve(token);
    if (roster.has(resolved)) return resolved;
    logger.warn({
      msg: 'COMBAT_INTENT_UNRESOLVED_REF',
      encounterId: state.encounter.id,
      sessionId: state.encounter.sessionId,
      intentType: submitted.type,
      role,
      submittedRef: token,
      // Named separately because the two differ exactly when the board resolved a token to an
      // id the encounter does not carry — a stale reference, not an unknown one.
      resolvedTo: resolved === token ? null : resolved,
      roster: index.roster(),
    });
    throw new NotFoundError('Combat participant', token, {
      role,
      intentType: submitted.type,
      roster: index.roster(),
    });
  };
  const actorId = require(submitted.actorId, 'actor');
  if (submitted.type === 'attack')
    return { ...submitted, actorId, targetId: require(submitted.targetId, 'target') };
  if (submitted.type === 'spell')
    return {
      ...submitted,
      actorId,
      targetIds: submitted.targetIds.map((id) => require(id, 'target')),
    };
  return { ...submitted, actorId };
}

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
export async function proposeCombatAttack(
  encounterId: string,
  submitted: SubmittedCombatIntent,
  userId: string,
  source: CombatActionSource,
): Promise<
  { movementOnly: true; result: unknown } | ({ movementOnly: false } & Record<string, unknown>)
> {
  if (submitted.type !== 'attack') {
    throw new ValidationError('Only attack intents can be proposed', {
      intentType: submitted.type,
    });
  }
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const index = await loadSessionEntityIndex(state.encounter.sessionId);
  const resolved = resolveIntentRefs(submitted, index, state) as Extract<
    CombatIntent,
    { type: 'attack' }
  >;
  const { actor, encounter } = await resolveActorTurn(
    encounterId,
    state,
    resolved.actorId,
    index,
    userId,
    resolved.type,
    source,
  );
  const actorLabel = actor.name ?? resolved.actorId;
  const targetLabel = await participantLabel(encounterId, resolved.targetId, userId);
  const equipped = await listEquippedWeaponProfiles(actor);
  const grounding = groundRequestedWeapon(resolved.weaponId, equipped);
  const approach = await decideAttackApproach({
    sessionId: encounter.sessionId,
    actorId: resolved.actorId,
    actorLabel,
    targetId: resolved.targetId,
    targetLabel,
    weapon: grounding.weapon,
  });
  if (approach.movementOnly) return { movementOnly: true, result: approach.result };
  const attackService = await createCombatAttackService();
  const proposal = await attackService.proposeAttack(
    encounterId,
    {
      attackerId: resolved.actorId,
      targetId: resolved.targetId,
      weaponId: grounding.weaponId,
      attackType: approach.attackType,
      // The proposal claims no version: it writes nothing that a concurrent write could lose.
      expectedVersion: encounter.version,
      advantage: resolved.advantage,
      disadvantage: resolved.disadvantage,
    },
    userId,
  );
  // The resolved ids travel back so the commit addresses exactly what was proposed, rather than
  // re-resolving a slug against a board the approach above may have moved.
  return {
    movementOnly: false,
    ...proposal,
    actorId: resolved.actorId,
    targetId: resolved.targetId,
    weaponId: grounding.weaponId,
    expectedVersion: encounter.version,
    targetLabel,
    requestedWeapon: grounding.requested,
    weaponSubstituted: !grounding.grounded,
  };
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
    // A completed encounter still retains its participant rows, but its tactical board is gone.
    // Check the authoritative encounter status before loading that board or resolving a slug;
    // otherwise a valid post-victory follow-through becomes the misleading 404 "Combat
    // participant not found" that #1744 observed.
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
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
    const index = await loadSessionEntityIndex(state.encounter.sessionId);
    const resolved = resolveIntentRefs(submitted, index, state);
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
    const { actor, encounter } = await resolveActorTurn(
      encounterId,
      state,
      resolved.actorId,
      index,
      userId,
      resolved.type,
      source,
    );
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
      const actorIsPlayer =
        state.participants.find((participant) => participant.id === intent.actorId)
          ?.participantType === 'player';
      const visibility = {
        actorId: intent.actorId,
        actorName: actorLabel,
        targetId: intent.targetId,
        targetName: targetLabel,
        requestedWeapon: grounding.requested,
        resolvedWeapon: weapon.name || 'attack',
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
              weaponId: grounding.weaponId,
              attackType: approach.attackType,
              expectedVersion: intent.expectedVersion,
              advantage: intent.advantage,
              disadvantage: intent.disadvantage,
              providedD20: intent.d20,
            } satisfies AttackRollInput,
            userId,
          ),
          { ...visibility, normalizeAutoRolled: true },
        );
        // Every resolution is reported, not just the ones that failed to reach. A hit the DM is
        // never told about is a hit it cannot narrate, and a DM with nothing to narrate repeats
        // the paragraph it wrote last turn.
        // "(auto-rolled)" belongs only to a die the player was supposed to throw. Every monster
        // attack is engine-rolled by design and marking those would turn the note into noise
        // that means nothing — so the flag is narrowed to player actors here rather than in the
        // attack service, which cannot know whose die it was.
        const resolvedAttack = result as Parameters<typeof describeResolvedAttack>[2];
        await recordDmTacticalFact(
          encounter.sessionId,
          describeResolvedAttack(
            actorLabel,
            targetLabel,
            { ...resolvedAttack, autoRolled: actorIsPlayer && resolvedAttack.autoRolled === true },
            weapon.name,
          ),
        );
        // Going down is its own event, and the most important one the DM has never been told
        // about. The attack line above says "is UNCONSCIOUS"; this says what unconscious means
        // in the rules the engine is now enforcing, so the DM narrates a character dying on
        // the floor rather than a character killed.
        const outcome = result as { targetNewHp?: number; targetIsDead?: boolean };
        const targetIsPlayer =
          state.participants.find((participant) => participant.id === intent.targetId)
            ?.participantType === 'player';
        if (targetIsPlayer && outcome.targetNewHp === 0 && outcome.targetIsDead !== true) {
          await recordDmTacticalFact(encounter.sessionId, describeGoingDown(targetLabel));
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
      // A downed character's turn is a death saving throw, not an action. Resolving it here,
      // as the order reaches them, is what makes 0 HP a state a fight passes through rather
      // than the state a fight ends in. `advanceOneTurn` is the same boundary an implicit
      // advance performs, so the two kinds of turn end cannot drift apart.
      const settled = await advanceOneTurn(encounterId, encounter.sessionId, userId);
      result = settled.deathSaves.length
        ? { ...settled.turn, deathSaves: settled.deathSaves }
        : settled.turn;
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
    // `end_turn` joins damage as a trigger because a character can now die without any damage
    // being dealt: three failed death saving throws end a campaign, and the check that ends
    // the encounter has to run on the turn that produced the third failure.
    const combatEnded =
      (damage > 0 || intent.type === 'end_turn') &&
      (await endCombatIfResolved(encounterId, userId));
    let combatBoundary = combatEnded;
    if (!combatEnded) {
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
      const endedOnAdvance = advanced ? await endCombatIfResolved(encounterId, userId) : false;
      combatBoundary = endedOnAdvance;
      if (!endedOnAdvance) await publishCombatState(encounterId, userId, intent.type);
    }
    return combatBoundary ? markCombatEnded(result) : result;
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
        baseTargetAc: resolveParticipantArmorClass(target.armorClass, {
          participantId: target.id,
          encounterId,
        }),
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
