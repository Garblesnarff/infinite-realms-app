/**
 * A won parley holds the target's action for its next turn (#2420).
 *
 * Without this the engine only told the DM that the creature "does not attack" while the NPC
 * runner went on attacking on its turn. The hold lives on the tactical map's state JSONB, beside
 * `pendingDmFacts`, keyed by round: a hold from an earlier round is simply never matched again, so
 * the creature attacks the next round without anything having to clear it.
 */
import { loadActiveTacticalMap, saveTacticalMap } from './tactical-map-store.js';
import { combatLogger } from '../../lib/logger.js';

export async function recordParleyHold(
  sessionId: string,
  participantId: string,
  round: number,
): Promise<void> {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map) {
    // No board to hold it on: the creature will act. Said in the log, since the fact still reads as a hold.
    combatLogger.warn({
      msg: 'PARLEY_HOLD_NOT_RECORDED',
      sessionId,
      participantId,
      reason: 'no_active_map',
    });
    return;
  }
  map.parleyHolds = [
    ...(map.parleyHolds ?? []).filter((hold) => hold.round >= round),
    { participantId, round },
  ];
  await saveTacticalMap(map);
}

export async function isParleyHeld(
  sessionId: string,
  participantId: string,
  round: number,
): Promise<boolean> {
  const map = await loadActiveTacticalMap(sessionId);
  return Boolean(
    map?.parleyHolds?.some((hold) => hold.participantId === participantId && hold.round === round),
  );
}
