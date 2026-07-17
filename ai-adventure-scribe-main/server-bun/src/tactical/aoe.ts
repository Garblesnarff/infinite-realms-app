import { getAoECells, getAoETargets } from './engine.js';

import type { AoEParams, AoEShape, Point, TacticalMap } from './types.js';

export type SpellAreaOfEffect = {
  shape: AoEShape;
  sizeFeet: number;
};

export type SpellForcedMove = {
  distanceFeet: number;
  direction: 'away' | 'toward';
};

export type AoECastGeometry = {
  shape: AoEShape;
  sizeFeet: number;
  origin: Point;
  direction: Point | null;
  cells: Point[];
};

export function parametersForArea(
  area: SpellAreaOfEffect,
  direction: Point | null,
  sourceEntityId?: string,
): AoEParams {
  if (area.shape === 'sphere')
    return { radiusFeet: area.sizeFeet, sourceEntityId };
  if (area.shape === 'cube') return { sizeFeet: area.sizeFeet, sourceEntityId };
  return {
    lengthFeet: area.sizeFeet,
    widthFeet: area.shape === 'line' ? 5 : undefined,
    direction: direction ?? undefined,
    sourceEntityId,
  };
}

/** Produce target IDs and display geometry from one engine calculation contract. */
export function calculateAoECast(
  map: TacticalMap,
  sourceEntityId: string,
  area: SpellAreaOfEffect,
  origin: Point,
  direction: Point | null,
) {
  const params = parametersForArea(area, direction, sourceEntityId);
  return {
    geometry: {
      shape: area.shape,
      sizeFeet: area.sizeFeet,
      origin,
      direction,
      cells: getAoECells(map, area.shape, origin, params),
    } satisfies AoECastGeometry,
    targets: getAoETargets(map, area.shape, origin, params).filter((target) => {
      const entity = map.entities.find((candidate) => candidate.id === target.id);
      return target.id !== sourceEntityId && entity?.type !== 'object';
    }),
  };
}
