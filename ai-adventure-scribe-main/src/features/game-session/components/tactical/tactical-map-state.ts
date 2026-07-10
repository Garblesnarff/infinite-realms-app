export type Terrain = 'floor' | 'wall' | 'door_closed' | 'door_open' | 'difficult' | 'water' | 'pit' | 'obscured';
export type Point = { x: number; y: number };

export interface TacticalCell {
  terrain: Terrain;
  blocksMovement: boolean;
  blocksSight: boolean;
  cover: 0 | 1 | 2 | 3;
  elevation: number;
  decoration?: string;
}

export interface TacticalEntity {
  id: string;
  x: number;
  y: number;
  size: 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
  type: 'pc' | 'npc' | 'monster' | 'object';
  speedFeet: number;
  movementRemaining: number;
  name?: string;
  isLiving?: boolean;
}

export interface TacticalMap {
  id: string;
  sessionId: string;
  width: number;
  height: number;
  cells: TacticalCell[][];
  entities: TacticalEntity[];
  round: number;
  sceneDescription: string;
}

export type TacticalDelta =
  | { type: 'map_created'; map: TacticalMap }
  | { type: 'map_destroyed' }
  | { type: 'entity_moved'; entityId: string; path: Point[]; movementReset?: boolean }
  | { type: 'cell_updated'; x: number; y: number; changes?: Partial<TacticalCell>; cell?: Partial<TacticalCell> };

/** Pure websocket reducer: animation is kept separately so server state stays canonical. */
export function applyTacticalDelta(map: TacticalMap | null, delta: TacticalDelta): TacticalMap | null {
  if (delta.type === 'map_created') return delta.map;
  if (delta.type === 'map_destroyed' || !map) return delta.type === 'map_destroyed' ? null : map;
  if (delta.type === 'entity_moved') {
    const destination = delta.path.at(-1);
    if (!destination) return map;
    return { ...map, entities: map.entities.map((entity) => entity.id === delta.entityId ? { ...entity, ...destination } : entity) };
  }
  const changes = delta.changes ?? delta.cell ?? {};
  if (!map.cells[delta.y]?.[delta.x]) return map;
  return {
    ...map,
    cells: map.cells.map((row, y) => y === delta.y ? row.map((cell, x) => x === delta.x ? { ...cell, ...changes } : cell) : row),
  };
}

export const entityFootprint = (size: TacticalEntity['size']) => ({ tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 })[size];
