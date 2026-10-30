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

export type DMMapAction =
  | {
      action: 'move';
      entityId?: string | null;
      x?: number | null;
      y?: number | null;
      changes?: null;
    }
  | {
      action: 'place';
      entityId?: string | null;
      x?: number | null;
      y?: number | null;
      changes?: MapEntity | null;
    }
  | {
      action: 'remove';
      entityId?: string | null;
      x?: number | null;
      y?: number | null;
      changes?: null;
    }
  | {
      action: 'update_cell';
      entityId?: string | null;
      x?: number | null;
      y?: number | null;
      changes?: Partial<Cell> | null;
    }
  | ForcedMoveAction;

export type DMAoESpellAction = {
  actor_id: string;
  action_type: 'cast_spell';
  spell_id: string;
  origin: Point;
  direction: Point | null;
  slot_level?: number | null;
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
    | 'flee'
    /**
     * #975: the Fighter's short-rest features, declared like any other combat
     * action and resolved by the engine (tracked use, heal, extra action).
     */
    | 'second_wind'
    | 'action_surge';
  target_ids: string[];
  weapon_id?: string | null;
  spell_id?: string | null;
  slot_level?: number | null;
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
    character?: string | null;
    voice_category?: VoiceCategory | null;
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
  scene_spec?: Record<string, unknown> | null;
  map_actions: DMMapAction[];
  handout_actions: DMHandoutAction[];
  combatants: Array<{ monster_id: string; name: string; count: number }>;
  combat_actions: DMCombatAction[];
  /**
   * Non-lethal exits declared alongside `combat_transition: 'end'` (#2524): a hostile
   * still standing may leave the fight only as fled, surrendered or withdrew — never
   * as dead. #1258: populated exits also arrive on narrative turns — an `end`
   * rides with `combat_transition`, which the narrative phase keeps, and the exits
   * ride with the end declaration; the guard judges them when combat is active.
   * Absent on envelopes that declare no exits.
   */
  combat_exits?: Array<{
    participant_id: string;
    exit: 'fled' | 'surrendered' | 'withdrew';
  }>;
  /**
   * XP the story awards the player's character this turn (#218 step 2): a challenge overcome
   * out of combat. The server adds it to the sheet once per player message; absent or null
   * when nothing is earned.
   */
  xp_award?: { amount: number; reason: string } | null;
  /**
   * Items the story grants or takes this turn (#218 step 3): found loot, spent supplies.
   * The server applies them to the inventory once per player message; absent or null when
   * nothing changes hands.
   */
  items?: Array<{ name: string; quantity: number; change: 'gain' | 'lose' }> | null;
  /**
   * Conditions the story applies or removes out of combat (#218 step 4). Names must be
   * 2014 5e conditions; the server validates them against the conditions library. The
   * server applies them to the sheet once per player message; absent or null when nothing
   * changes.
   */
  conditions?: Array<{
    name: string;
    change: 'apply' | 'remove';
    duration_minutes?: number | null;
  }> | null;
  /**
   * A rest the story grants this turn (#264, #218 step 5): the DM narrates the party
   * resting and the server applies it through RestService — the same ruleset the
   * sheet's rest buttons use. A short rest spends no hit dice on its own (the player
   * spends them from the sheet); a long rest restores HP and regains half the hit
   * dice. The server applies it once per player message; absent or null when the
   * story grants no rest.
   */
  rest?: { type: 'short' | 'long' } | null;
  /**
   * Damage the story deals the player's character this turn (#610, #218 step 6): a
   * failed check's consequence, a hazard, a trap — anything the narration says hurt
   * the character that the engine did not already resolve. The server subtracts it
   * from the sheet's hit points once per player message, through the same writer the
   * client damage route uses (`applyNonAttackDamage`); absent or null when the story
   * deals no damage.
   */
  damage?: { amount: number; source: string } | null;
  /**
   * The campaign's ending, declared the turn its story completes (#1020): the
   * final beat has played, or a limit the campaign's rules define has been
   * reached (a story Clock that fills, a final choice taken). The server posts
   * the ending, marks the session complete and ends the adventure; the
   * completion XP rides in the same reply's `xp_award`. Absent or null while
   * story beats remain.
   */
  campaign_ending?: { summary: string } | null;
  /**
   * Story clock changes the story makes this turn (#1042): the campaign's
   * clock ticks (a node finished, a rest taken, a prowler escaped) or is set
   * (a rule that jumps the clock). The server applies them to the session's
   * stored tracker once per player message and enforces the clock's limit;
   * absent or null when no clock moves.
   */
  tracker_changes?: Array<{ name: string; delta?: number; set?: number }> | null;
  /**
   * #1062, SERVER-ATTACHED, never model-set: the session's stored story
   * trackers after this turn's tracker step (`{name, value, limit}` per
   * clock), attached by the /generate route for the client to render the
   * tracker line from. Deliberately absent from `dmResponseSchema` below
   * (schema budget, #782): the DM never sets it, and `parseDmResponse`
   * passes it through untouched.
   */
  story_trackers?: Array<{ name: string; value: number; limit: number }> | null;
  /**
   * The story reached its final beat this turn (#1042): the campaign's
   * final location or last beat has played, whether or not a story clock
   * filled. The server arms the ending-required state from it; the ending
   * itself is still declared through `campaign_ending`, on this turn or
   * the next. Absent or null while story beats remain.
   */
  final_beat_reached?: boolean | null;
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
    entityId: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    changes: changesSchema,
    target: { type: 'string', description: "Required when action is 'forced_move'." },
    mode: {
      type: 'string',
      enum: ['shove', 'pull', 'teleport'],
      description: "Required when action is 'forced_move'.",
    },
    origin: pointSchema,
    distance: { type: 'number', minimum: 0 },
    destination: pointSchema,
  },
  required: ['action'],
} as const;

