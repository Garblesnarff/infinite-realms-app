/**
 * The only way an encounter is allowed to stop.
 *
 * There were four. `endCombatIfResolved` did the whole job — recorded the sentence the DM
 * narrates, ended the encounter, tore down the board, emitted `combat_ended`, republished the
 * state. The three route-level paths each did some subset of it, and the one the DM actually
 * reaches — `combat_transition: "end"`, which lands on `/tactical-map/end` — did the least:
 * it destroyed the map and flipped the row to `completed` with no reason, no telemetry, and
 * nothing written for the DM to read on its next turn.
 *
 * That is precisely what playtest run 18's encounter 2 was. The monster stood at 2 of 11 hit
 * points, no `combat_ended` was ever logged, the row said `completed`, and the next encounter
 * opened with no acknowledgement that a fight had just been walked away from. A player would
 * have watched a fight simply stop.
 *
 * So the subset-doing is gone. Every terminal transition calls `concludeEncounter`, it takes a
 * `CombatEndReason` it cannot default, and it always does all five things in the order that
 * makes the fifth one reachable: the DM fact is written BEFORE the board is torn down, because
 * `recordDmTacticalFact` writes onto the session's latest tactical map row and the teardown is
 * what makes that row stop being the active one.
 *
 * @module server/services/combat/combat-ending
 */
import { CombatEncounterService } from './combat-encounter-service.js';
import { trackCombatEvent } from './combat-events.js';
import { publishCombatState } from './combat-sync-service.js';
import { vitalStateOf, type VitalsInput } from './death-saves-service.js';
import { recordDmTacticalFact } from './tactical-action-service.js';
import { destroyTacticalCombatMap } from './tactical-combat-lifecycle.js';
import { alert } from '../../lib/alerting.js';
import { logger } from '../../lib/logger.js';
import { NarrativeLedgerService } from '../narrative/narrative-ledger-service.js';

import type { CombatEndReason } from '../../types/combat.js';

/**
 * The sentence the DM is handed when the fight is over — one per reason, because "the fight
 * ended" and "you walked away from a fight you were winning" are different scenes and the DM
 * narrated neither of them for eighteen runs.
 *
 * Each is written as a completed event with an explicit instruction not to open a new fight in
 * the same breath, which is the failure mode these replace: a fresh encounter starting with no
 * narrative acknowledgement that the previous one had happened.
 */
export function describeCombatEnd(reason: CombatEndReason): string {
  switch (reason) {
    case 'last_hostile_defeated':
      return (
        'THE FIGHT IS OVER: the last hostile has fallen and the party is victorious. Narrate ' +
        'the end of the combat — the final blow, the aftermath, what the party is left standing ' +
        'in. Do not start a new encounter in the same breath.'
      );
    case 'party_defeated':
      return (
        'THE FIGHT IS OVER: no member of the party is still able to fight. Narrate the defeat ' +
        'and what becomes of them. Do not start a new encounter in the same breath.'
      );
    case 'dm_ended_scene':
      return (
        'THE FIGHT IS OVER: combat has ended by your own scene transition, with combatants ' +
        'still standing. Nobody was defeated. Narrate how the fighting stopped — a retreat, a ' +
        'surrender, a parley, an interruption — and account for every creature that was still ' +
        'up. Do not narrate a victory that did not happen, and do not start a new encounter in ' +
        'the same breath.'
      );
    case 'ended_by_request':
      return (
        'THE FIGHT IS OVER: this encounter was closed while it was still running. Narrate how ' +
        'the fighting stopped and where the surviving combatants went. Do not start a new ' +
        'encounter in the same breath.'
      );
    case 'abandoned':
      return (
        'THE FIGHT IS OVER: this encounter was abandoned mid-fight. Narrate the party breaking ' +
        'off — what they leave behind them, and what is still standing when they go. Do not ' +
        'narrate a victory that did not happen, and do not start a new encounter in the same ' +
        'breath.'
      );
  }
}

