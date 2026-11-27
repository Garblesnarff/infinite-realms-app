import { CombatEncounterService } from './combat-encounter-service.js';
import { isLiveHostile } from './combat-end-guard.js';
import { getDefaultCombatWeapon } from './equipped-loadout.js';
import { writePlayerMoveRow } from './npc-engine-row.js';
import { loadActiveTacticalMap } from './tactical-map-store.js';
import { CELL_FEET, getDistance } from '../../tactical/engine.js';

export async function persistPlayerMove(params: {
  encounterId: string;
  actorId: string;
  actionId?: string;
  steps: number;
  userId: string;
}) {
  const state = await CombatEncounterService.getCombatState(params.encounterId, params.userId);
  const actor = state.participants.find((participant) => participant.id === params.actorId);
  if (actor?.participantType !== 'player') return [];
  const map = await loadActiveTacticalMap(state.encounter.sessionId);
  const mover = map?.entities.find((entity) => entity.id === actor.id);
  const hostiles = state.participants.filter(isLiveHostile);
  const closest = mover && map?.entities
    .flatMap((entity) => {
      const hostile = hostiles.find((participant) => participant.id === entity.id);
      return hostile ? [{ hostile, distance: getDistance(mover, entity) }] : [];
    })
    .sort((a, b) => a.distance - b.distance)[0];
  let detail = '';
  if (closest) {
    const profile = await getDefaultCombatWeapon(actor, { preferMelee: true });
    const reach = profile.ranged ? (profile.meleeWeapon ? 5 : null) : profile.normalRange;
    detail = `; ${closest.hostile.name} is ${closest.distance} ft away${reach ? ` (reach ${reach} ft)` : ''}`;
  }
  const line = `You moved ${params.steps * CELL_FEET} ft${detail}.`;
  return writePlayerMoveRow(
    state,
    `move:${params.actionId ?? crypto.randomUUID()}`,
    line,
    params.userId,
  );
}
