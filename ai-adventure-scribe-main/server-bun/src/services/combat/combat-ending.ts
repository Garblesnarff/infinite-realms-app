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
import { and, eq } from 'drizzle-orm';

import { CombatEncounterService } from './combat-encounter-service.js';
import {
  combatExitsOf,
  describeCombatExit,
  describeSceneEndRefusal,
  evaluateSceneEnd,
  partyHasLeftTheFight,
  type CombatExitDeclaration,
} from './combat-end-guard.js';
import { trackCombatEvent } from './combat-events.js';
import { publishCombatState } from './combat-sync-service.js';
import { vitalStateOf, type VitalsInput } from './death-saves-service.js';
import { recordDmTacticalFact } from './tactical-action-service.js';
import { destroyTacticalCombatMap } from './tactical-combat-lifecycle.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { db } from '../../../../db/client';
import { characterStats, gameSessions } from '../../../../db/schema/index';
import { alert } from '../../lib/alerting.js';
import { logger } from '../../lib/logger.js';
import { slugify, entitySlug, resolveEntityRef } from '../../tactical/identity.js';
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
    case 'ended_idle':
      return (
        'THE FIGHT IS OVER: this encounter sat unfinished and untouched for so long that it was ' +
        'closed automatically. Nobody acted in it — not the party, not you. Narrate the fight ' +
        'breaking off and what became of everyone still standing when it did, without inventing ' +
        'a blow that was never struck. Do not narrate a victory that did not happen, and do not ' +
        'start a new encounter in the same breath.'
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
      // A player exit (#2580) already wrote the party's slug (fled or surrendered) when it was
      // recorded; writing `fled` over it would turn every yield into a flight.
      const partyFacts = await NarrativeLedgerService.currentFacts(sessionId, userId, {
        subjectType: 'party',
        subjectName: 'party',
      });
      const partyStatus = partyFacts.find((fact) => fact.predicate === 'status');
      const recordedFor = (partyStatus?.value as { encounterId?: string } | undefined)?.encounterId;
      if (recordedFor !== encounterId) {
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
  requestedReason: CombatEndReason,
  options: { exits?: CombatExitDeclaration[] } = {},
): Promise<boolean> {
  // The live-hostile guard (#2524) sits at this one choke point: every path that sets
  // `dm_ended_scene` funnels through here, so a DM scene end can never close a fight
  // while a hostile stands conscious and active. Only an explicit fled / surrendered /
  // withdrew declaration accounts for a standing hostile, and it is marked as that
  // state — never as dead. The guard itself is read-only; exits are applied only
  // after the terminal claim below, so a concurrent conclusion leaves nothing behind.
  let exitDecision: ReturnType<typeof evaluateSceneEnd> | null = null;
  let exitState: Awaited<ReturnType<typeof CombatEncounterService.getCombatState>> | null = null;
  let boardSlugOf: (participant: { id: string; name?: string | null }) => string = (participant) =>
    slugify(participant.name ?? participant.id);
  // #2580: a guard cleared by the party leaving the fight (#2580) is not the DM deciding the
  // scene was over — nobody was left in it. It is recorded as the abandonment it is, so the row
  // cannot later be read as a fight the DM ended while hostiles stood.
  let reason: CombatEndReason = requestedReason;
  if (requestedReason === 'dm_ended_scene') {
    exitState = await CombatEncounterService.getCombatState(encounterId, userId);
    if (exitState.encounter.status !== 'active') return true;
    // The DM addresses participants by the board's slugs — numbered for duplicates
    // (`goblin-2`) — never by database id, so exits resolve through the tactical map
    // exactly as the turn-order block derives them.
    const map = await loadActiveTacticalMap(sessionId).catch(() => null);
    boardSlugOf = (participant: { id: string; name?: string | null }): string => {
      const entity = map ? resolveEntityRef(map.entities, participant.id) : null;
      return entity ? entitySlug(entity) : slugify(participant.name ?? participant.id);
    };
    const roster = exitState.participants as unknown as Parameters<typeof evaluateSceneEnd>[0];
    // #2580: a party that has left the fight makes the standing creatures nobody's problem, so
    // there is no live hostile left to protect a scene end from. Judged on the full roster,
    // which is what this call site has: the exited player is still a row here.
    // Only a roster that HAD a player row can have lost it to an exit: with no player row at all
    // the #2524 guard still judges the live hostiles.
    const partyLeft =
      roster.some((participant) => participant.participantType === 'player') &&
      partyHasLeftTheFight(roster);
    exitDecision = partyLeft
      ? { allowed: true as const, exits: combatExitsOf(options.exits) }
      : evaluateSceneEnd(roster, combatExitsOf(options.exits), boardSlugOf);
    // Recorded as the abandonment it is: an end the player walked out of is not the DM having
    // decided the scene was over, and the row should never be readable as one (#2524).
    if (partyLeft) reason = 'abandoned';
    if (!exitDecision.allowed) {
      logger.warn({
        msg: 'COMBAT_END_REFUSED_LIVE_HOSTILES',
        alert: true,
        encounterId,
        sessionId,
        liveHostiles: exitDecision.unaccounted.map((participant) => ({
          participantId: participant.id,
          name: participant.name ?? null,
          currentHp: participant.status?.currentHp ?? null,
        })),
      });
      alert('combat_end_refused_live_hostiles', { sessionId, error: `encounter=${encounterId}` });
      await recordDmTacticalFact(sessionId, describeSceneEndRefusal(exitDecision.unaccounted));
      return false;
    }
  }

  // Claim the terminal transition before writing any side effects. The conditional update is
  // the idempotency boundary: a post-conclusion retry returns here without another ledger fact,
  // tactical instruction, telemetry event, teardown, or publish.
  // #2517: a party defeat completes the session in the same transaction as the claim, so
  // the chronicle can be written for a dead run — but only when the hero actually died.
  // A party defeat can also mean a stabilised party (nobody standing or dying); that
  // hero's run continues in this session. The completion, the load gate and the message
  // refusal all read the same single truth: `vital_state === 'dead'`.
  const concluded = await db.transaction(async (tx) => {
    const claimed = await CombatEncounterService.endCombat(encounterId, userId, reason, tx);
    if (claimed && reason === 'party_defeated') {
      const [session] = await tx
        .select({ characterId: gameSessions.characterId })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId));
      const [stats] = session?.characterId
        ? await tx
            .select({ vitalState: characterStats.vitalState })
            .from(characterStats)
            .where(eq(characterStats.characterId, session.characterId))
        : [];
      if (stats?.vitalState === 'dead') {
        await tx
          .update(gameSessions)
          .set({ status: 'completed', endTime: new Date(), updatedAt: new Date() })
          .where(and(eq(gameSessions.id, sessionId), eq(gameSessions.status, 'active')));
      }
    }
    return claimed;
  });
  if (!concluded) {
    logger.info({
      msg: 'COMBAT_END_ALREADY_CONCLUDED',
      encounterId,
      sessionId,
      reason,
    });
    return true;
  }

  if (exitDecision?.allowed && exitState) {
    for (const declaration of exitDecision.exits) {
      const participant = exitState.participants.find(
        (candidate) =>
          candidate.id === declaration.participant_id ||
          boardSlugOf(candidate) === declaration.participant_id,
      );
      if (!participant) continue;
      await CombatEncounterService.markParticipantExited(encounterId, participant.id);
      await recordDmTacticalFact(
        sessionId,
        describeCombatExit(participant.name || participant.id, declaration.exit),
      );
      try {
        await NarrativeLedgerService.assertFact(
          {
            sessionId,
            subjectType: 'npc',
            subjectName: participant.name || participant.id,
            predicate: 'status',
            value: { state: declaration.exit, encounterId },
            knownBy: ['dm'],
            source: 'engine',
          },
          userId,
        );
      } catch (error) {
        logger.warn({
          msg: 'NARRATIVE_FACT_WRITE_FAILED',
          encounterId,
          sessionId,
          error: error instanceof Error ? error.message : error,
        });
      }
    }
  }

  await recordCombatNarrativeFacts(encounterId, sessionId, userId, reason);
  // The encounter row is already claimed as completed, but the tactical board remains active
  // until after this write. This is the only ordering in which the reason the fight ended can
  // reach the DM at all.
  await recordDmTacticalFact(sessionId, describeCombatEnd(reason));
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
  return true;
}
