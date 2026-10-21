import Ajv from 'ajv';
import { describe, expect, test } from 'bun:test';

import {
  VOICE_CATEGORY_VALUES,
  dmResponseSchema,
  parseDmResponse,
  reviewNarrationSpeakerSplit,
  stripOptionsRepeatedInText,
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

  test('drops options the model repeated word for word (#864)', () => {
    const parsed = parseDmResponse(
      response({
        options: [
          'A. **Study the passage**, look for signs of movement.',
          'B. **Call out**, see whether anyone answers.',
          'C. **Press onward**, keep your hand near your weapon.',
          'D. **Study the passage**, look for signs of movement.',
          'E. **Call out**, see whether anyone answers.',
          'F. **Press onward**, keep your hand near your weapon.',
        ],
      }),
    );

    expect(parsed).toEqual({
      success: true,
      data: expect.objectContaining({
        options: [
          'A. **Study the passage**, look for signs of movement.',
          'B. **Call out**, see whether anyone answers.',
          'C. **Press onward**, keep your hand near your weapon.',
        ],
      }),
    });
  });

  test('dedupes options that differ only in marker, case, emphasis or punctuation (#864)', () => {
    const parsed = parseDmResponse(
      response({
        options: [
          'A. **Press the Professor further**, demand an answer.',
          '2. press the professor further — demand an answer!',
          '**C. Press the Professor further**, demand an answer.',
          'B. **Retreat**, back away from the desk.',
          'D.  **Retreat**,   back away from the desk',
        ],
      }),
    );

    expect(parsed).toEqual({
      success: true,
      data: expect.objectContaining({
        options: [
          'A. **Press the Professor further**, demand an answer.',
          'B. **Retreat**, back away from the desk.',
        ],
      }),
    });
  });

  test('keeps options that share a title but differ in the choice itself (#864)', () => {
    const options = [
      'A. **Attack**, strike the professor with your staff.',
      'B. **Attack**, hurl the lantern at the professor.',
    ];

    const parsed = parseDmResponse(response({ options }));

    expect(parsed).toEqual({ success: true, data: expect.objectContaining({ options }) });
  });

  // #864 reopened (Hark D2-004): the opening producer's envelope can carry the
  // lettered choices inside the narration text as well as in the options field.
  // Every consumer appends the field to the text (the greeting hook builds the
  // saved greeting exactly that way — shared/test-fixtures/initial-greeting-save.ts),
  // so the copy inside the text is a second showing of the same list. The text and
  // options below follow that fixture's Gilded Lantern opening.
  const OPENING_NARRATION =
    'Rain hammers the shutters of the Gilded Lantern as the last of the evening crowd drifts out into the mud. Behind the bar, a hooded stranger slides a folded map toward you and says nothing.';
  const OPENING_OPTIONS = [
    'A. **Take the map**, and read it by the fire.',
    'B. **Ask the stranger** who sent them.',
  ];
  const occurrences = (haystack: string, needle: string): number =>
    haystack.split(needle).length - 1;

  test('drops options the model also wrote into the narration text (#864 reopened)', () => {
    const parsed = parseDmResponse(
      response({
        text: `${OPENING_NARRATION}\n\n${OPENING_OPTIONS.join('\n')}`,
        options: OPENING_OPTIONS,
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(OPENING_NARRATION);
    expect(parsed.data.options).toEqual(OPENING_OPTIONS);
    // The assembly every consumer renders: narration, then the options appended once.
    const delivered = `${parsed.data.text}\n\n${(parsed.data.options ?? []).join('\n')}`;
    for (const option of OPENING_OPTIONS) expect(occurrences(delivered, option)).toBe(1);
  });

  test('drops a text-carried list when the options field repeats it too (#864 reopened)', () => {
    const parsed = parseDmResponse(
      response({
        text: `${OPENING_NARRATION}\n\n${OPENING_OPTIONS.join('\n')}`,
        options: [...OPENING_OPTIONS, ...OPENING_OPTIONS],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(OPENING_NARRATION);
    expect(parsed.data.options).toEqual(OPENING_OPTIONS);
  });

  test('keeps a lettered list in the text that is not the offered options (#864 reopened)', () => {
    const text = `${OPENING_NARRATION}\n\nOn the bar, a chalk slate lists the house rules:\nA. **No blades** drawn after the second bell.\nB. **No credit** for travellers.`;
    const parsed = parseDmResponse(response({ text, options: OPENING_OPTIONS }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(text);
    expect(parsed.data.options).toEqual(OPENING_OPTIONS);
  });

  test('leaves the text untouched when the envelope offers no options (#864 reopened)', () => {
    const text = `${OPENING_NARRATION}\n\n${OPENING_OPTIONS.join('\n')}`;
    const parsed = parseDmResponse(response({ text, options: [] }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(text);
  });

  test('keeps a trailing lettered list that only partially overlaps the options (#864 reopened)', () => {
    // An in-world slate whose middle rule happens to read exactly like one of
    // the offered choices: the block as a set is not the options, so nothing
    // may be stripped — the slate keeps all three rules, in order.
    const options = [
      'A. **Shield** the lantern from the rain.',
      'B. **Ask the stranger** who sent them.',
    ];
    const text = `${OPENING_NARRATION}\n\nOn the bar, a chalk slate lists the house rules:\nA. **No blades** drawn after the second bell.\nB. **Shield** the lantern from the rain.\nC. **No credit** for travellers.`;
    const parsed = parseDmResponse(response({ text, options }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(text);
  });

  test('keeps the same list when narration continues after it (#864 reopened)', () => {
    // Only a trailing appendix is the producer's second showing; a list the
    // narration resumes after is part of the scene and stays.
    const text = `${OPENING_NARRATION}\n\n${OPENING_OPTIONS.join('\n')}\n\nThe stranger watches you decide, saying nothing.`;
    const parsed = parseDmResponse(response({ text, options: OPENING_OPTIONS }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(text);
  });

  test('drops the appendix when its markers differ from the field markers (#864 reopened)', () => {
    const parsed = parseDmResponse(
      response({
        text: `${OPENING_NARRATION}\n\n1. **Take the map**, and read it by the fire.\n2. **Ask the stranger** who sent them.`,
        options: OPENING_OPTIONS,
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(OPENING_NARRATION);
    expect(parsed.data.options).toEqual(OPENING_OPTIONS);
  });

  test('drops the appendix when an option in it wraps onto a second line (#864 reopened)', () => {
    const parsed = parseDmResponse(
      response({
        text: `${OPENING_NARRATION}\n\nA. **Take the map**, and read it\nby the fire.\nB. **Ask the stranger** who sent them.`,
        options: OPENING_OPTIONS,
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(OPENING_NARRATION);
  });

  test('keeps narration segment hints aligned when the appendix is dropped (#864 reopened)', () => {
    const parsed = parseDmResponse(
      response({
        text: `${OPENING_NARRATION}\n\n${OPENING_OPTIONS.join('\n')}`,
        options: OPENING_OPTIONS,
        narration_segments: [
          { type: 'dm', character: null, voice_category: null, text: OPENING_NARRATION },
        ],
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(OPENING_NARRATION);
    const segmentText = (parsed.data.narration_segments ?? []).map((s) => s.text).join('\n');
    expect(segmentText).toContain('Rain hammers the shutters');
    expect(segmentText).not.toContain('Take the map');
  });

  test('never empties the text: a reply that is only the option list is kept (#864 reopened)', () => {
    const text = OPENING_OPTIONS.join('\n');
    const parsed = parseDmResponse(response({ text, options: OPENING_OPTIONS }));

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.text).toBe(text);
    expect(parsed.data.options).toEqual(OPENING_OPTIONS);
  });
});

describe('stripOptionsRepeatedInText (#864 reopened)', () => {
  const NARRATION = 'Rain hammers the shutters of the Gilded Lantern.';
  const OPTIONS = [
    'A. **Take the map**, and read it by the fire.',
    'B. **Ask the stranger** who sent them.',
  ];

  test('is idempotent and a no-op on clean text', () => {
    const dirty = `${NARRATION}\n\n${OPTIONS.join('\n')}`;
    const once = stripOptionsRepeatedInText(dirty, OPTIONS);
    expect(once).toBe(NARRATION);
    expect(stripOptionsRepeatedInText(once, OPTIONS)).toBe(once);
    expect(stripOptionsRepeatedInText(NARRATION, OPTIONS)).toBe(NARRATION);
  });

  test('handles a CRLF text whose appendix uses ) markers', () => {
    const dirty = `${NARRATION}\r\n\r\nA) **Take the map**, and read it by the fire.\r\nB) **Ask the stranger** who sent them.`;
    expect(stripOptionsRepeatedInText(dirty, OPTIONS)).toBe(NARRATION);
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
      type: 'string',
      enum: [...VOICE_CATEGORY_VALUES],
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
  test('exposes the rest field with the short/long enum as a plain optional', () => {
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;

    expect(properties.rest).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { type: { type: 'string', enum: ['short', 'long'] } },
      required: ['type'],
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
    // the in-schema signal for when to populate the field (#463 precedent).
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const damage = properties.damage as unknown as Record<string, unknown>;

    expect(typeof damage.description).toBe('string');
    const description = String(damage.description);
    expect(description).toContain('hurt');
    expect(description).toContain('hit points');
    expect(description).toContain('damage');
    // #782 item 7: the pad collapsed to a plain optional — the model omits
    // the field instead of sending null.
    expect(description).toContain('omit');
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
    // the in-schema signal for when to populate the field (#310 precedent).
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const items = properties.items as unknown as Record<string, unknown>;

    expect(typeof items.description).toBe('string');
    const description = String(items.description);
    expect(description).toContain('gain');
    expect(description).toContain('lose');
    expect(description).toContain('Inventory');
    // #782 item 7: the pad collapsed to a plain optional — the model omits
    // the field instead of sending null.
    expect(description).toContain('omit');
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
    // #782 item 7: the scene_spec pad collapsed to a plain optional object.
    const properties = dmResponseSchema.properties as Record<string, Record<string, unknown>>;
    const sceneSpec = properties.scene_spec as unknown as Record<string, unknown>;
    const sceneProps = sceneSpec.properties as Record<string, unknown>;
    const required = sceneSpec.required as string[];

    expect(sceneProps).not.toHaveProperty('id');
    expect(sceneProps).not.toHaveProperty('sessionId');
    expect(required).not.toContain('id');
    expect(required).not.toContain('sessionId');
    expect(sceneProps).toHaveProperty('seed');
    expect(required).toContain('seed');
  });

  test('scene_spec is a plain optional top-level property (#782 item 7)', () => {
    // The model omits it on turns that do not start combat; combat-entry-gate
    // truthiness-guards the read, and sanitizeRefusedEnvelope re-emits null.
    expect(dmResponseSchema.required).not.toContain('scene_spec');
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

  // #782 item 7: weapon_id/spell_id/slot_level are plain optionals now, so
  // the corpus omits them rather than padding with null (an explicit null
  // fails full-schema validation, proven in llm-provider-gemini-full-schema).
  const targetedAction = {
    actor_id: 'enemy-goblin-1',
    action_type: 'attack',
    target_ids: ['pc-artha'],
    weapon_id: 'scimitar',
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

describe('dmResponseSchema map action contract (#782 item 7)', () => {
  test('a forced_move without target/mode is rejected by the parser', () => {
    // The flat schema only requires `action`; target/mode are mandatory for
    // forced_move via isMapAction (and their descriptions say so). A model
    // that omits them fails loudly here, not silently at dispatch.
    const parsed = parseDmResponse(
      response({
        map_actions: [{ action: 'forced_move' }],
      }),
    );
    expect(parsed).toEqual({
      success: false,
      issues: ['map_actions contains an invalid action'],
    });
  });

  test('a forced_move with target/mode and no other pads parses', () => {
    const parsed = parseDmResponse(
      response({
        map_actions: [
          {
            action: 'forced_move',
            target: 'goblin-1',
            mode: 'shove',
            origin: { x: 1, y: 1 },
            distance: 5,
          },
        ],
      }),
    );
    expect(parsed.success).toBe(true);
  });

  test('a move action with omitted entityId still parses', () => {
    // #782 item 7: entityId is a plain optional; dispatch refuses the missing
    // entity with an invalid_action refusal instead of a parse failure.
    const parsed = parseDmResponse(
      response({
        map_actions: [{ action: 'move', x: 3, y: 4 }],
      }),
    );
    expect(parsed.success).toBe(true);
  });
});
