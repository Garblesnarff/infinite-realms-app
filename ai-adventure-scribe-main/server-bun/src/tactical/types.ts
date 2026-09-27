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

/**
 * `id` deliberately remains a string: it is a CombatParticipant.id in CM-2, and it never
 * leaves the server. `slug` is the stable LLM-facing name assigned at placement; it is what
 * the ASCII map legend, the tactical digest, and every DM map action speak in.
 */
export interface MapEntity {
  id: string;
  slug?: string;
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
  /**
   * Things the engine did on the DM's behalf that it must narrate accurately — an attacker
   * that walked but could not reach, most of all. Consumed by the next context request.
   */
  pendingDmFacts?: string[];
  /**
   * Structured sibling of `pendingDmFacts`: the discrete actions the engine resolved this
   * turn (kind, actor, target, hit/miss), recorded alongside their narration sentence.
   * The narration contract is built from these, and the client post-check validates the
   * DM's prose against them. Recorded for #2236 after run M4's invented Dash and run 10's
   * "flurry of strikes" for a single attack roll: free-text facts cannot be validated
   * deterministically, so the contract needs a typed channel of its own.
   */
  pendingDmFactActions?: DmFactAction[];
  /**
   * How many consecutive DM contexts have been built with nothing for the engine to report.
   * Zero means something resolved last turn. It climbs only while combat is active and the
   * board is standing still, which is the measurable form of "the DM is narrating attacks that
   * never reach the engine" — the run 9 failure, counted rather than inferred.
   */
  dmSilentTurns?: number;
}

/**
 * One discrete engine-resolved action, recorded for the narration contract (#2236).
 * The narration may describe exactly these actions and no others; the client post-check
 * rejects prose that names an action type absent from this list, denies the player's turn
 * when the contract says it is theirs, or uses success language for a miss.
 */
export interface DmFactAction {
  kind: 'attack' | 'spell' | 'move' | 'dash' | 'dodge' | 'disengage' | 'death_save';
  /** Engine slug of the actor (the tactical digest id). */
  actorSlug: string;
  actorIsPlayer: boolean;
  /** Engine slug of the target, when the action has one. */
  targetSlug?: string;
  /**
   * Whether the action succeeded, for actions the engine rolls or saves against.
   * Undefined for actions with no success/failure outcome (dash, dodge, disengage, move).
   */
  hit?: boolean;
  timestamp: number;
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