/**
 * #782 item 8, tactical kind-split: one variant per map action kind, each
 * carrying only its kind's fields, required where the engine needs them to
 * apply the action (tactical/dispatch.ts) — not merely where the lenient
 * isMapAction parser checks them. The update_cell `changes` patch bag remains
 * sparse, while place carries a complete MapEntity shape. These phase-only
 * shapes are narrower than the full/live schema, which stays unchanged.
 * Deliberate narrowings vs the single schema, all for fields dispatch
 * ignores on that kind (shadow week adjudicates): move with a Cell bag in
 * `changes`; remove with x/y/changes; update_cell with entityId; place with
 * entityId/x/y. forced_move keeps origin/distance/destination optional
 * because the mode decides which are needed (teleport needs destination,
 * shove/pull need origin + distance — engine.ts forceMoveEntity), so no
 * single required-set is honest there.
 */
const mapActionMoveVariantSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['move'] },
    entityId: { type: 'string' },
    x: { type: 'number' },
    y: { type: 'number' },
    // Real replies send changes:null on moves (cli/fixtures/combat-movement.json).
    changes: { type: 'null' },
  },
  required: ['action', 'entityId', 'x', 'y'],
} as const;

const mapActionPlaceVariantSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['place'] },
    // A placement is a complete MapEntity, not a cell patch.  Keep the shadow
    // shape to the fields placeEntity actually consumes; the full/live schema
    // above remains unchanged for the provider and lenient parser.
    changes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        size: { type: 'string', enum: ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'] },
        type: { type: 'string', enum: ['pc', 'npc', 'monster', 'object'] },
        speedFeet: { type: 'number' },
        movementRemaining: { type: 'number' },
        name: { type: 'string' },
        isLiving: { type: 'boolean' },
      },
      required: ['id', 'x', 'y', 'size', 'type', 'speedFeet', 'movementRemaining'],
    },
  },
  required: ['action', 'changes'],
} as const;

const mapActionRemoveVariantSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['remove'] },
    entityId: { type: 'string' },
  },
  required: ['action', 'entityId'],
} as const;

const mapActionUpdateCellVariantSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['update_cell'] },
    x: { type: 'number' },
    y: { type: 'number' },
    // updateCell applies a Partial<Cell>; entity-only fields are ignored on
    // this path and should not consume strict-schema optional budget.
    changes: {
      type: 'object',
      additionalProperties: false,
      properties: {
        terrain: {
          type: 'string',
          enum: [
            'floor',
            'wall',
            'door_closed',
            'door_open',
            'difficult',
            'water',
            'pit',
            'obscured',
          ],
        },
        blocksMovement: { type: 'boolean' },
        blocksSight: { type: 'boolean' },
        cover: { type: 'number', enum: [0, 1, 2, 3] },
        elevation: { type: 'number' },
        decoration: { type: 'string' },
      },
    },
  },
  required: ['action', 'x', 'y', 'changes'],
} as const;

const mapActionForcedMoveVariantSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', enum: ['forced_move'] },
    target: { type: 'string', description: "Required when action is 'forced_move'." },
    mode: {
      type: 'string',
      enum: ['shove', 'pull', 'teleport'],
      description: "Required when action is 'forced_move'.",
    },
    origin: pointSchema,
    distance: { type: 'number', minimum: 0 },
    destination: pointSchema,
  },
  required: ['action', 'target', 'mode'],
} as const;

const tacticalMapActionsSchema = {
  type: 'array',
  items: {
    anyOf: [
      mapActionMoveVariantSchema,
      mapActionPlaceVariantSchema,
      mapActionRemoveVariantSchema,
      mapActionUpdateCellVariantSchema,
      mapActionForcedMoveVariantSchema,
    ],
  },
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
        // #262: typed yield/flee are declared as combat actions, like dodge.
        'yield',
        'flee',
        // #975: the Fighter's short-rest features.
        'second_wind',
        'action_surge',
      ],
    },
    target_ids: { type: 'array', items: { type: 'string' } },
    weapon_id: { type: 'string' },
    spell_id: { type: 'string' },
    slot_level: { type: 'number' },
    movement_feet: { type: 'number' },
  },
  required: ['actor_id', 'action_type', 'target_ids', 'movement_feet'],
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
    slot_level: { type: 'number' },
  },
  required: ['actor_id', 'action_type', 'spell_id', 'origin', 'direction'],
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
        character: { type: 'string' },
        voice_category: {
          type: 'string',
          enum: [...VOICE_CATEGORY_VALUES],
        },
      },
      required: ['type', 'text'],
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
  scene_spec: {
    type: 'object',
    additionalProperties: false,
    properties: {
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
      seed: nullable({ type: 'number' }),
      enemyPlacement: { type: 'string', enum: ['ambush', 'guarding', 'formation'] },
    },
    required: ['environment', 'seed'],
  },
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
    // #782 item 8: anyOf, not oneOf. The two variants are disjoint — a targeted
    // action requires target_ids/movement_feet (which the AoE schema forbids),
    // an AoE action requires origin (which the targeted schema forbids) — so
    // anyOf accepts exactly the same actions oneOf did.
    items: { anyOf: [targetedCombatActionSchema, aoeCombatActionSchema] },
  },
} as const;

/**
 * #782 item 8: per-phase DM reply schemas. `full` is today's single live
 * schema (every base property + every extension). The three phases are
 * strict subsets, chosen by the route from session state it already trusts:
 * narrative keeps the entry fields and the story extensions; combat keeps
 * the fight fields plus the scene declaration (a `start` can land on a
 * fight turn) and drops the map surface; tactical is the combat set plus
 * the kind-split map actions. #1258: combat_exits is a narrative field too
 * (the 10-28 nightly carried populated exits on narrative turns — an `end`
 * rides with `combat_transition`, which narrative keeps, and the exits ride
 * with the end declaration; the guard judges them when combat is active),
 * and rest, damage and
 * final_beat_reached ride on fight turns as well (the route's tracker step
 * arms the ending from a final-beat flag on a combat turn, the damage
 * applier gates on inCombat and nulls what it does not apply, and the rest
 * applier gates on inCombat and skips — the phase schema must not reject
 * a reply the route handles).
 * The extensions that stay narrative-only (xp_award, items, conditions,
 * campaign_ending, tracker_changes) are the ones with no fight-turn
 * evidence and no fight-turn consumer.
 */
export const DM_RESPONSE_PHASES = ['narrative', 'combat', 'tactical', 'full'] as const;
export type DmResponsePhase = (typeof DM_RESPONSE_PHASES)[number];

const NARRATIVE_BASE_KEYS = [
  'text',
  'options',
  'narration_segments',
  'roll_requests',
  'combat_transition',
  'scene_spec',
  'combatants',
  'handout_actions',
] as const;

const COMBAT_BASE_KEYS = [
  'text',
  'options',
  'narration_segments',
  'roll_requests',
  'combat_transition',
  // #1258: a `start` can land on a fight turn (half-transition), and the
  // prompt requires scene_spec with it — the reply is legitimate there
  // even when a live encounter means the gate seats nothing new.
  'scene_spec',
  'combatants',
  'handout_actions',
  'combat_actions',
] as const;

const TACTICAL_BASE_KEYS = [...COMBAT_BASE_KEYS, 'map_actions'] as const;

