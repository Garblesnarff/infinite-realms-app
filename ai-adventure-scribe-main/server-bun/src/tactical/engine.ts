/* eslint-disable max-lines */
import ROT from 'rot-js';

import type {
  AoEParams,
  AoEShape,
  AoETarget,
  Cell,
  MapEntity,
  MoveResult,
  PathResult,
  Point,
  TacticalMap,
} from './types';

export const CELL_FEET = 5;
const sizeCells: Record<MapEntity['size'], number> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};
export const entityFootprint = (entity: MapEntity): Point[] => {
  const n = sizeCells[entity.size];
  const cells: Point[] = [];
  for (let y = entity.y; y < entity.y + n; y++)
    for (let x = entity.x; x < entity.x + n; x++) cells.push({ x, y });
  return cells;
};
const key = ({ x, y }: Point) => `${x},${y}`;
const inBounds = (map: TacticalMap, p: Point) =>
  p.x >= 0 && p.y >= 0 && p.x < map.width && p.y < map.height;
const getEntity = (map: TacticalMap, id: string) => map.entities.find((e) => e.id === id);
const chebyshev = (a: Point, b: Point) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const terrainCost = (cell: Cell) =>
  cell.terrain === 'difficult' || cell.terrain === 'water' ? 2 : 1;

export function getDistance(a: MapEntity, b: MapEntity): number {
  let nearest = Infinity;
  for (const ac of entityFootprint(a))
    for (const bc of entityFootprint(b)) nearest = Math.min(nearest, chebyshev(ac, bc));
  return nearest * CELL_FEET;
}

/**
 * Inclusive, direction-independent Bresenham segment.  Canonicalising the endpoint
 * order fixes Bresenham's staircase tie-breaking so A→B and B→A see identical cells.
 * Callers intentionally discard the endpoints.
 */
export function bresenham(from: Point, to: Point): Point[] {
  if (from.x > to.x || (from.x === to.x && from.y > to.y)) return bresenham(to, from);
  const points: Point[] = [];
  let { x, y } = from;
  const dx = Math.abs(to.x - from.x),
    sx = from.x < to.x ? 1 : -1;
  const dy = -Math.abs(to.y - from.y),
    sy = from.y < to.y ? 1 : -1;
  let error = dx + dy;
  while (true) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
  return points;
}
function clearLine(map: TacticalMap, from: Point, to: Point): boolean {
  return bresenham(from, to)
    .slice(1, -1)
    .every(
      (p) => inBounds(map, p) && !map.cells[p.y][p.x].blocksSight && map.cells[p.y][p.x].cover < 3,
    );
}
export function checkLineOfSight(map: TacticalMap, fromId: string, toId: string): boolean {
  const from = getEntity(map, fromId),
    to = getEntity(map, toId);
  if (!from || !to) return false;
  return entityFootprint(from).some((a) => entityFootprint(to).some((b) => clearLine(map, a, b)));
}
/** Creatures never block sight; any creature, even gargantuan, grants cover 1 only. */
function entityAt(map: TacticalMap, p: Point, except: Set<string>): boolean {
  return map.entities.some(
    (e) => !except.has(e.id) && entityFootprint(e).some((c) => c.x === p.x && c.y === p.y),
  );
}
export function getCover(map: TacticalMap, fromId: string, toId: string): 0 | 1 | 2 | 3 {
  const from = getEntity(map, fromId),
    to = getEntity(map, toId);
  if (!from || !to) return 3;
  let best: 0 | 1 | 2 | 3 = 3;
  for (const a of entityFootprint(from))
    for (const b of entityFootprint(to)) {
      let cover: 0 | 1 | 2 | 3 = 0;
      let blocked = false;
      for (const p of bresenham(a, b).slice(1, -1)) {
        const cell = map.cells[p.y]?.[p.x];
        if (!cell) {
          blocked = true;
          break;
        }
        if (cell.blocksSight || cell.cover === 3) {
          blocked = true;
          break;
        }
        cover = Math.max(cover, cell.cover) as 0 | 1 | 2 | 3;
        if (entityAt(map, p, new Set([fromId, toId]))) cover = Math.max(cover, 1) as 0 | 1 | 2 | 3;
      }
      best = Math.min(best, blocked ? 3 : cover) as 0 | 1 | 2 | 3;
    }
  return best;
}

