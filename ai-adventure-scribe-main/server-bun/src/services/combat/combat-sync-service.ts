import { CombatEncounterService } from './combat-encounter-service.js';
import { buildInitiativeOrder } from './initiative-order.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { broadcastToRoom } from '../collaboration/room-manager.js';

export async function publishCombatState(
  encounterId: string,
  userId: string,
  reason: string,
): Promise<void> {
  const combat = await CombatEncounterService.getCombatState(encounterId, userId);
  const tacticalMap = await loadActiveTacticalMap(combat.encounter.sessionId);
  broadcastToRoom(combat.encounter.sessionId, null as never, {
    type: 'combat_state_updated',
    reason,
    combat,
    initiativeOrder: buildInitiativeOrder(combat),
    tacticalMap,
    timestamp: Date.now(),
  });
}
