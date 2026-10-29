import Ajv from 'ajv';
import { describe, expect, test } from 'bun:test';

import {
  phaseForSessionState,
  pickDmResponsePhase,
  setPhasePickerEnabledForTests,
} from '../dm-response-phase-picker.js';
import {
  createDmResponseSchema,
  dmResponseSchema,
  dmResponseSchemaForPhase,
  fillPhaseOmissions,
  parseDmResponse,
  rewriteNarrationSegmentsFromEnvelope,
} from '../dm-response-schema.js';
// Strategist HOLD on PR 1110, item 5: rollback must restore today's exact
// schema. The fixture is main's dmResponseSchema bytes, captured from the
// main tree's own module (schema unchanged by main through f04db2b2).
import mainDmResponseSchema from './fixtures/main-dm-response-schema.json' with {
  type: 'json',
};

/**
 * #782 item 8 (Refs #782): per-phase DM reply schemas in shadow. The phase
 * schemas are the real producer output (dmResponseSchemaForPhase); the
 * walker budgets live in dm-response-schema-budget.test.ts. Fixtures follow
 * the real producers: the move shape below is copied literally from
 * cli/fixtures/combat-movement.json; the empty-turn envelopes carry every
 * section their phase schema requires, the way the live schema requires
 * them today. The item-5 tail (keyword move) was split to its own PR by
 * the strategist HOLD on PR 1110 — this file pins the split (keywords at
 * their pre-move counts, rollback byte-identical to main's schema).
 */

const ajv = new Ajv({ strict: false, allErrors: true });

function validate(schema: Record<string, unknown>, value: unknown): string[] {
  const check = ajv.compile(schema);
  if (check(value)) return [];
  // Include params: additionalProperties names the offending key only there.
  return (check.errors ?? []).map(
    (error) =>
      `${error.instancePath || '(root)'} ${error.message ?? error.keyword} ${JSON.stringify(error.params ?? {})}`,
  );
}

/** Every section a phase schema requires, empty — the way the live schema requires them today. */
const baseTurn = {
  text: 'The goblin captain draws steel.',
  options: [],
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  combatants: [],
  handout_actions: [],
};

// Story fields are plain optionals, not nullable pads (item 7 collapse), so
// a narrative turn carries them by value or omits them — never null.
const narrativeTurn = {
  ...baseTurn,
  final_beat_reached: true,
};

// #1258 round 3: the fight-phase schemas declare the five keys required +
// nullable, so a fight turn carries them by value or as null — never omitted.
const combatTurn = {
  ...baseTurn,
  combat_actions: [],
  combat_exits: [],
  scene_spec: null,
  rest: null,
  damage: null,
  final_beat_reached: null,
};

const tacticalTurn = {
  ...combatTurn,
  map_actions: [],
};