function center(p: Point) {
  return { x: p.x + 0.5, y: p.y + 0.5 };
}
export function isAoECell(cell: Point, shape: AoEShape, origin: Point, params: AoEParams): boolean {
  const length = (params.lengthFeet ?? params.radiusFeet ?? params.sizeFeet ?? 0) / CELL_FEET;
  // Bursts follow the engine's "every diagonal = 5ft" convention: Chebyshev, not Euclidean.
  if (shape === 'sphere') return chebyshev(cell, origin) <= (params.radiusFeet ?? 0) / CELL_FEET;
  if (shape === 'cube')
    return (
      Math.max(Math.abs(cell.x - origin.x), Math.abs(cell.y - origin.y)) <
      (params.sizeFeet ?? 0) / CELL_FEET
    );
  const d = params.direction;
  if (!d || (!d.x && !d.y)) return false;
  const c = center(cell),
    o = center(origin),
    vx = c.x - o.x,
    vy = c.y - o.y,
    mag = Math.hypot(vx, vy),
    dm = Math.hypot(d.x, d.y);
  if (mag > length + 0.0001 || mag === 0) return shape === 'cone';
  const dot = (vx * d.x + vy * d.y) / (mag * dm);
  if (shape === 'cone') return dot >= Math.cos((53 * Math.PI) / 180 / 2); // cell centre in a 53° cone
  const projection = (vx * d.x + vy * d.y) / dm;
  const perpendicular = Math.abs(vx * d.y - vy * d.x) / dm;
  return (
    projection >= 0 &&
    projection <= length &&
    perpendicular <= (params.widthFeet ?? CELL_FEET) / CELL_FEET / 2
  );
}

/**
 * The canonical template geometry.  Targeting and rendering both consume this
 * exact list so the highlighted cells cannot drift from the engine decision.
 */
export function getAoECells(
  map: TacticalMap,
  shape: AoEShape,
  origin: Point,
  params: AoEParams,
): Point[] {
  const cells: Point[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++)
      if (isAoECell({ x, y }, shape, origin, params)) cells.push({ x, y });
  return cells;
}

export function getAoETargets(
  map: TacticalMap,
  shape: AoEShape,
  origin: Point,
  params: AoEParams,
): AoETarget[] {
  const source = params.sourceEntityId ? getEntity(map, params.sourceEntityId) : undefined;
  const cells = new Set(getAoECells(map, shape, origin, params).map(key));
  return map.entities
    .filter((e) => entityFootprint(e).some((c) => cells.has(key(c))))
    .map((e) => ({ id: e.id, friendly: !!source && e.type === source.type }));
}

function canOccupy(
  map: TacticalMap,
  entity: MapEntity,
  x: number,
  y: number,
  ownId = entity.id,
): boolean {
  const n = sizeCells[entity.size];
  for (let cy = y; cy < y + n; cy++)
    for (let cx = x; cx < x + n; cx++) {
      const p = { x: cx, y: cy };
      if (
        !inBounds(map, p) ||
        map.cells[cy][cx].blocksMovement ||
        entityAt(map, p, new Set([ownId]))
      )
        return false;
    }
  return true;
}
function stepCost(map: TacticalMap, entity: MapEntity, x: number, y: number): number {
  const n = sizeCells[entity.size];
  let max = 1;
  for (let cy = y; cy < y + n; cy++)
    for (let cx = x; cx < x + n; cx++) max = Math.max(max, terrainCost(map.cells[cy][cx]));
  return max * CELL_FEET;
}
/** Diagonal movement (and LoS) through diagonal wall gaps is permitted; there is no corner-cutting rule. */
const neighbours = (p: Point) =>
  [-1, 0, 1]
    .flatMap((dy) => [-1, 0, 1].map((dx) => ({ x: p.x + dx, y: p.y + dy })))
    .filter((n) => n.x !== p.x || n.y !== p.y);

