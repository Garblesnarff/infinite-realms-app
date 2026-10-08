import { eq, sql } from 'drizzle-orm';

import { CombatEncounterService } from './combat-encounter-service.js';
import { writeNpcCapRow } from './npc-engine-row.js';
import { advanceNpcTurns, type AdvanceNpcTurnsResult } from './npc-turn-runner.js';
import { loadSessionEntityIndex } from './session-entity-index.js';
import { db } from '../../../../db/client';
import { campaigns, characters, combatEncounters, gameSessions } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';
import { resolveEntityRef } from '../../tactical/identity.js';

import type { CombatState } from '../../types/combat.js';

export type NpcTurnsDrained = AdvanceNpcTurnsResult & { endedReason?: string | null };

/**
 * Runs the creatures until a player holds the turn, the fight ends, or the safety cap. The server
 * owns this (#2658 step 3): the turn never waits on a browser. A capped run leaves the cap line as
 * a row; the stranded-turn sweep picks the fight up again.
 */
export async function runNpcTurnsToPlayer(
  encounterId: string,
  userId: string,
): Promise<NpcTurnsDrained> {
  const batch = await advanceNpcTurns(encounterId, userId);
  const engineRows = [...(batch.engineRows ?? [])];
  const state = await CombatEncounterService.getCombatState(encounterId, userId);
  if (batch.capReached)
    engineRows.push(...(await writeNpcCapRow(state, batch.transcriptLines[0], userId)));
  const endedReason = batch.combatEnded
    ? ((await CombatEncounterService.getLatestConcludedEncounter(state.encounter.sessionId, userId))
        ?.endedReason ?? null)
    : undefined;
  return { ...batch, engineRows, ...(endedReason !== undefined ? { endedReason } : {}) };
}

/** The participant a typed actor names: an id, a board slug, or a name on the roster. */
async function participantIdFor(state: CombatState, token: string): Promise<string | undefined> {
  const seated = (id: string): boolean =>
    state.participants.some((participant) => participant.id === id);
  if (seated(token)) return token;
  const boardId = (await loadSessionEntityIndex(state.encounter.sessionId)).resolve(token);
  if (seated(boardId)) return boardId;
  return resolveEntityRef(state.participants, token)?.id;
}

/**
 * Drains only when a creature holds the turn of an active fight. With `forPlayerActorId`, only
 * when that actor is a player: a player acting while a creature still holds the turn (a restart,
 * a fight paused at the cap) gets the creatures run first instead of an out-of-turn refusal.
 *
 * A failed drain must not fail the request whose own write already committed: it is logged, the
 * creature keeps the turn, and the next player intent (or a restart) runs it again.
 */
export async function runNpcTurnsIfNpcHolds(
  encounterId: string,
  userId: string,
  forPlayerActorId?: string,
): Promise<NpcTurnsDrained | null> {
  try {
    const state = await CombatEncounterService.getCombatState(encounterId, userId);
    const holder = state.currentParticipant;
    if (state.encounter.status !== 'active' || !holder || holder.participantType === 'player') {
      return null;
    }
    // Nobody left in the order to hand the turn to (the player fled): the loop could only spin to
    // the cap, so the fight waits for its ending instead.
    if (!state.participants.some((p) => p.participantType === 'player' && p.isActive)) return null;
    if (forPlayerActorId !== undefined) {
      const actorId = await participantIdFor(state, forPlayerActorId);
      const actor = state.participants.find((participant) => participant.id === actorId);
      if (actor?.participantType !== 'player') return null;
    }
    return await runNpcTurnsToPlayer(encounterId, userId);
  } catch (error) {
    logger.warn({
      msg: 'NPC_TURNS_DRAIN_FAILED',
      encounterId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * A restart can land between two NPC turns, and a drain that failed leaves a creature holding the
 * turn while the player's composer waits. Nothing in the browser runs creatures any more, so every
 * active fight a creature holds is resumed at boot and on a short tick, as its owner (the idle
 * sweeper's owner rule: campaign owner, else character owner).
 */
export async function resumeStrandedNpcTurns(): Promise<void> {
  const active = await db
    .select({
      encounterId: combatEncounters.id,
      ownerUserId: sql<string | null>`coalesce(${campaigns.userId}, ${characters.userId})`,
    })
    .from(combatEncounters)
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(eq(combatEncounters.status, 'active'));
  for (const { encounterId, ownerUserId } of active) {
    if (!ownerUserId) continue;
    const drained = await runNpcTurnsIfNpcHolds(encounterId, ownerUserId);
    if (drained)
      logger.info({ msg: 'NPC_TURNS_RESUMED', encounterId, capReached: drained.capReached });
  }
}

/** How often a creature left holding the turn is picked up again. */
const NPC_TURN_SWEEP_INTERVAL_MS = 60 * 1000;
let sweepInFlight = false;

/** Boot run plus the tick; a slow sweep is never started twice. */
export function startNpcTurnSweep(): ReturnType<typeof setInterval> {
  const tick = (): void => {
    if (sweepInFlight) return;
    sweepInFlight = true;
    resumeStrandedNpcTurns()
      .catch((error) => logger.warn({ msg: 'NPC_TURNS_RESUME_FAILED', error: String(error) }))
      .finally(() => {
        sweepInFlight = false;
      });
  };
  tick();
  const interval = setInterval(tick, NPC_TURN_SWEEP_INTERVAL_MS);
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
}