/** A defeat on either side is a resolution; everything else stopped a fight that was still live. */
const isResolution = (reason: CombatEndReason): boolean =>
  reason === 'last_hostile_defeated' || reason === 'party_defeated';

/**
 * Persist only facts the combat engine can prove. Ledger failures are deliberately non-fatal:
 * combat state must still close if a deployment has not applied the narrative migration yet.
 */
async function recordCombatNarrativeFacts(
  encounterId: string,
  sessionId: string,
  userId: string,
  reason: CombatEndReason,
): Promise<void> {
  try {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const deadParticipants = state.participants.filter(
      (participant) => vitalStateOf(participant as unknown as VitalsInput) === 'dead',
    );

    for (const participant of deadParticipants) {
      await NarrativeLedgerService.assertFact(
        {
          sessionId,
          subjectType: participant.participantType === 'player' ? 'party' : 'npc',
          subjectName: participant.name,
          predicate: 'status',
          value: { state: 'dead', encounterId },
          knownBy: ['dm'],
          source: 'engine',
        },
        userId,
      );
    }

    // An explicit client abandonment means the party broke off while the encounter was live.
    // Keep this separate from creature death so the DM cannot turn an unresolved retreat into
    // a victory on the next turn.
    if (reason === 'abandoned') {
      await NarrativeLedgerService.assertFact(
        {
          sessionId,
          subjectType: 'party',
          subjectName: 'party',
          predicate: 'status',
          value: { state: 'fled', encounterId },
          knownBy: ['dm'],
          source: 'engine',
        },
        userId,
      );
    }
  } catch (error) {
    logger.warn({
      msg: 'NARRATIVE_FACT_WRITE_FAILED',
      encounterId,
      sessionId,
      error: error instanceof Error ? error.message : error,
    });
    // The write is non-fatal, but a ledger that silently stops recording deaths is the exact
    // failure #1680 exists to surface: combat still closes cleanly, so nothing else in the
    // turn looks wrong. Page on it (v2 guardrail 3).
    alert('narrative_fact_write_failed', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Ends `encounterId` and leaves behind every record of the ending: a reason on the row, a
 * `combat_ended` telemetry line, a sentence in the DM's next context, a torn-down board, and a
 * republished state.
 *
 * `sessionId` is taken rather than looked up so the fact can still be written when the caller
 * has already read the encounter — and so this never has to answer what to do about a fact for
 * a session it could not find.
 */
export async function concludeEncounter(
  encounterId: string,
  sessionId: string,
  userId: string,
  reason: CombatEndReason,
): Promise<void> {
  await recordCombatNarrativeFacts(encounterId, sessionId, userId, reason);
  // Before the teardown, deliberately: this is the only ordering in which the reason the fight
  // ended can reach the DM at all.
  await recordDmTacticalFact(sessionId, describeCombatEnd(reason));
  await CombatEncounterService.endCombat(encounterId, userId, reason);
  await destroyTacticalCombatMap(sessionId);
  trackCombatEvent('combat_ended', { encounterId, sessionId, reason });
  // An encounter stopped while it was still winnable is the thing run 18 could not see. It
  // stays a distinct, alertable line rather than one `reason` value among five in a counter.
  if (!isResolution(reason)) {
    logger.warn({
      msg: 'COMBAT_ENDED_UNRESOLVED',
      alert: true,
      encounterId,
      sessionId,
      reason,
    });
    // Loud, not just logged (#1680): this was previously an `alert: true` marker nobody
    // consumed. A fight ending unresolved is exactly the "working and broken look the same"
    // continuity failure the alerting module exists for.
    alert('combat_ended_unresolved', { sessionId, error: `reason=${reason}` });
    trackCombatEvent('abandonment', { encounterId, sessionId, reason });
  }
  await publishCombatState(encounterId, userId, 'combat_ended');
}
