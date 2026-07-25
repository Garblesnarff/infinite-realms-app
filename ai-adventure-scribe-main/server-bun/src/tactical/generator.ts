import ROT from 'rot-js';

import { entityFootprint, placeEntity } from './engine';
import { assignEntitySlugs } from './identity';

import type { Cell, MapEntity, Point, SceneSpec, TacticalMap } from './types';

const dims = { small: [10, 10], medium: [14, 12], large: [20, 16] } as const;
const floor = (): Cell => ({
  terrain: 'floor',
  blocksMovement: false,
  blocksSight: false,
  cover: 0,
  elevation: 0,
});
const wall = (): Cell => ({
  terrain: 'wall',
  blocksMovement: true,
  blocksSight: true,
  cover: 3,
  elevation: 0,
});
const feature = (terrain: Cell['terrain'], decoration?: string): Cell => ({
  terrain,
  blocksMovement: terrain === 'wall' || terrain === 'pit' || terrain === 'water',
  blocksSight: terrain === 'wall',
  cover: terrain === 'wall' ? 3 : terrain === 'obscured' ? 0 : 1,
  elevation: 0,
  decoration,
});
const table = (): Cell => ({
  terrain: 'difficult',
  blocksMovement: true,
  blocksSight: false,
  cover: 1,
  elevation: 0,
  decoration: 'table',
});
const tree = (): Cell => ({
  terrain: 'obscured',
  blocksMovement: true,
  blocksSight: true,
  cover: 1,
  elevation: 0,
  decoration: 'tree',
});
class Random {
  private state: number;
  constructor(seed: number) {
    this.state = seed || 1;
  }
  next() {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x100000000;
  }
  int(n: number) {
    return Math.floor(this.next() * n);
  }
}
const pointKey = (p: Point) => `${p.x},${p.y}`;

function reachable(map: TacticalMap, start: Point): Set<string> {
  const seen = new Set<string>(),
    queue = [start];
  while (queue.length) {
    const p = queue.shift()!;
    if (
      seen.has(pointKey(p)) ||
      p.x < 0 ||
      p.y < 0 ||
      p.x >= map.width ||
      p.y >= map.height ||
      map.cells[p.y][p.x].blocksMovement
    )
      continue;
    seen.add(pointKey(p));
    for (const dy of [-1, 0, 1])
      for (const dx of [-1, 0, 1]) if (dx || dy) queue.push({ x: p.x + dx, y: p.y + dy });
  }
  return seen;
}
function carveTo(map: TacticalMap, from: Point, to: Point) {
  let { x, y } = from;
  while (x !== to.x || y !== to.y) {
    map.cells[y][x] = floor();
    if (x !== to.x) x += Math.sign(to.x - x);
    if (y !== to.y) y += Math.sign(to.y - y);
  }
  map.cells[y][x] = floor();
}
function tacticalElements(map: TacticalMap) {
  return map.cells.flat().filter((c) => c.decoration || c.terrain !== 'floor').length;
}
function candidates(map: TacticalMap, entity: MapEntity, desired: Point, rng: Random): Point[] {
  const cells: Point[] = [];
  for (let y = 1; y < map.height - 1; y++)
    for (let x = 1; x < map.width - 1; x++) {
      const copy = { ...entity, x, y };
      if (
        entityFootprint(copy).every(
          (p) => map.cells[p.y]?.[p.x] && !map.cells[p.y][p.x].blocksMovement,
        )
      )
        cells.push({ x, y });
    }
  return cells.sort(
    (a, b) =>
      Math.max(Math.abs(a.x - desired.x), Math.abs(a.y - desired.y)) -
        Math.max(Math.abs(b.x - desired.x), Math.abs(b.y - desired.y)) || rng.next() - 0.5,
  );
}