function basePropertiesForPhase(phase: DmResponsePhase): Record<string, unknown> {
  if (phase === 'full') return baseProperties as unknown as Record<string, unknown>;
  const keys =
    phase === 'narrative'
      ? NARRATIVE_BASE_KEYS
      : phase === 'combat'
        ? COMBAT_BASE_KEYS
        : TACTICAL_BASE_KEYS;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    picked[key] =
      key === 'map_actions' && phase === 'tactical'
        ? tacticalMapActionsSchema
        : (baseProperties as unknown as Record<string, unknown>)[key];
  }
  return picked;
}

/**
 * Extension phase declarations for the seam: an extension declares its
 * phases at registration and defaults to ALL phases, so in-flight extension
 * work is never silently narrowed by a phase it did not consider.
 */
export type DmResponseExtensionPhases = Partial<Record<string, DmResponsePhase[]>>;

function extensionAppliesToPhase(
  declared: DmResponsePhase[] | undefined,
  phase: DmResponsePhase,
): boolean {
  if (phase === 'full') return true;
  if (!declared) return true;
  return declared.includes(phase);
}

/** Extension seam for #1492/#1493: add strict top-level fields without reshaping the base contract. */
export function createDmResponseSchema(
  extensionProperties: Record<string, unknown> = {},
  extensionRequired: string[] = [],
  options: { phase?: DmResponsePhase; extensionPhases?: DmResponseExtensionPhases } = {},
): Record<string, unknown> {
  const phase = options.phase ?? 'full';
  const base = basePropertiesForPhase(phase);
  const properties: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extensionProperties)) {
    if (!extensionAppliesToPhase(options.extensionPhases?.[key], phase)) continue;
    properties[key] = value;
  }
  const required = [
    // #782 item 7: scene_spec is a plain optional — the model omits it on
    // turns that do not start combat; every other base property stays required.
    ...Object.keys(base).filter((key) => key !== 'scene_spec'),
    // A dropped extension must not leave its name in `required`.
    ...extensionRequired.filter((key) => key in properties),
  ];
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required,
  };
}

/** #2524: non-lethal exits the DM may declare with `combat_transition: 'end'`. Optional
 * in the live schema — a legal field in structured output, never a required one there.
 * The fight-phase shadow schemas declare it required + nullable (#1258 round 3);
 * the shadow treats an absent key as null. */
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

/** #218 step 2: XP the story awards this turn. Optional, like `combat_exits`. */
const xpAwardProperty = {
  type: 'object',
  additionalProperties: false,
  properties: { amount: { type: 'integer' }, reason: { type: 'string' } },
  required: ['amount', 'reason'],
  description:
    '#310 story-win XP: when the party achieves a story win or milestone out of combat — ' +
    'solves the mystery, completes the objective, turns the arc — award XP here. The game ' +
    'adds it to the sheet and posts it in chat; state the award in your narration too. ' +
    'Never use for combat victories: the game awards those itself.',
};

/** #218 step 3: items the story grants or takes this turn. Optional. */
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
};

/** #218 step 4: conditions the story applies or removes out of combat. Optional. */
const storyConditionsProperty = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      change: { type: 'string', enum: ['apply', 'remove'] },
      duration_minutes: { type: 'integer', minimum: 1 },
    },
    required: ['name', 'change'],
  },
};

/** #264: a rest the story grants this turn. Optional, like `combat_exits`. */
const storyRestProperty = {
  type: 'object',
  additionalProperties: false,
  properties: { type: { type: 'string', enum: ['short', 'long'] } },
  required: ['type'],
};

/**
 * #610 (#218 step 6): damage the story deals the player's character this turn.
 * Optional.
 */
const storyDamageProperty = {
  type: 'object',
  additionalProperties: false,
  properties: {
    amount: { type: 'integer', minimum: 1, maximum: 999 },
    source: { type: 'string', minLength: 1, maxLength: 120 },
  },
  required: ['amount', 'source'],
  // #610: the model narrated injury ("the rope burns", "dragged to the edge") with no
  // damage signal, so the writer never ran. Like #463's items description, this tells
  // the model when to populate the field inside the structured-output contract.
  description:
    "#610 story damage: when the story hurts the player's character this turn (a failed " +
    "check's consequence, a hazard, a trap — anything the engine did not already resolve), " +
    'set this field to `{"amount": <whole number of hit points>, "source": "<short source, ' +
    'e.g. rope burn>"}` and narrate the hurt in `text`. The game subtracts the amount from ' +
    "the character's hit points and posts a damage line in chat; do not narrate the " +
    'character being hurt or taking damage without setting this field (or requesting a ' +
    '`damage` roll when the amount should be rolled). Otherwise omit it.',
};

