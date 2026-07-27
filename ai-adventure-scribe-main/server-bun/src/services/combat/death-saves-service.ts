/**
 * The recoverable middle state between "fighting" and "campaign over".
 *
 * A 5E character reduced to 0 hit points is not dead. They are unconscious and dying, rolling
 * a death saving throw at the start of each of their turns: three successes and they stabilise,
 * three failures and they die, a natural 20 and they are back on their feet with 1 hit point,
 * and any healing at all brings them round. That middle state is the entire reason a fight
 * going badly is a story rather than an ending.
 *
 * None of it was reachable. The machinery existed in pieces — `combat_participant_status`
 * carries `is_conscious`, `death_saves_successes` and `death_saves_failures`;
 * `HPMechanics.calculateDamageResult` already computes the unconscious flag and the extra
 * failures a hit on a downed creature costs; `CombatHPService.rollDeathSave` already
 * implements the whole d20 table — but nothing ever called `rollDeathSave` during a fight, and
 * `endCombatIfResolved` counted a participant as living only while `currentHp > 0`. So the
 * instant a character hit 0 the encounter ended as `party_defeated`, the board was torn down,
 * and none of the fields the schema had been carrying for months were ever read.
 *
 * This module is the missing caller. It runs when the turn reaches a downed character:
 *
 *   dying       roll the save, record what happened for the DM, and pass the turn on. They
 *               cannot act.
 *   stabilised  (three successes) unconscious at 0 HP, no longer rolling. The turn passes.
 *   revived     (natural 20) conscious at 1 HP. The turn is theirs; they act normally.
 *   dead        (three failures) out of the fight for good.
 *
 * Every one of those states is written into `<engine_resolved_outcomes>` as a plain sentence,
 * because a DM that is not told which of the four a character is in will narrate whichever one
 * it feels like — and it has been narrating none of them at all.
 *
 * @module server/services/combat/death-saves-service
 */

import { CombatEncounterService } from './combat-encounter-service.js';
import { recordDmTacticalFact } from './tactical-action-service.js';
import { resetTacticalMovementForTurn } from './tactical-combat-lifecycle.js';
import { logger } from '../../lib/logger.js';
import { CombatHPService } from '../combat-hp-service.js';
import { CombatInitiativeService } from '../combat-initiative-service.js';

import type { AdvanceTurnResult, DeathSaveResult } from '../../types/combat.js';

/** Where a combatant stands, as the fight-over check and the DM digest both need to ask it. */
export type VitalState = 'standing' | 'dying' | 'stabilized' | 'dead';

/** The three successes / three failures thresholds, named so no call site spells them. */
export const DEATH_SAVE_SUCCESSES_TO_STABILIZE = 3;
export const DEATH_SAVE_FAILURES_TO_DIE = 3;

/** The subset of a hydrated combat participant this module reads. */
export interface VitalsInput {
  participantType: string;
  maxHp: number;
  status?: {
    currentHp: number;
    isConscious: boolean;
    deathSavesSuccesses: number;
    deathSavesFailures: number;
  } | null;
}

export const isPlayerParticipant = (participantType: string): boolean =>
  participantType === 'player';

/**
 * Classifies one combatant.
 *
 * Only player characters get the dying state. That is 5E as written — a monster reduced to 0
 * hit points simply dies (MM p.6) — and it is also what keeps the fight-over check meaningful:
 * if a felled monster counted as "dying", no fight would ever end in victory.
 */
export function vitalStateOf(participant: VitalsInput): VitalState {
  const currentHp = participant.status?.currentHp ?? participant.maxHp;
  if (currentHp > 0) return 'standing';
  if (!isPlayerParticipant(participant.participantType)) return 'dead';
  const failures = participant.status?.deathSavesFailures ?? 0;
  const successes = participant.status?.deathSavesSuccesses ?? 0;
  if (failures >= DEATH_SAVE_FAILURES_TO_DIE) return 'dead';
  if (successes >= DEATH_SAVE_SUCCESSES_TO_STABILIZE) return 'stabilized';
  return 'dying';
}

/** The sentence the DM reads. Written as a completed event, never as a prompt to invent one. */
export function describeDeathSave(name: string, result: DeathSaveResult): string {
  const tally = `${result.successes} success${result.successes === 1 ? '' : 'es'}, ${
    result.failures
  } failure${result.failures === 1 ? '' : 's'}`;
  if (result.wasRevived) {
    return (
      `${name} rolled a NATURAL 20 on their death saving throw and is back on their feet at ` +
      `1 HP, conscious and able to act. Narrate this; it already happened.`
    );
  }
  if (result.isDead) {
    return (
      `${name} rolled ${result.roll} on their death saving throw — their third failure. ` +
      `${name} is DEAD. Narrate the death; it already happened.`
    );
  }
  if (result.isStabilized) {
    return (
      `${name} rolled ${result.roll} on their death saving throw — their third success. ` +
      `${name} is STABILISED: unconscious at 0 HP, no longer dying, and will make no further ` +
      `death saving throws. Narrate this; it already happened.`
    );
  }
  const outcome = result.isSuccess ? 'SUCCESS' : 'FAILURE';
  return (
    `${name} rolled ${result.roll} on their death saving throw — ${outcome} (${tally}). ` +
    `${name} is still unconscious at 0 HP and still dying. Narrate this; it already happened.`
  );
}

/** The line the DM gets when a character is put down, so the transition itself is narratable. */
export function describeGoingDown(name: string): string {
  return (
    `${name} has dropped to 0 HP and is UNCONSCIOUS and DYING — not dead. They will make a ` +
    `death saving throw at the start of each of their turns. Narrate them going down; it ` +
    `already happened.`
  );
}

export interface SettledTurn {
  turn: AdvanceTurnResult;
  deathSaves: DeathSaveResult[];
  /** True when a death save killed someone, so the caller re-checks whether the fight is over. */
  someoneDied: boolean;
}

/**
 * Rolls death saves for downed characters as the turn order reaches them, skipping past those
 * who cannot act, and returns the turn that the fight actually resumes on.
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
  const deathSaves: DeathSaveResult[] = [];
  let someoneDied = false;
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

    if (vital === 'dying') {
      const result = await CombatHPService.rollDeathSave(actor.id, encounterId, userId);
      deathSaves.push(result);
      await recordDmTacticalFact(sessionId, describeDeathSave(actor.name, result));
      logger.info({
        msg: 'COMBAT_DEATH_SAVE',
        encounterId,
        sessionId,
        participantId: actor.id,
        participantName: actor.name,
        roll: result.roll,
        successes: result.successes,
        failures: result.failures,
        isStabilized: result.isStabilized,
        isDead: result.isDead,
        wasRevived: result.wasRevived,
      });
      if (result.isDead) someoneDied = true;
      // A natural 20 puts them back up at 1 HP; the turn they just started is theirs to take.
      if (result.wasRevived) break;
    }

    // Unconscious, stabilised or dead: they cannot act, so the turn moves on rather than
    // waiting for an action that will never be submitted.
    current = await CombatInitiativeService.advanceTurn(encounterId, userId);
    await resetTacticalMovementForTurn(sessionId, current.currentParticipant.id);
  }

  return { turn: current, deathSaves, someoneDied };
}
