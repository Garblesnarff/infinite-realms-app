/** Server-authoritative tactical map primitives. One cell is always five feet. */
export type TerrainType =
  | 'floor'
  | 'wall'
  | 'door_closed'
  | 'door_open'
  | 'difficult'
  | 'water'
  | 'pit'
  | 'obscured';
export type EntitySize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
export type TacticalEntityType = 'pc' | 'npc' | 'monster' | 'object';

export interface Cell {
  terrain: TerrainType;
  blocksMovement: boolean;
  blocksSight: boolean;
  cover: 0 | 1 | 2 | 3;
  elevation: number;
  decoration?: string;
}

/** `id` deliberately remains a string: it is a CombatParticipant.id in CM-2. */
export interface MapEntity {
  id: string;
  x: number;
  y: number;
  size: EntitySize;
  type: TacticalEntityType;
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
  cells: Cell[][];
  entities: MapEntity[];
  round: number;
  sceneDescription: string;
  /** One-shot correction fact consumed by the next DM tactical-context request. */
  pendingDmCorrection?: string;
}

export type Point = { x: number; y: number };
export type AoEShape = 'sphere' | 'cone' | 'line' | 'cube';
export interface AoEParams {
  radiusFeet?: number;
  lengthFeet?: number;
  widthFeet?: number;
  sizeFeet?: number;
  /** Compass/vector direction, e.g. {x: 1, y: -1}; required by cone and line. */
  direction?: Point;
  /** Determines the `friendly` result; normally the casting entity. */
  sourceEntityId?: string;
}
export interface AoETarget {
  id: string;
  friendly: boolean;
}
export interface PathResult {
  path: Point[];
  costFeet: number;
}
export type MoveRefusal = {
  success: false;
  reason: 'blocked' | 'insufficient_movement';
  needsFeet: number;
  hasFeet: number;
};
export type MoveResult = { success: true; path: Point[]; remainingFeet: number } | MoveRefusal;

export type SceneEnvironment =
  | 'dungeon_room'
  | 'cave'
  | 'tavern'
  | 'forest_clearing'
  | 'road'
  | 'ruins'
  | 'ship_deck'
  | 'open_field'
  | 'corridor';
export type SceneSize = 'small' | 'medium' | 'large';
export type EnemyPlacement = 'ambush' | 'guarding' | 'formation';
export interface SceneSpec {
  id?: string;
  sessionId?: string;
  environment: SceneEnvironment;
  size?: SceneSize;
  sceneDescription?: string;
  seed?: number;
  pcEntities?: MapEntity[];
  enemyEntities?: MapEntity[];
  enemyPlacement?: EnemyPlacement;
}