describe('phase schemas (Refs #782 item 8)', () => {
  test('full phase is the live schema object', () => {
    expect(dmResponseSchemaForPhase('full')).toBe(dmResponseSchema);
  });

  test('narrative carries the entry + story fields, combat_exits, and drops the fight sections', () => {
    const schema = dmResponseSchemaForPhase('narrative');
    const properties = (schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(
      [
        'text',
        'options',
        'narration_segments',
        'roll_requests',
        'combat_transition',
        'scene_spec',
        'combatants',
        'handout_actions',
        'xp_award',
        'items',
        'conditions',
        'rest',
        'damage',
        'campaign_ending',
        'tracker_changes',
        'final_beat_reached',
        'combat_exits',
      ].sort(),
    );
    expect((schema as { required: string[] }).required).toEqual([
      'text',
      'options',
      'narration_segments',
      'roll_requests',
      'combat_transition',
      'combatants',
      'handout_actions',
    ]);
  });

  test('combat carries the fight fields, scene_spec and the #1258 extensions, and drops the map surface', () => {
    const schema = dmResponseSchemaForPhase('combat');
    const properties = (schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(
      [
        'text',
        'options',
        'narration_segments',
        'roll_requests',
        'combat_transition',
        'combatants',
        'handout_actions',
        'combat_actions',
        'combat_exits',
        'scene_spec',
        'rest',
        'damage',
        'final_beat_reached',
      ].sort(),
    );
    // #1258 round 3: fight phases require the five keys (nullable) — the
    // strict-fit shape. Base keys first, then scene_spec, then the
    // extensions in declaration order.
    expect((schema as { required: string[] }).required).toEqual([
      'text',
      'options',
      'narration_segments',
      'roll_requests',
      'combat_transition',
      'combatants',
      'handout_actions',
      'combat_actions',
      'scene_spec',
      'combat_exits',
      'rest',
      'damage',
      'final_beat_reached',
    ]);
  });

  test('tactical is the combat set plus the kind-split map actions', () => {
    const schema = dmResponseSchemaForPhase('tactical');
    const properties = (schema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(
      [
        'text',
        'options',
        'narration_segments',
        'roll_requests',
        'combat_transition',
        'combatants',
        'handout_actions',
        'combat_actions',
        'combat_exits',
        'scene_spec',
        'rest',
        'damage',
        'final_beat_reached',
        'map_actions',
      ].sort(),
    );
    expect((schema as { required: string[] }).required).toEqual([
      'text',
      'options',
      'narration_segments',
      'roll_requests',
      'combat_transition',
      'combatants',
      'handout_actions',
      'combat_actions',
      'map_actions',
      'scene_spec',
      'combat_exits',
      'rest',
      'damage',
      'final_beat_reached',
    ]);
  });

  test('each turn validates under its own phase and no other', () => {
    expect(validate(dmResponseSchemaForPhase('narrative'), narrativeTurn)).toEqual([]);
    expect(validate(dmResponseSchemaForPhase('combat'), narrativeTurn).length).toBeGreaterThan(0);
    expect(validate(dmResponseSchemaForPhase('tactical'), narrativeTurn).length).toBeGreaterThan(0);
    expect(validate(dmResponseSchemaForPhase('combat'), combatTurn)).toEqual([]);
    expect(validate(dmResponseSchemaForPhase('narrative'), combatTurn).length).toBeGreaterThan(0);
    expect(validate(dmResponseSchemaForPhase('tactical'), combatTurn).length).toBeGreaterThan(0);
    expect(validate(dmResponseSchemaForPhase('tactical'), tacticalTurn)).toEqual([]);
  });

  test('#1258: fight turns carry scene_spec, rest, damage and final_beat_reached; narrative turns carry combat_exits', () => {
    expect(
      validate(dmResponseSchemaForPhase('tactical'), {
        ...tacticalTurn,
        // Full scene_spec shape: the phase-scoped scene_spec requires the
        // descriptive fields (nullable) — a minimal shape validates only
        // through the shadow, which pads absent required-nullable keys.
        scene_spec: {
          environment: 'dungeon_room',
          size: 'small',
          sceneDescription: 'A torch-lit guardroom.',
          seed: 1,
          enemyPlacement: 'guarding',
        },
        rest: { type: 'short' },
        damage: { amount: 3, source: 'falling debris' },
        final_beat_reached: true,
      }),
    ).toEqual([]);
    expect(
      validate(dmResponseSchemaForPhase('narrative'), {
        ...narrativeTurn,
        combat_exits: [{ participant_id: 'goblin-1', exit: 'fled' }],
      }),
    ).toEqual([]);
    expect(validate(dmResponseSchemaForPhase('narrative'), tacticalTurn).length).toBeGreaterThan(0);
    expect(validate(dmResponseSchemaForPhase('combat'), tacticalTurn).length).toBeGreaterThan(0);
  });

  test('a wrong-phase section is a named failure, not a silent leak', () => {
    const errors = validate(dmResponseSchemaForPhase('narrative'), {
      ...narrativeTurn,
      combat_actions: [],
    });
    expect(errors.some((error) => error.includes('combat_actions'))).toBe(true);
    const mapErrors = validate(dmResponseSchemaForPhase('combat'), {
      ...combatTurn,
      map_actions: [],
    });
    expect(mapErrors.some((error) => error.includes('map_actions'))).toBe(true);
  });

  test('extension seam: a declared phase restricts, an undeclared one defaults to all', () => {
    const schema = createDmResponseSchema(
      {
        narrative_only: { type: 'string' },
        everywhere: { type: 'string' },
      },
      [],
      {
        phase: 'combat',
        extensionPhases: { narrative_only: ['narrative'] },
      },
    );
    const properties = (schema as { properties: Record<string, unknown> }).properties;
    expect(properties['narrative_only']).toBeUndefined();
    expect(properties['everywhere']).toBeDefined();
    // A dropped extension must not leave its name in `required`.
    const requiredSchema = createDmResponseSchema(
      { narrative_only: { type: 'string' } },
      ['narrative_only'],
      { phase: 'combat', extensionPhases: { narrative_only: ['narrative'] } },
    );
    expect((requiredSchema as { required: string[] }).required).not.toContain('narrative_only');
  });
});

/** Numeric/length keywords, shared with the phase-budget tests below. */
const KEYWORDS = [
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minProperties',
  'maxProperties',
  'uniqueItems',
];
const findKeywords = (node: unknown, seen = new Set<object>()): string[] => {
  if (node === null || typeof node !== 'object' || seen.has(node)) return [];
  seen.add(node);
  const found: string[] = [];
  if (Array.isArray(node)) {
    for (const item of node) found.push(...findKeywords(item, seen));
    return found;
  }
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (KEYWORDS.includes(key)) found.push(key);
    found.push(...findKeywords(value, seen));
  }
  return found;
};

describe('keyword split (strategist HOLD on PR 1110: item-5 tail moves to its own PR)', () => {
  test('keywords stay at exactly their pre-move counts per schema', () => {
    // Narrative keeps the story bounds (quantity, duration, amount min/max,
    // source min/maxLength); combat and tactical keep the damage bounds
    // (#1258: damage rides on fight turns) plus tactical's forced_move
    // distance minimum; the default builder keeps the base map distance
    // minimum; live keeps all seven.
    expect(findKeywords(dmResponseSchemaForPhase('narrative')).sort()).toEqual([
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
      'minimum',
      'minimum',
    ]);
    expect(findKeywords(dmResponseSchemaForPhase('combat')).sort()).toEqual([
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
    ]);
    expect(findKeywords(dmResponseSchemaForPhase('tactical')).sort()).toEqual([
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
      'minimum',
    ]);
    expect(findKeywords(dmResponseSchemaForPhase('full')).sort()).toEqual([
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
      'minimum',
      'minimum',
      'minimum',
    ]);
    expect(findKeywords(dmResponseSchema).sort()).toEqual([
      'maxLength',
      'maximum',
      'minLength',
      'minimum',
      'minimum',
      'minimum',
      'minimum',
    ]);
    expect(findKeywords(createDmResponseSchema())).toEqual(['minimum']);
  });

  test('each bound sits on its field as a schema keyword', () => {
    const live = dmResponseSchema as {
      properties: {
        map_actions: { items: { properties: { distance: Record<string, unknown> } } };
        items: { items: { properties: { quantity: Record<string, unknown> } } };
        conditions: { items: { properties: { duration_minutes: Record<string, unknown> } } };
        damage: { properties: { amount: Record<string, unknown>; source: Record<string, unknown> } };
      };
    };
    expect(live.properties.map_actions.items.properties.distance).toEqual({
      type: 'number',
      minimum: 0,
    });
    expect(live.properties.items.items.properties.quantity).toEqual({
      type: 'integer',
      minimum: 1,
    });
    expect(live.properties.conditions.items.properties.duration_minutes).toEqual({
      type: 'integer',
      minimum: 1,
    });
    expect(live.properties.damage.properties.amount).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 999,
    });
    expect(live.properties.damage.properties.source).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 120,
    });
  });
});

