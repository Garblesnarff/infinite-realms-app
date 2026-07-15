import { broadcastToRoom } from '../collaboration/room-manager.js';
import { generateMap } from '../../tactical/generator.js';
import { resetMovement } from '../../tactical/engine.js';
import { deactivateTacticalMap, loadActiveTacticalMap, saveTacticalMap } from './tactical-map-store.js';
import type { SceneSpec, TacticalMap } from '../../tactical/types.js';
import { tacticalSizeForParticipant } from '../../tactical/participant-size.js';

type Participant = { id: string; name: string; participantType: string; speed: number };

const broadcast = (sessionId: string, payload: Record<string, unknown>): void => {
  broadcastToRoom(sessionId, null as never, { ...payload, timestamp: Date.now() });
};

/** Converts initiative records into tactical entities without inventing new IDs. */
export async function createTacticalCombatMap(sessionId: string, participants: Participant[], sceneSpec: SceneSpec): Promise<TacticalMap> {
  const existing = await loadActiveTacticalMap(sessionId);
  if (existing) return existing;
  const entities = participants.map((participant) => ({
    id: participant.id, name: participant.name, x: 0, y: 0, size: tacticalSizeForParticipant(participant),
    type: participant.participantType === 'player' ? 'pc' as const : 'monster' as const,
    speedFeet: participant.speed || 30, movementRemaining: participant.speed || 30,
  }));
  const map = generateMap({ ...sceneSpec, id: crypto.randomUUID(), sessionId, pcEntities: entities.filter((entity) => entity.type === 'pc'), enemyEntities: entities.filter((entity) => entity.type !== 'pc') });
  await saveTacticalMap(map);
  broadcast(sessionId, { type: 'map_created', map });
  return map;
}

export async function resetTacticalMovementForTurn(sessionId: string, entityId: string): Promise<TacticalMap | null> {
  const map = await loadActiveTacticalMap(sessionId);
  if (!map || !resetMovement(map, entityId)) return map;
  await saveTacticalMap(map);
  broadcast(sessionId, { type: 'entity_moved', entityId, path: [], movementReset: true });
  return map;
}

export async function grantTacticalDash(sessionId: string, entityId: string): Promise<TacticalMap | null> {
  const map = await loadActiveTacticalMap(sessionId);
  const entity = map?.entities.find((candidate) => candidate.id === entityId);
  if (!map || !entity) return map;
  entity.movementRemaining += entity.speedFeet;
  await saveTacticalMap(map);
  broadcast(sessionId, { type: 'movement_updated', entityId, movementRemaining: entity.movementRemaining });
  return map;
}

export async function destroyTacticalCombatMap(sessionId: string): Promise<void> {
  if (!await loadActiveTacticalMap(sessionId)) return;
  await deactivateTacticalMap(sessionId);
  broadcast(sessionId, { type: 'map_destroyed' });
}
