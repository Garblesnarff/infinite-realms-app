/**
 * Canonical DM response contract.
 *
 * Keep this module runtime-neutral: it is imported by both the Bun server and
 * the browser bundle.  The strict OpenRouter schema, runtime parser, and
 * public TypeScript types intentionally live together so they cannot drift.
 */
import type { Cell, MapEntity, Point } from '../../tactical/types.js';

export type ForcedMoveMode = 'shove' | 'pull' | 'teleport';
export type ForcedMoveAction = {
  action: 'forced_move';
  target: string;
  mode: ForcedMoveMode;
  origin: Point | null;
  distance: number | null;
  destination: Point | null;
};

export type DMMapAction =
  | { action: 'move'; entityId: string | null; x: number | null; y: number | null; changes: null }
  | {
      action: 'place';
      entityId: string | null;
      x: number | null;
      y: number | null;
      changes: MapEntity | null;
    }
  | { action: 'remove'; entityId: string | null; x: number | null; y: number | null; changes: null }
  | {
      action: 'update_cell';
      entityId: string | null;
      x: number | null;
      y: number | null;
      changes: Partial<Cell> | null;
    }
  | ForcedMoveAction;

export type DMResponse = {
  text: string;
  narration_segments: Array<{
    type: 'dm' | 'character' | 'transition';
    text: string;
    character: string | null;
    voice_category: string | null;
  }>;
  roll_requests: Array<{
    type: 'check' | 'save' | 'attack' | 'damage' | 'initiative';
    formula: string;
    purpose: string;
    dc: number | null;
    advantage: boolean;
    disadvantage: boolean;
  }>;
  combat_transition: 'none' | 'start' | 'end';
  scene_spec: Record<string, unknown> | null;
  map_actions: DMMapAction[];
  combatants: Array<{ monster_id: string; name: string; count: number }>;
  combat_actions: Array<Record<string, unknown>>;
};

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const pointSchema = {
  type: 'object',
  additionalProperties: false,
  properties: { x: { type: 'number' }, y: { type: 'number' } },
  required: ['x', 'y'],
} as const;
const changesSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    terrain: {
      type: 'string',
      enum: ['floor', 'wall', 'door_closed', 'door_open', 'difficult', 'water', 'pit', 'obscured'],
    },
    blocksMovement: { type: 'boolean' },
    blocksSight: { type: 'boolean' },
    cover: { type: 'number', enum: [0, 1, 2, 3] },
    elevation: { type: 'number' },
    decoration: { type: 'string' },
    id: { type: 'string' },
    name: { type: 'string' },
    size: { type: 'string', enum: ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] },
    type: { type: 'string', enum: ['pc', 'npc', 'monster', 'object'] },
    speedFeet: { type: 'number' },
    movementRemaining: { type: 'number' },
    isLiving: { type: 'boolean' },
  },
} as const;

const mapActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['move', 'place', 'remove', 'update_cell', 'forced_move'] },
    entityId: nullable({ type: 'string' }),
    x: nullable({ type: 'number' }),
    y: nullable({ type: 'number' }),
    changes: nullable(changesSchema),
    target: nullable({ type: 'string' }),
    mode: nullable({ type: 'string', enum: ['shove', 'pull', 'teleport'] }),
    origin: nullable(pointSchema),
    distance: nullable({ type: 'number', minimum: 0 }),
    destination: nullable(pointSchema),
  },
  required: [
    'action',
    'entityId',
    'x',
    'y',
    'changes',
    'target',
    'mode',
    'origin',
    'distance',
    'destination',
  ],
} as const;

