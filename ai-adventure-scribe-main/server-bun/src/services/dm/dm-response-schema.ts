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
  origin?: Point | null;
  distance?: number | null;
  destination?: Point | null;
};

/**
 * Fields only relevant to some map action kinds are optional in the wire schema
 * (#633 PR 4): Anthropic structured output caps union-typed parameters at 16,
 * so rarely-used nullables are omitted instead of sent as explicit null. The
 * runtime validator treats an absent field like null.
 */
export type DMMapAction =
  | {
      action: 'move';
      entityId: string | null;
      x: number | null;
      y: number | null;
      changes: null;
      target?: string | null;
      mode?: ForcedMoveMode | null;
      origin?: Point | null;
      distance?: number | null;
      destination?: Point | null;
    }
  | {
      action: 'place';
      entityId: string | null;
      x: number | null;
      y: number | null;
      changes: MapEntity | null;
      target?: string | null;
      mode?: ForcedMoveMode | null;
      origin?: Point | null;
      distance?: number | null;
      destination?: Point | null;
    }
  | {
      action: 'remove';
      entityId: string | null;
      x: number | null;
      y: number | null;
      changes: null;
      target?: string | null;
      mode?: ForcedMoveMode | null;
      origin?: Point | null;
      distance?: number | null;
      destination?: Point | null;
    }
  | {
      action: 'update_cell';
      entityId: string | null;
      x: number | null;
      y: number | null;
      changes: Partial<Cell> | null;
      target?: string | null;
      mode?: ForcedMoveMode | null;
      origin?: Point | null;
      distance?: number | null;
      destination?: Point | null;
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
    | 'use_object'
    /**
     * #262: a typed yield/flee reaches the engine as the same intent the inline
     * option sends, so the DM can declare them in `combat_actions`.
     */
    | 'yield'
    | 'flee';
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
  /**
   * Non-lethal exits declared alongside `combat_transition: 'end'` (#2524): a hostile
   * still standing may leave the fight only as fled, surrendered or withdrew — never
   * as dead. Absent on envelopes that do not end combat.
   */
  combat_exits?: Array<{
    participant_id: string;
    exit: 'fled' | 'surrendered' | 'withdrew';
  }>;
  /**
   * XP the story awards the player's character this turn (#218 step 2): a challenge overcome
   * out of combat. The server adds it to the sheet once per player message; absent when
   * nothing is earned. Optional (never nullable) since #633 PR 4: Anthropic caps unions at 16.
   */
  xp_award?: { amount: number; reason: string };
  /**
   * Items the story grants or takes this turn (#218 step 3): found loot, spent supplies.
   * The server applies them to the inventory once per player message; absent when nothing
   * changes hands. Optional (never nullable) since #633 PR 4.
   */
  items?: Array<{ name: string; quantity: number; change: 'gain' | 'lose' }>;
  /**
   * Conditions the story applies or removes out of combat (#218 step 4). Names must be
   * 2014 5e conditions; the server validates them against the conditions library. The
   * server applies them to the sheet once per player message; absent when nothing
   * changes. Optional (never nullable) since #633 PR 4.
   */
  conditions?: Array<{
    name: string;
    change: 'apply' | 'remove';
    duration_minutes: number | null;
  }>;
  /**
   * A rest the story grants this turn (#264, #218 step 5): the DM narrates the party
   * resting and the server applies it through RestService — the same ruleset the
   * sheet's rest buttons use. A short rest spends no hit dice on its own (the player
   * spends them from the sheet); a long rest restores HP and regains half the hit
   * dice. The server applies it once per player message; absent when the story grants
   * no rest. Optional (never nullable) since #633 PR 4.
   */
  rest?: { type: 'short' | 'long' };
  /**
   * Damage the story deals the player's character this turn (#610, #218 step 6): a
   * failed check's consequence, a hazard, a trap — anything the narration says hurt
   * the character that the engine did not already resolve. The server subtracts it
   * from the sheet's hit points once per player message, through the same writer the
   * client damage route uses (`applyNonAttackDamage`); absent or null when the story
   * deals no damage.
   */
  damage?: { amount: number; source: string } | null;
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
    // #633 PR 4: forced-move-only fields are optional (omitted when unused) instead of
    // nullable — Anthropic structured output caps union-typed parameters at 16.
    // #633 PR 4 round 6: distance is required (Anthropic caps optional parameters
    // at 24); the model emits 0 when the action does not force-move anything.
    // The engine only reads distance for forced_move actions.
    target: { type: 'string' },
    mode: { type: 'string', enum: ['shove', 'pull', 'teleport'] },
    origin: pointSchema,
    distance: { type: 'number', minimum: 0 },
    destination: pointSchema,
  },
  required: ['action', 'entityId', 'x', 'y', 'changes', 'distance'],
} as const;