describe('tactical kind-split map variants (Refs #782 item 8)', () => {
  const tactical = dmResponseSchemaForPhase('tactical');
  const mapActions = (
    tactical as {
      properties: { map_actions: { items: unknown } };
    }
  ).properties.map_actions.items;

  const mapTurn = (action: unknown): Record<string, unknown> => ({
    ...tacticalTurn,
    map_actions: [action],
  });

  test('move requires entity + coordinates and accepts the fixture changes:null', () => {
    // Literal values from cli/fixtures/combat-movement.json.
    expect(
      validate(tactical, mapTurn({ action: 'move', entityId: 'void-maw', x: 3, y: 3, changes: null })),
    ).toEqual([]);
    expect(
      validate(tactical, mapTurn({ action: 'move', entityId: 'void-maw', x: 3, y: 3 })).length,
    ).toBe(0);
    expect(validate(tactical, mapTurn({ action: 'move', entityId: 'void-maw', x: 3 })).length).toBeGreaterThan(0);
  });

  test('place requires changes; remove requires only the entity', () => {
    expect(
      validate(
        tactical,
        mapTurn({ action: 'place', changes: { terrain: 'floor' } }),
      ).length,
    ).toBe(0);
    expect(validate(tactical, mapTurn({ action: 'place' })).length).toBeGreaterThan(0);
    expect(validate(tactical, mapTurn({ action: 'remove', entityId: 'goblin-1' })).length).toBe(0);
    expect(validate(tactical, mapTurn({ action: 'remove' })).length).toBeGreaterThan(0);
  });

  test('update_cell requires coordinates + changes; forced_move requires target + mode only', () => {
    expect(
      validate(tactical, mapTurn({ action: 'update_cell', x: 1, y: 2, changes: { terrain: 'wall' } }))
        .length,
    ).toBe(0);
    expect(
      validate(tactical, mapTurn({ action: 'update_cell', x: 1, y: 2 })).length,
    ).toBeGreaterThan(0);
    // Mirrors the hand parser's own test: target/mode with no other pads parses.
    expect(
      validate(tactical, mapTurn({ action: 'forced_move', target: 'goblin-1', mode: 'shove' })).length,
    ).toBe(0);
    expect(validate(tactical, mapTurn({ action: 'forced_move' })).length).toBeGreaterThan(0);
    expect(
      validate(
        tactical,
        mapTurn({
          action: 'forced_move',
          target: 'goblin-1',
          mode: 'teleport',
          origin: { x: 1, y: 1 },
          destination: { x: 4, y: 4 },
        }),
      ).length,
    ).toBe(0);
  });

  test('the variant set is exactly the five kinds', () => {
    const variants = (mapActions as { anyOf: Array<{ properties: { action: { enum: string[] } } }> })
      .anyOf;
    expect(variants.map((variant) => variant.properties.action.enum[0]).sort()).toEqual(
      ['forced_move', 'move', 'place', 'remove', 'update_cell'].sort(),
    );
  });
});

