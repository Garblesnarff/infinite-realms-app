/* eslint-disable max-lines */
/**
 * Canonical DM response contract.
 *
 * Keep this module runtime-neutral: it is imported by both the Bun server and
 * the browser bundle.  The strict OpenRouter schema, runtime parser, and
 * public TypeScript types intentionally live together so they cannot drift.
 */
import { deriveNarrationSegments } from './narration-segment-derivation.js';

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

export type DMAoESpellAction = {
  actor_id: string;
  action_type: 'cast_spell';
  spell_id: string;
  origin: Point;
  direction: Point | null;
  slot_level: number | null;
};

export type DMTargetedCombatAction = {
  actor_id: string;
  action_type:
    | 'attack'
    | 'cast_spell'
    | 'dash'
    | 'disengage'
    | 'dodge'
    | 'help'
    | 'hide'
    | 'ready'
    | 'use_object';
  target_ids: string[];
  weapon_id: string | null;
  spell_id: string | null;
  slot_level: number | null;
  movement_feet: number;
};

export type DMCombatAction = DMTargetedCombatAction | DMAoESpellAction;

/** A document delivery intent. Authored documents resolve against canon server-side. */
export type DMHandoutAction = {
  mode: 'authored' | 'improvised';
  key: string | null;
  title: string;
  body: string | null;
  giver: string;
};

/** Canonical labels the DM may emit for per-segment TTS. */
export const VOICE_CATEGORY_VALUES = [
  'narrator',
  'hero_male',
  'hero_female',
  'villain_male',
  'villain_female',
  'monster',
  'goblin',
  'merchant',
  'guard',
  'innkeeper',
  'elder',
  'child',
] as const;

export type VoiceCategory = (typeof VOICE_CATEGORY_VALUES)[number];

const VOICE_CATEGORY_SET = new Set<string>(VOICE_CATEGORY_VALUES);

/**
 * Legacy / free-text labels observed in production. Normalized to a
 * configured key so they never reach ElevenLabs as a category string.
 */
export const VOICE_CATEGORY_ALIASES: Record<string, VoiceCategory> = {
  dm: 'narrator',
  narrator: 'narrator',
  narrative: 'narrator',
  hero: 'hero_male',
  villain: 'villain_male',
  creature: 'monster',
  gruff: 'guard',
  calm: 'innkeeper',
  measured: 'innkeeper',
  nervous: 'merchant',
  breathless: 'goblin',
  high_pitched_fast_breathless: 'goblin',
};

export function normalizeVoiceCategory(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function getCanonicalVoiceCategory(category: string): VoiceCategory | undefined {
  if (typeof category !== 'string' || !category.trim()) {
    return undefined;
  }

  const normalized = normalizeVoiceCategory(category);
  const canonical = VOICE_CATEGORY_ALIASES[normalized] || normalized;
  return VOICE_CATEGORY_SET.has(canonical) ? (canonical as VoiceCategory) : undefined;
}

export type DMResponse = {
  text: string;
  options?: string[];
  narration_segments: Array<{
    type: 'dm' | 'character' | 'transition';
    text: string;
    character: string | null;
    voice_category: VoiceCategory | null;
  }>;
  roll_requests: Array<{
    type: 'check' | 'save' | 'attack' | 'damage' | 'initiative';
    formula: string;
    purpose: string;
    dc: number | null;
    ac: number | null;
    advantage: boolean;
    disadvantage: boolean;
  }>;
  combat_transition: 'none' | 'start' | 'end';
  scene_spec: Record<string, unknown> | null;
  map_actions: DMMapAction[];
  handout_actions: DMHandoutAction[];
  combatants: Array<{ monster_id: string; name: string; count: number }>;
  combat_actions: DMCombatAction[];
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

const targetedCombatActionSchema = {
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
} as const;

/** AoE target membership is always derived by the tactical engine, never the LLM. */
const aoeCombatActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    actor_id: { type: 'string' },
    action_type: { type: 'string', enum: ['cast_spell'] },
    spell_id: { type: 'string' },
    origin: pointSchema,
    direction: nullable(pointSchema),
    slot_level: nullable({ type: 'number' }),
  },
  required: ['actor_id', 'action_type', 'spell_id', 'origin', 'direction', 'slot_level'],
} as const;

const handoutActionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['authored', 'improvised'] },
    key: nullable({ type: 'string' }),
    title: { type: 'string' },
    body: nullable({ type: 'string' }),
    giver: { type: 'string' },
  },
  required: ['mode', 'key', 'title', 'body', 'giver'],
} as const;

