import Ajv from 'ajv';
import { describe, expect, test } from 'bun:test';

import {
  VOICE_CATEGORY_VALUES,
  dmResponseSchema,
  parseDmResponse,
  reviewNarrationSpeakerSplit,
} from '../dm-response-schema.js';

const response = (overrides: Record<string, unknown> = {}) => ({
  text: 'The lantern flame gutters in the cold passage.',
  narration_segments: [],
  roll_requests: [],
  combat_transition: 'none',
  scene_spec: null,
  map_actions: [],
  handout_actions: [],
  combatants: [],
  combat_actions: [],
  ...overrides,
});

describe('dmResponseSchema options contract', () => {
  test('requires an array of strings in the provider schema', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.options).toEqual({ type: 'array', items: { type: 'string' } });
    expect(dmResponseSchema.required).toContain('options');
  });

  test('parses and preserves structured action options', () => {
    const options = [
      'A. **Study the passage**, look for signs of movement.',
      'B. **Call out**, see whether anyone answers.',
      'C. **Press onward**, keep your hand near your weapon.',
    ];

    const parsed = parseDmResponse(response({ options }));

    expect(parsed).toEqual({ success: true, data: expect.objectContaining({ options }) });
  });

  test('rejects an options value containing non-string items', () => {
    const parsed = parseDmResponse(response({ options: ['A. **Look**, inspect the passage.', 2] }));

    expect(parsed).toEqual({
      success: false,
      issues: ['options must be an array of strings'],
    });
  });

  test('accepts legacy local shells that omit options', () => {
    expect(parseDmResponse(response()).success).toBe(true);
  });
});