describe('adapter fill (Refs #782 item 8)', () => {
  test('narrative fills combat_actions and map_actions, combat fills map_actions, nothing else', () => {
    const narrative = fillPhaseOmissions({ text: 'x' }, 'narrative');
    expect(narrative).toEqual({ text: 'x', combat_actions: [], map_actions: [] });
    const combat = fillPhaseOmissions({ text: 'x' }, 'combat');
    expect(combat).toEqual({ text: 'x', map_actions: [] });
    expect(fillPhaseOmissions({ text: 'x' }, 'tactical')).toEqual({ text: 'x' });
    expect(fillPhaseOmissions({ text: 'x' }, 'full')).toEqual({ text: 'x' });
    expect(fillPhaseOmissions({ text: 'x' })).toEqual({ text: 'x' });
  });

  test('fill never overwrites a section the reply already carries, and never fills story fields', () => {
    const kept = fillPhaseOmissions(
      { text: 'x', combat_actions: [{ action_type: 'attack' }] },
      'narrative',
    );
    expect(kept['combat_actions']).toEqual([{ action_type: 'attack' }]);
    // The other omitted section is still filled even when one is kept.
    expect(kept['map_actions']).toEqual([]);
    expect('xp_award' in fillPhaseOmissions({ text: 'x' }, 'narrative')).toBe(false);
  });

  test('a realistic narrative envelope (neither fight array) reaches the rewrite success path', () => {
    // Self-review round 1, R1: the previous version of this test pre-supplied
    // map_actions: [], which is exactly the field a real narrative reply
    // cannot carry (the narrative schema drops it) — masking that the fill
    // missed it and the strict parser failed every narrative turn.
    const envelope = {
      text: 'The goblin captain draws steel.',
      handout_actions: [],
    };
    const originalText = JSON.stringify(envelope);
    const rewritten = rewriteNarrationSegmentsFromEnvelope(
      { ...envelope },
      originalText,
      'narrative',
    );
    // Success path, not fail-open: the output differs from the input, both
    // omitted sections are filled, and segments are re-derived.
    expect(rewritten).not.toBe(originalText);
    const parsed = JSON.parse(rewritten) as {
      combat_actions?: unknown[];
      map_actions?: unknown[];
      narration_segments?: unknown;
    };
    expect(parsed.combat_actions).toEqual([]);
    expect(parsed.map_actions).toEqual([]);
    expect(Array.isArray(parsed.narration_segments)).toBe(true);
    // Control: without the phase the same envelope misses the success path
    // (the strict parser hard-requires both fight arrays) and the original
    // text comes back unchanged.
    expect(rewriteNarrationSegmentsFromEnvelope({ ...envelope }, originalText)).toBe(originalText);
  });

  test('a combat envelope without map_actions reaches the rewrite success path', () => {
    const envelope = {
      text: 'The goblin captain draws steel.',
      combat_actions: [],
      handout_actions: [],
    };
    const rewritten = rewriteNarrationSegmentsFromEnvelope(
      { ...envelope },
      JSON.stringify(envelope),
      'combat',
    );
    const parsed = JSON.parse(rewritten) as { map_actions?: unknown[] };
    expect(parsed.map_actions).toEqual([]);
  });

  test('fill + strict parse is parity for a full live envelope', () => {
    const envelope = {
      text: 'The goblin captain draws steel.',
      map_actions: [],
      handout_actions: [],
      combat_actions: [],
    };
    const filled = fillPhaseOmissions({ ...envelope }, 'narrative');
    const parsed = parseDmResponse(filled);
    expect(parsed.success).toBe(true);
  });
});