/**
 * #1020: the campaign's ending, declared the turn its story completes. Optional,
 * like the other story fields. Before this field existed nobody owned the
 * ending in code: the campaign's rules reached the DM only as prompt prose, so
 * a one-shot whose Clock filled just kept improvising (Hark G22-008/016) — no
 * ending row, no completion state, no completion XP, and the ending narration
 * itself was eaten by the client's narration gate for claiming consequences no
 * engine event backed.
 */
const campaignEndingProperty = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
  },
  required: ['summary'],
  description:
    "#1020 campaign ending: when the campaign's story is complete — its final beat has " +
    'played, or a limit its rules define has been reached (a story Clock that fills, the ' +
    'final choice taken) — set this field to `{"summary": "<one or two sentences: how the ' +
    'story ended>"}` and narrate the ending in `text`. The game posts the ending, marks ' +
    'the session complete and ends the adventure; put the completion XP in `xp_award` in ' +
    'the same reply. Set it only for the ending itself: never while story beats remain, ' +
    'never for a scene or combat ending, and never for the end of a session when the ' +
    "campaign's story continues in a later session. Otherwise omit it.",
};

/**
 * #1042: story clock changes. Optional, like the other story fields. Before
 * this field the campaign's Clock lived only in the DM's prose: the server
 * stored no clock state, so a filled Clock changed nothing in the engine
 * (the #1020 ending needed the DM to notice and declare it). The server now
 * stores each clock per session and enforces its limit — the climax, or the
 * ending, depending on the campaign's rules.
 */
const trackerChangesProperty = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      name: { type: 'string' },
      delta: { type: 'integer' },
      set: { type: 'integer' },
    },
    required: ['name'],
  },
  description:
    "#1042 story clocks: when the story advances one of the campaign's clocks this turn " +
    "(the tick events the campaign's rules and the <story_clock> state name: a node " +
    'finished, a rest taken, a creature escaped, time lingered), set this field to an ' +
    'array of `{"name": "<clock name>", "delta": <segments>}` — or `{"name": "<clock ' +
    'name>", "set": <segments>}` when a rule sets the clock to a value. The game stores ' +
    'the clock and enforces its limit; the values in <story_clock> are the stored truth, ' +
    'never your own count. The game UI shows the tracker line from them (#1062), so do ' +
    'NOT render a tracker line in your prose. If this reply asks ' +
    "for a roll, the changes land on the roll's result turn — send them again there. " +
    'Otherwise omit it.',
};

/**
 * #1042 final beat: the turn the story reaches the campaign's final beat.
 * Before this field the ending machinery armed only from clock state, so
 * a run whose climax resolved in prose with the Clock at 1/6 (Hark
 * N23-003) had no trigger: the DM narrated past the final beat and never
 * declared the ending. The flag is the DM's one-bit judgment that the
 * final beat has played; the server turns it into the ending-required
 * state, and the safety net behind that state ends the adventure even if
 * `campaign_ending` is never declared.
 */
const finalBeatReachedProperty = {
  type: 'boolean',
  description:
    "#1042 final beat: when this turn plays the campaign's final beat — the story " +
    'reaches the final location or last beat its rules describe — set this to true, ' +
    'even when no story clock has filled. The game then requires the ending on the ' +
    'next turn and ends the adventure if it is still not declared. Set it only for ' +
    'the final beat itself, never while story beats remain. If this reply asks for ' +
    'a roll, send it again on the result turn. Otherwise omit it.',
};

/** The live extension set, shared by the full schema and every phase schema. */
const liveExtensionProperties = {
  combat_exits: combatExitsProperty,
  xp_award: xpAwardProperty,
  items: storyItemsProperty,
  conditions: storyConditionsProperty,
  rest: storyRestProperty,
  damage: storyDamageProperty,
  campaign_ending: campaignEndingProperty,
  tracker_changes: trackerChangesProperty,
  final_beat_reached: finalBeatReachedProperty,
};