const baseProperties = {
  text: { type: 'string' },
  options: { type: 'array', items: { type: 'string' } },
  narration_segments: {
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', enum: ['dm', 'character', 'transition'] },
        text: { type: 'string' },
        character: nullable({ type: 'string' }),
        voice_category: nullable({
          type: 'string',
          enum: [...VOICE_CATEGORY_VALUES],
        }),
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
        ac: nullable({ type: 'number' }),
        advantage: { type: 'boolean' },
        disadvantage: { type: 'boolean' },
      },
      required: ['type', 'formula', 'purpose', 'dc', 'ac', 'advantage', 'disadvantage'],
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
  handout_actions: { type: 'array', items: handoutActionSchema },
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
    items: { oneOf: [targetedCombatActionSchema, aoeCombatActionSchema] },
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

const isCombatAction = (value: unknown): value is DMCombatAction => {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  if (action.action_type === 'cast_spell' && 'origin' in action) {
    return (
      typeof action.actor_id === 'string' &&
      typeof action.spell_id === 'string' &&
      isPoint(action.origin) &&
      (action.direction === null || isPoint(action.direction)) &&
      (action.slot_level === null || typeof action.slot_level === 'number') &&
      !('target_ids' in action)
    );
  }
  return (
    typeof action.actor_id === 'string' &&
    typeof action.action_type === 'string' &&
    Array.isArray(action.target_ids) &&
    action.target_ids.every((target) => typeof target === 'string')
  );
};

const isHandoutAction = (value: unknown): value is DMHandoutAction => {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  if (!['authored', 'improvised'].includes(String(action.mode))) return false;
  if (typeof action.title !== 'string' || typeof action.giver !== 'string') return false;
  if (action.key !== null && typeof action.key !== 'string') return false;
  if (action.body !== null && typeof action.body !== 'string') return false;
  return action.mode === 'authored'
    ? typeof action.key === 'string' && action.body === null
    : action.key === null && typeof action.body === 'string';
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const QUOTED_DIALOGUE = /["“][^"”]+["”]/;

function speakerKey(segment: DMResponse['narration_segments'][number]): string {
  if (segment.type === 'dm' || segment.type === 'transition' || !segment.character) {
    return 'narrator';
  }
  const name = segment.character.trim().toLowerCase();
  if (!name || name === 'narrator' || name === 'dm') {
    return 'narrator';
  }
  return name;
}

/**
 * Mixed narration + quoted dialogue must be one segment per speaker.
 * Collapsed replies are flagged (logged) and still accepted.
 */
export function reviewNarrationSpeakerSplit(
  text: string,
  segments: DMResponse['narration_segments'],
): { distinctSpeakers: string[]; flagged: boolean } {
  const distinctSpeakers = [...new Set(segments.map(speakerKey))];
  const hasQuotedDialogue = QUOTED_DIALOGUE.test(text);
  const proseWithoutQuotes = text.replace(QUOTED_DIALOGUE, '').trim();
  const mixed = hasQuotedDialogue && proseWithoutQuotes.length > 0;
  return {
    distinctSpeakers,
    flagged: mixed && distinctSpeakers.length < 2,
  };
}

export function parseDmResponse(
  value: unknown,
): { success: true; data: DMResponse } | { success: false; issues: string[] } {
  if (!value || typeof value !== 'object')
    return { success: false, issues: ['response must be an object'] };
  const response = value as Record<string, unknown>;
  if (typeof response.text !== 'string')
    return { success: false, issues: ['text must be a string'] };
  if (response.options !== undefined && !isStringArray(response.options))
    return { success: false, issues: ['options must be an array of strings'] };
  if (!Array.isArray(response.map_actions) || !response.map_actions.every(isMapAction))
    return { success: false, issues: ['map_actions contains an invalid action'] };
  if (!Array.isArray(response.handout_actions) || !response.handout_actions.every(isHandoutAction))
    return { success: false, issues: ['handout_actions contains an invalid action'] };
  if (!Array.isArray(response.combat_actions) || !response.combat_actions.every(isCombatAction))
    return { success: false, issues: ['combat_actions contains an invalid action'] };

  if (Array.isArray(response.narration_segments)) {
    response.narration_segments = response.narration_segments.map((segment) => {
      if (!segment || typeof segment !== 'object') {
        return segment;
      }
      const raw = segment as { voice_category?: unknown };
      if (raw.voice_category == null || raw.voice_category === '') {
        return { ...raw, voice_category: null };
      }
      if (typeof raw.voice_category !== 'string') {
        return { ...raw, voice_category: null };
      }
      return {
        ...raw,
        voice_category: getCanonicalVoiceCategory(raw.voice_category) ?? null,
      };
    });
  }

  const parsed = response as DMResponse;
  if (typeof parsed.text === 'string') {
    const hints = Array.isArray(parsed.narration_segments) ? parsed.narration_segments : [];
    parsed.narration_segments = deriveNarrationSegments(
      parsed.text,
      hints,
      getCanonicalVoiceCategory,
    );
    const review = reviewNarrationSpeakerSplit(parsed.text, parsed.narration_segments);
    if (review.flagged) {
      console.warn('narration_segments collapsed mixed speakers into one voice', {
        distinctSpeakers: review.distinctSpeakers,
      });
    }
  }

  return { success: true, data: parsed };
}

/**
 * Strip code fences and parse a model completion into a plain object.
 * Returns null for the text-only dialect rather than throwing. (#2050 G)
 */
export function parseLlmEnvelope(text: string): Record<string, unknown> | null {
  try {
    const cleaned = text
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    const payload = JSON.parse(cleaned) as Record<string, unknown>;
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

/**
 * As `rewriteNarrationSegmentsInLlmText`, but for a payload the caller has
 * already parsed, so the route parses the completion once instead of twice.
 */
export function rewriteNarrationSegmentsFromEnvelope(
  envelope: Record<string, unknown> | null,
  originalText: string,
): string {
  if (!envelope || typeof envelope.text !== 'string') return originalText;
  const parsed = parseDmResponse(envelope);
  return parsed.success ? JSON.stringify(parsed.data) : originalText;
}

export function rewriteNarrationSegmentsInLlmText(text: string): string {
  return rewriteNarrationSegmentsFromEnvelope(parseLlmEnvelope(text), text);
}