describe('phase picker (Refs #782 item 8)', () => {
  test('pure decision: encounter + map -> tactical, encounter alone -> combat, none -> narrative', () => {
    expect(phaseForSessionState({ hasEncounter: true, hasTacticalMap: true })).toBe('tactical');
    expect(phaseForSessionState({ hasEncounter: true, hasTacticalMap: false })).toBe('combat');
    expect(phaseForSessionState({ hasEncounter: false, hasTacticalMap: true })).toBe('narrative');
    expect(phaseForSessionState({ hasEncounter: false, hasTacticalMap: false })).toBe('narrative');
  });

  test('wrapper picks from injected lookups without a database', async () => {
    setPhasePickerEnabledForTests(true);
    try {
      const tactical = await pickDmResponsePhase('s1', 'u1', {
        getActiveEncounter: async () => ({ id: 'e1' }),
        loadActiveTacticalMap: async () => ({ id: 'm1' }),
      });
      expect(tactical.phase).toBe('tactical');
      expect(tactical.fallback).toBe(false);
      const combat = await pickDmResponsePhase('s1', 'u1', {
        getActiveEncounter: async () => ({ id: 'e1' }),
        loadActiveTacticalMap: async () => null,
      });
      expect(combat.phase).toBe('combat');
      const narrative = await pickDmResponsePhase('s1', 'u1', {
        getActiveEncounter: async () => undefined,
        loadActiveTacticalMap: async () => {
          throw new Error('must not be called without an encounter');
        },
      });
      expect(narrative.phase).toBe('narrative');
      const noSession = await pickDmResponsePhase(null, 'u1', {
        getActiveEncounter: async () => {
          throw new Error('must not be called without a session');
        },
      });
      expect(noSession.phase).toBe('narrative');
    } finally {
      setPhasePickerEnabledForTests(true);
    }
  });

  test('wrapper fails safe to the full schema on any lookup error', async () => {
    setPhasePickerEnabledForTests(true);
    try {
      const fell = await pickDmResponsePhase('s1', 'u1', {
        getActiveEncounter: async () => {
          throw new Error('db down');
        },
      });
      expect(fell.phase).toBe('full');
      expect(fell.schema).toBe(dmResponseSchema);
      expect(fell.fallback).toBe(true);
    } finally {
      setPhasePickerEnabledForTests(true);
    }
  });

  test('wrapper fails safe to the full schema when a lookup never settles', async () => {
    // PR 1110 CI: with no DATABASE_URL the real encounter lookup hangs past
    // bun's 5s test timeout instead of throwing. A hung lookup is the same
    // failure as a thrown one — it must fall back, not hang the turn.
    setPhasePickerEnabledForTests(true);
    try {
      const fell = await pickDmResponsePhase('s1', 'u1', {
        getActiveEncounter: () => new Promise(() => {}),
      });
      expect(fell.phase).toBe('full');
      expect(fell.schema).toBe(dmResponseSchema);
      expect(fell.fallback).toBe(true);
    } finally {
      setPhasePickerEnabledForTests(true);
    }
  });

  test('LLM_DM_PHASE_PICKER=off pins the full schema', async () => {
    setPhasePickerEnabledForTests(false);
    try {
      const pinned = await pickDmResponsePhase('s1', 'u1', {
        getActiveEncounter: async () => ({ id: 'e1' }),
        loadActiveTacticalMap: async () => ({ id: 'm1' }),
      });
      expect(pinned.phase).toBe('full');
      expect(pinned.fallback).toBe(true);
    } finally {
      setPhasePickerEnabledForTests(true);
    }
  });

  test('LLM_DM_PHASE_PICKER=off yields main\'s exact schema bytes (HOLD item 5)', async () => {
    // Rollback must restore today's schema, not just today's shape: the
    // pinned schema serializes byte-identically to main's live schema
    // (fixture captured from the main tree's own module output).
    setPhasePickerEnabledForTests(false);
    try {
      const pinned = await pickDmResponsePhase('s1', 'u1', {
        getActiveEncounter: async () => ({ id: 'e1' }),
        loadActiveTacticalMap: async () => ({ id: 'm1' }),
      });
      expect(JSON.stringify(pinned.schema)).toBe(JSON.stringify(mainDmResponseSchema));
    } finally {
      setPhasePickerEnabledForTests(true);
    }
  });
});

