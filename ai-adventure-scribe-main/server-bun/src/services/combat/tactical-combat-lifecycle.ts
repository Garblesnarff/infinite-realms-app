import {
  deactivateTacticalMap,
  loadActiveTacticalMap,
  loadLatestTacticalMapRow,
  saveTacticalMap,
} from './tactical-map-store.js';
import { resetMovement } from '../../tactical/engine.js';
import { generateMap } from '../../tactical/generator.js';
import { tacticalSizeForParticipant } from '../../tactical/participant-size.js';
import { broadcastToRoom } from '../collaboration/room-manager.js';

import type { EntitySize, SceneSpec, TacticalMap } from '../../tactical/types.js';

type Participant = { id: string; name: string; participantType: string; speed: number };

const broadcast = (sessionId: string, payload: Record<string, unknown>): void => {
  broadcastToRoom(sessionId, null as never, { ...payload, timestamp: Date.now() });
};

/** Converts initiative records into tactical entities without inventing new IDs. */
export async function createTacticalCombatMap(
  sessionId: string,
  participants: Participant[],
  sceneSpec: SceneSpec,
  participantSizes: Record<string, EntitySize> = {},
): Promise<TacticalMap> {
  const existing = await loadActiveTacticalMap(sessionId);
  if (existing) return existing;
  const entities = participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
    x: 0,
    y: 0,
    size: tacticalSizeForParticipant(participant, participantSizes[participant.id]),
    type: participant.participantType === 'player' ? ('pc' as const) : ('monster' as const),
    speedFeet: participant.speed || 30,
    movementRemaining: participant.speed || 30,
  }));
  const map = generateMap({
    ...sceneSpec,
    id: crypto.randomUUID(),
    sessionId,
    pcEntities: entities.filter((entity) => entity.type === 'pc'),
    enemyEntities: entities.filter((entity) => entity.type !== 'pc'),
  });
  // Facts are session-scoped and live on the latest map row, so a new board would otherwise
  // strand the previous fight's ending on a row nothing reads again. The most common shape of
  // that is precisely the one this wave exists to fix: last hostile falls, combat ends, the DM
  // starts the next encounter before it has narrated the last one's final blow.
  const previous = await loadLatestTacticalMapRow(sessionId);
  if (previous?.state.pendingDmFacts?.length)
    map.pendingDmFacts = [...previous.state.pendingDmFacts];
  if (previous?.state.pendingDmCorrection)
    map.pendingDmCorrection = previous.state.pendingDmCorrection;
  await saveTacticalMap(map);
  broadcast(sessionId, { type: 'map_created', map });
  return map;
}

export async function resetTacticalMovementForTurn(
  sessionId: string,
  entityId: string,
): Promise<TacticalMap | null> {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map || !resetMovement(map, entityId)) return map;
  await saveTacticalMap(map);
  broadcast(sessionId, { type: 'entity_moved', entityId, path: [], movementReset: true });
  return map;
}

export async function grantTacticalDash(
  sessionId: string,
  entityId: string,
): Promise<TacticalMap | null> {
  const map = await loadActiveTacticalMap(sessionId);
  const entity = map?.entities.find((candidate) => candidate.id === entityId);
  if (!map || !entity) return map;
  entity.movementRemaining += entity.speedFeet;
  await saveTacticalMap(map);
  broadcast(sessionId, {
    type: 'movement_updated',
    entityId,
    movementRemaining: entity.movementRemaining,
  });
  return map;
}

export async function destroyTacticalCombatMap(sessionId: string): Promise<void> {
  if (!(await loadActiveTacticalMap(sessionId))) return;
  await deactivateTacticalMap(sessionId);
  broadcast(sessionId, { type: 'map_destroyed' });
}
