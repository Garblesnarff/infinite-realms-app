/**
 * The recoverable middle state between "fighting" and "campaign over" (SRD 5.1, "Dropping to 0
 * Hit Points"), as the engine runs it.
 *
 * A player character at 0 hit points is not dead unless one blow overflowed their maximum
 * (`HPMechanics`). They are unconscious and dying, and the state machine is:
 *
 *   standing  -> dying {0,0}      damage drops them to 0 (no save is rolled in that resolution)
 *   standing  -> dead             the same blow overflows their hit point maximum
 *   dying     -> dying            a death save, or a hit on the body, moves the tallies
 *   dying     -> stabilized       three successes, or a stabilising effect
 *   dying     -> dead             three failures
 *   dying     -> standing         a natural 20 (1 HP) or any healing
 *   stabilized-> dying            a hit on the body
 *
 * The death saving throw belongs to the PLAYER. It is rolled once, at the start of their turn,
 * through the same roll prompt as every other player die: this module never rolls it while the
 * turn order merely passes by. `settleDownedTurns` stops the order on a dying player and
 * leaves the save owed; `rollOwedDeathSave` resolves it when the die arrives, and the caller
 * ends the turn, because the save is the whole of that turn. That is the entire reason the
 * saves of run D2 (#2516) — two of them, inside the enemy's resolution, with no player turn in
 * between — cannot happen again.
 *
 * Every state is written into `<engine_resolved_outcomes>` as a plain sentence, because a DM
 * that is not told which state a character is in will narrate whichever one it feels like.
 *
 * @module server/services/combat/death-saves-service
 */

import { CombatEncounterService } from './combat-encounter-service.js';
import { recordDmTacticalFact } from './tactical-action-service.js';
import { resetTacticalMovementForTurn } from './tactical-combat-lifecycle.js';
import { describeDeathSave } from '../../../../shared/death-save-lines';
import { BusinessLogicError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { CombatHPService } from '../combat-hp-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';
import { isPlayerParticipant, vitalStateOf, type VitalsInput } from './vital-state.js';

import type { AdvanceTurnResult, DeathSaveResult } from '../../types/combat.js';

export {
  DEATH_SAVE_FAILURES_TO_DIE,
  DEATH_SAVE_SUCCESSES_TO_STABILIZE,
  isPlayerParticipant,
  vitalStateOf,
  type VitalState,
  type VitalsInput,
} from './vital-state.js';

/** The shared death-save formatter, re-exported for the server's turn runner. */
export { describeDeathSave };

/** The line the DM gets when a character is put down, so the transition itself is narratable. */
export function describeGoingDown(
  name: string,
  facts?: { overflow?: number; hpMax?: number },
): string {
  // The numbers the verdict rests on (#2640): what remained after 0 HP against the maximum.
  const numbers =
    facts?.overflow !== undefined && facts.overflow > 0 && facts.hpMax !== undefined
      ? ` (${facts.overflow} damage remains; HP max ${facts.hpMax} — dying)`
      : '';
  return (
    `${name} has dropped to 0 HP${numbers} and is UNCONSCIOUS and still dying — not dead. They ` +
    `will make a death saving throw at the start of each of their turns.`
  );
}

export interface SettledTurn {
  turn: AdvanceTurnResult;
  /** True when the order stopped on a dying player, who owes the save this turn. */
  awaitingDeathSave: boolean;
}

/**
 * Skips past participants who cannot act, and stops on the turn the fight actually resumes on.
 *
 * A stable or dead character, and a monster at 0 hit points, cannot act: the turn moves on. A
 * DYING player is different: their turn is the death saving throw, which the player rolls, so
 * the order stops on them and `awaitingDeathSave` says so. Nothing is rolled here.
 *
 * Bounded by the participant count rather than looping until the state settles: a bug in the
 * classification above must produce a stuck turn a log can see, not a request that never
 * returns.
 */
export async function settleDownedTurns(
  encounterId: string,
  sessionId: string,
  userId: string,
  turn: AdvanceTurnResult,
): Promise<SettledTurn> {
  let current = turn;

  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const limit = Math.max(1, state.participants.length) * 2;

  for (let step = 0; step < limit; step += 1) {
    const fresh = await CombatEncounterService.getCombatState(encounterId, userId);
    const actor = fresh.participants.find(
      (participant) => participant.id === current.currentParticipant.id,
    ) as (VitalsInput & { id: string; name: string }) | undefined;
    if (!actor) break;
    const vital = vitalStateOf(actor);
    if (vital === 'standing') break;
    if (vital === 'dying') return { turn: current, awaitingDeathSave: true };

    current = await CombatInitiativeService.advanceTurn(encounterId, userId);
    await resetTacticalMovementForTurn(sessionId, current.currentParticipant.id);
  }

  return { turn: current, awaitingDeathSave: false };
}

/**
 * Resolves the death saving throw a dying player owes on their turn.
 *
 * `d20` is the die the player rolled (or the client's auto-roll when the prompt ran out); with
 * none, the engine rolls it. The save is refused unless `actorId` is the current participant
 * and is dying: a roll for anyone else, or out of turn, is not a death save.
 */
export async function rollOwedDeathSave(
  encounterId: string,
  sessionId: string,
  userId: string,
  actorId: string,
  d20?: number,
): Promise<DeathSaveResult | null> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const actor = state.participants.find((participant) => participant.id === actorId) as
    | (VitalsInput & { id: string; name: string })
    | undefined;
  if (!actor || state.currentParticipant?.id !== actorId || vitalStateOf(actor) !== 'dying') {
    throw new BusinessLogicError('No death saving throw is owed by this participant right now', {
      reason: 'death_save_not_owed',
      actorId,
      currentParticipantId: state.currentParticipant?.id ?? null,
    });
  }

  // The tallies read above are the ones the save is rolled against: a second save for the same
  // turn that read them too loses the compare-and-set and is refused (#2518).
  // The save spends the Action in the same write that records it, so a save already recorded
  // this turn (the turn change after it failed, and the client retried) is found here and is
  // NOT rolled again: the caller only finishes the turn.
  if ((actor as unknown as { actionUsed?: boolean }).actionUsed === true) {
    logger.warn({
      msg: 'COMBAT_DEATH_SAVE_ALREADY_RECORDED',
      encounterId,
      sessionId,
      participantId: actor.id,
    });
    return null;
  }
  const result = await CombatHPService.rollDeathSave(actor.id, encounterId, userId, d20, {
    successes: actor.status?.deathSavesSuccesses ?? 0,
    failures: actor.status?.deathSavesFailures ?? 0,
  });
  await recordDmTacticalFact(sessionId, describeDeathSave(actor.name, result));
  logger.info({
    msg: 'COMBAT_DEATH_SAVE',
    encounterId,
    sessionId,
    participantId: actor.id,
    participantName: actor.name,
    roll: result.roll,
    autoRolled: d20 === undefined,
    successes: result.successes,
    failures: result.failures,
    isStabilized: result.isStabilized,
    isDead: result.isDead,
    wasRevived: result.wasRevived,
  });
  return result;
}