describe('phase schema budgets (Refs #782 item 8)', () => {
  test('every phase fits the strict unions/optionals caps; keywords pinned per phase (split)', () => {
    // Unions/optionals/oneOf fit the strict caps (asserted exactly by the
    // budget test); keywords do NOT claim strict-fit — the HOLD split the
    // item-5 tail out, so each phase keeps today's keywords at its pinned
    // count (narrative 6, combat 4, tactical 5 — the damage bounds, #1258).
    const expectedKeywords: Record<'narrative' | 'combat' | 'tactical', number> = {
      narrative: 6,
      combat: 4,
      tactical: 5,
    };
    for (const phase of ['narrative', 'combat', 'tactical'] as const) {
      expect(findKeywords(dmResponseSchemaForPhase(phase))).toHaveLength(
        expectedKeywords[phase],
      );
    }
    // The budget test asserts the exact counts; here the shape guarantee:
    // phase schemas are strict subsets of the live schema's properties.
    const liveKeys = new Set(
      Object.keys((dmResponseSchema as { properties: Record<string, unknown> }).properties),
    );
    for (const phase of ['narrative', 'combat', 'tactical'] as const) {
      const keys = Object.keys(
        (dmResponseSchemaForPhase(phase) as { properties: Record<string, unknown> }).properties,
      );
      for (const key of keys) expect(liveKeys.has(key)).toBe(true);
    }
  });

  test('phase property sets union to the live schema keys (no base key unphased)', () => {
    // Self-review round 1, N3: a base property added to no phase key list
    // would otherwise grow `full` unratcheted.
    const liveKeys = Object.keys(
      (dmResponseSchema as { properties: Record<string, unknown> }).properties,
    ).sort();
    const union = new Set<string>();
    for (const phase of ['narrative', 'combat', 'tactical'] as const) {
      for (const key of Object.keys(
        (dmResponseSchemaForPhase(phase) as { properties: Record<string, unknown> }).properties,
      )) {
        union.add(key);
      }
    }
    expect([...union].sort()).toEqual(liveKeys);
  });
});