describe('dmResponseSchema voice category contract', () => {
  test('exposes the closed configured voice category enum', () => {
    const properties = dmResponseSchema.properties as Record<string, unknown>;
    const narrationSegmentProperties = (
      properties.narration_segments as {
        items: { properties: { voice_category: unknown } };
      }
    ).items.properties;

    expect(narrationSegmentProperties.voice_category).toEqual({
      anyOf: [{ type: 'string', enum: [...VOICE_CATEGORY_VALUES] }, { type: 'null' }],
    });
  });

  test('normalizes reopen free-text labels to configured keys', () => {
    const parsed = parseDmResponse(
      response({
        text: '"P-please..." "Sit."',
        narration_segments: [
          {
            type: 'character',
            text: 'P-please...',
            character: 'Professor Emil Darkwater',
            voice_category: 'high-pitched, fast, breathless',
          },
          {
            type: 'character',
            text: 'Sit.',
            character: 'Innkeep Mara',
            voice_category: 'calm',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const spoken = parsed.data.narration_segments.filter((segment) => segment.type === 'character');
    expect(spoken.map((segment) => segment.voice_category)).toEqual(['goblin', 'innkeeper']);
  });

  test('does not pass an unknown free-text category through', () => {
    const parsed = parseDmResponse(
      response({
        text: '"Who am I?"',
        narration_segments: [
          {
            type: 'character',
            text: 'Who am I?',
            character: 'Mystery',
            voice_category: 'unmapped_style',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.narration_segments[0].voice_category).toBeNull();
  });
});

describe('dmResponseSchema speaker-split contract', () => {
  const mixedText = 'Captain Sarah Reeves steps onto the deck. "Hold the line," she says.';

  test('narration plus one NPC quote parses to at least two distinct speakers', () => {
    const parsed = parseDmResponse(
      response({
        text: mixedText,
        narration_segments: [
          {
            type: 'dm',
            text: 'Captain Sarah Reeves steps onto the deck.',
            character: null,
            voice_category: 'narrator',
          },
          {
            type: 'character',
            text: 'Hold the line.',
            character: 'Captain Sarah Reeves',
            voice_category: 'guard',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const review = reviewNarrationSpeakerSplit(parsed.data.text, parsed.data.narration_segments);
    expect(parsed.data.narration_segments.length).toBeGreaterThanOrEqual(2);
    expect(review.distinctSpeakers.length).toBeGreaterThanOrEqual(2);
    expect(review.flagged).toBe(false);
  });

  test('derives distinct speakers from mixed text even when the model emitted one segment', () => {
    const parsed = parseDmResponse(
      response({
        text: mixedText,
        narration_segments: [
          {
            type: 'character',
            text: 'Hold the line.',
            character: 'Captain Sarah Reeves',
            voice_category: 'guard',
          },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const review = reviewNarrationSpeakerSplit(parsed.data.text, parsed.data.narration_segments);
    expect(parsed.data.narration_segments.length).toBeGreaterThanOrEqual(2);
    expect(review.distinctSpeakers.length).toBeGreaterThanOrEqual(2);
    expect(review.flagged).toBe(false);
  });
});

describe('dmResponseSchema story rest contract (#264)', () => {
  test('exposes the nullable rest field with the short/long enum', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.rest).toEqual({
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          properties: { type: { type: 'string', enum: ['short', 'long'] } },
          required: ['type'],
        },
        { type: 'null' },
      ],
    });
  });

  test('accepts a rest grant and the null rest on a plain turn', () => {
    const granted = parseDmResponse(response({ rest: { type: 'long' } }));
    expect(granted.success).toBe(true);

    const none = parseDmResponse(response({ rest: null }));
    expect(none.success).toBe(true);
  });
});

describe('dmResponseSchema story damage contract (#610)', () => {
  test('the damage field carries a description telling the model when to populate it', () => {
    // #610: the model narrated injury but left no damage signal, so the writer never
    // ran. In the strict structured-output contract the property description is
    // the in-schema signal for when to populate a nullable field (#463 precedent).
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const [objectVariant] = properties.damage.anyOf as Array<Record<string, unknown>>;

    expect(typeof objectVariant.description).toBe('string');
    const description = String(objectVariant.description);
    expect(description).toContain('hurt');
    expect(description).toContain('hit points');
    expect(description).toContain('damage');
    expect(description).toContain('null');
  });

  test('accepts a damage grant and the null damage on a plain turn', () => {
    const granted = parseDmResponse(response({ damage: { amount: 3, source: 'rope burn' } }));
    expect(granted.success).toBe(true);

    const none = parseDmResponse(response({ damage: null }));
    expect(none.success).toBe(true);
  });
});

describe('dmResponseSchema story items contract (#463)', () => {
  test('the items field carries a description telling the model when to populate it', () => {
    // #463: the model narrated pickups but left `items` null, so the writer never
    // ran. In the strict structured-output contract the property description is
    // the in-schema signal for when to populate a nullable field (#310 precedent).
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const [objectVariant] = properties.items.anyOf as Array<Record<string, unknown>>;

    expect(typeof objectVariant.description).toBe('string');
    const description = String(objectVariant.description);
    expect(description).toContain('gain');
    expect(description).toContain('lose');
    expect(description).toContain('Inventory');
    expect(description).toContain('null');
  });

  test('accepts an item grant and the null items on a plain turn', () => {
    const granted = parseDmResponse(
      response({ items: [{ name: 'Brass Key', quantity: 1, change: 'gain' }] }),
    );
    expect(granted.success).toBe(true);

    const none = parseDmResponse(response({ items: null }));
    expect(none.success).toBe(true);
  });
});

describe('dmResponseSchema scene_spec contract (#782 item 6)', () => {
  test('scene_spec has no id and no sessionId, but keeps seed', () => {
    // #782 item 6: the model-authored id and sessionId were dead weight — the
    // sanitizer discards the model's id and always replaces sessionId with the
    // route parameter. The wire schema no longer asks the model for them.
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const [objectVariant] = properties.scene_spec.anyOf as Array<Record<string, unknown>>;
    const sceneProps = objectVariant.properties as Record<string, unknown>;
    const required = objectVariant.required as string[];

    expect(sceneProps).not.toHaveProperty('id');
    expect(sceneProps).not.toHaveProperty('sessionId');
    expect(required).not.toContain('id');
    expect(required).not.toContain('sessionId');
    expect(sceneProps).toHaveProperty('seed');
    expect(required).toContain('seed');
  });
});

describe('dmResponseSchema combat_actions anyOf contract (#782 item 8)', () => {
  // #782 item 8: the last oneOf in the wire schema (combat_actions items) is
  // now anyOf. The two variants are disjoint — a targeted action requires
  // target_ids/movement_feet (forbidden on the AoE schema) and an AoE action
  // requires origin (forbidden on the targeted schema) — so oneOf and anyOf
  // accept exactly the same payloads. This test rebuilds the old oneOf shape
  // from the same two variants and proves the verdicts match on a corpus.
  const combatItems = (
    dmResponseSchema.properties as Record<string, Record<string, unknown>>
  ).combat_actions.items as { anyOf: unknown[] };
  const variants = combatItems.anyOf;

  const oldValidator = new Ajv({ strict: false }).compile({
    type: 'array',
    items: { oneOf: variants },
  });
  const newValidator = new Ajv({ strict: false }).compile({
    type: 'array',
    items: { anyOf: variants },
  });

  const targetedAction = {
    actor_id: 'enemy-goblin-1',
    action_type: 'attack',
    target_ids: ['pc-artha'],
    weapon_id: 'scimitar',
    spell_id: null,
    slot_level: null,
    movement_feet: 30,
  };
  const aoeAction = {
    actor_id: 'enemy-wizard',
    action_type: 'cast_spell',
    spell_id: 'fireball',
    origin: { x: 5, y: 3 },
    direction: null,
    slot_level: 3,
  };
  // Missing-key variants are built explicitly — on the wire a missing key is
  // absent, not present-with-undefined, and ajv + additionalProperties treat
  // the two differently.
  const targetedMissingIds = {
    actor_id: 'enemy-goblin-1',
    action_type: 'attack',
    weapon_id: 'scimitar',
    spell_id: null,
    slot_level: null,
    movement_feet: 30,
  };
  const aoeMissingOrigin = {
    actor_id: 'enemy-wizard',
    action_type: 'cast_spell',
    spell_id: 'fireball',
    direction: null,
    slot_level: 3,
  };

  // [payload, expected verdict]: mirrors what the DM model emits on the
  // google/ branch (see llm-provider-gemini-full-schema.test.ts).
  const corpus: Array<[string, unknown, boolean]> = [
    ['accepts a valid targeted action', [targetedAction], true],
    ['accepts a valid AoE action', [aoeAction], true],
    ['accepts both kinds in one array', [targetedAction, aoeAction], true],
    ['rejects a targeted action missing target_ids', [targetedMissingIds], false],
    ['rejects an AoE action missing origin', [aoeMissingOrigin], false],
    [
      'rejects an action with both target_ids and origin (matches neither variant)',
      [{ ...targetedAction, origin: { x: 1, y: 1 } }],
      false,
    ],
    [
      'rejects an unknown action_type',
      [{ ...targetedAction, action_type: 'teleport' }],
      false,
    ],
    [
      'rejects an extra property',
      [{ ...targetedAction, extra: 'nope' }],
      false,
    ],
    ['rejects an AoE action with spell_id null', [{ ...aoeAction, spell_id: null }], false],
  ];

  for (const [name, payload, expected] of corpus) {
    test(name, () => {
      const oldVerdict = oldValidator(payload);
      const newVerdict = newValidator(payload);
      expect(oldVerdict).toBe(expected);
      expect(newVerdict).toBe(oldVerdict);
    });
  }

  test('oneOf and anyOf agree across systematic mutations of both variants', () => {
    const mutations: unknown[] = [];
    for (const base of [targetedAction, aoeAction]) {
      for (const key of Object.keys(base)) {
        const copy: Record<string, unknown> = { ...base };
        delete copy[key];
        mutations.push([copy]);
      }
      for (const actionType of ['attack', 'cast_spell', 'dash', 'teleport']) {
        mutations.push([{ ...base, action_type: actionType }]);
      }
      mutations.push([{ ...base, slot_level: 'high' }]);
      mutations.push([{ ...base, actor_id: 42 }]);
    }
    for (const payload of mutations) {
      expect(newValidator(payload)).toBe(oldValidator(payload));
    }
  });

  test('parseDmResponse accepts a full reply carrying both action kinds', () => {
    const parsed = parseDmResponse(response({ combat_actions: [targetedAction, aoeAction] }));
    expect(parsed.success).toBe(true);
  });
});