/**
 * #633 PR 4: flat combat action schema replacing the `oneOf:
 * [targetedCombatActionSchema, aoeCombatActionSchema]` union — Anthropic structured
 * output does not support `oneOf` at all. One object covers both shapes: targeted
 * actions set target_ids/weapon_id/movement_feet and omit origin; AoE cast_spell
 * actions set origin (the engine derives AoE targets itself) and emit empty
 * target_ids / 0 movement_feet as explicit defaults. The runtime `isCombatAction`
 * validator still discriminates on `action_type === 'cast_spell' && origin != null`.
 */
const combatActionSchema = {
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
        // #262: typed yield/flee are declared as combat actions, like dodge.
        'yield',
        'flee',
      ],
    },
    target_ids: { type: 'array', items: { type: 'string' } },
    weapon_id: nullable({ type: 'string' }),
    spell_id: nullable({ type: 'string' }),
    slot_level: nullable({ type: 'number' }),
    movement_feet: { type: 'number' },
    // Optional: present only on AoE cast_spell actions.
    origin: pointSchema,
    direction: nullable(pointSchema),
  },
  required: [
    'actor_id',
    'action_type',
    'target_ids',
    'weapon_id',
    'spell_id',
    'slot_level',
    'movement_feet',
    'direction',
  ],
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
        // #633 PR 4 round 6: required non-nullable (was nullable) — every segment
        // has a speaker; the model emits 'narrator' for dm/transition narration.
        // Anthropic structured output caps union-typed parameters at 16.
        character: {
          type: 'string',
          description: "Speaker name for 'character' segments; 'narrator' for dm/transition narration.",
        },
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
      // #633 PR 4: all fields required (no unions, no optionals) — when the model
      // emits a scene_spec it is generating a scene and provides every field.
      // `id`/`sessionId` were removed: the sanitizer always discards/replaces them.
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
      size: { type: 'string', enum: ['small', 'medium', 'large'] },
      sceneDescription: { type: 'string' },
      seed: { type: 'number' },
      enemyPlacement: { type: 'string', enum: ['ambush', 'guarding', 'formation'] },
    },
    required: ['environment', 'size', 'sceneDescription', 'seed', 'enemyPlacement'],
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
    items: combatActionSchema,
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

/** #2524: non-lethal exits the DM may declare with `combat_transition: 'end'`. Optional —
 *  a legal field in structured output, never a required one. */
const combatExitsProperty = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      participant_id: { type: 'string' },
      exit: { type: 'string', enum: ['fled', 'surrendered', 'withdrew'] },
    },
    required: ['participant_id', 'exit'],
  },
} as const;

/** #218 step 2: XP the story awards this turn. Optional and non-nullable (#633 PR 4). */
const xpAwardProperty = {
  type: 'object',
  additionalProperties: false,
  properties: { amount: { type: 'integer' }, reason: { type: 'string' } },
  required: ['amount', 'reason'],
} as const;

/** #218 step 3: items the story grants or takes this turn. Optional and non-nullable. */
const storyItemsProperty = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      quantity: { type: 'integer', minimum: 1 },
      change: { type: 'string', enum: ['gain', 'lose'] },
    },
    required: ['name', 'quantity', 'change'],
  },
  // #463: the model narrated pickups but left `items` null on 18 Hark rows, so the
  // writer never ran. Like #310's xp_award description, this tells the model when
  // to populate the field inside the structured-output contract.
  description:
    "#463 story items: when the story gives the player's character an item (found, gifted, " +
    'looted, purchased) or takes one away (spent, lost, stolen, broken), set this field to an ' +
    'array of `{"name": "<exact item name>", "quantity": <whole number>, "change": "gain"|"lose"}`. ' +
    "The game updates the character's Inventory; do not narrate receiving or losing an item " +
    'without setting the field. Otherwise omit it.',
} as const;

/** #218 step 4: conditions the story applies or removes out of combat. Optional and non-nullable. */
const storyConditionsProperty = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      change: { type: 'string', enum: ['apply', 'remove'] },
      // #633 PR 4: required+nullable (not optional) — explicit null for permanent
      // conditions keeps it out of the 24-optional budget; uses 1 union slot.
      duration_minutes: nullable({ type: 'integer', minimum: 1 }),
    },
    required: ['name', 'change', 'duration_minutes'],
  },
} as const;

/** #264: a rest the story grants this turn. Optional and non-nullable, like `combat_exits`. */
const storyRestProperty = {
  type: 'object',
  additionalProperties: false,
  properties: { type: { type: 'string', enum: ['short', 'long'] } },
  required: ['type'],
} as const;

/**
 * #610 (#218 step 6): damage the story deals the player's character this turn.
 * Optional and nullable.
 */