/**
 * Phase declarations for the live extensions. Most story extensions stay
 * narrative-only because the route's own behaviour makes them so: the
 * story appliers in llm.ts refuse to run when dmReply.inCombat, so
 * carrying XP, items, conditions, campaign ending or tracker changes on
 * a combat turn would invite the model to emit fields the engine ignores.
 * #1258 corrects four declarations the 10-28 nightly disproved. Rest and
 * damage ride on fight turns too: the appliers gate on inCombat and the
 * route nulls unapplied damage and skips unapplied rest, so the phase
 * schema must not reject a reply the route handles. Final_beat_reached
 * does as well:
 * the tracker step arms the ending-required state from the flag on a
 * combat turn ("a climax spent fighting is still a climax"). And
 * combat_exits is a narrative field too: the nightly carried populated
 * exits on narrative turns, an `end` rides with `combat_transition`
 * (which narrative keeps), and the exits ride with the end declaration;
 * the guard judges them when combat is active. A future extension with no declaration defaults to all
 * phases, so in-flight extension work is never silently narrowed.
 */
const liveExtensionPhases: DmResponseExtensionPhases = {
  combat_exits: ['narrative', 'combat', 'tactical'],
  xp_award: ['narrative'],
  items: ['narrative'],
  conditions: ['narrative'],
  rest: ['narrative', 'combat', 'tactical'],
  damage: ['narrative', 'combat', 'tactical'],
  campaign_ending: ['narrative'],
  tracker_changes: ['narrative'],
  final_beat_reached: ['narrative', 'combat', 'tactical'],
};

export const dmResponseSchema = createDmResponseSchema(liveExtensionProperties);

/**
 * #1258 round 3 (strategist FIX at 774c634b), refined by #1265: the fight-phase shadow schemas
 * declare the five #1258 keys required + nullable instead of optional, so the
 * tactical phase fits the 24-optional strict budget (serialized 36 -> 18;
 * unions 8 -> 16, still within the 16 cap) without narrowing what the shadow
 * accepts. The live schema sent to the provider is untouched — the wrappers and the
 * scene_spec clone below exist only on the combat/tactical phase objects,
 * and the narrative phase keeps the round-1 shape (18 optionals, already
 * within budget). The shadow treats an absent required-nullable key as null
 * (see findPhaseShadowMismatch), which matches the route: the story appliers
 * skip absent fields exactly as they skip null ones. Precedent for the shape:
 * scene_spec's own `seed` is already required + nullable in the live schema.
 * The clone's nested required keys are safe for the same reason — the
 * combat-entry gate sanitizes partial scene_specs with defaults, so a start
 * turn carrying only environment + seed is a real shape, and the shadow pads
 * the missing descriptive fields rather than flagging them.
 */
const FIGHT_PHASE_REQUIRED_NULLABLE = [
  'scene_spec',
  'combat_exits',
  'rest',
  'damage',
  'final_beat_reached',
] as const;

/**
 * Phase-scoped scene_spec: the live value shape, with the three descriptive
 * fields required + nullable (null when the start turn does not describe
 * them). Built once and shared by both fight phases; the live property
 * object is never mutated, so the live schema stays byte-identical.
 */
const fightSceneSpecSchema: Record<string, unknown> = (() => {
  const live = (
    baseProperties as unknown as {
      scene_spec: Record<string, unknown>;
    }
  ).scene_spec;
  const props = live['properties'] as Record<string, Record<string, unknown>>;
  return {
    ...live,
    properties: {
      ...props,
      size: nullable(props['size']),
      sceneDescription: nullable(props['sceneDescription']),
      enemyPlacement: nullable(props['enemyPlacement']),
    },
    required: ['environment', 'seed', 'size', 'sceneDescription', 'enemyPlacement'],
  };
})();

/**
 * Strict-fit shape for a fight-phase schema: wrap the four #1258 extension
 * values in the null pad, swap in the phase-scoped scene_spec, and require
 * all five keys. Returns a fresh top-level object; the input schema and the
 * shared live property objects are never mutated.
 */
function strictFitFightPhaseSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const properties = {
    ...(schema['properties'] as Record<string, unknown>),
  };
  for (const key of ['combat_exits', 'rest', 'damage', 'final_beat_reached']) {
    properties[key] = nullable(properties[key] as Record<string, unknown>);
  }
  // The scene_spec clone is wrapped too: the key is required, so its schema
  // must accept the null the shadow pads an absent key with.
  properties['scene_spec'] = nullable(fightSceneSpecSchema);
  return {
    ...schema,
    properties,
    required: [...(schema['required'] as string[]), ...FIGHT_PHASE_REQUIRED_NULLABLE],
  };
}