/** A stable player waking after the fight moved on without them. */
export interface WakeOutcome {
  participantId: string;
  name: string;
  /** The 1d4 hours the engine rolled; HP is 1 and the unconscious state is lifted. */
  hours: number;
}

/**
 * Who wakes once the encounter ends, and after how long: the engine rolls 1d4 hours for each
 * stable player. Read-only: nothing is written until the encounter is claimed (`applyStableWake`).
 */
export async function planStableWake(encounterId: string, userId: string): Promise<WakeOutcome[]> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const plan: WakeOutcome[] = [];
  for (const participant of state.participants) {
    if (
      !isPlayerParticipant(participant.participantType as string) ||
      vitalStateOf(participant as unknown as VitalsInput) !== 'stabilized'
    ) {
      continue;
    }
    plan.push({
      participantId: participant.id,
      name: participant.name as string,
      hours: Math.floor(Math.random() * 4) + 1,
    });
  }
  return plan;
}

/**
 * Raise each planned player to 1 HP. Call it only after `concludeEncounter` has claimed the
 * encounter. A player who is no longer stable (a concurrent ending already woke them, or a hit
 * landed) is skipped, so a second caller cannot wake anyone twice.
 */
export async function applyStableWake(
  encounterId: string,
  userId: string,
  plan: WakeOutcome[],
): Promise<WakeOutcome[]> {
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  const woken: WakeOutcome[] = [];
  for (const entry of plan) {
    const participant = state.participants.find(
      (candidate) => candidate.id === entry.participantId,
    );
    if (!participant || vitalStateOf(participant as unknown as VitalsInput) !== 'stabilized') {
      continue;
    }
    await CombatHPService.healDamage(
      participant.id,
      encounterId,
      1,
      'woke after stabilising',
      userId,
    );
    woken.push(entry);
  }
  return woken;
}