/** Hybrid deterministic builder. The spec selects intent; all coordinates remain deterministic code. */
export function generateMap(spec: SceneSpec): TacticalMap {
  const [width, height] = dims[spec.size ?? 'medium'];
  const rng = new Random(spec.seed ?? 1);
  ROT.RNG.setSeed(spec.seed ?? 1);
  const map: TacticalMap = {
    id: spec.id ?? `tactical-${spec.seed ?? 1}`,
    sessionId: spec.sessionId ?? '',
    width,
    height,
    cells: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) =>
        x === 0 || y === 0 || x === width - 1 || y === height - 1 ? wall() : floor(),
      ),
    ),
    entities: [],
    round: 1,
    sceneDescription: spec.sceneDescription ?? spec.environment,
  };
  if (spec.environment === 'cave') {
    const cave = new ROT.Map.Cellular(width, height);
    cave.randomize(0.46);
    for (let i = 0; i < 5; i++) cave.create();
    cave.create((x, y, value) => {
      map.cells[y][x] = value ? wall() : floor();
    });
    map.cells[1][1] = floor();
  }
  const add = (x: number, y: number, c: Cell) => {
    if (x > 0 && y > 0 && x < width - 1 && y < height - 1) map.cells[y][x] = c;
  };
  const templates: Record<string, () => void> = {
    dungeon_room: () => {
      add(Math.floor(width / 2), Math.floor(height / 2), feature('wall', 'pillar'));
      add(2, 2, feature('difficult', 'rubble'));
    },
    tavern: () => {
      add(3, 3, table());
      add(4, 3, table());
      add(width - 4, height - 4, feature('difficult', 'barrel'));
    },
    forest_clearing: () => {
      add(3, 3, tree());
      add(width - 4, 3, tree());
      add(3, height - 4, feature('difficult', 'brush'));
    },
    road: () => {
      add(3, 3, tree());
      add(width - 4, height - 4, tree());
    },
    ruins: () => {
      add(3, 3, wall());
      add(width - 4, 3, wall());
      add(Math.floor(width / 2), height - 4, feature('difficult', 'rubble'));
    },
    ship_deck: () => {
      add(Math.floor(width / 2), 3, wall());
      add(3, height - 3, feature('difficult', 'crate'));
    },
    open_field: () => {
      add(3, 3, feature('difficult', 'boulder'));
      add(width - 4, height - 4, feature('difficult', 'boulder'));
    },
    corridor: () => {
      for (let y = 1; y < height - 1; y++)
        for (let x = 1; x < width - 1; x++)
          if (y !== Math.floor(height / 2) && y !== Math.floor(height / 2) - 1) add(x, y, wall());
      add(Math.floor(width / 2), Math.floor(height / 2), {
        ...floor(),
        terrain: 'door_closed',
        blocksMovement: true,
        blocksSight: true,
        cover: 3,
        decoration: 'door',
      });
    },
  };
  (templates[spec.environment] ?? templates.open_field)();
  const pcs = spec.pcEntities?.length
    ? spec.pcEntities
    : [
        {
          id: 'pc-1',
          x: 1,
          y: 1,
          size: 'medium',
          type: 'pc',
          speedFeet: 30,
          movementRemaining: 30,
        } as MapEntity,
      ];
  const enemies = spec.enemyEntities?.length
    ? spec.enemyEntities
    : [
        {
          id: 'monster-1',
          x: width - 2,
          y: height - 2,
          size: 'medium',
          type: 'monster',
          speedFeet: 30,
          movementRemaining: 30,
        } as MapEntity,
      ];
  // Slugs are minted over the whole roster at once: only here are duplicate names visible,
  // so three roaches become shadow-roach-1..3 rather than shadow-roach plus two suffixes.
  assignEntitySlugs([...pcs, ...enemies]);
  // Skipping occupied cells matters as much here as for enemies: every PC after the first
  // used to lose its placement silently and then be missing from the roster the DM addresses.
  for (const pc of pcs) {
    const positions = candidates(map, pc, { x: 1, y: 1 }, rng);
    const p = positions.find(
      (p) => !map.entities.some((e) => entityFootprint(e).some((c) => c.x === p.x && c.y === p.y)),
    );
    if (p) placeEntity(map, { ...pc, ...p });
  }
  const entry = map.entities[0] ? { x: map.entities[0].x, y: map.entities[0].y } : { x: 1, y: 1 };
  for (let i = 0; i < enemies.length; i++) {
    const desired =
      spec.enemyPlacement === 'formation'
        ? { x: width - 2 - i * 2, y: Math.floor(height / 2) }
        : spec.enemyPlacement === 'guarding'
          ? { x: Math.floor(width / 2) + i, y: Math.floor(height / 2) }
          : { x: width - 2 - i, y: height - 2 - i };
    const positions = candidates(map, enemies[i], desired, rng);
    const p = positions.find(
      (p) => !map.entities.some((e) => entityFootprint(e).some((c) => c.x === p.x && c.y === p.y)),
    );
    if (p) placeEntity(map, { ...enemies[i], ...p });
  }
  // Guarantee each enemy can be reached from entry, including cellular cave islands.
  for (const enemy of map.entities.filter((e) => e.type !== 'pc'))
    if (!reachable(map, entry).has(pointKey({ x: enemy.x, y: enemy.y })))
      carveTo(map, entry, { x: enemy.x, y: enemy.y });
  if (tacticalElements(map) < 2) {
    add(2, 2, feature('difficult', 'cover'));
    add(width - 3, height - 3, feature('difficult', 'cover'));
  }
  return map;
}

export function validateGeneratedMap(map: TacticalMap): {
  connected: boolean;
  tacticalElements: number;
  entitiesValid: boolean;
} {
  const entry = map.entities.find((e) => e.type === 'pc');
  const reach = entry ? reachable(map, { x: entry.x, y: entry.y }) : new Set<string>();
  return {
    connected: map.entities
      .filter((e) => e.type !== 'pc')
      .every((e) => reach.has(pointKey({ x: e.x, y: e.y }))),
    tacticalElements: tacticalElements(map),
    entitiesValid: map.entities.every((e) =>
      entityFootprint(e).every((p) => map.cells[p.y]?.[p.x] && !map.cells[p.y][p.x].blocksMovement),
    ),
  };
}