const phaseSchemaCache = new Map<DmResponsePhase, Record<string, unknown>>();

/**
 * #782 item 8: the per-phase schema for a phase, built from the live
 * extension set through the same builder as the full schema. Cached per
 * phase (one object per process, like dmResponseSchema) so the provider's
 * validator cache compiles each variant once. Combat and tactical get the
 * #1258 round-3 strict-fit shape (five keys required + nullable).
 */
export function dmResponseSchemaForPhase(phase: DmResponsePhase): Record<string, unknown> {
  if (phase === 'full') return dmResponseSchema;
  let schema = phaseSchemaCache.get(phase);
  if (!schema) {
    schema = createDmResponseSchema(liveExtensionProperties, [], {
      phase,
      extensionPhases: liveExtensionPhases,
    });
    if (phase === 'combat' || phase === 'tactical') {
      schema = strictFitFightPhaseSchema(schema);
    }
    phaseSchemaCache.set(phase, schema);
  }
  return schema;
}

/**
 * #782 item 8 adapter: the sections each phase schema omits. The internal
 * DMResponse envelope — and every consumer, client included — still sees
 * exactly today's shape: omitted array sections are filled with [] before
 * the strict parser runs. Optional story fields stay absent (the story
 * appliers skip absent fields exactly as they skip null ones).
 */
export const PHASE_OMITTED_SECTIONS: Record<DmResponsePhase, string[]> = {
  // Narrative drops BOTH array sections (combat_actions and map_actions):
  // the strict parser hard-requires both, so filling only one would still
  // miss the rewrite success path on every schema-conformant narrative turn
  // (self-review round 1, R1).
  narrative: ['combat_actions', 'map_actions'],
  combat: ['map_actions'],
  tactical: [],
  full: [],
};

/**
 * #1159: the extensions each phase schema omits, derived from the live
 * extension set and its phase declarations above (an extension with no
 * declaration defaults to all phases, so it is never omitted). Iterating
 * the extension set — the same set the builder iterates — keeps this
 * from drifting from the declarations. Used only by the shadow counter:
 * an empty omitted extension is padding, exactly like an empty omitted
 * base section. The phase schemas themselves still reject omitted
 * extensions, populated or empty — the counter measures content, not
 * padding, same deliberate asymmetry as the base sections.
 */
export function phaseOmittedExtensionSections(phase: DmResponsePhase): string[] {
  return Object.keys(liveExtensionProperties).filter(
    (name) => !extensionAppliesToPhase(liveExtensionPhases[name], phase),
  );
}

export function fillPhaseOmissions(
  envelope: Record<string, unknown>,
  phase?: DmResponsePhase,
): Record<string, unknown> {
  if (!phase || phase === 'full') return envelope;
  for (const section of PHASE_OMITTED_SECTIONS[phase] ?? []) {
    if (envelope[section] === undefined) envelope[section] = [];
  }
  return envelope;
}

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
      (action.origin == null || isPoint(action.origin)) &&
      (action.destination == null || isPoint(action.destination)) &&
      (action.distance == null || (typeof action.distance === 'number' && action.distance >= 0))
    );
  return (
    (action.entityId == null || typeof action.entityId === 'string') &&
    (action.x == null || typeof action.x === 'number') &&
    (action.y == null || typeof action.y === 'number')
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
      (action.slot_level == null || typeof action.slot_level === 'number') &&
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

const DM_OPTION_MARKER = /^\s*(?:\*\*)?(?:\d{1,3}|[A-Za-z])[.)](?:\*\*)?\s+/;

/**
 * The comparison key for one DM option (#864): two options that differ only in
 * their list marker, casing, markdown emphasis, whitespace or punctuation are
 * the same choice offered twice.
 */