const baseProperties = {
  text: { type: 'string' },
  narration_segments: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['dm', 'character', 'transition'] },
        text: { type: 'string' },
        character: nullable({ type: 'string' }),
        voice_category: nullable({ type: 'string' }),
      },
      required: ['type', 'text', 'character', 'voice_category'],
    },
  },
  roll_requests: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['check', 'save', 'attack', 'damage', 'initiative'] },
        formula: { type: 'string' },
        purpose: { type: 'string' },
        dc: nullable({ type: 'number' }),
        advantage: { type: 'boolean' },
        disadvantage: { type: 'boolean' },
      },
      required: ['type', 'formula', 'purpose', 'dc', 'advantage', 'disadvantage'],
    },
  },
  combat_transition: { type: 'string', enum: ['none', 'start', 'end'] },
  scene_spec: nullable({
    type: 'object',
    additionalProperties: false,
    properties: {
      id: nullable({ type: 'string' }),
      sessionId: nullable({ type: 'string' }),
      environment: {
        type: 'string',
        enum: [
          'dungeon_room',
          'cave',
          'tavern',
          'forest_clearing',
          'road',
          'ruins',
          'ship_deck',
          'open_field',
          'corridor',
        ],
      },
      size: { type: ['string', 'null'], enum: ['small', 'medium', 'large', null] },
      sceneDescription: nullable({ type: 'string' }),
      seed: nullable({ type: 'number' }),
      enemyPlacement: { type: ['string', 'null'], enum: ['ambush', 'guarding', 'formation', null] },
    },
    required: [
      'id',
      'sessionId',
      'environment',
      'size',
      'sceneDescription',
      'seed',
      'enemyPlacement',
    ],
  }),
  map_actions: { type: 'array', items: mapActionSchema },
  combatants: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        monster_id: { type: 'string' },
        name: { type: 'string' },
        count: { type: 'number' },
      },
      required: ['monster_id', 'name', 'count'],
    },
  },
  combat_actions: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        actor_id: { type: 'string' },
        action_type: {
          type: 'string',
          enum: [
            'attack',
            'cast_spell',
            'dash',
            'disengage',
            'dodge',
            'help',
            'hide',
            'ready',
            'use_object',
          ],
        },
        target_ids: { type: 'array', items: { type: 'string' } },
        weapon_id: nullable({ type: 'string' }),
        spell_id: nullable({ type: 'string' }),
        slot_level: nullable({ type: 'number' }),
        movement_feet: { type: 'number' },
      },
      required: [
        'actor_id',
        'action_type',
        'target_ids',
        'weapon_id',
        'spell_id',
        'slot_level',
        'movement_feet',
      ],
    },
  },
} as const;

/** Extension seam for #1492/#1493: add strict top-level fields without reshaping the base contract. */
export function createDmResponseSchema(
  extensionProperties: Record<string, unknown> = {},
  extensionRequired: string[] = [],
): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties: { ...baseProperties, ...extensionProperties },
    required: [...Object.keys(baseProperties), ...extensionRequired],
  };
}

export const dmResponseSchema = createDmResponseSchema();

const isPoint = (value: unknown): value is Point =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Point).x === 'number' &&
  typeof (value as Point).y === 'number';
const isMapAction = (value: unknown): value is DMMapAction => {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  if (!['move', 'place', 'remove', 'update_cell', 'forced_move'].includes(String(action.action)))
    return false;
  if (action.action === 'forced_move')
    return (
      typeof action.target === 'string' &&
      ['shove', 'pull', 'teleport'].includes(String(action.mode)) &&
      (action.origin === null || isPoint(action.origin)) &&
      (action.destination === null || isPoint(action.destination)) &&
      (action.distance === null || (typeof action.distance === 'number' && action.distance >= 0))
    );
  return (
    (action.entityId === null || typeof action.entityId === 'string') &&
    (action.x === null || typeof action.x === 'number') &&
    (action.y === null || typeof action.y === 'number')
  );
};

export function parseDmResponse(
  value: unknown,
): { success: true; data: DMResponse } | { success: false; issues: string[] } {
  if (!value || typeof value !== 'object')
    return { success: false, issues: ['response must be an object'] };
  const response = value as Record<string, unknown>;
  if (typeof response.text !== 'string')
    return { success: false, issues: ['text must be a string'] };
  if (!Array.isArray(response.map_actions) || !response.map_actions.every(isMapAction))
    return { success: false, issues: ['map_actions contains an invalid action'] };
  return { success: true, data: response as DMResponse };
}
