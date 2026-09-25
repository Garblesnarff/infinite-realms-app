import { CombatEncounterService } from './combat-encounter-service.js';
import { executeCombatIntent } from './combat-intent-service.js';
import { loadActiveTacticalMap, saveTacticalMap } from './tactical-map-store.js';
import { resolveCatalogSpell } from '../../data/spellData.js';
import { calculateAoECast } from '../../tactical/aoe.js';
import { dispatchMapAction } from '../../tactical/dispatch.js';
import { broadcastToRoom } from '../collaboration/room-manager.js';

import type { AoECastGeometry } from '../../tactical/aoe.js';
import type { Point } from '../../tactical/types.js';

export type AoECastRequest = {
  actorId: string;
  spellId: string;
  origin: Point;
  direction: Point | null;
  slotLevel: number | null;
};

export type AoEForcedMove = { entityId: string; path: Point[] };
export type AoETargetResult = {
  entityId: string;
  saved: boolean | null;
  finalDamage: number | undefined;
  newHp: number | undefined;
};
export type AoECastDelta = {
  type: 'aoe_cast';
  state: 'player-confirmed' | 'hostile-telegraph';
  actorId: string;
  spellId: string;
  geometry: AoECastGeometry;
  targets: AoETargetResult[];
  forcedMoves: AoEForcedMove[];
};
export type AoEPreviewDelta = {
  type: 'aoe_preview';
  state: 'player-pending' | 'hostile-telegraph';
  actorId: string;
  spellId: string;
  slotLevel: number | null;
  geometry: AoECastGeometry;
};

const publish = (sessionId: string, delta: AoECastDelta | AoEPreviewDelta): void =>
  broadcastToRoom(sessionId, null as never, { ...delta, timestamp: Date.now() });

async function prepare(sessionId: string, request: AoECastRequest) {
  const [map, spell] = await Promise.all([
    loadActiveTacticalMap(sessionId),
    resolveCatalogSpell(request.spellId),
  ]);
  if (!map) throw new Error('No active tactical map');
  if (!spell?.areaOfEffect) throw new Error('Spell does not have an area of effect');
  const actor = map.entities.find((entity) => entity.id === request.actorId);
  if (!actor) throw new Error('Casting entity is not on the tactical map');
  return {
    map,
    spell,
    actor,
    cast: calculateAoECast(
      map,
      request.actorId,
      spell.areaOfEffect,
      request.origin,
      request.direction,
    ),
  };
}

export async function proposeAoECast(sessionId: string, request: AoECastRequest) {
  const { spell, actor, cast } = await prepare(sessionId, request);
  const playerCast = actor.type === 'pc';
  const autoConfirm = playerCast && spell.range.toLowerCase() === 'self';
  const preview: AoEPreviewDelta = {
    type: 'aoe_preview',
    state: playerCast ? 'player-pending' : 'hostile-telegraph',
    actorId: request.actorId,
    spellId: request.spellId,
    slotLevel: request.slotLevel,
    geometry: cast.geometry,
  };
  publish(sessionId, preview);
  return { preview, autoConfirm, hostile: !playerCast };
}

/**
 * Resolve damage/saves through the combat engine, then apply every failed-save
 * push against the same in-memory tactical map. Only the completed aggregate is
 * broadcast, making this safe for spectators and future co-op clients.
 */
export async function resolveAoECast(
  sessionId: string,
  request: AoECastRequest,
  userId: string,
): Promise<AoECastDelta> {
  const { map, spell, actor, cast } = await prepare(sessionId, request);
  const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
  if (!encounter) throw new Error('No active combat encounter');
  const combatState = await CombatEncounterService.getCombatState(encounter.id, userId);
  const targetIds = cast.targets.map((target) => target.id);
  const resolved = targetIds.length
    ? ((await executeCombatIntent(
        encounter.id,
        {
          type: 'spell',
          actorId: request.actorId,
          targetIds,
          spellId: request.spellId,
          spellName: spell.name,
          slotLevel: request.slotLevel ?? undefined,
          expectedVersion: combatState.encounter.version,
        },
        userId,
        actor.type === 'pc' ? 'player' : 'dm',
      )) as { results?: Array<{ hit?: boolean; finalDamage?: number; targetNewHp?: number }> })
    : { results: [] };
  const outcomes = resolved.results ?? [];
  const targets = targetIds.map((entityId, index) => ({
    entityId,
    saved: spell.saveAbility ? outcomes[index]?.hit === false : null,
    finalDamage: outcomes[index]?.finalDamage,
    newHp: outcomes[index]?.targetNewHp,
  }));
  const forcedMoves: AoEForcedMove[] = [];
  if (spell.forcedMove) {
    for (const target of targets) {
      if (target.saved || target.saved === null) continue;
      const moved = dispatchMapAction(map, {
        action: 'forced_move',
        target: target.entityId,
        mode: spell.forcedMove.direction === 'away' ? 'shove' : 'pull',
        origin: request.origin,
        distance: spell.forcedMove.distanceFeet,
        destination: null,
      });
      if (moved.applied && moved.path?.length)
        forcedMoves.push({ entityId: target.entityId, path: moved.path });
    }
    if (forcedMoves.length) await saveTacticalMap(map);
  }
  const delta: AoECastDelta = {
    type: 'aoe_cast',
    state: actor.type === 'pc' ? 'player-confirmed' : 'hostile-telegraph',
    actorId: request.actorId,
    spellId: request.spellId,
    geometry: cast.geometry,
    targets,
    forcedMoves,
  };
  publish(sessionId, delta);
  return delta;
}