export function normalizeDmOptionText(option: string): string {
  return option
    .replace(DM_OPTION_MARKER, '')
    .toLowerCase()
    .replace(/[*_`~]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Drop options the model already offered earlier in the same list, keeping the
 * first occurrence and the order (#864: an opening reply repeated its four
 * options word for word as options 5–8, and every consumer renders the list
 * verbatim).
 */
export function dedupeDmOptions(options: string[]): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const option of options) {
    const key = normalizeDmOptionText(option);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    kept.push(option);
  }
  return kept;
}

/**
 * Drop the copy of the offered options the model also wrote into the narration
 * `text` (#864 reopened, Hark D2-004). The opening producer's envelope can
 * carry the lettered choices inside `text` as well as in the `options` field,
 * and every consumer appends the field to the text (the greeting hook,
 * use-ai-response, provisionalDmText), so the copy inside the text is a second
 * showing of the same list — the first DM message showed each choice twice
 * while later turns, whose text stays clean, did not.
 *
 * The strip is deliberately narrow, because the text is narration first: only
 * a trailing block of lettered lines that segments — marker line plus any
 * wrapped continuation lines — into candidates covering the offered options
 * exactly, as a set, is removed. A lettered list anywhere else, or one that
 * only partially overlaps the options (an in-world slate, a menu), is
 * narration and stays, and so does a text that is nothing but the list:
 * normalization never empties the narration it was handed.
 */
export function stripOptionsRepeatedInText(text: string, options: string[]): string {
  if (options.length === 0) return text;
  const keys = new Set(options.map(normalizeDmOptionText).filter(Boolean));
  if (keys.size === 0) return text;
  const lines = text.split('\n');
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end--;
  // Candidate blocks start at a marker line; try starts from the last line
  // backwards and take the first (shortest) suffix that validates, so a
  // lettered passage earlier in the narration is never reached.
  for (let start = end - 1; start >= 0; start--) {
    if (!DM_OPTION_MARKER.test(lines[start] ?? '')) continue;
    const covered = new Set<string>();
    let candidate: string[] = [];
    let valid = true;
    const flush = (): void => {
      if (candidate.length === 0) return;
      const key = normalizeDmOptionText(candidate.join('\n'));
      if (!keys.has(key)) {
        valid = false;
        return;
      }
      covered.add(key);
      candidate = [];
    };
    for (let i = start; i < end && valid; i++) {
      const line = lines[i] ?? '';
      if (line.trim() === '') continue;
      if (i > start && DM_OPTION_MARKER.test(line)) flush();
      if (!valid) break;
      candidate.push(line);
    }
    if (valid) flush();
    if (!valid || covered.size !== keys.size) continue;
    const stripped = lines.slice(0, start).join('\n').trimEnd();
    return stripped.trim().length > 0 ? stripped : text;
  }
  return text;
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
  if (Array.isArray(response.options)) {
    const options = dedupeDmOptions(response.options);
    response.options = options;
    // #864 reopened: the same choices can also sit inside the narration text;
    // consumers append the field to the text, so the text copy must go too.
    if (typeof response.text === 'string')
      response.text = stripOptionsRepeatedInText(response.text, options);
  }
  if (!Array.isArray(response.map_actions) || !response.map_actions.every(isMapAction))
    return { success: false, issues: ['map_actions contains an invalid action'] };
  const handoutIssue = handoutActionsIssue(response.handout_actions);
  if (handoutIssue) return { success: false, issues: [handoutIssue] };
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
  phase?: DmResponsePhase,
): string {
  if (!envelope || typeof envelope.text !== 'string') return originalText;
  // #633: a malformed segment (null entry, non-string character) throws inside
  // segment derivation. The reply is already saved, so keep the original text.
  try {
    // #782 item 8: fill the sections this turn's phase schema omitted before
    // the strict parser runs, or every narrative turn (no combat_actions) and
    // every combat turn (no map_actions) would miss the success path below.
    if (phase) fillPhaseOmissions(envelope, phase);
    const parsed = parseDmResponse(envelope);
    if (parsed.success) return JSON.stringify(parsed.data);
    // #864 fail-closed: parseDmResponse dedupes the options field and strips
    // the in-text copy BEFORE the map/handout/combat validation that failed
    // here, so the envelope it was handed already carries the deduped
    // options. Returning originalText would ship the raw duplicated list
    // (S-006: 1-3 shown again as 4-6 whenever an unrelated side field is
    // invalid). Return the mutated envelope instead — but only when the
    // options field itself is well-formed (a string array); a malformed
    // options field was never deduped, so that case stays fail-open.
    // Note: on this path narration_segments still describes the original
    // text while text may be stripped (segments are re-derived only on the
    // success path); the throw path below intentionally still returns
    // originalText unchanged.
    if (
      Array.isArray(envelope.options) &&
      envelope.options.every((option) => typeof option === 'string')
    ) {
      return JSON.stringify(envelope);
    }
    return originalText;
  } catch {
    return originalText;
  }
}