const storyDamageProperty = nullable({
  type: 'object',
  additionalProperties: false,
  properties: {
    amount: { type: 'integer', minimum: 1, maximum: 999 },
    source: { type: 'string', minLength: 1, maxLength: 120 },
  },
  required: ['amount', 'source'],
  // #610: the model narrated injury ("the rope burns", "dragged to the edge") with no
  // damage signal, so the writer never ran. Like #463's items description, this tells
  // the model when to populate the nullable field inside the structured-output contract.
  description:
    '#610 story damage: when the story hurts the player\'s character this turn (a failed ' +
    'check\'s consequence, a hazard, a trap — anything the engine did not already resolve), ' +
    'set this field to `{"amount": <whole number of hit points>, "source": "<short source, ' +
    'e.g. rope burn>"}` and narrate the hurt in `text`. The game subtracts the amount from ' +
    'the character\'s hit points and posts a damage line in chat; do not narrate the ' +
    'character being hurt or taking damage without setting this field (or requesting a ' +
    '`damage` roll when the amount should be rolled). Otherwise leave it null.',
});

export const dmResponseSchema = createDmResponseSchema({
  combat_exits: combatExitsProperty,
  xp_award: xpAwardProperty,
  items: storyItemsProperty,
  conditions: storyConditionsProperty,
  rest: storyRestProperty,
  damage: storyDamageProperty,
});

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
      // #633 PR 4: origin/destination/distance are optional (omitted when unused),
      // so absent counts like null here.
      (action.origin == null || isPoint(action.origin)) &&
      (action.destination == null || isPoint(action.destination)) &&
      (action.distance == null || (typeof action.distance === 'number' && action.distance >= 0))
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
  // #633 PR 4: the wire schema is flat (no oneOf). AoE is still discriminated the
  // same way: cast_spell with a present origin. target_ids is required by the flat
  // schema (empty array for AoE) but the engine derives AoE targets itself, so a
  // non-empty target_ids on an AoE intent is rejected — the LLM must not dictate
  // AoE membership.
  if (action.action_type === 'cast_spell' && action.origin != null) {
    return (
      typeof action.actor_id === 'string' &&
      typeof action.spell_id === 'string' &&
      isPoint(action.origin) &&
      (action.direction == null || isPoint(action.direction)) &&
      (action.slot_level == null || typeof action.slot_level === 'number') &&
      (action.target_ids === undefined ||
        (Array.isArray(action.target_ids) && action.target_ids.length === 0))
    );
  }
  return (
    typeof action.actor_id === 'string' &&
    typeof action.action_type === 'string' &&
    Array.isArray(action.target_ids) &&
    action.target_ids.every((target) => typeof target === 'string') &&
    // #633 PR 4: origin is optional in the flat schema; Gemini (less strict than
    // Haiku) may still emit explicit null, so accept both absent and null here.
    action.origin == null
  );
};

/**
 * Name of the first field of a handout action that breaks the contract, or
 * null when the action is valid. Returns a field NAME only, never a value:
 * the result ends up in a 422 body and in logs, and handout text is DM/player
 * content. `'action'` means the item is not an object at all.
 */
const invalidHandoutField = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return 'action';
  const action = value as Record<string, unknown>;
  if (!['authored', 'improvised'].includes(String(action.mode))) return 'mode';
  if (typeof action.title !== 'string') return 'title';
  if (typeof action.giver !== 'string') return 'giver';
  if (action.key !== null && typeof action.key !== 'string') return 'key';
  if (action.body !== null && typeof action.body !== 'string') return 'body';
  if (action.mode === 'authored') {
    if (typeof action.key !== 'string') return 'key';
    return action.body === null ? null : 'body';
  }
  if (action.key !== null) return 'key';
  return typeof action.body === 'string' ? null : 'body';
};

export const isHandoutAction = (value: unknown): value is DMHandoutAction =>
  invalidHandoutField(value) === null;

/** Issue text for the first invalid handout action: its index and field, never its content. */
const handoutActionsIssue = (actions: unknown): string | null => {
  if (!Array.isArray(actions)) return 'handout_actions must be an array';
  for (const [index, action] of actions.entries()) {
    const field = invalidHandoutField(action);
    if (field) return `handout_actions[${index}].${field} is invalid`;
  }
  return null;
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
  const handoutIssue = handoutActionsIssue(response.handout_actions);
  if (handoutIssue) return { success: false, issues: [handoutIssue] };
  if (!Array.isArray(response.combat_actions) || !response.combat_actions.every(isCombatAction))
    return { success: false, issues: ['combat_actions contains an invalid action'] };

  // #633 PR 4: the flat wire schema requires target_ids/movement_feet on every
  // action (empty/0 for AoE), but downstream discriminates AoE vs targeted with
  // `'target_ids' in action` (combat-resolution-step.ts, headless-game-client.ts).
  // Strip those keys from AoE intents so the parsed shape matches the
  // DMCombatAction union (DMAoESpellAction has neither field) and downstream
  // keeps working unchanged.
  for (const action of response.combat_actions as Record<string, unknown>[]) {
    if (action.action_type === 'cast_spell' && action.origin != null) {
      delete action.target_ids;
      delete action.movement_feet;
    }
  }

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
  // #633: a malformed segment (null entry, non-string character) throws inside
  // segment derivation. The reply is already saved, so keep the original text.
  try {
    const parsed = parseDmResponse(envelope);
    return parsed.success ? JSON.stringify(parsed.data) : originalText;
  } catch {
    return originalText;
  }
}