/** Weighted A*; diagonal steps are deliberately the same five-foot cost as orthogonal steps. */
export function findPath(
  map: TacticalMap,
  entityId: string,
  tx: number,
  ty: number,
): PathResult | null {
  const entity = getEntity(map, entityId);
  if (!entity || !canOccupy(map, entity, tx, ty) || !canOccupy(map, entity, entity.x, entity.y))
    return null;
  const start = { x: entity.x, y: entity.y },
    goal = { x: tx, y: ty };
  const open = [start];
  const came = new Map<string, Point>();
  const cost = new Map<string, number>([[key(start), 0]]);
  // ROT establishes topology-8 reachability. The weighted pass below is needed because
  // ROT's A* has no terrain-cost hook, while difficult cells cost two five-foot steps.
  const reachable: Point[] = [];
  new ROT.Path.AStar(goal.x, goal.y, (x, y) => canOccupy(map, entity, x, y), {
    topology: 8,
  }).compute(start.x, start.y, (x, y) => reachable.push({ x, y }));
  if (!reachable.some((p) => p.x === goal.x && p.y === goal.y)) return null;
  while (open.length) {
    open.sort(
      (a, b) =>
        cost.get(key(a))! +
        chebyshev(a, goal) * CELL_FEET -
        (cost.get(key(b))! + chebyshev(b, goal) * CELL_FEET),
    );
    const current = open.shift()!;
    if (key(current) === key(goal)) {
      const path: Point[] = [];
      let cursor: Point | undefined = current;
      while (cursor) {
        path.unshift(cursor);
        cursor = came.get(key(cursor));
      }
      return { path, costFeet: cost.get(key(current))! };
    }
    for (const next of neighbours(current)) {
      if (!canOccupy(map, entity, next.x, next.y)) continue;
      const nextCost = cost.get(key(current))! + stepCost(map, entity, next.x, next.y);
      if (nextCost < (cost.get(key(next)) ?? Infinity)) {
        cost.set(key(next), nextCost);
        came.set(key(next), current);
        if (!open.some((p) => key(p) === key(next))) open.push(next);
      }
    }
  }
  return null;
}
export function moveEntity(map: TacticalMap, entityId: string, tx: number, ty: number): MoveResult {
  const entity = getEntity(map, entityId);
  const path = entity && findPath(map, entityId, tx, ty);
  if (!entity || !path)
    return {
      success: false,
      reason: 'blocked',
      needsFeet: 0,
      hasFeet: entity?.movementRemaining ?? 0,
    };
  if (path.costFeet > entity.movementRemaining)
    return {
      success: false,
      reason: 'insufficient_movement',
      needsFeet: path.costFeet,
      hasFeet: entity.movementRemaining,
    };
  entity.x = tx;
  entity.y = ty;
  entity.movementRemaining -= path.costFeet;
  return { success: true, path: path.path, remainingFeet: entity.movementRemaining };
}
/** Forced movement ignores speed and opportunity attacks, but never crosses walls or creatures. */
export function forceMoveEntity(
  map: TacticalMap,
  targetId: string,
  mode: 'shove' | 'pull' | 'teleport',
  origin: Point | null,
  distanceFeet: number | null,
  destination: Point | null,
): MoveResult {
  const entity = getEntity(map, targetId);
  if (!entity) return { success: false, reason: 'blocked', needsFeet: 0, hasFeet: 0 };
  const target = destination;
  if (mode === 'teleport') {
    if (!target || !canOccupy(map, entity, target.x, target.y))
      return { success: false, reason: 'blocked', needsFeet: 0, hasFeet: 0 };
    const start = { x: entity.x, y: entity.y };
    entity.x = target.x;
    entity.y = target.y;
    return {
      success: true,
      path: [start, { x: entity.x, y: entity.y }],
      remainingFeet: entity.movementRemaining,
    };
  }
  if (!origin || !distanceFeet || distanceFeet % CELL_FEET !== 0)
    return { success: false, reason: 'blocked', needsFeet: 0, hasFeet: entity.movementRemaining };
  const dx = Math.sign(entity.x - origin.x),
    dy = Math.sign(entity.y - origin.y);
  if (!dx && !dy)
    return {
      success: false,
      reason: 'blocked',
      needsFeet: distanceFeet,
      hasFeet: entity.movementRemaining,
    };
  const direction = mode === 'shove' ? { x: dx, y: dy } : { x: -dx, y: -dy };
  const path = [{ x: entity.x, y: entity.y }];
  for (let step = 0; step < distanceFeet / CELL_FEET; step += 1) {
    const next = {
      x: path[path.length - 1].x + direction.x,
      y: path[path.length - 1].y + direction.y,
    };
    if (!canOccupy(map, entity, next.x, next.y)) break;
    path.push(next);
  }
  if (path.length === 1)
    return {
      success: false,
      reason: 'blocked',
      needsFeet: distanceFeet,
      hasFeet: entity.movementRemaining,
    };
  const final = path[path.length - 1];
  entity.x = final.x;
  entity.y = final.y;
  return { success: true, path, remainingFeet: entity.movementRemaining };
}
export function getValidMoves(map: TacticalMap, entityId: string): Point[] {
  const entity = getEntity(map, entityId);
  if (!entity) return [];
  const start = { x: entity.x, y: entity.y },
    costs = new Map<string, number>([[key(start), 0]]),
    queue = [start];
  while (queue.length) {
    queue.sort((a, b) => costs.get(key(a))! - costs.get(key(b))!);
    const current = queue.shift()!;
    for (const next of neighbours(current)) {
      if (!canOccupy(map, entity, next.x, next.y)) continue;
      const nextCost = costs.get(key(current))! + stepCost(map, entity, next.x, next.y);
      if (nextCost <= entity.movementRemaining && nextCost < (costs.get(key(next)) ?? Infinity)) {
        costs.set(key(next), nextCost);
        queue.push(next);
      }
    }
  }
  return [...costs.keys()].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x, y };
  });
}
export function resetMovement(map: TacticalMap, entityId: string): boolean {
  const entity = getEntity(map, entityId);
  if (!entity) return false;
  entity.movementRemaining = entity.speedFeet;
  return true;
}
export function placeEntity(map: TacticalMap, entity: MapEntity): boolean {
  if (getEntity(map, entity.id) || !canOccupy(map, entity, entity.x, entity.y)) return false;
  map.entities.push(entity);
  return true;
}
export function removeEntity(map: TacticalMap, entityId: string): boolean {
  const i = map.entities.findIndex((e) => e.id === entityId);
  if (i < 0) return false;
  map.entities.splice(i, 1);
  return true;
}
export function updateCell(map: TacticalMap, x: number, y: number, patch: Partial<Cell>): boolean {
  if (!inBounds(map, { x, y })) return false;
  map.cells[y][x] = { ...map.cells[y][x], ...patch };
  return true;
}
